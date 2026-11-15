"""Shared temporal, provenance, deduplication, and incremental lifecycle helpers for versioned legal knowledge.

Implements the full specification of:
- Multi-layer identity (legal_instrument_id, legal_version_id, source_artifact_id, ingestion_job_id, semantic_chunk_id)
- Two-level Unicode NFC normalized SHA-256 hashing (document_hash & chunk_hash) and composite index_fingerprint
- Deterministic vector IDs (f"{legal_version_id}:{semantic_chunk_id}:{chunk_hash}") and unique operation_key idempotency
- Four-class duplicate classification (EXACT, STRUCTURAL, NEAR, LEGAL_EQUIVALENT) & manifest diffing
- Chunk-level incremental diff & vector reuse (Keep / Add / Modify / Retire) across v1 -> v2 transitions
- Staging (PREPARED), Validation Gate, Atomic Compare-And-Swap (CAS) Activation, Soft-Delete/Retire, Rollback & Reconciliation
- Point-in-time temporal filtering invariant & Stale Matching Leakage calculation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
import hashlib
import json
import re
import time
import unicodedata
from typing import Any, Callable

# ---------------------------------------------------------------------------
# Constants for Index Fingerprint & Pipeline Versioning
# ---------------------------------------------------------------------------
PARSER_VERSION = "legal-parser-v2"
OCR_ENGINE_VERSION = "tesseract-v5-nfc"
NORMALIZATION_VERSION = "nfc-lf-v1"
CHUNKING_VERSION = "article-clause-1800-v2"
DEFAULT_DISTANCE_METRIC = "cosine"
DEFAULT_EMBEDDING_MODEL = "models/gemini-embedding-001"
DEFAULT_EMBEDDING_DIMENSION = 3072

# Lifecycle status constants
STATUS_PREPARED = "PREPARED"
STATUS_ACTIVE = "ACTIVE"
STATUS_PARTIALLY_EXPIRED = "PARTIALLY_EXPIRED"
STATUS_RETIRED = "RETIRED"
STATUS_FAILED = "FAILED"


def parse_as_of(value: date | str | None) -> date:
    """Return the legal evaluation date, defaulting to today's local date. Supports ISO, DD/MM/YYYY, MM/YYYY, YYYY-MM."""
    if value is None:
        return date.today()
    if isinstance(value, date):
        return value
    s = str(value).strip()
    if not s:
        return date.today()
    dmy = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    if dmy:
        return date(int(dmy.group(3)), int(dmy.group(2)), int(dmy.group(1)))
    my = re.match(r"^(\d{1,2})/(\d{4})$", s)
    if my:
        return date(int(my.group(2)), int(my.group(1)), 1)
    ym = re.match(r"^(\d{4})-(\d{1,2})$", s)
    if ym:
        return date(int(ym.group(1)), int(ym.group(2)), 1)
    return date.fromisoformat(s)


def is_effective_on(
    effective_from: date | str | None,
    effective_to: date | str | None,
    as_of: date | str | None = None,
) -> bool:
    """Use inclusive legal effective-date boundaries; unknown boundaries stay open."""
    at = parse_as_of(as_of)
    start = date.fromisoformat(str(effective_from)) if effective_from else None
    end = date.fromisoformat(str(effective_to)) if effective_to else None
    return (start is None or start <= at) and (end is None or at <= end)


def provision_version_id(
    doc_code: str,
    article_number: int | str,
    source_file: str,
    text: str,
    effective_from: date | str | None,
    effective_to: date | str | None,
) -> str:
    """Stable ID for an immutable article-text snapshot with its source and interval."""
    norm_doc_code = unicodedata.normalize("NFC", str(doc_code or "").strip())
    norm_source = unicodedata.normalize("NFC", re.split(r"[\\/]", str(source_file or "").strip())[-1])
    norm_text = " ".join(unicodedata.normalize("NFC", text or "").replace("\r\n", "\n").replace("\r", "\n").split())
    payload: dict[str, Any] = {
        "doc_code": norm_doc_code,
        "article_number": str(article_number).strip(),
        "source_file": norm_source,
        "text": norm_text,
        "effective_from": str(effective_from) if effective_from else None,
        "effective_to": str(effective_to) if effective_to else None,
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Section 3 & 4: Unicode NFC Normalization, Two-Level Hashing & Fingerprint
# ---------------------------------------------------------------------------
def normalize_for_hash(text: str) -> str:
    """Normalize text to Unicode NFC, unify CRLF/CR to LF, and normalize horizontal whitespace per line.

    Prevents unnecessary re-embedding caused by OS line-ending conversions (CRLF vs LF),
    Unicode NFD decomposed diacritics from OCR engines vs precomposed NFC, or trailing spaces.
    """
    norm = unicodedata.normalize("NFC", text or "")
    norm = norm.replace("\r\n", "\n").replace("\r", "\n")
    lines = [" ".join(line.split()) for line in norm.split("\n")]
    cleaned = "\n".join(line for line in lines if line)
    return cleaned.strip()


def content_hash(text: str) -> str:
    """Compute SHA-256 hex digest over NFC-normalized legal text (document-level or chunk-level)."""
    norm = normalize_for_hash(text)
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()


compute_content_hash = content_hash
chunk_hash = content_hash
compute_chunk_hash = content_hash


def compute_index_fingerprint(
    content_hash_val: str,
    embedding_model: str = DEFAULT_EMBEDDING_MODEL,
    embedding_dimension: int = DEFAULT_EMBEDDING_DIMENSION,
    parser_version: str = PARSER_VERSION,
    ocr_engine_version: str = OCR_ENGINE_VERSION,
    normalization_version: str = NORMALIZATION_VERSION,
    chunking_version: str = CHUNKING_VERSION,
    distance_metric: str = DEFAULT_DISTANCE_METRIC,
) -> str:
    """Combine content_hash and technical index parameters into a single deterministic index_fingerprint.

    A document is considered truly unchanged ONLY when both content_hash and index_fingerprint match
    the currently active legal_version.
    """
    payload = {
        "content_hash": str(content_hash_val),
        "embedding_model": str(embedding_model).strip(),
        "embedding_dimension": int(embedding_dimension),
        "parser_version": str(parser_version).strip(),
        "ocr_engine_version": str(ocr_engine_version).strip(),
        "normalization_version": str(normalization_version).strip(),
        "chunking_version": str(chunking_version).strip(),
        "distance_metric": str(distance_metric).strip().lower(),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Section 2, 6.2 & 7: Three-Layer Identity, Semantic Chunk ID & Operation Key
# ---------------------------------------------------------------------------
def normalize_doc_slug(doc_code: str) -> str:
    """Convert a Vietnamese legal document code (e.g. '309/2026/NĐ-CP') into a canonical ASCII slug."""
    norm = unicodedata.normalize("NFC", str(doc_code or "").strip().lower())
    norm = norm.replace("đ", "d")
    norm = unicodedata.normalize("NFD", norm)
    norm = "".join(ch for ch in norm if unicodedata.category(ch) != "Mn")
    slug = re.sub(r"[^a-z0-9]+", "-", norm).strip("-")
    return slug or "unknown-doc"


def legal_instrument_id(doc_code: str) -> str:
    """Stable identifier for a legal instrument across all its versions."""
    return f"inst:{normalize_doc_slug(doc_code)}"


def legal_version_id(doc_code: str, version_no: int = 1) -> str:
    """Stable identifier for a specific legal content version (e.g. v1, v2) of a legal instrument."""
    return f"ver:{normalize_doc_slug(doc_code)}:v{int(version_no)}"


def source_artifact_id(doc_code: str, object_key: str, artifact_hash: str | None = None) -> str:
    """Identifier for a physical source artifact (.docx, native .pdf, or OCR scan) representing a legal version."""
    key_norm = unicodedata.normalize("NFC", str(object_key or "").strip())
    seed = f"{normalize_doc_slug(doc_code)}:{key_norm}:{artifact_hash or ''}"
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:12]
    return f"artf:{normalize_doc_slug(doc_code)}:{digest}"


def semantic_chunk_id(
    article_number: int | str,
    clauses_label: str | int | None = None,
    point_label: str | None = None,
) -> str:
    """Generate a structural semantic_chunk_id anchored to legal hierarchy (Article / Clause / Point),
    never by sequential chunk position.

    Examples:
      - semantic_chunk_id(3, 9) -> 'dieu-3/khoan-9'
      - semantic_chunk_id(17, '2a') -> 'dieu-17/khoan-2a'
      - semantic_chunk_id(8) -> 'dieu-8'
    """
    art_slug = normalize_doc_slug(str(article_number))
    base = f"dieu-{art_slug}"
    if clauses_label is not None and str(clauses_label).strip() != "":
        cl_raw = str(clauses_label).strip().lower()
        cl_raw = re.sub(r"^khoản\s*", "", cl_raw, flags=re.IGNORECASE)
        cl_slug = normalize_doc_slug(cl_raw)
        if cl_slug:
            base = f"{base}/khoan-{cl_slug}"
    if point_label is not None and str(point_label).strip() != "":
        pt_slug = normalize_doc_slug(str(point_label).strip())
        if pt_slug:
            base = f"{base}/diem-{pt_slug}"
    return base


def deterministic_vector_id(legal_ver_id: str, sem_chunk_id: str, chk_hash: str) -> str:
    """Deterministic vector ID per Section 7.1: f'{legal_version_id}:{semantic_chunk_id}:{chunk_hash}'."""
    return f"{legal_ver_id}:{sem_chunk_id}:{chk_hash}"


def compute_operation_key(
    source_artifact_id_val: str,
    content_hash_val: str,
    index_fingerprint_val: str,
) -> str:
    """Deterministic idempotency key for an ingestion job / outbox event per Section 7.1:
    SHA256(source_artifact_id + content_hash + index_fingerprint).
    """
    raw = f"{source_artifact_id_val}+{content_hash_val}+{index_fingerprint_val}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def collection_alias_for_model(
    base_collection: str,
    embedding_model: str,
    embedding_dimension: int,
) -> str:
    """Build a model-isolated collection name so vectors from two different embedding models
    (e.g. BAAI/bge-m3 1024d vs gemini-embedding-001 3072d) are never mixed in the same index.
    """
    model_slug = normalize_doc_slug(embedding_model).replace("-", "_")
    return f"{base_collection}__{model_slug}_{int(embedding_dimension)}d"


# ---------------------------------------------------------------------------
# Section 3 (Table 2) & Section 4 (Table 3): Duplicate Classification & Diff
# ---------------------------------------------------------------------------
def _token_shingles(text: str, k: int = 3) -> set[str]:
    words = normalize_for_hash(text).lower().split()
    if not words:
        return set()
    if len(words) < k:
        return {" ".join(words)}
    return {" ".join(words[i : i + k]) for i in range(len(words) - k + 1)}


def text_jaccard_similarity(text_a: str, text_b: str, k: int = 3) -> float:
    """Compute k-shingle Jaccard similarity for near-duplicate detection."""
    shingles_a = _token_shingles(text_a, k=k)
    shingles_b = _token_shingles(text_b, k=k)
    if not shingles_a and not shingles_b:
        return 1.0
    if not shingles_a or not shingles_b:
        return 0.0
    return len(shingles_a & shingles_b) / len(shingles_a | shingles_b)


def classify_duplicate(
    *,
    doc_code_a: str,
    doc_code_b: str,
    semantic_chunk_id_a: str,
    semantic_chunk_id_b: str,
    text_a: str,
    text_b: str,
    verified_legal_equivalent: bool = False,
    near_threshold: float = 0.82,
) -> dict[str, Any]:
    """Classify pair of legal chunks into Table 2 categories:
    - EXACT: Same normalized SHA-256 -> action = 'skip_or_reuse'
    - LEGAL_EQUIVALENT: Verified legal relationship (e.g. DOCX vs OCR scan of same version) -> action = 'link_not_inferred_from_vector'
    - STRUCTURAL: Same legal instrument + same semantic_chunk_id, different hash -> action = 'compare_version'
    - NEAR: High shingle similarity -> action = 'send_to_review'
    - DISTINCT: Different provisions -> action = 'index_normally'
    """
    hash_a = content_hash(text_a)
    hash_b = content_hash(text_b)
    if hash_a == hash_b:
        return {
            "category": "EXACT",
            "action": "skip_or_reuse",
            "similarity": 1.0,
            "hash_match": True,
        }
    if verified_legal_equivalent:
        return {
            "category": "LEGAL_EQUIVALENT",
            "action": "link_not_inferred_from_vector",
            "similarity": text_jaccard_similarity(text_a, text_b),
            "hash_match": False,
        }
    same_instrument = legal_instrument_id(doc_code_a) == legal_instrument_id(doc_code_b)
    if same_instrument and semantic_chunk_id_a == semantic_chunk_id_b:
        return {
            "category": "STRUCTURAL",
            "action": "compare_version",
            "similarity": text_jaccard_similarity(text_a, text_b),
            "hash_match": False,
        }
    sim = text_jaccard_similarity(text_a, text_b)
    if sim >= near_threshold:
        return {
            "category": "NEAR",
            "action": "send_to_review",
            "similarity": round(sim, 4),
            "hash_match": False,
        }
    return {
        "category": "DISTINCT",
        "action": "index_normally",
        "similarity": round(sim, 4),
        "hash_match": False,
    }


def diff_manifest(
    current: dict[str, dict[str, Any]],
    previous: dict[str, dict[str, Any]],
    processed_operation_keys: set[str] | None = None,
) -> dict[str, set[str]]:
    """Diff scanned legal corpus against active manifest per Section 4 (Table 3).

    Each item in `current` and `previous` is keyed by `doc_id` (e.g., legal_instrument_id or doc_code)
    and contains `content_hash`, `index_fingerprint` (optional), and `operation_key` (optional).

    Returns sets of doc_ids for:
      - added: New legal instrument -> Parse, chunk, index
      - modified: Same instrument, content_hash or index_fingerprint changed -> Create candidate version
      - deleted: Repealed / removed from active set -> Soft delete or retire
      - unchanged: Both content_hash and index_fingerprint match -> Skip embedding
      - duplicate: operation_key already processed -> Do not re-run
    """
    processed_ops = processed_operation_keys or set()
    current_ids = set(current.keys())
    previous_ids = set(previous.keys())

    duplicate: set[str] = {
        doc_id
        for doc_id in current_ids
        if current[doc_id].get("operation_key")
        and current[doc_id]["operation_key"] in processed_ops
    }
    remaining_current_ids = current_ids - duplicate

    added = remaining_current_ids - previous_ids
    deleted = previous_ids - current_ids
    common_ids = remaining_current_ids & previous_ids

    modified: set[str] = set()
    for doc_id in common_ids:
        cur_item = current[doc_id]
        prev_item = previous[doc_id]
        hash_changed = cur_item.get("content_hash") != prev_item.get("content_hash")
        cur_fp = cur_item.get("index_fingerprint")
        prev_fp = prev_item.get("index_fingerprint")
        fp_changed = bool(cur_fp and prev_fp and cur_fp != prev_fp)
        if hash_changed or fp_changed:
            modified.add(doc_id)

    unchanged = common_ids - modified
    return {
        "added": added,
        "modified": modified,
        "deleted": deleted,
        "unchanged": unchanged,
        "duplicate": duplicate,
    }


def diff_version_chunks(
    v1_chunks: dict[str, dict[str, Any]],
    v2_chunks: dict[str, dict[str, Any]],
    *,
    is_partial_amendment: bool = False,
    explicit_retired_chunk_ids: set[str] | None = None,
) -> dict[str, list[str]]:
    """Compute chunk-level transitions (Keep / Add / Modify / Retire) from v1 -> v2 per Section 6.2.

    - If `is_partial_amendment=True` (e.g. NĐ 309/2026 amends/supplements specific clauses of NĐ 118/2025):
      Untouched clauses of v1 are automatically kept (`keep`), new clauses are added (`add`),
      amended clauses are modified (`modify`), and only `explicit_retired_chunk_ids` are retired (`retire`).
      Adding Khoản 9 Điều 3 does NOT retire Khoản 4 Điều 3!
    - If `is_partial_amendment=False` (full v2 replacement of the same document):
      Chunks in v1 absent from v2 (or in `explicit_retired_chunk_ids`) are retired (`retire`).
    """
    retired_explicit = set(explicit_retired_chunk_ids or set())
    v1_keys = set(v1_chunks.keys())
    v2_keys = set(v2_chunks.keys())

    keep: list[str] = []
    add: list[str] = []
    modify: list[str] = []
    retire: list[str] = []

    for sem_id in sorted(v2_keys):
        if sem_id in retired_explicit:
            retire.append(sem_id)
            continue
        if sem_id not in v1_keys:
            add.append(sem_id)
        else:
            h1 = v1_chunks[sem_id].get("chunk_hash") or content_hash(v1_chunks[sem_id].get("text", ""))
            h2 = v2_chunks[sem_id].get("chunk_hash") or content_hash(v2_chunks[sem_id].get("text", ""))
            if h1 == h2:
                keep.append(sem_id)
            else:
                modify.append(sem_id)

    for sem_id in sorted(v1_keys - v2_keys):
        if sem_id in retired_explicit or not is_partial_amendment:
            retire.append(sem_id)
        else:
            keep.append(sem_id)

    return {
        "keep": keep,
        "add": add,
        "modify": modify,
        "retire": retire,
    }


# ---------------------------------------------------------------------------
# Section 5.3: Stale Matching Leakage Metric
# ---------------------------------------------------------------------------
def compute_stale_matching_leakage(
    returned_chunks: list[dict[str, Any]],
    as_of: date | str | None = None,
    active_version_ids: set[str] | None = None,
) -> float | None:
    """Compute stale_matching_leakage = inactive_chunks_returned / returned_chunks (Section 5.3).

    Returns None if returned_chunks is empty.
    A chunk is considered stale/inactive if:
      - Its lifecycle_status / validity_status is PREPARED, FAILED, or RETIRED (for current queries), OR
      - Its [effective_from, effective_to] interval does not cover `as_of`, OR
      - `active_version_ids` is provided and `legal_version_id` is not in `active_version_ids`.
    """
    total = len(returned_chunks)
    if total == 0:
        return None

    eval_date = parse_as_of(as_of)
    inactive_count = 0
    for chunk in returned_chunks:
        meta = chunk.get("metadata") if isinstance(chunk.get("metadata"), dict) else chunk
        status = str(meta.get("lifecycle_status") or meta.get("validity_status") or "ACTIVE").upper()
        if status in {STATUS_PREPARED, STATUS_FAILED, STATUS_RETIRED, "EXPIRED", "INACTIVE"}:
            inactive_count += 1
            continue
        ver_id = meta.get("legal_version_id")
        if active_version_ids is not None and ver_id and ver_id not in active_version_ids:
            inactive_count += 1
            continue
        eff_from = meta.get("effective_from")
        eff_to = meta.get("effective_to")
        if not is_effective_on(eff_from, eff_to, eval_date):
            inactive_count += 1

    return round(inactive_count / total, 6)


def format_citation_provenance(
    *,
    doc_code: str,
    article_number: int | str,
    clauses: str | int | None = None,
    legal_instrument_id_val: str | None = None,
    legal_version_id_val: str | None = None,
    semantic_chunk_id_val: str | None = None,
    index_generation: int | str = 1,
    source_url: str | None = None,
) -> dict[str, Any]:
    """Build complete citation provenance metadata per Section 11 & 15."""
    inst_id = legal_instrument_id_val or legal_instrument_id(doc_code)
    ver_id = legal_version_id_val or legal_version_id(doc_code, 1)
    sem_id = semantic_chunk_id_val or semantic_chunk_id(article_number, clauses)
    clause_str = f" khoản {clauses}" if clauses else ""
    gen_str = f"v{index_generation}" if not str(index_generation).startswith("v") else str(index_generation)
    return {
        "citation": f"{doc_code}, Điều {article_number}{clause_str}",
        "legal_instrument_id": inst_id,
        "legal_version_id": ver_id,
        "semantic_chunk_id": sem_id,
        "index_generation": gen_str,
        "source_url": source_url,
    }


# ---------------------------------------------------------------------------
# PostgreSQL Production Schema DDL & CAS SQL (Sections 2, 7.1, 10)
# ---------------------------------------------------------------------------
MANIFEST_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS legal_instrument (
    id TEXT PRIMARY KEY,
    normalized_number TEXT NOT NULL UNIQUE,
    document_type TEXT NOT NULL,
    issuing_authority TEXT NOT NULL,
    issued_date DATE,
    active_legal_version_id TEXT,
    index_generation INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS legal_version (
    id TEXT PRIMARY KEY,
    legal_instrument_id TEXT NOT NULL REFERENCES legal_instrument(id) ON DELETE CASCADE,
    version_no BIGINT NOT NULL,
    normalized_content_hash TEXT NOT NULL,
    index_fingerprint TEXT NOT NULL,
    embedding_model TEXT NOT NULL,
    embedding_dimension INTEGER NOT NULL,
    effective_from DATE,
    effective_to DATE,
    lifecycle_status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (legal_instrument_id, version_no)
);

CREATE TABLE IF NOT EXISTS source_artifact (
    id TEXT PRIMARY KEY,
    legal_version_id TEXT NOT NULL REFERENCES legal_version(id) ON DELETE CASCADE,
    object_key TEXT NOT NULL,
    artifact_type TEXT NOT NULL,
    artifact_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_job (
    id TEXT PRIMARY KEY,
    source_artifact_id TEXT NOT NULL REFERENCES source_artifact(id) ON DELETE CASCADE,
    operation_key TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_index_operation
ON ingestion_job (operation_key);

CREATE TABLE IF NOT EXISTS legal_relation (
    id TEXT PRIMARY KEY,
    source_instrument_id TEXT NOT NULL REFERENCES legal_instrument(id) ON DELETE CASCADE,
    amends_id TEXT,
    supersedes_id TEXT,
    consolidates_ids JSONB,
    effective_from DATE,
    validity_status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS ingestion_outbox (
    event_id TEXT PRIMARY KEY,
    legal_version_id TEXT NOT NULL,
    source_artifact_id TEXT NOT NULL,
    operation_key TEXT NOT NULL,
    payload JSONB NOT NULL,
    published BOOLEAN NOT NULL DEFAULT FALSE,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    delivery_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

CAS_ACTIVATE_VERSION_SQL = """
UPDATE legal_instrument
SET active_legal_version_id = %s,
    index_generation = COALESCE(index_generation, 0) + 1,
    updated_at = NOW()
WHERE id = %s
  AND (active_legal_version_id = %s OR (active_legal_version_id IS NULL AND %s IS NULL))
RETURNING id, active_legal_version_id, index_generation;
"""


def ensure_manifest_schema(conn) -> None:
    """Create the multi-layer legal manifest tables and unique constraints in PostgreSQL."""
    with conn.cursor() as cur:
        cur.execute(MANIFEST_SCHEMA_SQL)
    conn.commit()


# ---------------------------------------------------------------------------
# Full Transactional Staging, CAS, Rollback & Reconciliation Engine
# ---------------------------------------------------------------------------
@dataclass
class ChunkSpec:
    article_number: int | str
    text: str
    clauses: str | int | None = None
    effective_from: str | None = None
    effective_to: str | None = None
    title: str = ""


@dataclass
class LegalFixtureVersionSpec:
    doc_code: str
    document_type: str
    issuing_authority: str
    issued_date: str
    version_no: int
    object_key: str
    artifact_type: str
    effective_from: str | None
    effective_to: str | None = None
    amends_doc_code: str | None = None
    supersedes_doc_code: str | None = None
    is_partial_amendment: bool = False
    explicit_retired_chunk_ids: set[str] = field(default_factory=set)
    chunks: list[ChunkSpec] = field(default_factory=list)


class IncrementalLegalRAGPipeline:
    """Production-grade state machine implementing:
    - Manifest source-of-truth (legal_instrument, legal_version, source_artifact, ingestion_job, legal_relation, outbox)
    - At-least-once Outbox Publisher & Idempotent Consumer (by event_id & operation_key)
    - Candidate Staging (PREPARED), Validation Gate (dimension, count, hash, sample retrieval), and CAS Activation
    - Chunk-level incremental v1 -> v2 update (Keep/Reuse, Add, Modify, Retire)
    - Point-in-time temporal retrieval invariant & Stale Matching Leakage verification
    - Atomic Rollback (per-document CAS pointer & global index alias)
    - Reconciliation between Manifest and Vector Store.
    """

    def __init__(
        self,
        embedding_model: str = "BAAI/bge-m3",
        embedding_dimension: int = 1024,
        embed_fn: Callable[[list[str]], list[list[float]]] | None = None,
    ) -> None:
        self.embedding_model = embedding_model
        self.embedding_dimension = int(embedding_dimension)
        self._embed_fn = embed_fn or self._deterministic_embed
        self.index_generation: int = 1
        self.active_collection_alias: str = collection_alias_for_model(
            "legal_knowledge_base", self.embedding_model, self.embedding_dimension
        )

        # Relational manifest state
        self.instruments: dict[str, dict[str, Any]] = {}
        self.versions: dict[str, dict[str, Any]] = {}
        self.artifacts: dict[str, dict[str, Any]] = {}
        self.jobs: dict[str, dict[str, Any]] = {}  # keyed by job_id
        self.operation_key_index: dict[str, str] = {}  # UNIQUE(operation_key) -> job_id
        self.relations: dict[str, dict[str, Any]] = {}
        self.outbox_events: list[dict[str, Any]] = []
        self.version_history_stack: dict[str, list[str]] = {}  # instrument_id -> [v1_id, v2_id...]

        # Vector store state (keyed by deterministic vector_id)
        self.vector_store: dict[str, dict[str, Any]] = {}

        # Telemetry & Reconciliation counters
        self.metrics: dict[str, Any] = {
            "published_messages": 0,
            "processed_events": 0,
            "duplicate_deliveries": 0,
            "documents_added": 0,
            "documents_updated": 0,
            "documents_retired": 0,
            "documents_skipped": 0,
            "chunks_embedded": 0,
            "chunks_reused": 0,
            "stale_vectors_found": 0,
            "duplicate_chunks_found": 0,
            "ingestion_failures": 0,
            "ingestion_latency_ms": 0.0,
            "embedding_cost_tokens": 0,
        }

    def _deterministic_embed(self, texts: list[str]) -> list[list[float]]:
        """Generate deterministic unit-normalized vectors of `self.embedding_dimension` from NFC text."""
        vectors: list[list[float]] = []
        for text in texts:
            norm = normalize_for_hash(text)
            seed = hashlib.sha256(norm.encode("utf-8")).digest()
            vec: list[float] = []
            for idx in range(self.embedding_dimension):
                b = seed[idx % len(seed)] ^ ((idx * 31) & 0xFF)
                vec.append((b / 127.5) - 1.0)
            vectors.append(vec)
        return vectors

    def stage_version_and_outbox(self, spec: LegalFixtureVersionSpec) -> dict[str, Any]:
        """Step 1: Inside a single logical transaction, register instrument, candidate legal_version (PREPARED),
        source_artifact, ingestion_job (bound by unique operation_key), legal_relation, and outbox event.

        If the same artifact + content_hash + index_fingerprint is submitted again, returns idempotent status
        without creating a duplicate legal_version.
        """
        inst_id = legal_instrument_id(spec.doc_code)
        ver_id = legal_version_id(spec.doc_code, spec.version_no)

        full_doc_text = "\n".join(
            f"Điều {c.article_number} ({c.clauses or ''}): {c.text}" for c in spec.chunks
        )
        doc_hash = content_hash(full_doc_text)
        idx_fp = compute_index_fingerprint(
            doc_hash,
            embedding_model=self.embedding_model,
            embedding_dimension=self.embedding_dimension,
        )
        artf_id = source_artifact_id(spec.doc_code, spec.object_key, doc_hash)
        op_key = compute_operation_key(artf_id, doc_hash, idx_fp)

        # Check if currently active version already has identical content_hash & index_fingerprint
        existing_inst = self.instruments.get(inst_id)
        if existing_inst and existing_inst.get("active_legal_version_id"):
            active_ver = self.versions.get(existing_inst["active_legal_version_id"])
            if (
                active_ver
                and active_ver["raw_content_hash"] == doc_hash
                and active_ver["index_fingerprint"] == idx_fp
            ):
                # Same legal content arriving via another artifact (e.g. DOCX vs OCR scan) is a
                # LEGAL_EQUIVALENT: link the artifact to the active version, never re-embed.
                if artf_id not in self.artifacts:
                    self.artifacts[artf_id] = {
                        "id": artf_id,
                        "legal_version_id": active_ver["id"],
                        "object_key": spec.object_key,
                        "artifact_type": spec.artifact_type,
                        "artifact_hash": f"sha256:{doc_hash}",
                    }
                self.metrics["documents_skipped"] += 1
                return {
                    "status": "UNCHANGED",
                    "legal_instrument_id": inst_id,
                    "legal_version_id": active_ver["id"],
                    "source_artifact_id": artf_id,
                    "operation_key": op_key,
                }

        # Idempotent retry handling on same operation_key (Section 2 & 7.1):
        # Retry updates attempt_count on existing ingestion_job; NEVER creates a new legal_version!
        if op_key in self.operation_key_index:
            job_id = self.operation_key_index[op_key]
            job = self.jobs[job_id]
            job["attempt_count"] += 1
            self.metrics["documents_skipped"] += 1
            return {
                "status": "DUPLICATE_OPERATION",
                "legal_instrument_id": inst_id,
                "legal_version_id": ver_id,
                "source_artifact_id": artf_id,
                "ingestion_job_id": job_id,
                "operation_key": op_key,
                "attempt_count": job["attempt_count"],
            }

        if inst_id not in self.instruments:
            self.instruments[inst_id] = {
                "id": inst_id,
                "normalized_number": spec.doc_code,
                "document_type": spec.document_type,
                "issuing_authority": spec.issuing_authority,
                "issued_date": spec.issued_date,
                "active_legal_version_id": None,
                "index_generation": self.index_generation,
            }

        self.versions[ver_id] = {
            "id": ver_id,
            "legal_instrument_id": inst_id,
            "version_no": spec.version_no,
            "normalized_content_hash": f"sha256:{doc_hash}",
            "raw_content_hash": doc_hash,
            "index_fingerprint": idx_fp,
            "embedding_model": self.embedding_model,
            "embedding_dimension": self.embedding_dimension,
            "effective_from": spec.effective_from,
            "effective_to": spec.effective_to,
            "lifecycle_status": STATUS_PREPARED,
            "spec": spec,
        }

        self.artifacts[artf_id] = {
            "id": artf_id,
            "legal_version_id": ver_id,
            "object_key": spec.object_key,
            "artifact_type": spec.artifact_type,
            "artifact_hash": f"sha256:{doc_hash}",
        }

        job_id = f"job:{normalize_doc_slug(spec.doc_code)}:v{spec.version_no}:{op_key[:8]}"
        self.jobs[job_id] = {
            "id": job_id,
            "source_artifact_id": artf_id,
            "operation_key": op_key,
            "status": "PENDING",
            "attempt_count": 1,
            "last_error": None,
        }
        self.operation_key_index[op_key] = job_id

        if spec.amends_doc_code or spec.supersedes_doc_code:
            rel_id = f"rel:{inst_id}:{spec.version_no}"
            self.relations[rel_id] = {
                "id": rel_id,
                "source_instrument_id": inst_id,
                "amends_id": legal_instrument_id(spec.amends_doc_code) if spec.amends_doc_code else None,
                "supersedes_id": legal_instrument_id(spec.supersedes_doc_code) if spec.supersedes_doc_code else None,
                "consolidates_ids": None,
                "effective_from": spec.effective_from,
                "validity_status": "active",
            }
            if spec.amends_doc_code:
                target_inst_id = legal_instrument_id(spec.amends_doc_code)
                target_inst = self.instruments.get(target_inst_id)
                if target_inst and target_inst.get("active_legal_version_id"):
                    target_ver = self.versions.get(target_inst["active_legal_version_id"])
                    if target_ver:
                        target_ver["validity_status"] = "partially_expired"
                        target_ver["updated_by"] = inst_id
                        target_ver["updated_effective_at"] = spec.effective_from

        event = {
            "event_id": f"evt:{ver_id}:{op_key[:10]}",
            "legal_instrument_id": inst_id,
            "legal_version_id": ver_id,
            "source_artifact_id": artf_id,
            "ingestion_job_id": job_id,
            "operation_key": op_key,
            "expected_previous_version_id": self.instruments[inst_id].get("active_legal_version_id"),
        }
        self.outbox_events.append(event)
        return {
            "status": STATUS_PREPARED,
            "legal_instrument_id": inst_id,
            "legal_version_id": ver_id,
            "source_artifact_id": artf_id,
            "ingestion_job_id": job_id,
            "operation_key": op_key,
            "event": event,
        }

    def consume_event(self, event: dict[str, Any]) -> dict[str, Any]:
        """Step 2-5: Idempotent consumer that processes an outbox delivery (including redeliveries),
        performs chunk-level diff/reuse, embeds new/modified candidate chunks in staging,
        validates count/hash/dimension/sample-retrieval, and executes CAS activation.
        """
        t0 = time.perf_counter()
        self.metrics["published_messages"] += 1
        op_key = event["operation_key"]
        job_id = self.operation_key_index.get(op_key)
        if not job_id or job_id not in self.jobs:
            raise ValueError(f"Unknown operation_key: {op_key}")

        job = self.jobs[job_id]
        if job["status"] == "COMPLETED":
            self.metrics["duplicate_deliveries"] += 1
            return {
                "status": "DUPLICATE_IGNORED",
                "operation_key": op_key,
                "legal_version_id": event["legal_version_id"],
            }

        ver_id = event["legal_version_id"]
        ver = self.versions[ver_id]
        inst_id = ver["legal_instrument_id"]
        inst = self.instruments[inst_id]
        spec: LegalFixtureVersionSpec = ver["spec"]
        prev_ver_id = inst.get("active_legal_version_id")

        # Gather previous version's chunks for chunk-level reuse (v1 -> v2)
        prev_chunks_by_sem_id: dict[str, dict[str, Any]] = {}
        if prev_ver_id:
            for vec_row in self.vector_store.values():
                if (
                    vec_row["legal_version_id"] == prev_ver_id
                    and vec_row["lifecycle_status"] in {STATUS_ACTIVE, STATUS_PARTIALLY_EXPIRED}
                ):
                    prev_chunks_by_sem_id[vec_row["semantic_chunk_id"]] = vec_row

        try:
            # Parse candidate chunks into semantic_chunk_id map
            candidate_chunks_map: dict[str, dict[str, Any]] = {}
            for ch in spec.chunks:
                if not ch.text or not ch.text.strip():
                    raise ValueError(f"Empty chunk text in {spec.doc_code} Điều {ch.article_number}")
                sem_id = semantic_chunk_id(ch.article_number, ch.clauses)
                ch_hash = chunk_hash(ch.text)
                candidate_chunks_map[sem_id] = {
                    "semantic_chunk_id": sem_id,
                    "article_number": ch.article_number,
                    "clauses": ch.clauses,
                    "title": ch.title,
                    "text": normalize_for_hash(ch.text),
                    "chunk_hash": ch_hash,
                    "effective_from": ch.effective_from or spec.effective_from,
                    "effective_to": ch.effective_to or spec.effective_to,
                }

            chunk_diff = diff_version_chunks(
                prev_chunks_by_sem_id,
                candidate_chunks_map,
                is_partial_amendment=spec.is_partial_amendment,
                explicit_retired_chunk_ids=spec.explicit_retired_chunk_ids,
            )

            staged_vector_ids: list[str] = []

            # 1. Reuse unchanged chunks from v1 without calling embedding API
            for sem_id in chunk_diff["keep"]:
                if sem_id in candidate_chunks_map and sem_id in prev_chunks_by_sem_id:
                    c_info = candidate_chunks_map[sem_id]
                    prev_row = prev_chunks_by_sem_id[sem_id]
                elif sem_id in prev_chunks_by_sem_id:
                    prev_row = prev_chunks_by_sem_id[sem_id]
                    c_info = {
                        "semantic_chunk_id": sem_id,
                        "article_number": prev_row["article_number"],
                        "clauses": prev_row.get("clauses"),
                        "title": prev_row.get("title", ""),
                        "text": prev_row["text"],
                        "chunk_hash": prev_row["chunk_hash"],
                        "effective_from": prev_row["effective_from"],
                        "effective_to": prev_row["effective_to"],
                    }
                else:
                    continue

                vec_id = deterministic_vector_id(ver_id, sem_id, c_info["chunk_hash"])
                self.vector_store[vec_id] = {
                    "vector_id": vec_id,
                    "legal_instrument_id": inst_id,
                    "legal_version_id": ver_id,
                    "doc_code": spec.doc_code,
                    "semantic_chunk_id": sem_id,
                    "article_number": c_info["article_number"],
                    "clauses": c_info["clauses"],
                    "title": c_info["title"],
                    "text": c_info["text"],
                    "chunk_hash": c_info["chunk_hash"],
                    "embedding": list(prev_row["embedding"]),
                    "embedding_model": self.embedding_model,
                    "embedding_dimension": len(prev_row["embedding"]),
                    "effective_from": c_info["effective_from"],
                    "effective_to": c_info["effective_to"],
                    "lifecycle_status": STATUS_PREPARED,
                    "validity_status": "active",
                    "index_generation": self.index_generation,
                }
                staged_vector_ids.append(vec_id)
                self.metrics["chunks_reused"] += 1

            # 2. Embed only added or modified chunks in staging
            to_embed_ids = chunk_diff["add"] + chunk_diff["modify"]
            if to_embed_ids:
                texts_to_embed = [candidate_chunks_map[sid]["text"] for sid in to_embed_ids]
                embeddings_list = self._embed_fn(texts_to_embed)
                for sid, vec in zip(to_embed_ids, embeddings_list):
                    if len(vec) != self.embedding_dimension:
                        raise ValueError(
                            f"Embedding dimension mismatch: expected {self.embedding_dimension}, got {len(vec)}"
                        )
                    c_info = candidate_chunks_map[sid]
                    vec_id = deterministic_vector_id(ver_id, sid, c_info["chunk_hash"])
                    self.vector_store[vec_id] = {
                        "vector_id": vec_id,
                        "legal_instrument_id": inst_id,
                        "legal_version_id": ver_id,
                        "doc_code": spec.doc_code,
                        "semantic_chunk_id": sid,
                        "article_number": c_info["article_number"],
                        "clauses": c_info["clauses"],
                        "title": c_info["title"],
                        "text": c_info["text"],
                        "chunk_hash": c_info["chunk_hash"],
                        "embedding": vec,
                        "embedding_model": self.embedding_model,
                        "embedding_dimension": len(vec),
                        "effective_from": c_info["effective_from"],
                        "effective_to": c_info["effective_to"],
                        "lifecycle_status": STATUS_PREPARED,
                        "validity_status": "active",
                        "index_generation": self.index_generation,
                    }
                    staged_vector_ids.append(vec_id)
                    self.metrics["chunks_embedded"] += 1
                    self.metrics["embedding_cost_tokens"] += max(1, len(c_info["text"]) // 3)

            # Step 4: Validation Gate (count, hash, dimension, sample retrieval)
            expected_count = len(chunk_diff["keep"]) + len(to_embed_ids)
            if len(staged_vector_ids) != expected_count or expected_count == 0:
                raise RuntimeError(
                    f"Validation failed: staged {len(staged_vector_ids)} chunks, expected {expected_count}"
                )
            for vid in staged_vector_ids:
                row = self.vector_store.get(vid)
                if not row or len(row["embedding"]) != self.embedding_dimension:
                    raise RuntimeError(f"Validation failed on staged vector {vid}")

            # Step 5: Atomic Compare-And-Swap (CAS) Activation
            expected_prev = event.get("expected_previous_version_id")
            cas_ok = self.cas_activate_version(
                inst_id,
                candidate_version_id=ver_id,
                expected_previous_version_id=expected_prev,
            )
            if not cas_ok:
                raise RuntimeError(
                    f"CAS conflict on {inst_id}: active_legal_version_id changed concurrently "
                    f"(expected {expected_prev}, found {inst.get('active_legal_version_id')})"
                )

            job["status"] = "COMPLETED"
            self.metrics["processed_events"] += 1
            if prev_ver_id is None:
                self.metrics["documents_added"] += 1
            else:
                self.metrics["documents_updated"] += 1

            self.metrics["ingestion_latency_ms"] += round((time.perf_counter() - t0) * 1000.0, 2)
            return {
                "status": STATUS_ACTIVE,
                "legal_instrument_id": inst_id,
                "legal_version_id": ver_id,
                "chunk_diff": chunk_diff,
                "staged_vectors": len(staged_vector_ids),
            }

        except Exception as exc:
            # Failure Matrix safety (Table 4, Page 12):
            # Mark candidate FAILED; keep previous active version untouched!
            ver["lifecycle_status"] = STATUS_FAILED
            job["status"] = "FAILED"
            job["last_error"] = str(exc)
            for vec_row in self.vector_store.values():
                if vec_row["legal_version_id"] == ver_id:
                    vec_row["lifecycle_status"] = STATUS_FAILED
            self.metrics["ingestion_failures"] += 1
            raise

    def cas_activate_version(
        self,
        instrument_id: str,
        candidate_version_id: str,
        expected_previous_version_id: str | None,
    ) -> bool:
        """Compare-And-Swap (CAS) activation of a candidate legal_version (Section 10).

        Equivalent to SQL:
          UPDATE legal_instrument
          SET active_legal_version_id = :candidate
          WHERE id = :instrument AND active_legal_version_id = :expected_previous;
        """
        inst = self.instruments.get(instrument_id)
        if not inst:
            return False
        current_active = inst.get("active_legal_version_id")
        if current_active != expected_previous_version_id:
            return False

        cand_ver = self.versions.get(candidate_version_id)
        if not cand_ver or cand_ver["lifecycle_status"] == STATUS_FAILED:
            return False

        # Retire previous version's active status (keep in history for rollback & point-in-time retrieval)
        if current_active and current_active in self.versions:
            prev_ver = self.versions[current_active]
            prev_ver["lifecycle_status"] = STATUS_RETIRED
            for vec_row in self.vector_store.values():
                if vec_row["legal_version_id"] == current_active:
                    vec_row["lifecycle_status"] = STATUS_RETIRED

        # Activate candidate version and its chunks
        self.index_generation += 1
        inst["active_legal_version_id"] = candidate_version_id
        inst["index_generation"] = self.index_generation
        cand_ver["lifecycle_status"] = STATUS_ACTIVE

        for vec_row in self.vector_store.values():
            if vec_row["legal_version_id"] == candidate_version_id:
                vec_row["lifecycle_status"] = STATUS_ACTIVE
                vec_row["index_generation"] = self.index_generation

        history = self.version_history_stack.setdefault(instrument_id, [])
        if not history or history[-1] != candidate_version_id:
            history.append(candidate_version_id)
        return True

    def soft_delete_instrument(
        self,
        doc_code: str,
        *,
        status: str = "retired",
        updated_by_doc_code: str | None = None,
        effective_at: str | None = None,
    ) -> dict[str, Any]:
        """Soft-delete or partially expire a legal instrument (Section 8).
        In the legal domain, records are never hard-deleted so historical Point-in-time queries remain auditable.
        """
        inst_id = legal_instrument_id(doc_code)
        inst = self.instruments.get(inst_id)
        if not inst or not inst.get("active_legal_version_id"):
            raise KeyError(f"Instrument {doc_code} not found or has no active version")

        ver_id = inst["active_legal_version_id"]
        ver = self.versions[ver_id]
        norm_status = status.lower()
        if norm_status == "retired":
            ver["lifecycle_status"] = STATUS_RETIRED
            ver["validity_status"] = "retired"
            if effective_at:
                ver["effective_to"] = effective_at
            self.metrics["documents_retired"] += 1
        else:
            ver["lifecycle_status"] = STATUS_PARTIALLY_EXPIRED
            ver["validity_status"] = "partially_expired"

        for vec_row in self.vector_store.values():
            if vec_row["legal_version_id"] == ver_id:
                vec_row["validity_status"] = ver["validity_status"]
                vec_row["lifecycle_status"] = ver["lifecycle_status"]
                if effective_at and norm_status == "retired":
                    vec_row["effective_to"] = effective_at

        return {
            "document_id": inst_id,
            "legal_version_id": ver_id,
            "status": ver["validity_status"],
            "updated_by": legal_instrument_id(updated_by_doc_code) if updated_by_doc_code else None,
            "effective_at": effective_at,
        }

    def rollback_instrument(self, doc_code: str, target_version_id: str | None = None) -> dict[str, Any]:
        """Atomic rollback of a single legal instrument by CAS updating its active_legal_version_id pointer
        back to the previous (or specified) version (Section 11).
        """
        inst_id = legal_instrument_id(doc_code)
        inst = self.instruments.get(inst_id)
        if not inst:
            raise KeyError(f"Unknown legal instrument: {doc_code}")

        current_active = inst.get("active_legal_version_id")
        history = self.version_history_stack.get(inst_id, [])
        if target_version_id is None:
            if len(history) < 2:
                raise ValueError(f"No previous version available to rollback for {doc_code}")
            target_version_id = history[-2]

        if target_version_id not in self.versions:
            raise KeyError(f"Target version {target_version_id} not found")

        ok = self.cas_activate_version(
            inst_id,
            candidate_version_id=target_version_id,
            expected_previous_version_id=current_active,
        )
        if not ok:
            raise RuntimeError(f"CAS rollback failed for {doc_code}")

        return {
            "legal_instrument_id": inst_id,
            "rolled_back_from": current_active,
            "active_legal_version_id": target_version_id,
            "index_generation": self.index_generation,
        }

    def reconcile(self) -> dict[str, Any]:
        """Section 12 Reconciliation: Compare manifest versions against Vector Store chunks.
        Detects and cleans:
          - stale_vectors_found: Vectors of FAILED versions, vectors whose version no longer exists in the
            manifest (orphans), or PREPARED vectors whose ingestion job is no longer in progress.
          - duplicate_chunks_found: Duplicate (legal_version_id, semantic_chunk_id) entries.
          - missing_chunk_versions: ACTIVE versions without any vector (reported, needs re-ingest).
        RETIRED vectors of a still-registered version are kept as audit history for rollback and
        point-in-time queries; current-query retrieval already excludes them.
        """
        in_progress_versions = {
            self.artifacts[job["source_artifact_id"]]["legal_version_id"]
            for job in self.jobs.values()
            if job["status"] in {"PENDING", "PROCESSING"} and job["source_artifact_id"] in self.artifacts
        }

        stale_ids: list[str] = []
        seen_sem_keys: set[tuple[str, str]] = set()
        duplicate_ids: list[str] = []

        for vec_id, row in list(self.vector_store.items()):
            ver_id = row.get("legal_version_id")
            ver = self.versions.get(ver_id)
            status = row.get("lifecycle_status")
            if (
                ver is None
                or ver.get("lifecycle_status") == STATUS_FAILED
                or status == STATUS_FAILED
                or (status == STATUS_PREPARED and ver_id not in in_progress_versions)
            ):
                stale_ids.append(vec_id)
                continue
            sem_key = (ver_id, row.get("semantic_chunk_id", ""))
            if sem_key in seen_sem_keys:
                duplicate_ids.append(vec_id)
            else:
                seen_sem_keys.add(sem_key)

        for vid in stale_ids + duplicate_ids:
            self.vector_store.pop(vid, None)

        active_ver_ids = {
            inst["active_legal_version_id"]
            for inst in self.instruments.values()
            if inst.get("active_legal_version_id")
        }
        versions_with_vectors = {row["legal_version_id"] for row in self.vector_store.values()}
        missing = sorted(active_ver_ids - versions_with_vectors)

        self.metrics["stale_vectors_found"] += len(stale_ids)
        self.metrics["duplicate_chunks_found"] += len(duplicate_ids)
        return {
            "active_version_count": len(active_ver_ids),
            "remaining_vectors": len(self.vector_store),
            "stale_vectors_removed": len(stale_ids),
            "duplicate_chunks_removed": len(duplicate_ids),
            "missing_chunk_versions": missing,
            "metrics": dict(self.metrics),
        }

    def retrieve(
        self,
        query: str,
        *,
        as_of: date | str | None = None,
        top_k: int = 3,
        include_historical_versions: bool = False,
    ) -> list[dict[str, Any]]:
        """Point-in-time Legal Retrieval enforcing the Server-Side Temporal Invariant (Section 8 & 15):
          effective_from <= T AND (effective_to IS NULL OR effective_to >= T)
          AND validity_status IN ('active', 'partially_expired')
          AND (legal_version_id == instrument.active_legal_version_id unless historical lookup).
        """
        eval_date = parse_as_of(as_of)
        active_ver_ids = {
            inst["active_legal_version_id"]
            for inst in self.instruments.values()
            if inst.get("active_legal_version_id")
        }

        q_words = set(normalize_for_hash(query).lower().split())
        allowed_statuses = {STATUS_ACTIVE, STATUS_PARTIALLY_EXPIRED}
        allowed_validity = {"active", "partially_expired"}
        if include_historical_versions:
            allowed_statuses.add(STATUS_RETIRED)
            allowed_validity.add("retired")
        candidates: list[dict[str, Any]] = []
        for row in self.vector_store.values():
            ver_id = row["legal_version_id"]
            if not include_historical_versions and ver_id not in active_ver_ids:
                continue
            if row.get("lifecycle_status") not in allowed_statuses:
                continue
            if str(row.get("validity_status", "active")).lower() not in allowed_validity:
                continue
            if not is_effective_on(row.get("effective_from"), row.get("effective_to"), eval_date):
                continue

            text_words = set(row["text"].lower().split())
            overlap = len(q_words & text_words)
            score = overlap / max(1, len(q_words)) if q_words else 1.0
            provenance = format_citation_provenance(
                doc_code=row["doc_code"],
                article_number=row["article_number"],
                clauses=row.get("clauses"),
                legal_instrument_id_val=row["legal_instrument_id"],
                legal_version_id_val=row["legal_version_id"],
                semantic_chunk_id_val=row["semantic_chunk_id"],
                index_generation=row.get("index_generation", self.index_generation),
            )
            candidates.append({
                **row,
                "score": round(score, 4),
                "provenance": provenance,
            })

        candidates.sort(key=lambda r: (r["score"], str(r["doc_code"]), str(r["semantic_chunk_id"])), reverse=True)
        return candidates[:top_k]
