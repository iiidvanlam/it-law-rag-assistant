"""Kiểm thử Hạng mục 1: Chống trùng lặp dữ liệu, Chunk Hash, Idempotency & Stale Matching Leakage.

Bao phủ đầy đủ 3 trụ cột:
1. Chuẩn hóa Unicode NFC & Hash Tất định (`legal_parser.py` & `legal_knowledge.py`):
   - Cùng nội dung điều luật ở dạng NFD (OCR), NFC, CRLF vs LF, khoảng trắng thừa đều sinh cùng
     `normalize_text()` và cùng mã băm `provision_version_id()` (SHA-256 64 ký tự hex).
2. Tính Idempotent khi Nạp lại Văn bản & Sự kiện (`ingest.py` & `graph_ingest.py`):
   - Khóa định danh `article_id`, `clause_id`, `provision_version_id`, `semantic_chunk_id`, `deterministic_vector_id`
     tất định theo cấu trúc pháp lý (`doc_code:Điều X:Khoản Y`), độc lập với đường dẫn file hay `mtime`.
   - Cơ chế `skip_sources` / `content_hash` trong `ingest.py` và `MERGE` trong `graph_ingest._write_skeleton`
     hoạt động idempotent: nạp lại cùng văn bản không sinh bản sao node `:Article`, `:Clause`, `:Action`,
     `:Penalty` hay `:ProvisionVersion` dư thừa.
3. Đo lường `stale_matching_leakage == 0.0`:
   - Tại `as_of_date = 2026-11-02`: điều khoản hết hiệu lực `2026-06-30` (`15/2020/NĐ-CP`, `24/2018/QH14`,
     `67/2006/QH11`, `86/2015/QH13`) có `inactive_chunks_returned == 0` (`stale_matching_leakage == 0.0`).
   - Tại `as_of_date = 2026-06-30`: văn bản tương lai (`174/2026/NĐ-CP`, `330/2026/NĐ-CP`, `116/2025/QH15`)
     không lọt vào kết quả (`stale_matching_leakage == 0.0`).
   - Sửa đổi cục bộ cấp Điều/Khoản: Nghị định `211/2025/NĐ-CP` sửa đổi Điều `93a, 93b, 114, 114a` của
     Nghị định `15/2020/NĐ-CP` cập nhật phiên bản mới từ `2025-09-09` và bảo toàn `historical_articles`
     trước ngày sửa đổi (`effective_to == "2025-09-08"`).
"""

from __future__ import annotations

from datetime import date
import os
from pathlib import Path
import re
import sys
import unicodedata
import unittest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import graph_ingest
import ingest
from legal_knowledge import (
    ChunkSpec,
    IncrementalLegalRAGPipeline,
    LegalFixtureVersionSpec,
    chunk_hash,
    compute_stale_matching_leakage,
    content_hash,
    deterministic_vector_id,
    is_effective_on,
    legal_version_id,
    provision_version_id,
    semantic_chunk_id,
)
from legal_parser import (
    Article,
    Clause,
    LegalDocument,
    Point,
    apply_211_amendments_to_15,
    apply_effective_dates,
    article_id,
    clause_id,
    normalize_text,
)
import main


class _IdempotentMockTx:
    """Bộ mô phỏng giao dịch Neo4j thực thi ngữ nghĩa MERGE theo khóa định danh của graph_ingest._write_skeleton."""

    def __init__(self) -> None:
        self.nodes: dict[tuple[str, str], dict] = {}
        self.queries: list[str] = []

    def run(self, query: str, **params):
        self.queries.append(query)
        q = " ".join(query.split())

        if "RETURN a.text AS text" in q:
            key = ("Article", str(params.get("id")))
            node = self.nodes.get(key)
            if node is None:
                return _MockResult(None)
            return _MockResult({"text": node.get("text")})

        if "MERGE (d:LegalDoc {code: $code})" in q:
            self.nodes[("LegalDoc", str(params["code"]))] = {"code": params["code"], "title": params.get("title")}
            self.nodes[("Article", str(params["id"]))] = {
                "id": params["id"],
                "text": params.get("text"),
                "doc_code": params["code"],
            }

        if "MERGE (v:ProvisionVersion {id: $version_id})" in q:
            self.nodes[("ProvisionVersion", str(params["version_id"]))] = {
                "id": params["version_id"],
                "article_id": params.get("article_id"),
                "text": params.get("text"),
            }

        if "MERGE (k:Clause {id: c.id})" in q:
            for cl in params.get("clauses") or []:
                self.nodes[("Clause", str(cl["id"]))] = dict(cl)
                for pt in cl.get("points") or []:
                    self.nodes[("Point", str(pt["id"]))] = dict(pt)

        if "MERGE (act:Action {id: x.id})" in q:
            for act in params.get("actions") or []:
                self.nodes[("Action", str(act["id"]))] = dict(act)
                pen = act.get("penalty")
                if isinstance(pen, dict) and pen.get("id"):
                    self.nodes[("Penalty", str(pen["id"]))] = dict(pen)

        if "MERGE (n:Sanction {id: s.id})" in q:
            for sanc in params.get("sanctions") or []:
                self.nodes[("Sanction", str(sanc["id"]))] = dict(sanc)

        return _MockResult(None)

    def count_label(self, label: str) -> int:
        return sum(1 for lbl, _ in self.nodes if lbl == label)


class _MockResult:
    def __init__(self, row: dict | None) -> None:
        self._row = row

    def single(self):
        return self._row

    def consume(self):
        return None


class DataLifecycleAndDedupTests(unittest.TestCase):
    """Kiểm thử toàn diện Hạng mục 1: NFC Normalization, Idempotency & Stale Matching Leakage = 0.0."""

    def test_01_unicode_nfc_and_deterministic_provision_version_id(self):
        """Cùng một nội dung điều luật ở NFD, NFC, CRLF vs LF và khoảng trắng thừa sinh cùng normalize_text & provision_version_id."""
        raw_nfc = (
            "Điều 101. Vi phạm các quy định về trách nhiệm sử dụng dịch vụ mạng xã hội\n"
            "1. Phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng đối với hành vi lợi dụng mạng xã hội "
            "để cung cấp, chia sẻ thông tin giả mạo, thông tin sai sự thật."
        )
        raw_nfd_crlf = (
            unicodedata.normalize("NFD", raw_nfc)
            .replace("\n", "\r\n")
            .replace("10.000.000 đồng", "10.000.000   đồng\t ")
            + "   \r\n"
        )
        raw_broken_syllable = raw_nfc.replace("vi phạm", "vi ph ạm").replace("pháp luật", "pháp lu ật")

        norm_from_nfc = normalize_text(raw_nfc)
        norm_from_nfd = normalize_text(raw_nfd_crlf)
        norm_from_broken = normalize_text(raw_broken_syllable)

        self.assertEqual(norm_from_nfc, norm_from_nfd)
        self.assertEqual(norm_from_nfc, norm_from_broken)
        self.assertEqual(content_hash(raw_nfc), content_hash(raw_nfd_crlf))
        self.assertEqual(chunk_hash(raw_nfc), chunk_hash(raw_nfd_crlf))

        # provision_version_id phải trả về SHA-256 64 ký tự hex trùng khớp tuyệt đối
        pvid_nfc = provision_version_id(
            doc_code="15/2020/NĐ-CP",
            article_number=101,
            source_file="data/2022_645_646_08-vbhn-btttt.pdf",
            text=raw_nfc,
            effective_from="2020-04-15",
            effective_to="2026-06-30",
        )
        pvid_nfd = provision_version_id(
            doc_code=unicodedata.normalize("NFD", "15/2020/NĐ-CP "),
            article_number="101",
            source_file=r"C:\fakepath\subdir\2022_645_646_08-vbhn-btttt.pdf",
            text=raw_nfd_crlf,
            effective_from=date(2020, 4, 15),
            effective_to=date(2026, 6, 30),
        )
        self.assertEqual(len(pvid_nfc), 64)
        self.assertTrue(bool(re.fullmatch(r"[0-9a-f]{64}", pvid_nfc)))
        self.assertEqual(pvid_nfc, pvid_nfd)

    def test_02_deterministic_structural_keys_and_idempotent_graph_and_vector_ingest(self):
        """Khóa định danh tất định theo cấu trúc pháp lý và nạp lại cùng văn bản không tạo bản sao node hay chunk."""
        # 1. Định danh tất định theo doc_code:Điều X:Khoản Y
        aid_nfc = article_id("15/2020/NĐ-CP", 101)
        aid_nfd = article_id(unicodedata.normalize("NFD", " 15/2020/NĐ-CP "), "101")
        self.assertEqual(aid_nfc, "15/2020/NĐ-CP:Điều 101")
        self.assertEqual(aid_nfc, aid_nfd)

        cid_nfc = clause_id("15/2020/NĐ-CP", 101, 1)
        cid_nfd = clause_id(unicodedata.normalize("NFD", "15/2020/NĐ-CP"), "101", "1")
        self.assertEqual(cid_nfc, "15/2020/NĐ-CP:Điều 101:Khoản 1")
        self.assertEqual(cid_nfc, cid_nfd)
        self.assertEqual(legal_version_id("15/2020/NĐ-CP", 1), "ver:15-2020-nd-cp:v1")
        self.assertEqual(semantic_chunk_id(101, "1"), "dieu-101/khoan-1")

        # 2. Tạo một LegalDocument mẫu và kiểm tra idempotency khi gọi build_chunks_for_document & _write_skeleton 2 lần
        art = Article(
            doc_code="174/2026/NĐ-CP",
            number=95,
            title="Vi phạm các quy định về trách nhiệm sử dụng dịch vụ mạng xã hội",
            chapter="V",
            text=(
                "Điều 95. Vi phạm các quy định về trách nhiệm sử dụng dịch vụ mạng xã hội\n"
                "1. Phạt tiền từ 20.000.000 đồng đến 30.000.000 đồng đối với một trong các hành vi sau:\n"
                "a) Cung cấp, chia sẻ thông tin giả mạo, thông tin sai sự thật;\n"
                "b) Cung cấp, chia sẻ thông tin bịa đặt, gây hoang mang trong Nhân dân.\n"
                "3. Biện pháp khắc phục hậu quả:\n"
                "a) Buộc gỡ bỏ thông tin sai sự thật hoặc gây nhầm lẫn đối với hành vi vi phạm tại khoản 1 Điều này."
            ),
            source="C:/path_one/174-2026-ndcp.docx",
            page=42,
            effective_from="2026-07-01",
            effective_to=None,
            clauses=[
                Clause(
                    number=1,
                    text="Phạt tiền từ 20.000.000 đồng đến 30.000.000 đồng đối với một trong các hành vi sau:",
                    fine_min=20_000_000,
                    fine_max=30_000_000,
                    points=[
                        Point(letter="a", text="Cung cấp, chia sẻ thông tin giả mạo, thông tin sai sự thật;"),
                        Point(letter="b", text="Cung cấp, chia sẻ thông tin bịa đặt, gây hoang mang trong Nhân dân."),
                    ],
                ),
                Clause(
                    number=3,
                    text="Biện pháp khắc phục hậu quả: a) Buộc gỡ bỏ thông tin sai sự thật đối với khoản 1 Điều này.",
                    points=[
                        Point(letter="a", text="Buộc gỡ bỏ thông tin sai sự thật đối với khoản 1 Điều này."),
                    ],
                ),
            ],
        )
        doc_run1 = LegalDocument(
            code="174/2026/NĐ-CP",
            title="Nghị định 174/2026/NĐ-CP",
            short="Nghị định 174/2026/NĐ-CP",
            doc_type="DECREE",
            effective_from="2026-07-01",
            sources=["174-2026-ndcp.docx"],
            articles=[art],
        )
        # Lần 2 đổi đường dẫn thư mục chứa file nhưng giữ nguyên tên file và nội dung
        art_run2 = Article(
            doc_code=art.doc_code,
            number=art.number,
            title=art.title,
            chapter=art.chapter,
            text=art.text,
            source="/var/tmp/another_dir/174-2026-ndcp.docx",
            page=art.page,
            effective_from=art.effective_from,
            effective_to=art.effective_to,
            clauses=art.clauses,
        )
        doc_run2 = LegalDocument(
            code="174/2026/NĐ-CP",
            title="Nghị định 174/2026/NĐ-CP",
            short="Nghị định 174/2026/NĐ-CP",
            doc_type="DECREE",
            effective_from="2026-07-01",
            sources=["174-2026-ndcp.docx"],
            articles=[art_run2],
        )

        self.assertEqual(ingest.document_content_hash(doc_run1), ingest.document_content_hash(doc_run2))
        chunks_1 = ingest.build_chunks_for_document(doc_run1, {"174-2026-ndcp.docx": "abc123"})
        chunks_2 = ingest.build_chunks_for_document(doc_run2, {"174-2026-ndcp.docx": "abc123"})
        self.assertEqual(len(chunks_1), len(chunks_2))
        for c1, c2 in zip(chunks_1, chunks_2):
            v1 = deterministic_vector_id(
                c1.metadata["legal_version_id"],
                c1.metadata["semantic_chunk_id"],
                c1.metadata["chunk_hash"],
            )
            v2 = deterministic_vector_id(
                c2.metadata["legal_version_id"],
                c2.metadata["semantic_chunk_id"],
                c2.metadata["chunk_hash"],
            )
            self.assertEqual(v1, v2)

        # Kiểm tra _write_skeleton trong graph_ingest.py thực thi MERGE idempotent
        tx = _IdempotentMockTx()
        stats_1 = graph_ingest._write_skeleton(tx, doc_run1, art)
        snapshot_counts_1 = {
            lbl: tx.count_label(lbl)
            for lbl in ("LegalDoc", "Article", "ProvisionVersion", "Clause", "Point", "Action", "Penalty", "Sanction")
        }
        stats_2 = graph_ingest._write_skeleton(tx, doc_run2, art_run2)
        snapshot_counts_2 = {
            lbl: tx.count_label(lbl)
            for lbl in ("LegalDoc", "Article", "ProvisionVersion", "Clause", "Point", "Action", "Penalty", "Sanction")
        }
        self.assertEqual(stats_1, stats_2)
        self.assertEqual(snapshot_counts_1, snapshot_counts_2)
        self.assertEqual(snapshot_counts_2["Article"], 1)
        self.assertEqual(snapshot_counts_2["ProvisionVersion"], 1)
        self.assertEqual(snapshot_counts_2["Clause"], 2)
        self.assertEqual(snapshot_counts_2["Action"], 2)
        self.assertEqual(snapshot_counts_2["Penalty"], 1)
        self.assertEqual(snapshot_counts_2["Sanction"], 1)

    def test_03_stale_matching_leakage_zero_at_current_and_historical_dates(self):
        """stale_matching_leakage == 0.0 tại cả thời điểm hiện hành (2026-11-02) và lịch sử (2026-06-30)."""
        pipeline = IncrementalLegalRAGPipeline(embedding_model="BAAI/bge-m3", embedding_dimension=1024)

        historical_docs = [
            ("15/2020/NĐ-CP", "DECREE", "2020-04-15", "2026-06-30", 101, "Xử phạt vi phạm mạng xã hội theo NĐ 15/2020"),
            ("24/2018/QH14", "LAW", "2019-01-01", "2026-06-30", 8, "Các hành vi bị nghiêm cấm về an ninh mạng 2018"),
            ("67/2006/QH11", "LAW", "2007-01-01", "2026-06-30", 12, "Các hành vi bị nghiêm cấm về công nghệ thông tin 2006"),
            ("86/2015/QH13", "LAW", "2016-07-01", "2026-06-30", 7, "Các hành vi bị nghiêm cấm về an toàn thông tin mạng 2015"),
        ]
        current_docs = [
            ("174/2026/NĐ-CP", "DECREE", "2026-07-01", None, 95, "Xử phạt vi phạm mạng xã hội và an ninh mạng theo NĐ 174/2026"),
            ("330/2026/NĐ-CP", "DECREE", "2026-08-19", None, 50, "Xử phạt vi phạm bảo vệ dữ liệu cá nhân và công nghệ thông tin theo NĐ 330/2026"),
            ("116/2025/QH15", "LAW", "2026-07-01", None, 8, "Các hành vi bị nghiêm cấm về an ninh mạng và an toàn thông tin mạng 2025"),
        ]

        for code, dtype, eff_from, eff_to, art_no, txt in [*historical_docs, *current_docs]:
            spec = LegalFixtureVersionSpec(
                doc_code=code,
                document_type=dtype,
                issuing_authority="Cơ quan có thẩm quyền",
                issued_date=eff_from,
                version_no=1,
                object_key=f"legal/{code}.docx",
                artifact_type="DOCX",
                effective_from=eff_from,
                effective_to=eff_to,
                chunks=[ChunkSpec(article_number=art_no, clauses="1", title=txt[:40], text=txt)],
            )
            staged = pipeline.stage_version_and_outbox(spec)
            pipeline.consume_event(staged["event"])

        # 1. Truy vấn tại ngày hiện hành 2026-11-02: không có bất kỳ văn bản hết hiệu lực 2026-06-30 nào lọt vào
        res_current = pipeline.retrieve(
            "vi phạm mạng xã hội an ninh mạng công nghệ thông tin an toàn thông tin",
            as_of="2026-11-02",
            top_k=10,
        )
        self.assertTrue(len(res_current) > 0)
        expired_codes = {"15/2020/NĐ-CP", "24/2018/QH14", "67/2006/QH11", "86/2015/QH13"}
        inactive_at_current = [c for c in res_current if c["doc_code"] in expired_codes or not is_effective_on(c["effective_from"], c["effective_to"], "2026-11-02")]
        self.assertEqual(len(inactive_at_current), 0)
        self.assertEqual(compute_stale_matching_leakage(res_current, as_of="2026-11-02"), 0.0)

        # 2. Truy vấn lùi về lịch sử 2026-06-30: không có bất kỳ văn bản tương lai (174/2026, 330/2026, 116/2025) nào lọt vào
        res_hist = pipeline.retrieve(
            "vi phạm mạng xã hội an ninh mạng công nghệ thông tin an toàn thông tin",
            as_of="2026-06-30",
            top_k=10,
        )
        self.assertTrue(len(res_hist) > 0)
        future_codes = {"174/2026/NĐ-CP", "330/2026/NĐ-CP", "116/2025/QH15"}
        inactive_at_hist = [c for c in res_hist if c["doc_code"] in future_codes or not is_effective_on(c["effective_from"], c["effective_to"], "2026-06-30")]
        self.assertEqual(len(inactive_at_hist), 0)
        self.assertEqual(compute_stale_matching_leakage(res_hist, as_of="2026-06-30"), 0.0)

        # 3. Kiểm tra trực tiếp trên luồng truy xuất thực tế của main._prepare_retrieval_bundle
        bundle_current = main._prepare_retrieval_bundle(
            main.ChatRequest(
                question="Đăng bài sai sự thật trên mạng xã hội bị phạt bao nhiêu tiền?",
                as_of_date=date(2026, 11, 2),
            )
        )
        sources_current = bundle_current.get("sources") or []
        self.assertEqual(compute_stale_matching_leakage(sources_current, as_of="2026-11-02") or 0.0, 0.0)

        bundle_hist = main._prepare_retrieval_bundle(
            main.ChatRequest(
                question="Theo Điều 101 Nghị định 15/2020/NĐ-CP, đăng tin sai sự thật bị phạt bao nhiêu?",
                as_of_date=date(2026, 6, 30),
            )
        )
        sources_hist = bundle_hist.get("sources") or []
        self.assertEqual(compute_stale_matching_leakage(sources_hist, as_of="2026-06-30") or 0.0, 0.0)
        for src in sources_hist:
            self.assertNotIn(src.get("doc_code"), future_codes)

    def test_04_partial_amendment_nd211_preserves_historical_articles_and_updates_active(self):
        """Nghị định 211/2025/NĐ-CP sửa đổi Điều 93a, 93b, 114, 114a của NĐ 15/2020/NĐ-CP từ 2025-09-09."""
        data_dir = BACKEND_DIR.parent / "data"
        pdf_211 = data_dir / "211-2025-ndcp.signed.pdf"
        self.assertTrue(pdf_211.exists(), "Thiếu file 211-2025-ndcp.signed.pdf trong thư mục data/")

        doc_15 = LegalDocument(
            code="15/2020/NĐ-CP",
            title="Nghị định 15/2020/NĐ-CP",
            short="Nghị định 15/2020/NĐ-CP (VBHN 2022)",
            doc_type="DECREE",
            effective_from="2020-04-15",
            effective_to="2026-06-30",
            articles=[
                Article(
                    doc_code="15/2020/NĐ-CP",
                    number="93a",
                    title="Vi phạm quy định về kinh doanh sản phẩm mật mã dân sự (bản gốc)",
                    chapter="V",
                    text="Điều 93a. Nội dung trước khi sửa đổi bởi Nghị định 211/2025/NĐ-CP.",
                    source="2022_645_646_08-vbhn-btttt.pdf",
                    page=20,
                    effective_from="2020-04-15",
                    effective_to="2026-06-30",
                ),
                Article(
                    doc_code="15/2020/NĐ-CP",
                    number=114,
                    title="Vi phạm quy định về sử dụng sản phẩm mật mã dân sự (bản gốc)",
                    chapter="VI",
                    text="Điều 114. Nội dung gốc trước ngày 09/09/2025.",
                    source="2022_645_646_08-vbhn-btttt.pdf",
                    page=35,
                    effective_from="2020-04-15",
                    effective_to="2026-06-30",
                ),
            ],
        )

        updated_count = apply_211_amendments_to_15(doc_15, pdf_211)
        apply_effective_dates(doc_15)
        self.assertEqual(updated_count, 4)

        active_by_num = {str(a.number): a for a in doc_15.articles}
        for target_num in ("93a", "93b", "114", "114a"):
            self.assertIn(target_num, active_by_num)
            art_new = active_by_num[target_num]
            self.assertEqual(art_new.effective_from, "2025-09-09")
            self.assertEqual(art_new.effective_to, "2026-06-30")
            self.assertEqual(art_new.source, "211-2025-ndcp.signed.pdf")

        # Kiểm tra các bản lịch sử trước sửa đổi được bảo toàn trong historical_articles với effective_to == 2025-09-08
        hist_by_num = {str(a.number): a for a in doc_15.historical_articles}
        self.assertIn("93a", hist_by_num)
        self.assertIn("114", hist_by_num)
        self.assertEqual(hist_by_num["93a"].effective_from, "2020-04-15")
        self.assertEqual(hist_by_num["93a"].effective_to, "2025-09-08")
        self.assertEqual(hist_by_num["114"].effective_to, "2025-09-08")

        # Kiểm tra lọc theo thời điểm trước sửa đổi (2025-08-01) và sau sửa đổi (2025-10-01) đều có leakage == 0.0
        all_snapshots = [
            {
                "doc_code": a.doc_code,
                "article_number": str(a.number),
                "source": a.source,
                "effective_from": a.effective_from,
                "effective_to": a.effective_to,
                "lifecycle_status": "ACTIVE",
            }
            for a in [*doc_15.articles, *doc_15.historical_articles]
        ]
        active_aug_2025 = [
            s for s in all_snapshots if is_effective_on(s["effective_from"], s["effective_to"], "2025-08-01")
        ]
        self.assertTrue(all(s["source"] == "2022_645_646_08-vbhn-btttt.pdf" for s in active_aug_2025))
        self.assertEqual(compute_stale_matching_leakage(active_aug_2025, as_of="2025-08-01"), 0.0)

        active_oct_2025 = [
            s for s in all_snapshots if is_effective_on(s["effective_from"], s["effective_to"], "2025-10-01")
        ]
        self.assertTrue(all(s["source"] == "211-2025-ndcp.signed.pdf" for s in active_oct_2025))
        self.assertEqual(compute_stale_matching_leakage(active_oct_2025, as_of="2025-10-01"), 0.0)

    def test_05_infrastructure_indexes_and_health_graph_overview_endpoints(self):
        """Kiểm tra cấu hình Docker, chỉ mục PGVector/Neo4j và phản hồi /health + /graph/overview (online & offline)."""
        from vector_index import ensure_halfvec_hnsw_index

        # 1. Xác nhận cấu hình container Docker (law_postgres_graph:5433, law_neo4j:7687)
        compose_text = (BACKEND_DIR.parent / "docker-compose.yml").read_text(encoding="utf-8")
        self.assertIn("container_name: law_postgres_graph", compose_text)
        self.assertIn("127.0.0.1:5433:5432", compose_text)
        self.assertIn("container_name: law_neo4j", compose_text)
        self.assertIn("127.0.0.1:7687:7687", compose_text)
        self.assertIn("neo4j:5.26-community", compose_text)

        # 2. Xác nhận chỉ mục PostgreSQL (idx_pg_embedding_art_doc_lower, idx_pg_embedding_document_trgm, HNSW halfvec)
        main_source = (BACKEND_DIR / "main.py").read_text(encoding="utf-8")
        self.assertIn("idx_pg_embedding_art_doc_lower", main_source)
        self.assertIn("idx_pg_embedding_document_trgm", main_source)

        executed_sql: list[str] = []

        class _MockScalarResult:
            def scalar(self):
                return 3072

        class _MockConn:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def execute(self, stmt, params=None):
                executed_sql.append(str(stmt))
                return _MockScalarResult()

        class _MockEngine:
            def begin(self):
                return _MockConn()

        dim = ensure_halfvec_hnsw_index(_MockEngine(), "it_law_collection")
        self.assertEqual(dim, 3072)
        joined_sql = "\n".join(executed_sql)
        self.assertIn("idx_lc_embedding_halfvec_hnsw_3072", joined_sql)
        self.assertIn("halfvec(3072)", joined_sql)
        self.assertIn("idx_pg_embedding_art_doc_lower", joined_sql)

        # 3. Xác nhận Neo4j constraints và indexes (action_embedding, action_fulltext, article_fulltext)
        schema_joined = "\n".join(graph_ingest.SCHEMA_QUERIES)
        self.assertIn("action_embedding", schema_joined)
        self.assertIn("action_fulltext", schema_joined)
        self.assertIn("article_fulltext", schema_joined)
        self.assertIn("CREATE CONSTRAINT provision_version_id", schema_joined)

        # 4. Kiểm tra /health và /graph/overview khi giả lập Offline
        main._OVERVIEW_CACHE.clear()
        orig_driver = main.neo4j_driver
        orig_offline = os.environ.get("NEO4J_OFFLINE")
        try:
            os.environ["NEO4J_OFFLINE"] = "1"
            health_off = main.health_check()
            self.assertEqual(health_off["status"], "healthy")
            self.assertFalse(health_off["neo4j_connected"])
            self.assertIn("pgvector_ready", health_off)

            overview_off = main.graph_overview()
            self.assertIn("stats", overview_off)
            self.assertIn("documents", overview_off)
            self.assertIn("graph_view", overview_off)
            self.assertEqual(overview_off["status"], "offline")
            self.assertEqual(overview_off["graph_view"], {"nodes": [], "edges": []})

            # 5. Kiểm tra /health và /graph/overview khi Online (mock Neo4j driver)
            os.environ["NEO4J_OFFLINE"] = "0"
            main._NEO4J_CIRCUIT_OPEN_UNTIL = 0.0
            main._OVERVIEW_CACHE.clear()

            class _OnlineSession:
                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, tb):
                    return False

                def run(self, query, **kwargs):
                    q_str = str(getattr(query, "text", query))
                    if "RETURN 1 AS ok" in q_str:
                        return _MockResult({"ok": 1})
                    if "labels(n)[0] AS label" in q_str:
                        return _MockDataResult([{"label": "LegalDoc", "n": 35}, {"label": "Article", "n": 1200}])
                    if "type(r) AS type" in q_str:
                        return _MockDataResult([{"type": "PART_OF", "n": 1200}])
                    if "MATCH (d:LegalDoc)" in q_str and "RETURN d.code AS code" in q_str:
                        return _MockDataResult([
                            {
                                "code": "174/2026/NĐ-CP",
                                "short": "Nghị định 174/2026/NĐ-CP",
                                "title": "Nghị định 174/2026/NĐ-CP",
                                "type": "DECREE",
                                "articles": 120,
                            }
                        ])
                    return _MockDataResult([
                        {
                            "doc_code": "174/2026/NĐ-CP",
                            "doc_short": "Nghị định 174/2026/NĐ-CP",
                            "doc_title": "Nghị định 174/2026/NĐ-CP",
                            "art_id": "174/2026/NĐ-CP:Điều 95",
                            "art_num": 95,
                            "art_title": "Vi phạm mạng xã hội",
                            "clause_id": "174/2026/NĐ-CP:Điều 95:Khoản 1",
                            "clause_num": 1,
                            "clause_text": "Phạt tiền từ 20 triệu đến 30 triệu đồng",
                            "act_id": "174/2026/NĐ-CP:Điều 95:Khoản 1:a",
                            "act_name": "Tung tin giả mạo, sai sự thật",
                            "act_kind": "VIOLATION",
                            "pen_id": "174/2026/NĐ-CP:Điều 95:Khoản 1:FINE",
                            "min_amount": 20_000_000,
                            "max_amount": 30_000_000,
                            "sanc_id": "174/2026/NĐ-CP:Điều 95:Khoản 3:a",
                            "sanc_desc": "Buộc gỡ bỏ thông tin sai sự thật",
                            "ref_art_id": None,
                            "ref_art_num": None,
                            "ref_rel_type": None,
                        }
                    ])

            class _OnlineDriver:
                def session(self, **kwargs):
                    return _OnlineSession()

            class _MockDataResult:
                def __init__(self, rows):
                    self._rows = rows

                def data(self):
                    return self._rows

            main.neo4j_driver = _OnlineDriver()
            health_on = main.health_check()
            self.assertEqual(health_on["status"], "healthy")
            self.assertTrue(health_on["neo4j_connected"])

            overview_on = main.graph_overview()
            self.assertEqual(overview_on["stats"]["total_nodes"], 1235)
            self.assertEqual(overview_on["stats"]["total_relationships"], 1200)
            self.assertEqual(len(overview_on["documents"]), 1)
            self.assertGreater(len(overview_on["graph_view"]["nodes"]), 0)
            self.assertGreater(len(overview_on["graph_view"]["edges"]), 0)
        finally:
            main.neo4j_driver = orig_driver
            main._OVERVIEW_CACHE.clear()
            if orig_offline is None:
                os.environ.pop("NEO4J_OFFLINE", None)
            else:
                os.environ["NEO4J_OFFLINE"] = orig_offline


if __name__ == "__main__":
    unittest.main()
