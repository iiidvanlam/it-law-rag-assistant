"""TDD reproduction tests for Backend & Docker/Infra fixes."""

from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from pydantic import ValidationError

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import config
import legal_parser
import main
import precedents
import workspace_tools
from legal_rules import QueryFacts


class _FakeNeo4jResult:
    def __init__(self, row: dict | None = None) -> None:
        self._row = row

    def single(self):
        return self._row

    def consume(self):
        return None


class _SchemaAwareNeo4jSession:
    """Fake Neo4j session enforcing graph_ingest.py schema & database parameter."""

    def __init__(self, database: str | None, record_log: list[tuple[str | None, str]]) -> None:
        self._database = database
        self._record_log = record_log

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def run(self, cypher: str, **params):
        self._record_log.append((self._database, cypher))
        if self._database != config.NEO4J_DATABASE:
            return _FakeNeo4jResult(None)
        if any(bad in cypher for bad in (":HAS_ARTICLE", ":HAS_CLAUSE", ":SPECIFIES_ACTION", ":HAS_PENALTY", "p.raw_text")):
            return _FakeNeo4jResult(None)

        if "MATCH (a:Article)-[:PART_OF]->(d:LegalDoc" in cypher and "PENALIZED_BY" in cypher:
            return _FakeNeo4jResult({
                "min_amount": 20_000_000,
                "max_amount": 30_000_000,
                "penalty_type": "FINE",
                "base_subject": "ORGANIZATION",
                "raw_text": "Cung cấp, chia sẻ thông tin giả mạo, thông tin sai sự thật",
            })

        if "MATCH (a:Article)-[:PART_OF]->(d:LegalDoc" in cypher and "RETURN" in cypher:
            return _FakeNeo4jResult({
                "doc_title": "Nghị định 174/2026/NĐ-CP",
                "article_title": "Vi phạm các quy định về trách nhiệm sử dụng dịch vụ mạng xã hội",
                "text": "Điều 95. Phạt tiền từ 20.000.000 đồng đến 30.000.000 đồng...",
                "effective_from": "2026-07-01",
                "effective_to": None,
                "source_url": "https://chinhphu.vn/174-2026",
                "doc_source_url": "https://chinhphu.vn/174-2026",
            })

        return _FakeNeo4jResult(None)


class _SchemaAwareNeo4jDriver:
    def __init__(self) -> None:
        self.calls: list[tuple[str | None, str]] = []

    def session(self, database: str | None = None, **kwargs):
        return _SchemaAwareNeo4jSession(database, self.calls)


class WorkspaceToolsNeo4jAndSqlTests(unittest.TestCase):
    def test_get_article_detail_uses_neo4j_database_and_part_of_schema(self) -> None:
        driver = _SchemaAwareNeo4jDriver()
        detail = workspace_tools.get_article_detail_with_history(
            doc_code="174/2026/NĐ-CP",
            article_number="95",
            sql_engine=None,
            neo4j_driver=driver,
            as_of="2026-11-02",
        )
        self.assertTrue(driver.calls, "Expected Neo4j session.run to be called")
        db_used, cypher = driver.calls[0]
        self.assertEqual(db_used, config.NEO4J_DATABASE)
        self.assertNotIn(":HAS_ARTICLE", cypher)
        self.assertIn("(a:Article)-[:PART_OF]->", cypher)
        self.assertTrue(detail["found"])
        self.assertIn("20.000.000", detail["full_text"])

    def test_get_article_detail_sql_joins_collection_and_filters_lifecycle(self) -> None:
        executed_sql: list[str] = []

        class _MappingsResult:
            def all(self):
                return []

        class _ExecResult:
            def mappings(self):
                return _MappingsResult()

        class _Conn:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def execute(self, stmt, params=None):
                executed_sql.append(str(stmt))
                return _ExecResult()

        class _Engine:
            def connect(self):
                return _Conn()

        workspace_tools.get_article_detail_with_history(
            doc_code="174/2026/NĐ-CP",
            article_number="95",
            sql_engine=_Engine(),
            neo4j_driver=None,
            as_of="2026-11-02",
        )
        self.assertEqual(len(executed_sql), 1)
        sql = executed_sql[0]
        self.assertIn("langchain_pg_collection", sql)
        self.assertIn("LOWER(e.cmetadata->>'article_number')", sql)
        self.assertIn("e.cmetadata->>'doc_code' = :doc_code", sql)
        self.assertNotIn("UPPER(COALESCE(e.cmetadata->>'doc_code'", sql)
        self.assertIn("('PREPARED', 'FAILED', 'RETIRED')", sql)

    def test_lookup_neo4j_penalty_uses_graph_ingest_schema_and_database(self) -> None:
        driver = _SchemaAwareNeo4jDriver()
        penalty = workspace_tools._lookup_neo4j_penalty_for_article(
            driver, "174/2026/NĐ-CP", "95"
        )
        self.assertTrue(driver.calls)
        db_used, cypher = driver.calls[0]
        self.assertEqual(db_used, config.NEO4J_DATABASE)
        for legacy_token in (":HAS_ARTICLE", ":HAS_CLAUSE", ":SPECIFIES_ACTION", ":HAS_PENALTY", "p.raw_text"):
            self.assertNotIn(legacy_token, cypher)
        for real_token in (":PART_OF", ":DEFINED_IN", ":PENALIZED_BY"):
            self.assertIn(real_token, cypher)
        self.assertIsNotNone(penalty)
        self.assertEqual(penalty["min_amount"], 20_000_000)
        self.assertEqual(penalty["max_amount"], 30_000_000)


class PrecedentsNumericMatchTests(unittest.TestCase):
    def test_precedents_write_matches_numeric_and_string_article_numbers(self) -> None:
        manifest_path = ROOT_DIR / "data" / "precedents" / "it_law_precedents.json"
        record = precedents.load_precedent_manifest(manifest_path)[0]
        articles_in_db = [
            {"doc_code": ref.doc_code, "number": int(ref.article_number) if ref.article_number.isdigit() else ref.article_number}
            for ref in record.references
        ]
        cypher_queries: list[str] = []

        class _Tx:
            def run(self, cypher: str, **params):
                cypher_queries.append(cypher)
                if "MERGE (p)-[r:" in cypher:
                    # Simulate Neo4j strict type equality for property map {number: $article_number}
                    if "{doc_code: $doc_code, number: $article_number}" in cypher:
                        matched = [
                            a for a in articles_in_db
                            if a["doc_code"] == params["doc_code"] and a["number"] == params["article_number"]
                        ]
                    elif "toLower(toString(a.number)) = toLower(toString($article_number))" in cypher:
                        matched = [
                            a for a in articles_in_db
                            if a["doc_code"] == params["doc_code"]
                            and str(a["number"]).lower() == str(params["article_number"]).lower()
                        ]
                    else:
                        matched = []
                    return _FakeNeo4jResult({"linked": len(matched)})
                return _FakeNeo4jResult(None)

        resolved = precedents._write_precedent(_Tx(), record, "it_law_precedents.json")
        self.assertEqual(resolved, len(record.references))
        link_queries = [q for q in cypher_queries if "MERGE (p)-[r:" in q]
        self.assertTrue(link_queries)
        self.assertIn("toLower(toString(a.number)) = toLower(toString($article_number))", link_queries[0])

    def test_precedents_write_uses_neo4j_primitive_properties_only(self) -> None:
        manifest_path = ROOT_DIR / "data" / "precedents" / "it_law_precedents.json"
        records = precedents.load_precedent_manifest(manifest_path)
        self.assertEqual(len(records), 8)
        captured_params: list[dict] = []

        def _validate_neo4j_prop(key: str, value) -> None:
            if value is None or isinstance(value, (str, int, float, bool)):
                return
            if isinstance(value, (list, tuple)):
                for item in value:
                    if not isinstance(item, (str, int, float, bool)):
                        raise TypeError(
                            f"Neo4j property '{key}' list element has non-primitive type {type(item).__name__}: {item!r}"
                        )
                return
            raise TypeError(
                f"Neo4j property '{key}' has non-primitive type {type(value).__name__}: {value!r}"
            )

        class _StrictNeo4j526Tx:
            def run(self, cypher: str, **params):
                if "SET " in cypher:
                    for key, val in params.items():
                        _validate_neo4j_prop(key, val)
                captured_params.append({"cypher": cypher, "params": params})
                if "MERGE (p)-[r:" in cypher:
                    return _FakeNeo4jResult({"linked": 1})
                return _FakeNeo4jResult(None)

        for record in records:
            resolved = precedents._write_precedent(_StrictNeo4j526Tx(), record, "it_law_precedents.json")
            self.assertEqual(resolved, len(record.references))

        set_node_calls = [c for c in captured_params if "p.reference_specs" in c["cypher"]]
        self.assertEqual(len(set_node_calls), len(records))
        first_specs = json.loads(set_node_calls[0]["params"]["reference_specs"])
        self.assertEqual(len(first_specs), len(records[0].references))
        self.assertEqual(first_specs[0]["doc_code"], records[0].references[0].doc_code)


class FastPgHybridSearchLifecycleSqlTests(unittest.TestCase):
    def test_all_fast_pg_hybrid_search_sql_queries_filter_inactive_lifecycle(self) -> None:
        executed_selects: list[str] = []

        class _Result:
            def fetchall(self):
                return []

        class _Conn:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def execute(self, stmt, params=None):
                s = str(stmt)
                if "FROM langchain_pg_embedding" in s:
                    executed_selects.append(s)
                return _Result()

        class _Engine:
            def connect(self):
                return _Conn()

        with patch.object(main, "_sql_engine", _Engine()):
            # 1) article_refs + doc_hints (including 15/2020 Art 3 amendment branch) + vector + keyword fallback
            main.fast_pg_hybrid_search(
                "Điều 3 Nghị định 15/2020/NĐ-CP quy định gì về mạng xã hội?",
                facts=QueryFacts(subjects=[], subject_detected=False, age=None, article_refs=[3], doc_hints=["15/2020/NĐ-CP"]),
                query_vector=[0.01] * 3072,
                k=5,
                as_of="2026-06-30",
            )
            # 2) article_refs without doc_hints
            main.fast_pg_hybrid_search(
                "Điều 95 quy định xử phạt thế nào?",
                facts=QueryFacts(subjects=[], subject_detected=False, age=None, article_refs=[95], doc_hints=[]),
                query_vector=None,
                k=5,
                as_of="2026-11-02",
            )
            # 3) doc_hints without article_refs + keyword fallback
            main.fast_pg_hybrid_search(
                "mạng xã hội tin giả xử phạt",
                facts=QueryFacts(subjects=[], subject_detected=False, age=None, article_refs=[], doc_hints=["174/2026/NĐ-CP"]),
                query_vector=None,
                k=5,
                as_of="2026-11-02",
            )

        self.assertGreaterEqual(len(executed_selects), 6)
        for idx, sql in enumerate(executed_selects):
            self.assertIn(
                "('PREPARED', 'FAILED', 'RETIRED')",
                sql,
                f"SQL query #{idx} missing lifecycle_status exclusion before LIMIT:\n{sql}",
            )


class FastApiHardeningTests(unittest.TestCase):
    def test_compliance_review_file_base64_and_precedents_limit_bounds(self) -> None:
        with self.assertRaises(ValidationError):
            main.ComplianceReviewRequest(file_base64="A" * (main.MAX_EVIDENCE_B64_CHARS + 1))

        schema = main.app.openapi()
        params = schema["paths"]["/precedents/search"]["get"]["parameters"]
        limit_param = next(p for p in params if p["name"] == "limit")
        self.assertEqual(limit_param["schema"]["default"], 20)
        self.assertEqual(limit_param["schema"]["minimum"], 1)
        self.assertEqual(limit_param["schema"]["maximum"], 50)

    def test_no_nonlocal_used_llm_fallback_in_chat_endpoints(self) -> None:
        main_src = (BACKEND_DIR / "main.py").read_text(encoding="utf-8")
        tree = ast.parse(main_src)
        offending_funcs: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.name in {"_execute_chat", "chat_stream_endpoint"}:
                    for sub in ast.walk(node):
                        if isinstance(sub, ast.Nonlocal) and "used_llm_fallback" in sub.names:
                            offending_funcs.append(node.name)
        self.assertEqual(offending_funcs, [], f"Found cross-thread nonlocal used_llm_fallback in: {offending_funcs}")

    def test_safe_endpoints_have_pydantic_response_models(self) -> None:
        expected_paths = {
            "/health",
            "/penalty/simulate",
            "/graph/overview",
            "/chat",
            "/analyze-evidence",
            "/benchmark/run",
            "/auth/register",
            "/auth/otp/request",
            "/auth/register/verify-otp",
            "/auth/password/reset",
            "/auth/change-password",
            "/auth/login",
            "/auth/google-config",
            "/auth/google",
            "/auth/me",
            "/auth/profile",
            "/precedents/search",
            "/legal/article-detail",
            "/legal/documents/search",
            "/legal/updates",
            "/stats/overview",
            "/conversations",
            "/conversations/{conv_id}",
            "/support/contact",
            "/compliance/review",
            "/drafting/templates",
            "/drafting/generate",
        }
        route_models = {
            getattr(r, "path", None): getattr(r, "response_model", None)
            for r in main.app.routes
            if getattr(r, "path", None) in expected_paths
        }
        missing = sorted(p for p in expected_paths if route_models.get(p) is None)
        self.assertEqual(missing, [], f"Endpoints missing response_model: {missing}")

    def test_legal_draft_response_aligns_llm_refined_field(self) -> None:
        self.assertIn("llm_refined", main.LegalDraftResponse.model_fields)
        draft_payload = workspace_tools.generate_legal_draft(
            template_type="PRIVACY_POLICY",
            party_a="Công ty Test",
            party_b="Người dùng",
            incident_or_scope="Kiểm thử schema LegalDraftResponse",
            as_of="2026-11-02",
            use_llm=False,
        )
        validated = main.LegalDraftResponse.model_validate(draft_payload)
        self.assertFalse(validated.llm_refined)


class BenchmarkEntrypointTests(unittest.TestCase):
    def test_evaluate_benchmark_uses_asyncio_run_not_coro_send(self) -> None:
        src = (BACKEND_DIR / "evaluate_benchmark.py").read_text(encoding="utf-8")
        self.assertNotIn("_coro.send(None)", src)
        self.assertIn("asyncio.run(run_benchmark())", src)


class TransitionMapAndOcrCacheTests(unittest.TestCase):
    def test_transition_map_15_2020_art_99_aligned_with_graph_ingest(self) -> None:
        trans_99 = workspace_tools._ARTICLE_TRANSITIONS.get(("15/2020/NĐ-CP", "99"))
        self.assertIsNotNone(trans_99)
        self.assertEqual(trans_99["successor_doc"], "174/2026/NĐ-CP")
        self.assertEqual(trans_99["successor_article"], "93")

        trans_100 = workspace_tools._ARTICLE_TRANSITIONS.get(("15/2020/NĐ-CP", "100"))
        self.assertIsNotNone(trans_100)
        self.assertEqual(trans_100["successor_doc"], "174/2026/NĐ-CP")
        self.assertEqual(trans_100["successor_article"], "94")

    def test_legacy_ocr_cache_fallback_reads_hash12_when_hash16_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            cache_dir = tmp_dir / ".ocr_cache"
            cache_dir.mkdir()
            pdf_path = tmp_dir / "scanned-test.pdf"
            pdf_path.write_bytes(b"%PDF-1.4\n%fake-scanned\n")

            stat = pdf_path.stat()
            hash12 = hashlib.sha1(
                f"{pdf_path.name}:{stat.st_size}:{int(stat.st_mtime)}".encode("utf-8")
            ).hexdigest()[:12]
            legacy_cache = cache_dir / f"{pdf_path.name}.{hash12}.json"
            legacy_cache.write_text(
                json.dumps(["Điều 1. Nội dung từ bộ nhớ đệm OCR cũ."], ensure_ascii=False),
                encoding="utf-8",
            )
            missing_hash16 = cache_dir / "ocr.0000000000000000.json"

            class _BlankPage:
                def extract_text(self):
                    return ""

            class _FakeReader:
                def __init__(self, _):
                    self.pages = [_BlankPage()]

            with patch.object(legal_parser, "PdfReader", _FakeReader), \
                 patch.object(legal_parser, "_ocr_cache_path", return_value=missing_hash16), \
                 patch.object(legal_parser, "fitz", None):
                pages = legal_parser._read_pdf_pages(pdf_path, use_cache=True)

            self.assertEqual(pages, ["Điều 1. Nội dung từ bộ nhớ đệm OCR cũ."])


class DockerConfigTests(unittest.TestCase):
    def test_docker_compose_db_healthcheck_and_dockerignore(self) -> None:
        compose = (ROOT_DIR / "docker-compose.yml").read_text(encoding="utf-8")
        self.assertIn("pg_isready", compose)
        self.assertIn("law_graph_data", compose)

        dockerignore = ROOT_DIR / ".dockerignore"
        self.assertTrue(dockerignore.exists(), "Root .dockerignore must exist")
        ignore_text = dockerignore.read_text(encoding="utf-8")
        for pat in ("node_modules", "__pycache__", ".git", ".env", "venv", "scratch"):
            self.assertIn(pat, ignore_text)


if __name__ == "__main__":
    unittest.main()
