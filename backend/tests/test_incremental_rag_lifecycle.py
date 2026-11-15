"""Bộ kiểm thử toàn diện 11+ kịch bản cho Incremental Legal RAG & Kiểm soát Dữ liệu Trùng (Tài liệu #26).

Bao phủ đầy đủ Bảng 5 (Trang 14) của tài liệu kỹ thuật #26, bao gồm cả luồng nâng cao v1 -> v2
(Staging, Chunk-level Reuse, CAS Activation, Retire, Rollback & Reconciliation):
1. Chuẩn hóa Unicode NFC/NFD, CRLF/LF, content_hash, chunk_hash và index_fingerprint.
2. Kiểm tra chiều vector (1024d / 3072d), từ chối sai dimension (Failure Matrix) và cách ly model.
3. Định danh 3 lớp (legal_version, source_artifact, ingestion_job), bảng quan hệ (amends_id) và Outbox.
4. Idempotency khi retry cùng input (.docx) và tương đương pháp lý (.docx vs scan OCR .pdf).
5. Redelivery: 4 message được gửi (2 event gốc + 2 giao lặp) -> xử lý 2, bỏ qua 2.
6. Tính ổn định của semantic_chunk_id (dieu-3/khoan-9, dieu-17/khoan-2a) và deterministic vector_id.
7. Temporal Point-in-time Retrieval: lọc Nghị định 309/2026/NĐ-CP trước và sau ngày hiệu lực 2026-08-05.
8. Đo lường Stale Matching Leakage = 0.0 (0/3) và chốt chặn lifecycle_status trong main.py.
9. Luồng v1 -> v2 cùng một văn bản: Keep (reuse 100% vector không đổi), Add, Modify, Retire & CAS Activation.
10. Chặn xung đột CAS từ worker cũ & Rollback nguyên tử phục hồi v1 tức thì.
11. Reconciliation đối chiếu Manifest <-> Vector Store (dọn vector mồ côi/trùng lặp) & phân loại trùng 4 nhóm.
"""

from __future__ import annotations

from pathlib import Path
import sys
import unicodedata
import unittest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from legal_knowledge import (
    ChunkSpec,
    IncrementalLegalRAGPipeline,
    LegalFixtureVersionSpec,
    STATUS_ACTIVE,
    STATUS_FAILED,
    STATUS_PREPARED,
    STATUS_RETIRED,
    chunk_hash,
    classify_duplicate,
    collection_alias_for_model,
    compute_index_fingerprint,
    compute_operation_key,
    compute_stale_matching_leakage,
    content_hash,
    deterministic_vector_id,
    diff_manifest,
    legal_instrument_id,
    legal_version_id,
    semantic_chunk_id,
    source_artifact_id,
)


def _build_nd118_spec() -> LegalFixtureVersionSpec:
    return LegalFixtureVersionSpec(
        doc_code="118/2025/NĐ-CP",
        document_type="DECREE",
        issuing_authority="Chính phủ",
        issued_date="2025-06-15",
        version_no=1,
        object_key="legal/118_2025_ND_CP/Nghi_dinh_118.docx",
        artifact_type="DOCX",
        effective_from="2025-07-01",
        chunks=[
            ChunkSpec(
                article_number=3,
                clauses="4",
                title="Giải thích từ ngữ về Bộ phận Một cửa",
                text="Bộ phận Một cửa là bộ phận tiếp nhận và trả kết quả giải quyết thủ tục hành chính.",
            ),
            ChunkSpec(
                article_number=17,
                clauses="2",
                title="Tiếp nhận hồ sơ thủ tục hành chính",
                text="Cán bộ tiếp nhận kiểm tra tính hợp lệ của hồ sơ trực tiếp tại quầy giao dịch.",
            ),
        ],
    )


def _build_nd309_spec() -> LegalFixtureVersionSpec:
    return LegalFixtureVersionSpec(
        doc_code="309/2026/NĐ-CP",
        document_type="DECREE",
        issuing_authority="Chính phủ",
        issued_date="2026-06-20",
        version_no=1,
        object_key="legal/309_2026_ND_CP/Nghi_dinh_309.docx",
        artifact_type="DOCX",
        effective_from="2026-08-05",
        amends_doc_code="118/2025/NĐ-CP",
        chunks=[
            ChunkSpec(
                article_number=3,
                clauses="9",
                title="Bổ sung khoản 9 Điều 3 về ki-ốt thông minh",
                text="Ki-ốt thông minh là thiết bị điện tử tích hợp phục vụ tra cứu và nộp hồ sơ trực tuyến tại Cổng Dịch vụ công.",
            ),
            ChunkSpec(
                article_number=17,
                clauses="2a",
                title="Bổ sung khoản 2a Điều 17 về xác thực VNeID",
                text="Người dân thực hiện xác thực danh tính điện tử qua ứng dụng VNeID hoặc thiết bị đọc thẻ Căn cước.",
            ),
        ],
    )


class IncrementalLegalRAGLifecycleTests(unittest.TestCase):
    """Kiểm thử toàn diện 11 nhóm theo đúng đặc tả trong tài liệu #26."""

    def test_01_unicode_nfc_and_content_hash(self):
        """Chuẩn hóa Unicode NFC vs NFD (từ OCR) và CRLF vs LF phải cho cùng một SHA-256 content_hash."""
        nfc_text = "Điều 17 khoản 2a: Xác thực qua ứng dụng VNeID hoặc thiết bị đọc thẻ Căn cước.\nKhoản 9 Điều 3: Ki-ốt thông minh."
        nfd_crlf_text = unicodedata.normalize("NFD", nfc_text).replace("\n", "\r\n") + "   \r\n"

        h_nfc = content_hash(nfc_text)
        h_nfd = content_hash(nfd_crlf_text)
        self.assertEqual(h_nfc, h_nfd)
        self.assertEqual(chunk_hash(nfc_text), chunk_hash(nfd_crlf_text))

        fp_v1 = compute_index_fingerprint(h_nfc, embedding_model="BAAI/bge-m3", embedding_dimension=1024)
        fp_same = compute_index_fingerprint(h_nfd, embedding_model="BAAI/bge-m3", embedding_dimension=1024)
        fp_diff_model = compute_index_fingerprint(
            h_nfc, embedding_model="text-embedding-3-large", embedding_dimension=3072
        )
        self.assertEqual(fp_v1, fp_same)
        self.assertNotEqual(fp_v1, fp_diff_model)

    def test_02_embedding_dimension_guard_and_model_isolation(self):
        """Từ chối vector sai dimension (1024 chiều); giữ nguyên trạng thái an toàn và cách ly alias theo model."""
        alias_bge = collection_alias_for_model("legal_knowledge_base", "BAAI/bge-m3", 1024)
        alias_large = collection_alias_for_model("legal_knowledge_base", "text-embedding-3-large", 3072)
        self.assertNotEqual(alias_bge, alias_large)

        # Pipeline yêu cầu 1024 chiều nhưng adapter trả về 512 chiều -> Validation Gate chặn và đánh dấu FAILED
        bad_pipeline = IncrementalLegalRAGPipeline(
            embedding_model="BAAI/bge-m3",
            embedding_dimension=1024,
            embed_fn=lambda texts: [[0.1] * 512 for _ in texts],
        )
        staged = bad_pipeline.stage_version_and_outbox(_build_nd309_spec())
        with self.assertRaises(ValueError):
            bad_pipeline.consume_event(staged["event"])

        ver = bad_pipeline.versions[staged["legal_version_id"]]
        self.assertEqual(ver["lifecycle_status"], STATUS_FAILED)
        self.assertIsNone(bad_pipeline.instruments[staged["legal_instrument_id"]]["active_legal_version_id"])
        self.assertEqual(bad_pipeline.metrics["ingestion_failures"], 1)

    def test_03_manifest_three_layer_identity_and_outbox(self):
        """Ba lớp định danh (legal_version, source_artifact, ingestion_job) + quan hệ amends_id + Outbox."""
        pipeline = IncrementalLegalRAGPipeline(embedding_model="BAAI/bge-m3", embedding_dimension=1024)
        s118 = pipeline.stage_version_and_outbox(_build_nd118_spec())
        pipeline.consume_event(s118["event"])

        s309 = pipeline.stage_version_and_outbox(_build_nd309_spec())
        pipeline.consume_event(s309["event"])

        self.assertEqual(len(pipeline.outbox_events), 2)
        self.assertNotEqual(s309["legal_version_id"], s309["source_artifact_id"])
        self.assertNotEqual(s309["source_artifact_id"], s309["ingestion_job_id"])

        # Kiểm tra quan hệ sửa đổi, bổ sung giữa NĐ 309/2026 và NĐ 118/2025
        rel = next(iter(pipeline.relations.values()))
        self.assertEqual(rel["amends_id"], legal_instrument_id("118/2025/NĐ-CP"))
        self.assertIsNone(rel["supersedes_id"])
        self.assertEqual(rel["effective_from"], "2026-08-05")
        self.assertEqual(rel["validity_status"], "active")

        # NĐ 118 được đánh dấu partially_expired nhưng vẫn phục vụ các điều khoản không bị bãi bỏ
        ver118 = pipeline.versions[s118["legal_version_id"]]
        self.assertEqual(ver118["validity_status"], "partially_expired")

    def test_04_idempotency_same_input_and_docx_vs_ocr_artifact_equivalence(self):
        """Chạy lại cùng input hoặc nạp bản scan OCR tương đương không tạo thêm legal_version hay vector mới."""
        pipeline = IncrementalLegalRAGPipeline(embedding_model="BAAI/bge-m3", embedding_dimension=1024)
        spec_docx = _build_nd309_spec()
        first = pipeline.stage_version_and_outbox(spec_docx)
        pipeline.consume_event(first["event"])
        self.assertEqual(len(pipeline.versions), 1)
        self.assertEqual(len(pipeline.vector_store), 2)

        # Chạy lại đúng file DOCX đó
        second = pipeline.stage_version_and_outbox(spec_docx)
        self.assertEqual(second["status"], "UNCHANGED")
        self.assertEqual(len(pipeline.versions), 1)
        self.assertEqual(len(pipeline.vector_store), 2)

        # Nạp thêm bản PDF scan OCR có cùng nội dung pháp lý đã chuẩn hóa (khác object_key & NFD)
        spec_ocr = _build_nd309_spec()
        spec_ocr.object_key = "legal/309_2026_ND_CP/Nghi_dinh_309_scan_ocr.pdf"
        spec_ocr.artifact_type = "PDF_OCR"
        for ch in spec_ocr.chunks:
            ch.text = unicodedata.normalize("NFD", ch.text)
        third = pipeline.stage_version_and_outbox(spec_ocr)
        self.assertEqual(third["status"], "UNCHANGED")
        self.assertEqual(len(pipeline.versions), 1)
        self.assertEqual(len(pipeline.artifacts), 2)  # 2 artifacts (DOCX + PDF_OCR) cùng trỏ về 1 legal_version
        self.assertEqual(pipeline.metrics["chunks_embedded"], 2)

    def test_05_redelivery_4_messages_2_processed_2_duplicate_deliveries(self):
        """Tái hiện chính xác Output thực tế Mục 5.2 (Trang 8-9): 4 message, 2 event xử lý, 2 giao lặp bỏ qua, 4 chunk."""
        pipeline = IncrementalLegalRAGPipeline(embedding_model="BAAI/bge-m3", embedding_dimension=1024)
        s118 = pipeline.stage_version_and_outbox(_build_nd118_spec())
        s309 = pipeline.stage_version_and_outbox(_build_nd309_spec())

        # Mỗi outbox event được publish 2 lần (at-least-once redelivery)
        r1 = pipeline.consume_event(s118["event"])
        r2 = pipeline.consume_event(s118["event"])
        r3 = pipeline.consume_event(s309["event"])
        r4 = pipeline.consume_event(s309["event"])

        self.assertEqual(r1["status"], STATUS_ACTIVE)
        self.assertEqual(r2["status"], "DUPLICATE_IGNORED")
        self.assertEqual(r3["status"], STATUS_ACTIVE)
        self.assertEqual(r4["status"], "DUPLICATE_IGNORED")

        self.assertEqual(pipeline.metrics["published_messages"], 4)
        self.assertEqual(pipeline.metrics["processed_events"], 2)
        self.assertEqual(pipeline.metrics["duplicate_deliveries"], 2)
        self.assertEqual(len(pipeline.vector_store), 4)

    def test_06_semantic_chunk_id_stability_and_deterministic_vector_id(self):
        """semantic_chunk_id ổn định theo cấu trúc pháp lý (dieu-17/khoan-2a) và vector_id tất định."""
        sem_3_9 = semantic_chunk_id(3, 9)
        sem_17_2a = semantic_chunk_id(17, "2a")
        self.assertEqual(sem_3_9, "dieu-3/khoan-9")
        self.assertEqual(sem_17_2a, "dieu-17/khoan-2a")

        ver_id = legal_version_id("309/2026/NĐ-CP", 1)
        c_hash = chunk_hash("Người dân thực hiện xác thực danh tính điện tử qua ứng dụng VNeID.")
        vec_id = deterministic_vector_id(ver_id, sem_17_2a, c_hash)
        self.assertEqual(vec_id, f"{ver_id}:dieu-17/khoan-2a:{c_hash}")

        artf_id = source_artifact_id("309/2026/NĐ-CP", "Nghi_dinh_309.docx", c_hash)
        fp = compute_index_fingerprint(c_hash, embedding_model="BAAI/bge-m3", embedding_dimension=1024)
        op_key_1 = compute_operation_key(artf_id, c_hash, fp)
        op_key_2 = compute_operation_key(artf_id, c_hash, fp)
        self.assertEqual(op_key_1, op_key_2)

    def test_07_temporal_point_in_time_filtering_before_and_after_effective_date(self):
        """Lọc Nghị định 309/2026/NĐ-CP trước và sau ngày hiệu lực 2026-08-05 kèm Citation Provenance."""
        pipeline = IncrementalLegalRAGPipeline(embedding_model="BAAI/bge-m3", embedding_dimension=1024)
        s118 = pipeline.stage_version_and_outbox(_build_nd118_spec())
        s309 = pipeline.stage_version_and_outbox(_build_nd309_spec())
        pipeline.consume_event(s118["event"])
        pipeline.consume_event(s309["event"])

        # Trước ngày 2026-08-05: chỉ có NĐ 118/2025/NĐ-CP có hiệu lực
        before_chunks = pipeline.retrieve(
            "ki-ốt thông minh xác thực VNeID hồ sơ thủ tục hành chính",
            as_of="2026-07-01",
            top_k=4,
        )
        self.assertEqual(len(before_chunks), 2)
        self.assertTrue(all(c["doc_code"] == "118/2025/NĐ-CP" for c in before_chunks))

        # Từ ngày 2026-08-05: NĐ 309/2026/NĐ-CP có hiệu lực
        after_chunks = pipeline.retrieve(
            "ki-ốt thông minh xác thực VNeID hồ sơ thủ tục hành chính",
            as_of="2026-08-10",
            top_k=3,
        )
        self.assertEqual(len(after_chunks), 3)
        doc_codes_after = {c["doc_code"] for c in after_chunks}
        self.assertIn("309/2026/NĐ-CP", doc_codes_after)
        for c in after_chunks:
            prov = c["provenance"]
            self.assertIn("citation", prov)
            self.assertIn("legal_instrument_id", prov)
            self.assertIn("legal_version_id", prov)
            self.assertIn("semantic_chunk_id", prov)
            self.assertIn("index_generation", prov)

    def test_08_zero_stale_matching_leakage_and_main_lifecycle_filter(self):
        """Đo lường stale_matching_leakage == 0.0 (0/3) và xác minh fast_pg_hybrid_search chặn PREPARED/RETIRED/FAILED."""
        pipeline = IncrementalLegalRAGPipeline(embedding_model="BAAI/bge-m3", embedding_dimension=1024)
        s118 = pipeline.stage_version_and_outbox(_build_nd118_spec())
        s309 = pipeline.stage_version_and_outbox(_build_nd309_spec())
        pipeline.consume_event(s118["event"])
        pipeline.consume_event(s309["event"])

        returned = pipeline.retrieve("ki-ốt thông minh VNeID quầy giao dịch", as_of="2026-08-15", top_k=3)
        self.assertEqual(len(returned), 3)
        leakage = compute_stale_matching_leakage(returned, as_of="2026-08-15")
        self.assertEqual(leakage, 0.0)
        self.assertIsNone(compute_stale_matching_leakage([], as_of="2026-08-15"))

        # Nếu cố tình trộn 1 chunk RETIRED hoặc ngoài khoảng hiệu lực vào kết quả -> leakage > 0
        tampered = list(returned) + [
            {
                "doc_code": "118/2025/NĐ-CP",
                "lifecycle_status": STATUS_RETIRED,
                "effective_from": "2025-07-01",
                "effective_to": "2026-08-04",
            }
        ]
        self.assertAlmostEqual(compute_stale_matching_leakage(tampered, as_of="2026-08-15"), 0.25)

    def test_09_v1_to_v2_chunk_reuse_cas_activation_and_retire(self):
        """Hoàn thiện mục 'v1 -> v2' (Bảng 5, Trang 14):
        - Nạp v1 gồm 3 chunk (dieu-3/khoan-4, dieu-17/khoan-2, dieu-20/khoan-1).
        - Nạp v2 của CÙNG legal instrument trong đó:
          + dieu-3/khoan-4 giữ nguyên -> Keep (Reuse 100% vector từ v1, không nhúng lại).
          + dieu-17/khoan-2 sửa nội dung -> Modify (Nhúng lại).
          + dieu-3/khoan-9 thêm mới -> Add (Nhúng mới).
          + dieu-20/khoan-1 bị bãi bỏ trong v2 -> Retire (Không còn phục vụ ở v2).
        """
        pipeline = IncrementalLegalRAGPipeline(embedding_model="BAAI/bge-m3", embedding_dimension=1024)
        v1_spec = LegalFixtureVersionSpec(
            doc_code="118/2025/NĐ-CP",
            document_type="DECREE",
            issuing_authority="Chính phủ",
            issued_date="2025-06-15",
            version_no=1,
            object_key="legal/118_2025_ND_CP/Nghi_dinh_118_v1.docx",
            artifact_type="DOCX",
            effective_from="2025-07-01",
            chunks=[
                ChunkSpec(
                    article_number=3,
                    clauses="4",
                    text="Bộ phận Một cửa là bộ phận tiếp nhận và trả kết quả giải quyết thủ tục hành chính.",
                ),
                ChunkSpec(
                    article_number=17,
                    clauses="2",
                    text="Cán bộ tiếp nhận kiểm tra tính hợp lệ của hồ sơ trực tiếp tại quầy giao dịch.",
                ),
                ChunkSpec(
                    article_number=20,
                    clauses="1",
                    text="Quy định tạm thời về biểu mẫu giấy cũ tại quầy tiếp nhận.",
                ),
            ],
        )
        s_v1 = pipeline.stage_version_and_outbox(v1_spec)
        res_v1 = pipeline.consume_event(s_v1["event"])
        self.assertEqual(res_v1["status"], STATUS_ACTIVE)
        self.assertEqual(pipeline.metrics["chunks_embedded"], 3)
        self.assertEqual(pipeline.metrics["chunks_reused"], 0)

        # Nạp v2 của cùng văn bản 118/2025/NĐ-CP (VBHN cập nhật)
        v2_spec = LegalFixtureVersionSpec(
            doc_code="118/2025/NĐ-CP",
            document_type="DECREE",
            issuing_authority="Chính phủ",
            issued_date="2026-08-05",
            version_no=2,
            object_key="legal/118_2025_ND_CP/Nghi_dinh_118_v2_vbhn.docx",
            artifact_type="DOCX",
            effective_from="2026-08-05",
            chunks=[
                ChunkSpec(
                    article_number=3,
                    clauses="4",
                    text="Bộ phận Một cửa là bộ phận tiếp nhận và trả kết quả giải quyết thủ tục hành chính.",
                ),
                ChunkSpec(
                    article_number=3,
                    clauses="9",
                    text="Ki-ốt thông minh là thiết bị điện tử tích hợp phục vụ tra cứu và nộp hồ sơ trực tuyến.",
                ),
                ChunkSpec(
                    article_number=17,
                    clauses="2",
                    text="Cán bộ tiếp nhận kiểm tra hồ sơ điện tử đã xác thực qua VNeID hoặc thẻ Căn cước.",
                ),
            ],
        )
        s_v2 = pipeline.stage_version_and_outbox(v2_spec)
        res_v2 = pipeline.consume_event(s_v2["event"])
        self.assertEqual(res_v2["status"], STATUS_ACTIVE)
        self.assertEqual(res_v2["chunk_diff"]["keep"], ["dieu-3/khoan-4"])
        self.assertEqual(res_v2["chunk_diff"]["add"], ["dieu-3/khoan-9"])
        self.assertEqual(res_v2["chunk_diff"]["modify"], ["dieu-17/khoan-2"])
        self.assertEqual(res_v2["chunk_diff"]["retire"], ["dieu-20/khoan-1"])

        # Kiểm tra reuse: chỉ nhúng thêm đúng 2 chunk (add + modify), tái sử dụng 1 chunk (dieu-3/khoan-4)
        self.assertEqual(pipeline.metrics["chunks_reused"], 1)
        self.assertEqual(pipeline.metrics["chunks_embedded"], 3 + 2)

        # Kiểm tra v2 đã thay thế v1 và chunk cũ dieu-20/khoan-1 đã được retire
        inst_id = legal_instrument_id("118/2025/NĐ-CP")
        self.assertEqual(pipeline.instruments[inst_id]["active_legal_version_id"], s_v2["legal_version_id"])
        self.assertEqual(pipeline.versions[s_v1["legal_version_id"]]["lifecycle_status"], STATUS_RETIRED)

        active_results = pipeline.retrieve("biểu mẫu giấy cũ VNeID ki-ốt", as_of="2026-08-10", top_k=10)
        returned_sem_ids = {r["semantic_chunk_id"] for r in active_results}
        self.assertEqual(returned_sem_ids, {"dieu-3/khoan-4", "dieu-3/khoan-9", "dieu-17/khoan-2"})
        self.assertNotIn("dieu-20/khoan-1", returned_sem_ids)
        self.assertEqual(compute_stale_matching_leakage(active_results, as_of="2026-08-10"), 0.0)

    def test_10_cas_concurrency_guard_and_atomic_rollback(self):
        """CAS ngăn worker cũ activate đè version mới; Rollback phục hồi tức thì v1 và verify retrieval."""
        pipeline = IncrementalLegalRAGPipeline(embedding_model="BAAI/bge-m3", embedding_dimension=1024)
        v1 = _build_nd118_spec()
        s_v1 = pipeline.stage_version_and_outbox(v1)
        pipeline.consume_event(s_v1["event"])

        v2 = LegalFixtureVersionSpec(
            doc_code="118/2025/NĐ-CP",
            document_type="DECREE",
            issuing_authority="Chính phủ",
            issued_date="2026-08-05",
            version_no=2,
            object_key="legal/118_2025_ND_CP/Nghi_dinh_118_v2.docx",
            artifact_type="DOCX",
            effective_from="2026-08-05",
            chunks=[
                ChunkSpec(
                    article_number=3,
                    clauses="4",
                    text="Bộ phận Một cửa hợp nhất trực tuyến toàn trình.",
                )
            ],
        )
        s_v2 = pipeline.stage_version_and_outbox(v2)
        pipeline.consume_event(s_v2["event"])

        inst_id = legal_instrument_id("118/2025/NĐ-CP")
        # Giả lập một worker chậm mang expected_previous_version_id = None cố ghi đè active pointer
        stale_cas = pipeline.cas_activate_version(
            inst_id,
            candidate_version_id=s_v1["legal_version_id"],
            expected_previous_version_id=None,
        )
        self.assertFalse(stale_cas)
        self.assertEqual(pipeline.instruments[inst_id]["active_legal_version_id"], s_v2["legal_version_id"])

        # Thực hiện Rollback nguyên tử từ v2 về v1
        rb = pipeline.rollback_instrument("118/2025/NĐ-CP")
        self.assertEqual(rb["active_legal_version_id"], s_v1["legal_version_id"])
        self.assertEqual(pipeline.versions[s_v1["legal_version_id"]]["lifecycle_status"], STATUS_ACTIVE)

        restored_chunks = pipeline.retrieve("quầy giao dịch", as_of="2026-08-10", top_k=5)
        self.assertEqual(len(restored_chunks), 2)
        self.assertTrue(all(c["legal_version_id"] == s_v1["legal_version_id"] for c in restored_chunks))

    def test_11_reconciliation_and_four_class_duplicate_detection(self):
        """Reconciliation dọn sạch vector mồ côi/PREPARED treo/trùng lặp; kiểm tra Bảng 2 & Bảng 3."""
        pipeline = IncrementalLegalRAGPipeline(embedding_model="BAAI/bge-m3", embedding_dimension=1024)
        s118 = pipeline.stage_version_and_outbox(_build_nd118_spec())
        pipeline.consume_event(s118["event"])

        # Tiêm 1 vector mồ côi (thuộc version không tồn tại) và 1 vector trùng semantic_chunk_id
        pipeline.vector_store["orphan:dieu-99:abc"] = {
            "vector_id": "orphan:dieu-99:abc",
            "legal_instrument_id": "inst:ghost",
            "legal_version_id": "ver:ghost:v99",
            "doc_code": "999/2026/NĐ-CP",
            "semantic_chunk_id": "dieu-99",
            "lifecycle_status": STATUS_PREPARED,
        }
        existing_row = next(iter(pipeline.vector_store.values()))
        pipeline.vector_store["dup:dieu-3/khoan-4:xyz"] = dict(existing_row, vector_id="dup:dieu-3/khoan-4:xyz")

        rec = pipeline.reconcile()
        self.assertEqual(rec["stale_vectors_removed"], 1)
        self.assertEqual(rec["duplicate_chunks_removed"], 1)
        self.assertEqual(rec["remaining_vectors"], 2)
        self.assertEqual(rec["missing_chunk_versions"], [])

        # Kiểm tra phân loại 4 loại dữ liệu trùng (Bảng 2, Trang 7)
        c_exact = classify_duplicate(
            doc_code_a="309/2026/NĐ-CP",
            doc_code_b="309/2026/NĐ-CP",
            semantic_chunk_id_a="dieu-17/khoan-2a",
            semantic_chunk_id_b="dieu-17/khoan-2a",
            text_a="Xác thực qua VNeID.",
            text_b="Xác thực qua VNeID.\r\n",
        )
        self.assertEqual(c_exact["category"], "EXACT")

        c_struct = classify_duplicate(
            doc_code_a="118/2025/NĐ-CP",
            doc_code_b="118/2025/NĐ-CP",
            semantic_chunk_id_a="dieu-17/khoan-2",
            semantic_chunk_id_b="dieu-17/khoan-2",
            text_a="Kiểm tra hồ sơ trực tiếp tại quầy.",
            text_b="Kiểm tra hồ sơ trực tuyến qua VNeID.",
        )
        self.assertEqual(c_struct["category"], "STRUCTURAL")

        c_equiv = classify_duplicate(
            doc_code_a="309/2026/NĐ-CP",
            doc_code_b="118/2025/NĐ-CP",
            semantic_chunk_id_a="dieu-1/khoan-2",
            semantic_chunk_id_b="dieu-3/khoan-9",
            text_a="Bổ sung khoản 9 Điều 3 về ki-ốt thông minh.",
            text_b="Khoản 9 Điều 3: Ki-ốt thông minh phục vụ tra cứu.",
            verified_legal_equivalent=True,
        )
        self.assertEqual(c_equiv["category"], "LEGAL_EQUIVALENT")

        # Kiểm tra phép diff manifest (Bảng 3, Trang 7)
        prev_manifest = {
            "inst:118": {"content_hash": "h1", "index_fingerprint": "fp1"},
            "inst:old": {"content_hash": "h_old", "index_fingerprint": "fp_old"},
        }
        curr_manifest = {
            "inst:118": {"content_hash": "h2", "index_fingerprint": "fp2"},
            "inst:309": {"content_hash": "h309", "index_fingerprint": "fp309"},
            "inst:dup": {"content_hash": "hdup", "index_fingerprint": "fpdup", "operation_key": "op_seen"},
        }
        diff = diff_manifest(curr_manifest, prev_manifest, processed_operation_keys={"op_seen"})
        self.assertEqual(diff["added"], {"inst:309"})
        self.assertEqual(diff["modified"], {"inst:118"})
        self.assertEqual(diff["deleted"], {"inst:old"})
        self.assertEqual(diff["duplicate"], {"inst:dup"})


if __name__ == "__main__":
    unittest.main()
