"""Workspace capabilities for LexIT: Auth/Profile, Follow-up Suggestions,
Precedent Search, Full-Text Article Drawer, IT Compliance Review & Legal Drafting.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import date, datetime, timezone
from email.message import EmailMessage
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import smtplib
import ssl
import tempfile
import threading
import time
from typing import Any
import unicodedata
import uuid

from sqlalchemy import text as sql_text

from config import COLLECTION_NAME, DATA_DIR, NEO4J_DATABASE
from legal_knowledge import is_effective_on, parse_as_of
from legal_parser import DOCUMENT_REGISTRY, REPEALED_15_ARTICLES, normalize_text, related_document_codes
from legal_rules import DECREE_RULES, INDIVIDUAL, ORGANIZATION, QueryFacts, apply_penalty_rules
from precedents import load_precedent_manifest


# ---------------------------------------------------------------------------
# Helpers chung (Chuẩn hóa tiếng Việt & Hashing)
# ---------------------------------------------------------------------------
def _strip_accents_lower(value: str) -> str:
    text = unicodedata.normalize("NFC", value or "").lower()
    text = text.replace("đ", "d")
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(encoded: str) -> bytes:
    padding = "=" * (-len(encoded) % 4)
    return base64.urlsafe_b64decode(encoded + padding)


def _norm_email(email: str) -> str:
    return unicodedata.normalize("NFC", (email or "").strip().lower())


def _safe_json_loads(raw: str | dict | None, default: dict | None = None) -> dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    if not raw:
        return dict(default or {})
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else dict(default or {})
    except Exception:
        return dict(default or {})


def _doc_registry_by_code() -> dict[str, dict[str, Any]]:
    mapping: dict[str, dict[str, Any]] = {}
    for entry in DOCUMENT_REGISTRY:
        code = str(entry.get("code") or "").strip()
        if code and code not in mapping:
            mapping[code] = entry
    return mapping


# ---------------------------------------------------------------------------
# 1. Authentication & User Profile Manager (PostgreSQL + JSON fallback)
# ---------------------------------------------------------------------------
_PBKDF2_ITERATIONS = 200_000
_TOKEN_TTL_SECONDS = 7 * 24 * 3600
_OTP_LENGTH = 6
_OTP_TTL_SECONDS = 300
_OTP_RESEND_COOLDOWN_SECONDS = 60
_OTP_MAX_ATTEMPTS = 5
_OTP_VALID_PURPOSES = frozenset({"register", "reset_password"})
_OTP_CODE_RE = re.compile(r"^\d{6}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class OtpCooldownError(ValueError):
    """Lỗi giới hạn thời gian chờ trước khi gửi lại mã OTP."""

    def __init__(self, message: str, retry_after_seconds: int) -> None:
        super().__init__(message)
        self.retry_after_seconds = max(1, int(retry_after_seconds))


def send_otp_email(
    to_email: str,
    otp_code: str,
    purpose: str = "register",
    ttl_seconds: int = _OTP_TTL_SECONDS,
) -> str:
    """Gửi email mã OTP 6 chữ số qua máy chủ SMTP thật (bắt buộc cấu hình SMTP_* trong backend/.env)."""
    smtp_host = (os.getenv("SMTP_HOST") or "").strip()
    smtp_user = (os.getenv("SMTP_USER") or "").strip()
    smtp_pass = (os.getenv("SMTP_PASSWORD") or "").strip()
    smtp_from = (os.getenv("SMTP_FROM") or smtp_user or "LexIT LegalTech <no-reply@lexit.vn>").strip()
    try:
        smtp_port = int((os.getenv("SMTP_PORT") or "587").strip())
    except ValueError:
        smtp_port = 587

    if not (smtp_host and smtp_user and smtp_pass):
        raise RuntimeError(
            "Máy chủ chưa cấu hình SMTP để gửi email OTP thật. "
            "Vui lòng bổ sung SMTP_HOST, SMTP_USER và SMTP_PASSWORD (App Password) trong backend/.env rồi khởi động lại backend."
        )

    minutes = max(1, ttl_seconds // 60)
    action_text = (
        "xác minh đăng ký tài khoản LexIT"
        if purpose == "register"
        else "đặt lại mật khẩu tài khoản LexIT"
    )
    subject = (
        f"[LexIT] Mã OTP xác minh đăng ký: {otp_code}"
        if purpose == "register"
        else f"[LexIT] Mã OTP đặt lại mật khẩu: {otp_code}"
    )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = smtp_from
    msg["To"] = to_email
    msg.set_content(
        f"Xin chào,\n\n"
        f"Mã OTP để {action_text} của bạn là: {otp_code}\n"
        f"Mã có hiệu lực trong {minutes} phút. Tuyệt đối không chia sẻ mã này cho người khác.\n\n"
        f"Trân trọng,\nHệ thống Trợ lý Pháp luật CNTT LexIT"
    )
    msg.add_alternative(
        f"""<!DOCTYPE html>
<html lang="vi">
<body style="font-family:Segoe UI,Arial,sans-serif;background:#070d1b;color:#f1f5f9;padding:24px;">
  <div style="max-width:480px;margin:0 auto;background:#131e2e;border:1px solid #24334a;border-radius:12px;padding:28px;">
    <h2 style="margin:0 0 12px;color:#ffffff;">LexIT LegalTech — Mã xác thực OTP</h2>
    <p style="margin:0 0 18px;color:#cbd5e1;font-size:14px;line-height:1.6;">
      Bạn vừa yêu cầu mã OTP để <strong>{action_text}</strong>. Vui lòng nhập mã 6 chữ số bên dưới:
    </p>
    <div style="text-align:center;margin:20px 0;padding:16px;background:#1c283b;border-radius:10px;letter-spacing:10px;font-size:30px;font-weight:700;color:#93c5fd;">
      {otp_code}
    </div>
    <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">
      Mã có hiệu lực trong <strong>{minutes} phút</strong> (tối đa 5 lần nhập sai). Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email này.
    </p>
  </div>
</body>
</html>""",
        subtype="html",
    )

    try:
        context = ssl.create_default_context()
        if smtp_port == 465:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=10, context=context) as server:
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
                server.ehlo()
                server.starttls(context=context)
                server.ehlo()
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
        return "smtp"
    except Exception as exc:
        raise RuntimeError(f"Không thể gửi email OTP qua máy chủ SMTP ({smtp_host}): {exc}") from exc


def verify_google_id_token(id_token_str: str, client_id: str) -> dict[str, Any]:
    """Xác thực Google ID Token (OAuth 2.0 / Google Identity Services) bằng chữ ký JWT chính thức."""
    resolved_client_id = (client_id or "").strip()
    if not resolved_client_id:
        raise RuntimeError("Máy chủ chưa cấu hình GOOGLE_CLIENT_ID cho đăng nhập Google.")
    token = (id_token_str or "").strip()
    if not token:
        raise ValueError("Thiếu Google credential token.")

    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token as google_id_token
    except ImportError as exc:
        raise RuntimeError("Thiếu thư viện google-auth ở backend để xác thực Google Sign-In.") from exc

    try:
        claims = google_id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            resolved_client_id,
            clock_skew_in_seconds=10,
        )
    except ValueError as exc:
        raise ValueError(f"Google ID Token không hợp lệ hoặc đã hết hạn: {exc}") from exc
    except Exception as exc:
        raise ValueError(f"Không thể xác thực token từ Google: {exc}") from exc

    issuer = str(claims.get("iss") or "")
    if issuer not in {"accounts.google.com", "https://accounts.google.com"}:
        raise ValueError("Token Google sai nguồn phát hành (issuer).")
    if claims.get("email_verified") is not True:
        raise ValueError("Tài khoản Google chưa xác minh địa chỉ email.")
    email = _norm_email(str(claims.get("email") or ""))
    if not _EMAIL_RE.match(email) or not claims.get("sub"):
        raise ValueError("Token Google thiếu thông tin email hoặc định danh tài khoản.")
    return dict(claims)


def _hash_password(password: str, salt: bytes | None = None) -> str:
    salt_bytes = salt if salt is not None else secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt_bytes, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${_b64url_encode(salt_bytes)}${_b64url_encode(dk)}"


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        scheme, iter_s, salt_b64, digest_b64 = (stored_hash or "").split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        iterations = int(iter_s)
        salt_bytes = _b64url_decode(salt_b64)
        expected = _b64url_decode(digest_b64)
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt_bytes, iterations)
        return secrets.compare_digest(candidate, expected)
    except Exception:
        return False


class AuthManager:
    """Quản lý đăng ký, đăng nhập, hồ sơ người dùng với PostgreSQL và fallback JSON."""

    def __init__(
        self,
        sql_engine: Any = None,
        store_path: Path | None = None,
        secret_key: str | None = None,
    ) -> None:
        self.sql_engine = sql_engine
        self.store_path = Path(store_path) if store_path else (DATA_DIR / ".users_store.json")
        self._lock = threading.RLock()
        self._pg_ready = False
        self._secret_key = (
            secret_key
            or os.getenv("LEXIT_AUTH_SECRET")
            or os.getenv("LAW_API_KEY")
            or ""
        ).strip()
        self._ensure_initialized()

    def _public_user(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": str(row["id"]),
            "email": str(row["email"]),
            "full_name": str(row.get("full_name") or ""),
            "role": str(row.get("role") or "Doanh nghiệp / Cá nhân"),
            "organization": str(row.get("organization") or ""),
            "auth_provider": str(row.get("auth_provider") or "local"),
            "credits": int(row.get("credits") if row.get("credits") is not None else 100),
            "preferences": _safe_json_loads(row.get("preferences") or row.get("preferences_json"), {"theme": "light", "default_topic": "ALL"}),
            "created_at": str(row.get("created_at") or ""),
            "updated_at": str(row.get("updated_at") or ""),
        }

    def _load_json_store(self) -> dict[str, Any]:
        if not self.store_path.exists():
            return {"_secret": "", "users": {}, "otps": {}}
        try:
            data = json.loads(self.store_path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                return {"_secret": "", "users": {}, "otps": {}}
            data.setdefault("_secret", "")
            data.setdefault("users", {})
            data.setdefault("otps", {})
            return data
        except Exception:
            return {"_secret": "", "users": {}, "otps": {}}

    def _save_json_store(self, payload: dict[str, Any]) -> None:
        self.store_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.store_path.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp_path.replace(self.store_path)

    def _init_postgres_table(self) -> None:
        if self.sql_engine is None:
            return
        ddl_users = sql_text(
            """
            CREATE TABLE IF NOT EXISTS lexit_users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                role TEXT NOT NULL,
                organization TEXT NOT NULL DEFAULT '',
                auth_provider TEXT NOT NULL DEFAULT 'local',
                credits INTEGER NOT NULL DEFAULT 100,
                preferences_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        ddl_otps = sql_text(
            """
            CREATE TABLE IF NOT EXISTS lexit_auth_otps (
                email TEXT NOT NULL,
                purpose TEXT NOT NULL,
                otp_hash TEXT NOT NULL,
                expires_at BIGINT NOT NULL,
                resend_available_at BIGINT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                max_attempts INTEGER NOT NULL DEFAULT 5,
                created_at TEXT NOT NULL,
                PRIMARY KEY (email, purpose)
            )
            """
        )
        with self.sql_engine.begin() as conn:
            conn.execute(ddl_users)
            conn.execute(ddl_otps)
        self._pg_ready = True

    def _ensure_initialized(self) -> None:
        with self._lock:
            store = self._load_json_store()
            dirty = False
            if not self._secret_key:
                stored_secret = str(store.get("_secret") or "").strip()
                if not stored_secret:
                    stored_secret = secrets.token_urlsafe(32)
                    store["_secret"] = stored_secret
                    dirty = True
                self._secret_key = stored_secret

            if self.sql_engine is not None:
                try:
                    self._init_postgres_table()
                except Exception:
                    self._pg_ready = False

            if dirty:
                try:
                    self._save_json_store(store)
                except Exception:
                    pass

    def _find_user_by_email(self, email: str) -> dict[str, Any] | None:
        norm = _norm_email(email)
        if self._pg_ready and self.sql_engine is not None:
            try:
                with self.sql_engine.connect() as conn:
                    row = conn.execute(
                        sql_text("SELECT * FROM lexit_users WHERE email = :email LIMIT 1"),
                        {"email": norm},
                    ).mappings().first()
                    if row is not None:
                        return dict(row)
            except Exception:
                pass
        store = self._load_json_store()
        for user in store.get("users", {}).values():
            if _norm_email(user.get("email", "")) == norm:
                return dict(user)
        return None

    def get_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        if not user_id:
            return None
        if self._pg_ready and self.sql_engine is not None:
            try:
                with self.sql_engine.connect() as conn:
                    row = conn.execute(
                        sql_text("SELECT * FROM lexit_users WHERE id = :id LIMIT 1"),
                        {"id": str(user_id)},
                    ).mappings().first()
                    if row is not None:
                        return self._public_user(dict(row))
            except Exception:
                pass
        store = self._load_json_store()
        found = store.get("users", {}).get(str(user_id))
        return self._public_user(found) if found else None

    def _persist_user(self, record: dict[str, Any]) -> None:
        prefs_str = (
            record.get("preferences_json")
            if isinstance(record.get("preferences_json"), str)
            else json.dumps(record.get("preferences") or {}, ensure_ascii=False)
        )
        if self._pg_ready and self.sql_engine is not None:
            try:
                with self.sql_engine.begin() as conn:
                    conn.execute(
                        sql_text(
                            """
                            INSERT INTO lexit_users (
                                id, email, password_hash, full_name, role, organization,
                                auth_provider, credits, preferences_json, created_at, updated_at
                            ) VALUES (
                                :id, :email, :password_hash, :full_name, :role, :organization,
                                :auth_provider, :credits, :preferences_json, :created_at, :updated_at
                            )
                            ON CONFLICT (id) DO UPDATE SET
                                password_hash = EXCLUDED.password_hash,
                                full_name = EXCLUDED.full_name,
                                role = EXCLUDED.role,
                                organization = EXCLUDED.organization,
                                credits = EXCLUDED.credits,
                                preferences_json = EXCLUDED.preferences_json,
                                updated_at = EXCLUDED.updated_at
                            """
                        ),
                        {
                            "id": record["id"],
                            "email": _norm_email(record["email"]),
                            "password_hash": record["password_hash"],
                            "full_name": record["full_name"],
                            "role": record["role"],
                            "organization": record.get("organization") or "",
                            "auth_provider": record.get("auth_provider") or "local",
                            "credits": int(record.get("credits") if record.get("credits") is not None else 100),
                            "preferences_json": prefs_str,
                            "created_at": record["created_at"],
                            "updated_at": record["updated_at"],
                        },
                    )
            except Exception:
                pass

        store = self._load_json_store()
        store_copy = dict(record)
        store_copy["email"] = _norm_email(record["email"])
        store_copy["preferences"] = _safe_json_loads(prefs_str)
        store_copy.pop("preferences_json", None)
        store["users"][record["id"]] = store_copy
        self._save_json_store(store)

    def create_access_token(self, user: dict[str, Any], ttl_seconds: int = _TOKEN_TTL_SECONDS) -> str:
        now = int(time.time())
        payload = {
            "sub": str(user["id"]),
            "email": str(user["email"]),
            "iat": now,
            "exp": now + ttl_seconds,
        }
        payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
        sig = hmac.new(self._secret_key.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest()
        return f"{payload_b64}.{_b64url_encode(sig)}"

    def verify_access_token(self, token: str) -> dict[str, Any] | None:
        raw = (token or "").strip()
        if raw.lower().startswith("bearer "):
            raw = raw[7:].strip()
        if "." not in raw:
            return None
        try:
            payload_b64, sig_b64 = raw.split(".", 1)
            expected_sig = hmac.new(
                self._secret_key.encode("utf-8"),
                payload_b64.encode("ascii"),
                hashlib.sha256,
            ).digest()
            provided_sig = _b64url_decode(sig_b64)
            if not secrets.compare_digest(expected_sig, provided_sig):
                return None
            payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
            if int(payload.get("exp", 0)) < int(time.time()):
                return None
            user_id = str(payload.get("sub") or "")
            return self.get_user_by_id(user_id)
        except Exception:
            return None

    def register_user(
        self,
        email: str,
        password: str,
        full_name: str,
        role: str = "Doanh nghiệp / Cá nhân",
        organization: str = "",
    ) -> tuple[dict[str, Any], str]:
        norm = _norm_email(email)
        if not _EMAIL_RE.match(norm):
            raise ValueError("Email không hợp lệ.")
        if len(password or "") < 6:
            raise ValueError("Mật khẩu phải có tối thiểu 6 ký tự.")
        cleaned_name = unicodedata.normalize("NFC", (full_name or "").strip())
        if len(cleaned_name) < 2:
            raise ValueError("Họ tên phải có tối thiểu 2 ký tự.")

        with self._lock:
            if self._find_user_by_email(norm) is not None:
                raise ValueError("Email này đã được đăng ký.")
            now_iso = datetime.now(timezone.utc).isoformat()
            record = {
                "id": f"usr-{uuid.uuid4().hex[:12]}",
                "email": norm,
                "password_hash": _hash_password(password),
                "full_name": cleaned_name,
                "role": unicodedata.normalize("NFC", (role or "Doanh nghiệp / Cá nhân").strip()) or "Doanh nghiệp / Cá nhân",
                "organization": unicodedata.normalize("NFC", (organization or "").strip()),
                "auth_provider": "local",
                "credits": 100,
                "preferences": {"theme": "light", "default_topic": "ALL"},
                "created_at": now_iso,
                "updated_at": now_iso,
            }
            self._persist_user(record)
            pub = self._public_user(record)
            return pub, self.create_access_token(pub)

    def login_user(self, email: str, password: str) -> tuple[dict[str, Any], str]:
        norm = _norm_email(email)
        with self._lock:
            found = self._find_user_by_email(norm)
            if found is None or not _verify_password(password or "", str(found.get("password_hash") or "")):
                raise ValueError("Email hoặc mật khẩu không chính xác.")
            pub = self._public_user(found)
            return pub, self.create_access_token(pub)

    def login_with_google_token(
        self,
        id_token_str: str,
        client_id: str | None = None,
        verifier: Any = None,
    ) -> tuple[dict[str, Any], str]:
        """Xác thực Google ID Token thật, tạo hoặc đồng bộ user trong lexit_users và cấp access token."""
        resolved_cid = (
            client_id if client_id is not None else os.getenv("GOOGLE_CLIENT_ID", "")
        ).strip()
        if not resolved_cid:
            raise RuntimeError("Đăng nhập Google chưa được kích hoạt (chưa có GOOGLE_CLIENT_ID trên server).")

        verify_fn = verifier or verify_google_id_token
        claims = verify_fn(id_token_str, resolved_cid)
        if not isinstance(claims, dict):
            raise ValueError("Phản hồi xác thực Google không hợp lệ.")
        if claims.get("email_verified") is False:
            raise ValueError("Tài khoản Google chưa xác minh địa chỉ email.")

        norm = _norm_email(str(claims.get("email") or ""))
        if not _EMAIL_RE.match(norm):
            raise ValueError("Token Google không chứa email hợp lệ.")

        default_name = norm.split("@", 1)[0]
        cleaned_name = unicodedata.normalize(
            "NFC",
            str(claims.get("name") or default_name).strip(),
        ) or default_name
        picture = str(claims.get("picture") or "").strip()
        hosted_domain = unicodedata.normalize("NFC", str(claims.get("hd") or "").strip())
        sub_tag = re.sub(r"[^a-zA-Z0-9_-]", "", str(claims.get("sub") or ""))[:20]

        with self._lock:
            found = self._find_user_by_email(norm)
            now_iso = datetime.now(timezone.utc).isoformat()
            if found is not None:
                updated = dict(found)
                prefs = _safe_json_loads(updated.get("preferences") or updated.get("preferences_json"))
                changed = False
                if picture and prefs.get("avatar_url") != picture:
                    prefs["avatar_url"] = picture
                    changed = True
                if sub_tag and prefs.get("google_sub") != sub_tag:
                    prefs["google_sub"] = sub_tag
                    changed = True
                if changed:
                    updated["preferences"] = prefs
                    updated.pop("preferences_json", None)
                    updated["updated_at"] = now_iso
                    self._persist_user(updated)
                pub = self._public_user(updated)
                return pub, self.create_access_token(pub)

            prefs: dict[str, Any] = {"theme": "light", "default_topic": "ALL"}
            if picture:
                prefs["avatar_url"] = picture
            if sub_tag:
                prefs["google_sub"] = sub_tag

            record = {
                "id": f"usr-gg-{sub_tag or uuid.uuid4().hex[:10]}",
                "email": norm,
                "password_hash": _hash_password(secrets.token_urlsafe(32)),
                "full_name": cleaned_name,
                "role": "Thành viên Google",
                "organization": hosted_domain,
                "auth_provider": "google",
                "credits": 250,
                "preferences": prefs,
                "created_at": now_iso,
                "updated_at": now_iso,
            }
            self._persist_user(record)
            pub = self._public_user(record)
            return pub, self.create_access_token(pub)

    def update_profile(
        self,
        user_id: str,
        full_name: str | None = None,
        role: str | None = None,
        organization: str | None = None,
        preferences: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        with self._lock:
            current = None
            if self._pg_ready and self.sql_engine is not None:
                try:
                    with self.sql_engine.connect() as conn:
                        row = conn.execute(
                            sql_text("SELECT * FROM lexit_users WHERE id = :id LIMIT 1"),
                            {"id": str(user_id)},
                        ).mappings().first()
                        if row is not None:
                            current = dict(row)
                except Exception:
                    current = None
            if current is None:
                current = self._load_json_store().get("users", {}).get(str(user_id))
            if current is None:
                return None

            updated = dict(current)
            if full_name is not None and full_name.strip():
                updated["full_name"] = unicodedata.normalize("NFC", full_name.strip())
            if role is not None and role.strip():
                updated["role"] = unicodedata.normalize("NFC", role.strip())
            if organization is not None:
                updated["organization"] = unicodedata.normalize("NFC", organization.strip())
            if preferences is not None:
                merged_prefs = _safe_json_loads(updated.get("preferences") or updated.get("preferences_json"))
                merged_prefs.update(preferences)
                updated["preferences"] = merged_prefs
                updated.pop("preferences_json", None)
            updated["updated_at"] = datetime.now(timezone.utc).isoformat()
            self._persist_user(updated)
            return self._public_user(updated)

    def _hash_otp(self, email: str, purpose: str, otp_code: str) -> str:
        msg = f"otp:{purpose}:{_norm_email(email)}:{otp_code.strip()}".encode("utf-8")
        digest = hmac.new(self._secret_key.encode("utf-8"), msg, hashlib.sha256).digest()
        return _b64url_encode(digest)

    def _load_otp_record(self, email: str, purpose: str) -> dict[str, Any] | None:
        norm = _norm_email(email)
        if self._pg_ready and self.sql_engine is not None:
            try:
                with self.sql_engine.connect() as conn:
                    row = conn.execute(
                        sql_text(
                            "SELECT * FROM lexit_auth_otps WHERE email = :email AND purpose = :purpose LIMIT 1"
                        ),
                        {"email": norm, "purpose": purpose},
                    ).mappings().first()
                    if row is not None:
                        return dict(row)
            except Exception:
                pass
        store = self._load_json_store()
        found = store.get("otps", {}).get(f"{purpose}:{norm}")
        return dict(found) if isinstance(found, dict) else None

    def _save_otp_record(self, record: dict[str, Any]) -> None:
        norm = _norm_email(record["email"])
        purpose = str(record["purpose"])
        if self._pg_ready and self.sql_engine is not None:
            try:
                with self.sql_engine.begin() as conn:
                    conn.execute(
                        sql_text(
                            """
                            INSERT INTO lexit_auth_otps (
                                email, purpose, otp_hash, expires_at, resend_available_at,
                                attempts, max_attempts, created_at
                            ) VALUES (
                                :email, :purpose, :otp_hash, :expires_at, :resend_available_at,
                                :attempts, :max_attempts, :created_at
                            )
                            ON CONFLICT (email, purpose) DO UPDATE SET
                                otp_hash = EXCLUDED.otp_hash,
                                expires_at = EXCLUDED.expires_at,
                                resend_available_at = EXCLUDED.resend_available_at,
                                attempts = EXCLUDED.attempts,
                                max_attempts = EXCLUDED.max_attempts,
                                created_at = EXCLUDED.created_at
                            """
                        ),
                        {
                            "email": norm,
                            "purpose": purpose,
                            "otp_hash": record["otp_hash"],
                            "expires_at": int(record["expires_at"]),
                            "resend_available_at": int(record["resend_available_at"]),
                            "attempts": int(record.get("attempts") or 0),
                            "max_attempts": int(record.get("max_attempts") or _OTP_MAX_ATTEMPTS),
                            "created_at": str(record["created_at"]),
                        },
                    )
            except Exception:
                pass

        store = self._load_json_store()
        store.setdefault("otps", {})[f"{purpose}:{norm}"] = {
            "email": norm,
            "purpose": purpose,
            "otp_hash": record["otp_hash"],
            "expires_at": int(record["expires_at"]),
            "resend_available_at": int(record["resend_available_at"]),
            "attempts": int(record.get("attempts") or 0),
            "max_attempts": int(record.get("max_attempts") or _OTP_MAX_ATTEMPTS),
            "created_at": str(record["created_at"]),
        }
        self._save_json_store(store)

    def _delete_otp_record(self, email: str, purpose: str) -> None:
        norm = _norm_email(email)
        if self._pg_ready and self.sql_engine is not None:
            try:
                with self.sql_engine.begin() as conn:
                    conn.execute(
                        sql_text(
                            "DELETE FROM lexit_auth_otps WHERE email = :email AND purpose = :purpose"
                        ),
                        {"email": norm, "purpose": purpose},
                    )
            except Exception:
                pass

        store = self._load_json_store()
        if f"{purpose}:{norm}" in store.get("otps", {}):
            store["otps"].pop(f"{purpose}:{norm}", None)
            self._save_json_store(store)

    def request_otp(
        self,
        email: str,
        purpose: str = "register",
        email_sender: Any = None,
        now_ts: int | None = None,
    ) -> dict[str, Any]:
        """Sinh mã OTP 6 chữ số bảo mật (HMAC-SHA256) và gửi trực tiếp qua máy chủ SMTP."""
        clean_purpose = (purpose or "register").strip().lower()
        if clean_purpose not in _OTP_VALID_PURPOSES:
            raise ValueError("Mục đích OTP không hợp lệ (chỉ hỗ trợ register hoặc reset_password).")

        norm = _norm_email(email)
        if not _EMAIL_RE.match(norm):
            raise ValueError("Địa chỉ email không hợp lệ.")

        now = int(time.time()) if now_ts is None else int(now_ts)

        with self._lock:
            existing_user = self._find_user_by_email(norm)
            if clean_purpose == "register" and existing_user is not None:
                raise ValueError("Email này đã được đăng ký. Vui lòng chuyển sang Đăng nhập.")
            if clean_purpose == "reset_password" and existing_user is None:
                raise ValueError("Không tìm thấy tài khoản nào gắn với địa chỉ email này.")

            prev = self._load_otp_record(norm, clean_purpose)
            if prev is not None:
                resend_at = int(prev.get("resend_available_at") or 0)
                if now < resend_at:
                    wait_sec = resend_at - now
                    raise OtpCooldownError(
                        f"Vui lòng chờ {wait_sec} giây trước khi yêu cầu gửi lại mã OTP.",
                        retry_after_seconds=wait_sec,
                    )

            otp_code = f"{secrets.randbelow(10 ** _OTP_LENGTH):0{_OTP_LENGTH}d}"
            record = {
                "email": norm,
                "purpose": clean_purpose,
                "otp_hash": self._hash_otp(norm, clean_purpose, otp_code),
                "expires_at": now + _OTP_TTL_SECONDS,
                "resend_available_at": now + _OTP_RESEND_COOLDOWN_SECONDS,
                "attempts": 0,
                "max_attempts": _OTP_MAX_ATTEMPTS,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            self._save_otp_record(record)

        sender = email_sender or send_otp_email
        try:
            delivery_channel = sender(norm, otp_code, clean_purpose, _OTP_TTL_SECONDS)
            if isinstance(delivery_channel, tuple):
                delivery_channel = str(delivery_channel[0] or "smtp")
        except Exception:
            with self._lock:
                self._delete_otp_record(norm, clean_purpose)
            raise

        return {
            "ok": True,
            "email": norm,
            "purpose": clean_purpose,
            "expires_in_seconds": _OTP_TTL_SECONDS,
            "resend_after_seconds": _OTP_RESEND_COOLDOWN_SECONDS,
            "delivery_channel": str(delivery_channel or "smtp"),
            "message": f"Đã gửi mã xác thực OTP 6 chữ số tới {norm}. Vui lòng kiểm tra hộp thư (hoặc thư mục Spam).",
        }

    def _verify_and_consume_otp(
        self,
        email: str,
        purpose: str,
        otp_code: str,
        now_ts: int | None = None,
    ) -> None:
        clean_code = re.sub(r"\s+", "", str(otp_code or ""))
        if not _OTP_CODE_RE.match(clean_code):
            raise ValueError("Mã OTP phải gồm đúng 6 chữ số.")

        norm = _norm_email(email)
        now = int(time.time()) if now_ts is None else int(now_ts)
        record = self._load_otp_record(norm, purpose)
        if record is None:
            raise ValueError("Mã OTP không tồn tại hoặc đã được sử dụng. Vui lòng yêu cầu mã mới.")

        expires_at = int(record.get("expires_at") or 0)
        if now > expires_at:
            self._delete_otp_record(norm, purpose)
            raise ValueError("Mã OTP đã hết hạn (quá 5 phút). Vui lòng nhấn Gửi lại mã.")

        attempts = int(record.get("attempts") or 0)
        max_attempts = int(record.get("max_attempts") or _OTP_MAX_ATTEMPTS)
        if attempts >= max_attempts:
            self._delete_otp_record(norm, purpose)
            raise ValueError("Bạn đã nhập sai mã OTP quá số lần cho phép. Vui lòng yêu cầu mã mới.")

        expected_hash = str(record.get("otp_hash") or "")
        provided_hash = self._hash_otp(norm, purpose, clean_code)
        if not secrets.compare_digest(expected_hash, provided_hash):
            attempts += 1
            remaining = max(0, max_attempts - attempts)
            if remaining <= 0:
                self._delete_otp_record(norm, purpose)
                raise ValueError("Mã OTP không chính xác và đã bị khóa sau 5 lần thử. Vui lòng yêu cầu mã mới.")
            record["attempts"] = attempts
            self._save_otp_record(record)
            raise ValueError(f"Mã OTP không chính xác (còn {remaining} lần thử).")

        self._delete_otp_record(norm, purpose)

    def register_with_otp(
        self,
        email: str,
        otp_code: str,
        password: str,
        full_name: str,
        role: str = "Doanh nghiệp / Cá nhân",
        organization: str = "",
        now_ts: int | None = None,
    ) -> tuple[dict[str, Any], str]:
        """Xác thực OTP đăng ký và tạo tài khoản chính thức trong lexit_users."""
        norm = _norm_email(email)
        if not _EMAIL_RE.match(norm):
            raise ValueError("Email không hợp lệ.")
        if len(password or "") < 6:
            raise ValueError("Mật khẩu phải có tối thiểu 6 ký tự.")
        cleaned_name = unicodedata.normalize("NFC", (full_name or "").strip())
        if len(cleaned_name) < 2:
            raise ValueError("Họ tên phải có tối thiểu 2 ký tự.")

        with self._lock:
            if self._find_user_by_email(norm) is not None:
                raise ValueError("Email này đã được đăng ký.")
            self._verify_and_consume_otp(norm, "register", otp_code, now_ts=now_ts)
            now_iso = datetime.now(timezone.utc).isoformat()
            record = {
                "id": f"usr-{uuid.uuid4().hex[:12]}",
                "email": norm,
                "password_hash": _hash_password(password),
                "full_name": cleaned_name,
                "role": unicodedata.normalize("NFC", (role or "Doanh nghiệp / Cá nhân").strip())
                or "Doanh nghiệp / Cá nhân",
                "organization": unicodedata.normalize("NFC", (organization or "").strip()),
                "auth_provider": "local",
                "credits": 100,
                "preferences": {"theme": "light", "default_topic": "ALL", "email_verified": True},
                "created_at": now_iso,
                "updated_at": now_iso,
            }
            self._persist_user(record)
            pub = self._public_user(record)
            return pub, self.create_access_token(pub)

    def reset_password_with_otp(
        self,
        email: str,
        otp_code: str,
        new_password: str,
        now_ts: int | None = None,
    ) -> dict[str, Any]:
        """Xác thực OTP quên mật khẩu và cập nhật mật khẩu mới."""
        norm = _norm_email(email)
        if not _EMAIL_RE.match(norm):
            raise ValueError("Email không hợp lệ.")
        if len(new_password or "") < 6:
            raise ValueError("Mật khẩu mới phải có tối thiểu 6 ký tự.")

        with self._lock:
            found = self._find_user_by_email(norm)
            if found is None:
                raise ValueError("Không tìm thấy tài khoản nào gắn với địa chỉ email này.")
            self._verify_and_consume_otp(norm, "reset_password", otp_code, now_ts=now_ts)
            updated = dict(found)
            updated["password_hash"] = _hash_password(new_password)
            updated["updated_at"] = datetime.now(timezone.utc).isoformat()
            self._persist_user(updated)
            return {
                "ok": True,
                "email": norm,
                "message": "Đặt lại mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.",
            }

    def change_password(
        self,
        user_id: str,
        current_password: str,
        new_password: str,
    ) -> dict[str, Any]:
        """Đổi mật khẩu trực tiếp cho tài khoản đang đăng nhập."""
        if len(new_password or "") < 6:
            raise ValueError("Mật khẩu mới phải có tối thiểu 6 ký tự.")
        if current_password and current_password == new_password:
            raise ValueError("Mật khẩu mới không được trùng với mật khẩu hiện tại.")

        with self._lock:
            current = None
            if self._pg_ready and self.sql_engine is not None:
                try:
                    with self.sql_engine.connect() as conn:
                        row = conn.execute(
                            sql_text("SELECT * FROM lexit_users WHERE id = :id LIMIT 1"),
                            {"id": str(user_id)},
                        ).mappings().first()
                        if row is not None:
                            current = dict(row)
                except Exception:
                    current = None
            if current is None:
                current = self._load_json_store().get("users", {}).get(str(user_id))
            if current is None:
                raise ValueError("Không tìm thấy hồ sơ người dùng.")

            is_google_only = str(current.get("auth_provider") or "") == "google"
            prefs = _safe_json_loads(current.get("preferences") or current.get("preferences_json"))
            has_local_pw = (not is_google_only) or bool(prefs.get("has_local_password"))

            if has_local_pw:
                if not _verify_password(current_password or "", str(current.get("password_hash") or "")):
                    raise ValueError("Mật khẩu hiện tại không chính xác.")

            updated = dict(current)
            updated["password_hash"] = _hash_password(new_password)
            prefs["has_local_password"] = True
            updated["preferences"] = prefs
            updated.pop("preferences_json", None)
            updated["updated_at"] = datetime.now(timezone.utc).isoformat()
            self._persist_user(updated)
            return {
                "ok": True,
                "email": str(updated["email"]),
                "message": "Đã cập nhật mật khẩu thành công.",
            }


# ---------------------------------------------------------------------------
# 2. Gợi ý Câu hỏi Tiếp theo (Contextual Follow-up Suggestions)
# ---------------------------------------------------------------------------
def generate_suggested_followups(
    question: str,
    symbolic_reasoning: dict[str, Any] | None = None,
    sources: list[dict[str, Any]] | None = None,
) -> list[str]:
    """Sinh tối đa 4 câu hỏi nối tiếp thông minh dựa trên ngữ cảnh Symbolic & Nguồn luật."""
    reasoning = symbolic_reasoning or {}
    src_list = sources or []
    suggestions: list[str] = []

    if reasoning.get("guardrail_blocked"):
        return [
            "Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 nghiêm cấm những hành vi nào?",
            "Cá nhân đăng tin sai sự thật trên mạng xã hội bị phạt bao nhiêu tiền theo Nghị định 174/2026/NĐ-CP?",
            "Khi nào hành vi mua bán dữ liệu cá nhân bị xử lý hình sự theo Điều 288 BLHS?",
        ]

    facts = reasoning.get("facts") or {}
    subjects = set(facts.get("subjects") or [])
    age_band = facts.get("age_band")
    norm_q = _strip_accents_lower(question)

    doc_codes: set[str] = set()
    for s in src_list:
        sid = str(s.get("source_id") or "")
        if sid.startswith("STATUTE:"):
            parts = sid.split(":")
            if len(parts) >= 2:
                doc_codes.add(parts[1])
        title = str(s.get("title") or "")
        m = re.search(r"\d+/\d{4}/[A-ZĐ0-9\-]+", title)
        if m:
            doc_codes.add(m.group(0))

    if ORGANIZATION in subjects and INDIVIDUAL not in subjects:
        suggestions.append("Nếu cá nhân thực hiện hành vi tương tự thì mức phạt và mức trần tối đa là bao nhiêu?")
    elif INDIVIDUAL in subjects and ORGANIZATION not in subjects:
        suggestions.append("Nếu tổ chức/doanh nghiệp vi phạm quy định này thì mức xử phạt được nhân lên như thế nào?")

    if age_band in {"UNDER_14", "14_TO_UNDER_16", "UNDER_16_UNSPECIFIED", "16_TO_UNDER_18"}:
        suggestions.append("Nguyên tắc áp dụng biện pháp khắc phục hậu quả và trách nhiệm bồi thường của người chưa thành niên là gì?")

    if not reasoning.get("multi_hop_paths") and not any("100/2015/QH13" in c for c in doc_codes):
        suggestions.append("Hành vi này trong trường hợp nào sẽ chuyển từ xử phạt hành chính sang truy cứu trách nhiệm hình sự?")

    if reasoning.get("matched_precedents"):
        suggestions.append("Thực tiễn xét xử của Tòa án đối với các vụ việc tương tự rút ra tiêu chí định tội hoặc định khung nào?")

    if {"91/2025/QH15", "13/2023/NĐ-CP", "356/2025/NĐ-CP", "330/2026/NĐ-CP"}.intersection(doc_codes) or "du lieu ca nhan" in norm_q:
        suggestions.append("Doanh nghiệp cần thông báo sự cố lộ dữ liệu cá nhân trong thời hạn bao nhiêu giờ và lập hồ sơ đánh giá tác động ra sao?")

    if {"15/2020/NĐ-CP", "174/2026/NĐ-CP"}.intersection(doc_codes):
        suggestions.append("Từ ngày 01/07/2026, quy định tại Nghị định 174/2026/NĐ-CP thay thế điều khoản nào của Nghị định 15/2020/NĐ-CP?")

    if "20/2023/QH15" in doc_codes or "dien tu" in norm_q:
        suggestions.append("Điều kiện để thông điệp dữ liệu và chữ ký điện tử có giá trị làm chứng cứ trước Tòa án là gì?")

    if len(suggestions) < 3:
        suggestions.extend([
            "Thời hiệu xử phạt vi phạm hành chính đối với hành vi trên theo Điều 6 Luật XLVPHC là bao lâu?",
            "Biện pháp khắc phục hậu quả bắt buộc (gỡ bỏ thông tin, nộp lại số lợi bất hợp pháp) gồm những gì?",
        ])

    deduped: list[str] = []
    seen: set[str] = set()
    for item in suggestions:
        clean = item.strip()
        if clean and clean not in seen and clean.lower() != (question or "").strip().lower():
            deduped.append(clean)
            seen.add(clean)
        if len(deduped) >= 4:
            break
    return deduped


# ---------------------------------------------------------------------------
# 3. Precedents / Bản án Manifest Cache & Search
# ---------------------------------------------------------------------------
_DEFAULT_PRECEDENT_PATH = DATA_DIR / "precedents" / "it_law_precedents.json"
_PRECEDENT_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}


def _load_precedents_serialized(manifest_path: Path | None = None) -> list[dict[str, Any]]:
    target = Path(manifest_path) if manifest_path else _DEFAULT_PRECEDENT_PATH
    if not target.exists():
        fallback = DATA_DIR / "precedents" / "precedents.example.json"
        if not fallback.exists():
            return []
        target = fallback

    mtime = target.stat().st_mtime
    cache_key = str(target.resolve())
    cached = _PRECEDENT_CACHE.get(cache_key)
    if cached is not None and cached[0] == mtime:
        return cached[1]

    records = load_precedent_manifest(target)
    serialized: list[dict[str, Any]] = []
    for rec in records:
        serialized.append({
            "id": rec.id,
            "title": rec.title,
            "court": rec.court,
            "decision_number": rec.decision_number,
            "decision_date": rec.decision_date.isoformat(),
            "status": rec.status,
            "status_source": rec.status_source,
            "source_url": str(rec.source_url),
            "material_facts": rec.material_facts,
            "legal_issue": rec.legal_issue,
            "holding": rec.holding,
            "reasoning": rec.reasoning,
            "tags": list(rec.tags),
            "references": [ref.model_dump() for ref in rec.references],
        })
    _PRECEDENT_CACHE[cache_key] = (mtime, serialized)
    return serialized


def search_precedents_catalog(
    query: str = "",
    doc_code: str = "",
    article_number: str = "",
    tag: str = "",
    limit: int = 20,
    manifest_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Tìm kiếm trong kho bản án / án lệ đã kiểm duyệt theo từ khóa, mã văn bản, Điều hoặc tag."""
    items = _load_precedents_serialized(manifest_path)
    norm_q = _strip_accents_lower(query)
    terms = [t for t in re.split(r"\s+", norm_q) if len(t) >= 2]
    target_doc = (doc_code or "").strip().upper()
    target_art = (article_number or "").strip().lower()
    target_tag = _strip_accents_lower(tag)

    scored: list[tuple[int, dict[str, Any]]] = []
    for item in items:
        refs = item.get("references") or []
        if target_doc and not any(str(r.get("doc_code") or "").upper() == target_doc for r in refs):
            continue
        if target_art and not any(str(r.get("article_number") or "").lower() == target_art for r in refs):
            continue
        if target_tag and not any(target_tag in _strip_accents_lower(t) for t in (item.get("tags") or [])):
            continue

        if not terms:
            scored.append((1, item))
            continue

        haystack = _strip_accents_lower(
            " ".join([
                item.get("id", ""),
                item.get("title", ""),
                item.get("legal_issue", ""),
                item.get("holding", ""),
                item.get("material_facts", ""),
                " ".join(item.get("tags") or []),
                " ".join(f"{r.get('doc_code', '')} dieu {r.get('article_number', '')}" for r in refs),
            ])
        )
        hits = sum(1 for t in terms if t in haystack)
        if norm_q and norm_q in haystack:
            hits += 3
        if hits > 0:
            scored.append((hits, item))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [pair[1] for pair in scored[: max(1, min(limit, 50))]]


def match_precedents_for_articles(
    doc_articles: list[tuple[str, str]],
    question: str = "",
    limit: int = 4,
    manifest_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Khớp bản án tham chiếu cho cặp (doc_code, article_number) khi Neo4j chưa có node Precedent."""
    items = _load_precedents_serialized(manifest_path)
    if not items:
        return []

    pair_set = {
        (str(doc or "").strip().upper(), str(art or "").strip().lower())
        for doc, art in doc_articles
        if doc
    }
    doc_set = {doc for doc, _ in pair_set if doc}
    norm_q = _strip_accents_lower(question)
    q_terms = {t for t in re.split(r"\s+", norm_q) if len(t) >= 3}

    ranked: list[tuple[int, dict[str, Any]]] = []
    for item in items:
        best_score = 0
        best_ref: dict[str, Any] | None = None
        for ref in item.get("references") or []:
            r_doc = str(ref.get("doc_code") or "").strip().upper()
            r_art = str(ref.get("article_number") or "").strip().lower()
            score = 0
            if (r_doc, r_art) in pair_set:
                score = 10
            elif r_doc in doc_set:
                score = 4
            if score > best_score:
                best_score = score
                best_ref = ref

        haystack = _strip_accents_lower(
            f"{item.get('title', '')} {item.get('legal_issue', '')} {' '.join(item.get('tags') or [])}"
        )
        kw_hits = sum(1 for t in q_terms if t in haystack)
        total_score = best_score + kw_hits
        if best_score > 0 or kw_hits >= 2:
            chosen_ref = best_ref or (item.get("references") or [{}])[0]
            ranked.append((
                total_score,
                {
                    "id": item["id"],
                    "title": item["title"],
                    "court": item["court"],
                    "decision_number": item["decision_number"],
                    "decision_date": item["decision_date"],
                    "status": item["status"],
                    "status_source": item["status_source"],
                    "source_url": item["source_url"],
                    "material_facts": item["material_facts"],
                    "legal_issue": item["legal_issue"],
                    "holding": item["holding"],
                    "reasoning": item["reasoning"],
                    "article_id": f"{chosen_ref.get('doc_code', '')}:Điều {chosen_ref.get('article_number', '')}",
                    "article_number": chosen_ref.get("article_number"),
                    "doc_code": chosen_ref.get("doc_code"),
                    "relation": chosen_ref.get("relation") or "CITES",
                    "supporting_quote": chosen_ref.get("supporting_quote"),
                },
            ))

    ranked.sort(key=lambda pair: pair[0], reverse=True)
    return [pair[1] for pair in ranked[:limit]]


# ---------------------------------------------------------------------------
# 4. Full-Text Article Drawer + Lược đồ Hiệu lực / Chuyển tiếp (Văn bản liên quan)
# ---------------------------------------------------------------------------
_ARTICLE_TRANSITIONS: dict[tuple[str, str], dict[str, str]] = {
    ("15/2020/NĐ-CP", "101"): {
        "successor_doc": "174/2026/NĐ-CP",
        "successor_article": "95",
        "note": "Từ ngày 01/07/2026, quy định xử phạt trách nhiệm sử dụng dịch vụ mạng xã hội chuyển tiếp sang Điều 95 Nghị định 174/2026/NĐ-CP.",
    },
    ("15/2020/NĐ-CP", "99"): {
        "successor_doc": "174/2026/NĐ-CP",
        "successor_article": "93",
        "note": "Từ ngày 01/07/2026, quy định xử phạt vi phạm quy định về trang thông tin điện tử chuyển tiếp sang Điều 93 Nghị định 174/2026/NĐ-CP.",
    },
    ("15/2020/NĐ-CP", "100"): {
        "successor_doc": "174/2026/NĐ-CP",
        "successor_article": "94",
        "note": "Từ ngày 01/07/2026, quy định xử phạt trách nhiệm thiết lập mạng xã hội chuyển tiếp sang Điều 94 Nghị định 174/2026/NĐ-CP.",
    },
    ("15/2020/NĐ-CP", "106"): {
        "successor_doc": "174/2026/NĐ-CP",
        "successor_article": "101",
        "note": "Từ ngày 01/07/2026, quy định ngoại lệ cho cá nhân (người chơi) chuyển tiếp sang Điều 101 Nghị định 174/2026/NĐ-CP.",
    },
    ("15/2020/NĐ-CP", "84"): {
        "successor_doc": "330/2026/NĐ-CP",
        "successor_article": "50",
        "note": "Từ ngày 01/07/2026, xử phạt vi phạm bảo vệ dữ liệu cá nhân được quy định chuyên biệt tại Nghị định 330/2026/NĐ-CP và Luật 91/2025/QH15.",
    },
    ("24/2018/QH14", "8"): {
        "successor_doc": "116/2025/QH15",
        "successor_article": "8",
        "note": "Từ ngày 01/07/2026, Luật An ninh mạng 116/2025/QH15 thay thế Luật An ninh mạng 2018 (24/2018/QH14).",
    },
    ("86/2015/QH13", "7"): {
        "successor_doc": "116/2025/QH15",
        "successor_article": "8",
        "note": "Từ ngày 01/07/2026, nội dung an toàn thông tin mạng hợp nhất vào Luật An ninh mạng 116/2025/QH15.",
    },
}


def get_article_detail_with_history(
    doc_code: str,
    article_number: str,
    sql_engine: Any = None,
    neo4j_driver: Any = None,
    as_of: str | None = None,
) -> dict[str, Any]:
    """Lấy toàn văn Điều luật từ PGVector/Neo4j kèm 3 mốc hiệu lực & lược đồ chuyển tiếp."""
    clean_doc = unicodedata.normalize("NFC", (doc_code or "").strip())
    clean_art = unicodedata.normalize("NFC", re.sub(r"(?i)^điều\s+", "", (article_number or "").strip()))
    eval_date = parse_as_of(as_of)

    reg_by_code = _doc_registry_by_code()
    reg_entry = reg_by_code.get(clean_doc, {})
    effective_from = reg_entry.get("effective_from")
    effective_to = reg_entry.get("effective_to")
    if clean_doc == "15/2020/NĐ-CP" and clean_art:
        art_key: int | str = int(clean_art) if clean_art.isdigit() else clean_art.lower()
        if art_key in REPEALED_15_ARTICLES and (not effective_to or effective_to > "2026-06-30"):
            effective_to = "2026-06-30"
    doc_title = reg_entry.get("title") or clean_doc
    source_url = reg_entry.get("source_url")

    chunks: list[dict[str, Any]] = []
    if sql_engine is not None and clean_doc and clean_art:
        try:
            with sql_engine.connect() as conn:
                rows = conn.execute(
                    sql_text(
                        """
                        SELECT
                            e.document AS text,
                            e.cmetadata->>'article_title' AS article_title,
                            e.cmetadata->>'doc_title' AS doc_title,
                            e.cmetadata->>'effective_from' AS effective_from,
                            e.cmetadata->>'effective_to' AS effective_to,
                            e.cmetadata->>'source_url' AS source_url,
                            e.cmetadata->>'page' AS page,
                            e.cmetadata->>'clauses' AS clauses
                        FROM langchain_pg_embedding e
                        JOIN langchain_pg_collection c ON e.collection_id = c.uuid
                        WHERE c.name = :collection
                          AND e.cmetadata->>'doc_code' = :doc_code
                          AND LOWER(e.cmetadata->>'article_number') = LOWER(:article_number)
                          AND UPPER(COALESCE(e.cmetadata->>'lifecycle_status', 'ACTIVE')) NOT IN ('PREPARED', 'FAILED', 'RETIRED')
                        ORDER BY CASE WHEN (e.cmetadata->>'page') ~ '^\\d+$' THEN (e.cmetadata->>'page')::int ELSE 1 END ASC
                        LIMIT 15
                        """
                    ),
                    {"collection": COLLECTION_NAME, "doc_code": clean_doc, "article_number": clean_art},
                ).mappings().all()
                chunks = [dict(r) for r in rows]
        except Exception:
            chunks = []

    neo4j_info: dict[str, Any] = {}
    if neo4j_driver is not None and clean_doc and clean_art:
        try:
            with neo4j_driver.session(database=NEO4J_DATABASE) as session:
                rec = session.run(
                    """
                    MATCH (a:Article)-[:PART_OF]->(d:LegalDoc {code: $doc_code})
                    WHERE toLower(toString(a.number)) = toLower(toString($article_number))
                    RETURN d.title AS doc_title,
                           a.title AS article_title,
                           a.text AS text,
                           a.effective_from AS effective_from,
                           a.effective_to AS effective_to,
                           a.source_url AS source_url,
                           d.source_url AS doc_source_url
                    LIMIT 1
                    """,
                    doc_code=clean_doc,
                    article_number=clean_art,
                ).single()
                if rec:
                    neo4j_info = dict(rec)
        except Exception:
            neo4j_info = {}

    article_title = ""
    full_parts: list[str] = []
    seen_parts: set[str] = set()
    page: int | None = None
    for row in chunks:
        if not article_title and row.get("article_title"):
            article_title = str(row["article_title"])
        if row.get("doc_title"):
            doc_title = str(row["doc_title"])
        if row.get("effective_from"):
            effective_from = row["effective_from"]
        if row.get("effective_to"):
            effective_to = row["effective_to"]
        if row.get("source_url"):
            source_url = row["source_url"]
        if page is None and row.get("page"):
            try:
                page = int(row["page"])
            except Exception:
                page = None
        piece = str(row.get("text") or "").strip()
        if piece and piece not in seen_parts:
            full_parts.append(piece)
            seen_parts.add(piece)

    if not full_parts and neo4j_info.get("text"):
        full_parts.append(str(neo4j_info["text"]).strip())
    if not article_title and neo4j_info.get("article_title"):
        article_title = str(neo4j_info["article_title"])
    effective_from = effective_from or neo4j_info.get("effective_from")
    effective_to = effective_to or neo4j_info.get("effective_to")
    source_url = source_url or neo4j_info.get("source_url") or neo4j_info.get("doc_source_url")

    still_valid = is_effective_on(effective_from, effective_to, eval_date)
    if effective_to and parse_as_of(effective_to) < eval_date:
        status_badge = "EXPIRED"
        status_label = f"Hết hiệu lực từ {effective_to}"
    elif effective_from and parse_as_of(effective_from) > eval_date:
        status_badge = "UPCOMING"
        status_label = f"Chưa có hiệu lực tại {eval_date.isoformat()} (từ {effective_from})"
    elif still_valid:
        status_badge = "ACTIVE"
        status_label = "Còn hiệu lực"
    else:
        status_badge = "UNKNOWN"
        status_label = "Chưa xác định hiệu lực"

    transition = _ARTICLE_TRANSITIONS.get((clean_doc.upper(), clean_art.lower()))
    if transition is None:
        # Thử tra ngược nếu là điều kế thừa
        for (old_doc, old_art), meta in _ARTICLE_TRANSITIONS.items():
            if meta["successor_doc"].upper() == clean_doc.upper() and meta["successor_article"].lower() == clean_art.lower():
                transition = {
                    "predecessor_doc": old_doc,
                    "predecessor_article": old_art,
                    "note": meta["note"],
                }
                break

    related_docs = sorted(related_document_codes(clean_doc) - {clean_doc}) if clean_doc else []
    precedents = match_precedents_for_articles([(clean_doc, clean_art)], limit=3)

    return {
        "found": bool(full_parts),
        "doc_code": clean_doc,
        "doc_title": doc_title,
        "article_number": clean_art,
        "article_title": article_title,
        "full_text": "\n\n".join(full_parts) if full_parts else f"Chưa tìm thấy toàn văn Điều {clean_art} ({clean_doc}) trong kho dữ liệu đang kết nối.",
        "page": page,
        "effective_from": effective_from,
        "effective_to": effective_to,
        "evaluated_as_of": eval_date.isoformat(),
        "status_badge": status_badge,
        "status_label": status_label,
        "source_url": source_url,
        "related_documents": related_docs,
        "transition": transition,
        "precedents": precedents,
    }


# ---------------------------------------------------------------------------
# 5. Compliance Review Engine (Rà soát Tuân thủ Hợp đồng / Chính sách IT)
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class _ComplianceRule:
    rule_id: str
    title: str
    legal_basis: str
    doc_code_before_july2026: str
    article_before_july2026: str
    doc_code_from_july2026: str
    article_from_july2026: str
    present_keywords: tuple[str, ...]
    partial_keywords: tuple[str, ...]
    risk_if_missing: str
    recommended_clause: str


_IT_COMPLIANCE_RULES: tuple[_ComplianceRule, ...] = (
    _ComplianceRule(
        rule_id="PDP_CONSENT_LEGAL_BASIS",
        title="Sự đồng ý rõ ràng & Mục đích thu thập dữ liệu cá nhân",
        legal_basis="Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 (Điều 8, 9), NĐ 13/2023/NĐ-CP & NĐ 356/2025/NĐ-CP",
        doc_code_before_july2026="15/2020/NĐ-CP",
        article_before_july2026="84",
        doc_code_from_july2026="330/2026/NĐ-CP",
        article_from_july2026="50",
        present_keywords=("su dong y", "muc dich xu ly", "loai du lieu", "khong mua ban", "chu the du lieu"),
        partial_keywords=("du lieu ca nhan", "thong tin ca nhan", "bao mat thong tin"),
        risk_if_missing="Thiếu điều khoản xin sự đồng ý minh bạch (opt-in) và cam kết không mua, bán dữ liệu cá nhân theo Luật 91/2025/QH15.",
        recommended_clause="Bên xử lý chỉ thu thập, sử dụng dữ liệu cá nhân đúng mục đích đã thông báo khi có sự đồng ý rõ ràng của Chủ thể dữ liệu; nghiêm cấm mọi hành vi mua, bán dữ liệu cá nhân dưới mọi hình thức.",
    ),
    _ComplianceRule(
        rule_id="PDP_BREACH_72H_NOTIFY",
        title="Nghĩa vụ thông báo sự cố lộ/lọt dữ liệu cá nhân trong 72 giờ",
        legal_basis="Nghị định 13/2023/NĐ-CP (Điều 23), Luật 91/2025/QH15 & Nghị định 356/2025/NĐ-CP",
        doc_code_before_july2026="15/2020/NĐ-CP",
        article_before_july2026="84",
        doc_code_from_july2026="330/2026/NĐ-CP",
        article_from_july2026="50",
        present_keywords=("72 gio", "72h", "thong bao vi pham", "su co du lieu", "bo cong an"),
        partial_keywords=("su co bao mat", "ro ri", "lo du lieu"),
        risk_if_missing="Chưa cam kết thời hạn tối đa 72 giờ thông báo cơ quan chuyên trách bảo vệ dữ liệu và các bên liên quan khi xảy ra sự cố.",
        recommended_clause="Khi phát hiện vi phạm quy định bảo vệ dữ liệu cá nhân hoặc sự cố an ninh mạng, Bên xử lý dữ liệu phải thông báo bằng văn bản cho Bên kiểm soát dữ liệu và cơ quan chức năng có thẩm quyền chậm nhất không quá 72 giờ kể từ khi xảy ra vi phạm.",
    ),
    _ComplianceRule(
        rule_id="PDP_DATA_SUBJECT_RIGHTS",
        title="Quyền truy cập, chỉnh sửa, xóa và rút lại sự đồng ý",
        legal_basis="Nghị định 13/2023/NĐ-CP (Điều 9, 12) & Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15",
        doc_code_before_july2026="15/2020/NĐ-CP",
        article_before_july2026="84",
        doc_code_from_july2026="330/2026/NĐ-CP",
        article_from_july2026="50",
        present_keywords=("rut lai su dong y", "xoa du lieu", "chinh sua du lieu", "quyen truy cap"),
        partial_keywords=("quyen cua nguoi dung", "huy tai khoan", "xoa thong tin"),
        risk_if_missing="Không quy định cơ chế cho người dùng rút lại sự đồng ý hoặc yêu cầu xóa/chỉnh sửa dữ liệu cá nhân.",
        recommended_clause="Chủ thể dữ liệu có quyền yêu cầu truy cập, chỉnh sửa, hạn chế xử lý, xóa dữ liệu cá nhân hoặc rút lại sự đồng ý bất cứ lúc nào thông qua kênh hỗ trợ trực tuyến chính thức.",
    ),
    _ComplianceRule(
        rule_id="CROSS_BORDER_DPIA_TIA",
        title="Đánh giá tác động xử lý (DPIA) & Chuyển dữ liệu ra nước ngoài",
        legal_basis="Nghị định 13/2023/NĐ-CP (Điều 24, 25), Luật 91/2025/QH15 & Luật Dữ liệu 60/2024/QH15",
        doc_code_before_july2026="15/2020/NĐ-CP",
        article_before_july2026="84",
        doc_code_from_july2026="330/2026/NĐ-CP",
        article_from_july2026="50",
        present_keywords=("chuyen du lieu ra nuoc ngoai", "danh gia tac dong", "dpia", "may chu tai viet nam"),
        partial_keywords=("luu tru dam may", "cloud", "nuoc ngoai", "xuyen bien gioi"),
        risk_if_missing="Chưa nêu nghĩa vụ lập Hồ sơ đánh giá tác động xử lý hoặc đánh giá tác động chuyển dữ liệu cá nhân ra nước ngoài (nếu dùng hạ tầng máy chủ nước ngoài).",
        recommended_clause="Trường hợp chuyển dữ liệu cá nhân ra nước ngoài hoặc lưu trữ trên hạ tầng điện toán đám mây ngoài lãnh thổ Việt Nam, các Bên phải lập và nộp Hồ sơ đánh giá tác động chuyển dữ liệu ra nước ngoài theo đúng trình tự pháp luật Việt Nam.",
    ),
    _ComplianceRule(
        rule_id="ANTI_SPAM_OPT_OUT",
        title="Chống tin nhắn rác, thư điện tử rác & Cơ chế từ chối quảng cáo",
        legal_basis="Nghị định 15/2020/NĐ-CP (Điều 94) / Nghị định 174/2026/NĐ-CP (Điều 89)",
        doc_code_before_july2026="15/2020/NĐ-CP",
        article_before_july2026="94",
        doc_code_from_july2026="174/2026/NĐ-CP",
        article_from_july2026="89",
        present_keywords=("tu choi nhan quang cao", "tin nhan rac", "thu rac", "opt-out", "unsubscribe"),
        partial_keywords=("quang cao", "tiep thi", "email marketing", "sms"),
        risk_if_missing="Nếu hệ thống gửi email/SMS tiếp thị mà không ghi rõ sự đồng ý trước và nút từ chối (opt-out), dễ vi phạm quy định chống thư rác/tin nhắn rác.",
        recommended_clause="Mọi thông điệp tiếp thị qua SMS/Email chỉ được gửi khi người nhận đã đồng ý trước và luôn đính kèm chức năng từ chối nhận tin (Opt-out/Unsubscribe) miễn phí, có hiệu lực ngay lập tức.",
    ),
    _ComplianceRule(
        rule_id="ETRANSACTION_DATA_INTEGRITY",
        title="Giá trị pháp lý thông điệp dữ liệu, chữ ký điện tử & lưu vết chứng từ",
        legal_basis="Luật Giao dịch điện tử 20/2023/QH15 (Điều 8, 11, 14) & NĐ 15/2020/NĐ-CP (Điều 107) / NĐ 174/2026/NĐ-CP",
        doc_code_before_july2026="15/2020/NĐ-CP",
        article_before_july2026="107",
        doc_code_from_july2026="174/2026/NĐ-CP",
        article_from_july2026="106",
        present_keywords=("thong diep du lieu", "chu ky dien tu", "chu ky so", "toan ven du lieu", "luu tru dien tu"),
        partial_keywords=("hop dong dien tu", "giao dich dien tu", "log he thong", "xac thuc"),
        risk_if_missing="Thiếu thỏa thuận công nhận giá trị pháp lý của thông điệp dữ liệu, chữ ký số và tiêu chuẩn toàn vẹn log khi phát sinh tranh chấp.",
        recommended_clause="Các Bên công nhận thông điệp dữ liệu, hợp đồng điện tử và biên bản xác thực gắn chữ ký số hợp lệ theo Luật Giao dịch điện tử 20/2023/QH15 có giá trị pháp lý tương đương văn bản giấy và được lưu trữ toàn vẹn để làm chứng cứ.",
    ),
    _ComplianceRule(
        rule_id="CYBERSECURITY_TECH_CONTROLS",
        title="Biện pháp kỹ thuật bảo vệ an toàn thông tin mạng & kiểm soát truy cập",
        legal_basis="Luật An toàn thông tin mạng 86/2015/QH13, Luật An ninh mạng 24/2018/QH14 / 116/2025/QH15",
        doc_code_before_july2026="15/2020/NĐ-CP",
        article_before_july2026="80",
        doc_code_from_july2026="174/2026/NĐ-CP",
        article_from_july2026="75",
        present_keywords=("ma hoa", "kiem soat truy cap", "sao luu", "an toan thong tin", "bao mat he thong"),
        partial_keywords=("mat khau", "phan quyen", "tuong lua", "bao mat"),
        risk_if_missing="Chưa quy định tối thiểu các biện pháp mã hóa, phân quyền truy cập và sao lưu phục hồi hệ thống thông tin.",
        recommended_clause="Nhà cung cấp dịch vụ cam kết áp dụng chuẩn mã hóa truyền tải và lưu trữ, xác thực đa yếu tố, kiểm soát truy cập theo nguyên tắc tối thiểu và quy trình sao lưu định kỳ nhằm bảo đảm an toàn thông tin mạng.",
    ),
    _ComplianceRule(
        rule_id="CYBER_24H_TAKEDOWN_COORDINATION",
        title="Phối hợp ngăn chặn, gỡ bỏ nội dung vi phạm trong 24 giờ",
        legal_basis="Luật An ninh mạng 24/2018/QH14 (Điều 26) / Luật An ninh mạng 116/2025/QH15 & NĐ 147/2024/NĐ-CP",
        doc_code_before_july2026="15/2020/NĐ-CP",
        article_before_july2026="101",
        doc_code_from_july2026="174/2026/NĐ-CP",
        article_from_july2026="95",
        present_keywords=("24 gio", "go bo", "noi dung vi pham", "phoi hop co quan", "thong tin gia mao"),
        partial_keywords=("khoa tai khoan", "kiem duyet", "noi dung xau doc"),
        risk_if_missing="Thiếu cam kết phối hợp ngăn chặn, gỡ bỏ thông tin sai sự thật hoặc nội dung vi phạm trong vòng 24 giờ theo yêu cầu cơ quan có thẩm quyền.",
        recommended_clause="Trong thời hạn tối đa 24 giờ kể từ khi nhận yêu cầu bằng văn bản từ cơ quan có thẩm quyền, Bên vận hành nền tảng có trách nhiệm ngăn chặn, gỡ bỏ thông tin vi phạm pháp luật và lưu trữ nhật ký phục vụ xác minh.",
    ),
)


def extract_document_text_from_base64(filename: str, file_base64: str, max_bytes: int = 10 * 1024 * 1024) -> str:
    """Giải mã base64 (.txt/.md/.pdf/.docx) an toàn và trả về văn bản chuẩn hóa NFC."""
    cleaned_b64 = (file_base64 or "").split(",", 1)[-1].strip()
    if not cleaned_b64:
        raise ValueError("Dữ liệu tệp đính kèm rỗng.")
    raw_bytes = base64.b64decode(cleaned_b64, validate=True)
    if len(raw_bytes) > max_bytes:
        raise ValueError("Dung lượng tài liệu vượt quá giới hạn cho phép (10 MB).")

    suffix = Path(filename or "document.txt").suffix.lower() or ".txt"
    if suffix not in {".txt", ".md", ".pdf", ".docx"}:
        raise ValueError("Chỉ hỗ trợ rà soát tệp định dạng .txt, .md, .pdf hoặc .docx.")

    if suffix in {".txt", ".md"}:
        return normalize_text(raw_bytes.decode("utf-8-sig", errors="replace"))

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(raw_bytes)
        tmp_path = Path(tmp.name)
    try:
        from legal_parser import _read_pages

        pages = _read_pages(tmp_path, max_pages=40, use_cache=False)
        return normalize_text("\n".join(pages))
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass


def _lookup_neo4j_penalty_for_article(
    neo4j_driver: Any,
    doc_code: str,
    article_number: str,
) -> dict[str, Any] | None:
    if neo4j_driver is None or not doc_code or not article_number:
        return None
    try:
        with neo4j_driver.session(database=NEO4J_DATABASE) as session:
            rec = session.run(
                """
                MATCH (a:Article)-[:PART_OF]->(d:LegalDoc {code: $doc_code})
                WHERE toLower(toString(a.number)) = toLower(toString($article_number))
                OPTIONAL MATCH (act:Action)-[:DEFINED_IN]->(parent)
                WHERE parent = a OR (parent:Clause AND (parent)-[:PART_OF]->(a))
                OPTIONAL MATCH (act)-[:PENALIZED_BY]->(p:Penalty)
                WHERE p.max_amount IS NOT NULL
                RETURN p.min_amount AS min_amount,
                       p.max_amount AS max_amount,
                       p.type AS penalty_type,
                       p.base_subject AS base_subject,
                       act.text AS raw_text
                ORDER BY p.max_amount DESC
                LIMIT 1
                """,
                doc_code=doc_code,
                article_number=str(article_number),
            ).single()
            if rec and rec.get("max_amount") is not None:
                return {
                    "min_amount": rec.get("min_amount"),
                    "max_amount": rec.get("max_amount"),
                    "type": rec.get("penalty_type") or "FINE",
                    "base_subject": rec.get("base_subject"),
                    "raw_text": rec.get("raw_text"),
                }
    except Exception:
        return None
    return None


def _statutory_cap_note(doc_code: str, article_number: str, subject: str) -> str:
    cfg = DECREE_RULES.get(doc_code)
    if not cfg:
        return f"Căn cứ xử phạt: {doc_code} Điều {article_number}"
    try:
        art_int = int(re.match(r"\d+", str(article_number)).group(0))  # type: ignore[union-attr]
    except Exception:
        return f"Căn cứ: {cfg.get('cap_basis', doc_code)}"

    cap_val = None
    for (lo, hi), val, _ in cfg.get("individual_caps", []):
        if lo <= art_int <= hi:
            cap_val = val
            break
    if subject == ORGANIZATION:
        org_cap = cfg.get("organization_cap") or (cap_val * 2 if cap_val else None)
        if doc_code == "330/2026/NĐ-CP" and art_int in cfg.get("individual_base_articles", set()):
            return f"Mức phạt tổ chức gấp 2 lần cá nhân, trần tối đa {org_cap:,} đồng ({cfg['cap_basis']}).".replace(",", ".")
        if org_cap:
            return f"Áp dụng khung tổ chức theo {cfg['basis']} (trần lĩnh vực tổ chức đến {org_cap:,} đồng).".replace(",", ".")
    elif cap_val:
        return f"Áp dụng mức phạt cá nhân (bằng 1/2 tổ chức với điều khoản tổ chức) và trần cá nhân {cap_val:,} đồng ({cfg['cap_basis']}).".replace(",", ".")
    return f"Căn cứ: {cfg.get('cap_basis', doc_code)}"


def review_it_compliance_document(
    document_text: str,
    doc_type: str = "PRIVACY_POLICY",
    subject: str = ORGANIZATION,
    as_of: str | None = None,
    neo4j_driver: Any = None,
    penalty_lookup: dict[tuple[str, str], dict[str, Any]] | None = None,
    llm: Any = None,
    use_llm: bool = False,
) -> dict[str, Any]:
    """Rà soát tuân thủ văn bản CNTT dựa trên bộ quy tắc Symbolic tất định."""
    cleaned_text = normalize_text(document_text)
    if len(cleaned_text) < 15:
        raise ValueError("Nội dung tài liệu quá ngắn để rà soát (cần tối thiểu 15 ký tự).")

    eval_date = parse_as_of(as_of)
    use_2026 = eval_date >= date(2026, 7, 1)
    norm_subject = ORGANIZATION if str(subject).upper() == ORGANIZATION else INDIVIDUAL
    norm_text = _strip_accents_lower(cleaned_text)
    facts = QueryFacts(
        subjects=[norm_subject],
        subject_detected=True,
        age=None,
        article_refs=[],
        doc_hints=[],
    )

    findings: list[dict[str, Any]] = []
    score_sum = 0
    for rule in _IT_COMPLIANCE_RULES:
        present_hits = [kw for kw in rule.present_keywords if kw in norm_text]
        partial_hits = [kw for kw in rule.partial_keywords if kw in norm_text]
        if len(present_hits) >= 2 or (len(present_hits) == 1 and len(partial_hits) >= 1):
            status = "PASS"
            points = 100
        elif present_hits or partial_hits:
            status = "PARTIAL"
            points = 55
        else:
            status = "MISSING"
            points = 0
        score_sum += points

        target_doc = rule.doc_code_from_july2026 if use_2026 else rule.doc_code_before_july2026
        target_art = rule.article_from_july2026 if use_2026 else rule.article_before_july2026

        raw_penalty = (penalty_lookup or {}).get((target_doc, target_art))
        if raw_penalty is None and neo4j_driver is not None:
            raw_penalty = _lookup_neo4j_penalty_for_article(neo4j_driver, target_doc, target_art)

        penalty_summary = _statutory_cap_note(target_doc, target_art, norm_subject)
        calculated_penalty = None
        if raw_penalty and status != "PASS":
            calc = apply_penalty_rules(raw_penalty, target_doc, target_art, facts)
            if calc.get("rule_supported") and calc.get("results"):
                r0 = calc["results"][0]
                calculated_penalty = r0
                penalty_summary = f"{r0['display']} ({target_doc} Điều {target_art} — {r0['formula']})"

        findings.append({
            "rule_id": rule.rule_id,
            "title": rule.title,
            "status": status,
            "legal_basis": rule.legal_basis,
            "referenced_statute": f"{target_doc} Điều {target_art}",
            "matched_signals": present_hits or partial_hits,
            "risk_detail": "Đạt yêu cầu cơ bản trong văn bản." if status == "PASS" else rule.risk_if_missing,
            "recommended_clause": rule.recommended_clause if status != "PASS" else None,
            "penalty_reference": penalty_summary,
            "calculated_penalty": calculated_penalty,
        })

    compliance_score = round(score_sum / len(_IT_COMPLIANCE_RULES))
    if compliance_score >= 80:
        risk_level = "LOW"
    elif compliance_score >= 50:
        risk_level = "MEDIUM"
    else:
        risk_level = "HIGH"

    missing_count = sum(1 for f in findings if f["status"] == "MISSING")
    partial_count = sum(1 for f in findings if f["status"] == "PARTIAL")
    passed_count = sum(1 for f in findings if f["status"] == "PASS")

    summary_lines = [
        f"Điểm tuân thủ pháp luật CNTT & An ninh mạng ({doc_type}): {compliance_score}/100 (Mức rủi ro: {risk_level}).",
        f"Tổng hợp 8 tiêu chí tất định theo mốc hiệu lực {eval_date.isoformat()}: {passed_count} đạt, {partial_count} cần bổ sung chi tiết, {missing_count} thiếu quy định.",
    ]

    llm_notes = None
    if use_llm and llm is not None:
        try:
            missing_titles = [f["title"] for f in findings if f["status"] != "PASS"]
            prompt = (
                "Bạn là chuyên gia pháp chế CNTT Việt Nam. Dựa trên kết quả rà soát TẤT ĐỊNH dưới đây, "
                "viết tối đa 3 câu nhận xét tổng quan ngắn gọn, KHÔNG tự bịa mức phạt tiền hay số Điều mới:\n"
                f"- Loại tài liệu: {doc_type}, Điểm tuân thủ: {compliance_score}/100 ({risk_level})\n"
                f"- Các mục cần bổ sung: {', '.join(missing_titles) if missing_titles else 'Không có'}\n"
            )
            res = llm.invoke(prompt)
            content = getattr(res, "content", str(res)).strip()
            if content:
                llm_notes = content
        except Exception:
            llm_notes = None

    return {
        "doc_type": doc_type,
        "subject": norm_subject,
        "evaluated_as_of": eval_date.isoformat(),
        "compliance_score": compliance_score,
        "risk_level": risk_level,
        "counts": {"pass": passed_count, "partial": partial_count, "missing": missing_count},
        "summary": " ".join(summary_lines),
        "llm_advisory": llm_notes,
        "findings": findings,
    }


# ---------------------------------------------------------------------------
# 6. Legal Drafting Templates & Generator (Soạn thảo Văn bản CNTT)
# ---------------------------------------------------------------------------
DRAFT_TEMPLATES_CATALOG: dict[str, dict[str, Any]] = {
    "DATA_BREACH_72H": {
        "title": "Thông báo sự cố vi phạm bảo vệ dữ liệu cá nhân (Trong 72 giờ)",
        "description": "Mẫu văn bản gửi Cục An ninh mạng & PCTP sử dụng CNC / chủ thể dữ liệu theo Điều 23 NĐ 13/2023/NĐ-CP & Luật 91/2025/QH15.",
        "statutes": ["91/2025/QH15", "13/2023/NĐ-CP Điều 23", "356/2025/NĐ-CP"],
    },
    "PRIVACY_POLICY": {
        "title": "Chính sách Bảo mật & Xử lý Dữ liệu Cá nhân cho Ứng dụng/Website",
        "description": "Bộ điều khoản chuẩn Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15, NĐ 13/2023/NĐ-CP và NĐ 356/2025/NĐ-CP.",
        "statutes": ["91/2025/QH15", "13/2023/NĐ-CP", "356/2025/NĐ-CP", "20/2023/QH15"],
    },
    "CYBERCRIME_REPORT": {
        "title": "Đơn trình báo / Tố giác hành vi tấn công mạng hoặc giả mạo trên mạng",
        "description": "Trình báo sự cố xâm nhập, phát tán mã độc, lừa đảo hoặc bôi nhọ trên không gian mạng kèm nhật ký chứng cứ.",
        "statutes": ["100/2015/QH13 Điều 285-290", "24/2018/QH14", "116/2025/QH15", "15/2020/NĐ-CP"],
    },
    "SOFTWARE_DPA_CLAUSE": {
        "title": "Phụ lục Điều khoản Xử lý Dữ liệu & An toàn Thông tin (DPA)",
        "description": "Phụ lục đính kèm hợp đồng gia công phần mềm / thuê ngoài SaaS quy định trách nhiệm bảo mật 72h & không mua bán data.",
        "statutes": ["91/2025/QH15 Điều 8", "13/2023/NĐ-CP", "86/2015/QH13", "20/2023/QH15 Điều 8, 11"],
    },
    "ADMIN_PENALTY_EXPLANATION": {
        "title": "Văn bản giải trình vi phạm hành chính lĩnh vực CNTT & Viễn thông",
        "description": "Văn bản giải trình tình tiết giảm nhẹ, khắc phục hậu quả theo quy định XLVPHC và NĐ 15/2020/NĐ-CP / NĐ 174/2026/NĐ-CP.",
        "statutes": ["15/2020/NĐ-CP", "174/2026/NĐ-CP", "330/2026/NĐ-CP"],
    },
}


def _render_deterministic_draft(
    template_type: str,
    party_a: str,
    party_b: str,
    incident_or_scope: str,
    as_of: str | None = None,
    language: str = "vi",
) -> tuple[str, str, list[str]]:
    eval_date = parse_as_of(as_of)
    meta = DRAFT_TEMPLATES_CATALOG.get(template_type)
    if meta is None:
        raise ValueError(f"Mẫu văn bản không hợp lệ: {template_type}")

    org_a = unicodedata.normalize("NFC", (party_a or "[Tên Tổ chức / Doanh nghiệp A]").strip())
    org_b = unicodedata.normalize("NFC", (party_b or "[Đối tác / Cơ quan tiếp nhận]").strip())
    scope = unicodedata.normalize("NFC", (incident_or_scope or "[Mô tả phạm vi hệ thống / sự việc cụ thể]").strip())
    date_str = eval_date.strftime("%d/%m/%Y")
    is_en = str(language).lower().startswith("en")
    enforce_2026 = eval_date >= date(2026, 7, 1)
    sanction_doc = "Nghị định 174/2026/NĐ-CP và Nghị định 330/2026/NĐ-CP" if enforce_2026 else "Nghị định 15/2020/NĐ-CP (sửa đổi bởi Nghị định 14/2022/NĐ-CP và Nghị định 211/2025/NĐ-CP)"

    if template_type == "DATA_BREACH_72H":
        title = "THÔNG BÁO SỰ CỐ VI PHẠM BẢO VỆ DỮ LIỆU CÁ NHÂN (MẪU 72 GIỜ)"
        body = (
            f"# {title}\n"
            f"*Ngày lập: {date_str}*\n\n"
            f"**Kính gửi:** {org_b} (và Cơ quan chuyên trách bảo vệ dữ liệu cá nhân)\n\n"
            f"**Đơn vị báo cáo:** {org_a}\n\n"
            f"## 1. Căn cứ pháp lý\n"
            f"- Luật Bảo vệ dữ liệu cá nhân số `91/2025/QH15`;\n"
            f"- Nghị định `13/2023/NĐ-CP` (Điều 23 về thông báo vi phạm trong thời hạn 72 giờ) và Nghị định `356/2025/NĐ-CP`;\n"
            f"- Chế tài quản lý liên quan theo {sanction_doc}.\n\n"
            f"## 2. Mô tả sự cố & Phạm vi dữ liệu bị ảnh hưởng\n"
            f"- **Tóm tắt sự việc:** {scope}\n"
            f"- **Thời điểm phát hiện:** Ngày {date_str} (thông báo trong thời hạn <= 72 giờ).\n"
            f"- **Nhóm dữ liệu liên quan:** Dữ liệu cá nhân cơ bản / nhạy cảm trên hệ thống vận hành của {org_a}.\n\n"
            f"## 3. Biện pháp ứng cứu & Khắc phục đã triển khai\n"
            f"1. Cô lập phân đoạn mạng / tài khoản bị truy cập trái phép, thu hồi phiên đăng nhập và khóa truy cập bất thường.\n"
            f"2. Niêm phong log máy chủ, tường lửa và mã băm tệp nhật ký phục vụ giám định điện tử (theo Điều 11 Luật `20/2023/QH15`).\n"
            f"3. Thông báo khuyến cáo đổi mật khẩu, xác thực đa yếu tố đến Chủ thể dữ liệu bị ảnh hưởng.\n\n"
            f"## 4. Đầu mối liên hệ tiếp nhận xử lý\n"
            f"- Đại diện Bảo vệ dữ liệu (DPO) của {org_a}: [Họ tên / Email / Số điện thoại].\n"
        )
    elif template_type == "PRIVACY_POLICY":
        title = "CHÍNH SÁCH BẢO VỆ DỮ LIỆU CÁ NHÂN & QUYỀN RIÊNG TƯ"
        body = (
            f"# {title}\n"
            f"**Đơn vị kiểm soát & xử lý dữ liệu:** {org_a}\n"
            f"**Phạm vi áp dụng:** {scope}\n"
            f"**Ngày hiệu lực:** {date_str}\n\n"
            f"## Điều 1. Nguyên tắc bảo vệ và cam kết không mua, bán dữ liệu\n"
            f"{org_a} tuân thủ nghiêm Luật Bảo vệ dữ liệu cá nhân `91/2025/QH15`, Nghị định `13/2023/NĐ-CP` và Nghị định `356/2025/NĐ-CP`. Mọi hành vi mua, bán dữ liệu cá nhân đều bị nghiêm cấm tuyệt đối theo Điều 8 Luật `91/2025/QH15`.\n\n"
            f"## Điều 2. Mục đích thu thập & Sự đồng ý (Opt-in)\n"
            f"Dữ liệu chỉ được thu thập sau khi Người dùng đọc và xác nhận đồng ý rõ ràng cho từng mục đích cụ thể; việc tiếp thị/quảng cáo điện tử tuân thủ cơ chế từ chối (Opt-out) theo quy định chống thư rác.\n\n"
            f"## Điều 3. Quyền của Chủ thể dữ liệu\n"
            f"Người dùng có quyền biết, đồng ý hoặc rút lại sự đồng ý, truy cập, chỉnh sửa, yêu cầu xóa dữ liệu và khiếu nại theo quy định pháp luật hiện hành.\n\n"
            f"## Điều 4. Lưu trữ, chuyển dữ liệu xuyên biên giới & Thông báo sự cố 72 giờ\n"
            f"Trường hợp chuyển dữ liệu cá nhân ra nước ngoài, {org_a} thực hiện lập Hồ sơ đánh giá tác động (DPIA/TIA). Nếu phát sinh sự cố lộ dữ liệu, {org_a} thông báo tới cơ quan chức năng và chủ thể dữ liệu trong vòng 72 giờ.\n\n"
            f"## Điều 5. Liên hệ tiếp nhận yêu cầu\n"
            f"- Bộ phận Pháp chế / Bảo vệ dữ liệu — {org_a} (Đối tác kỹ thuật phối hợp: {org_b}).\n"
        )
    elif template_type == "CYBERCRIME_REPORT":
        title = "ĐƠN TRÌNH BÁO SỰ CỐ AN NINH MẠNG & HÀNH VI XÂM PHẠM TRÁI PHÉP"
        body = (
            f"# {title}\n"
            f"*Ngày lập: {date_str}*\n\n"
            f"**Kính gửi:** {org_b} (Cơ quan Công an có thẩm quyền / Đơn vị chuyên trách An ninh mạng)\n\n"
            f"**Người / Tổ chức trình báo:** {org_a}\n\n"
            f"## 1. Nội dung sự việc & Dấu hiệu vi phạm\n"
            f"{scope}\n\n"
            f"## 2. Căn cứ pháp luật viện dẫn\n"
            f"- Luật An ninh mạng (`24/2018/QH14` / `116/2025/QH15` hiệu lực từ 01/07/2026) và Luật An toàn thông tin mạng `86/2015/QH13`;\n"
            f"- Bộ luật Hình sự `100/2015/QH13` (Điều 285–290 về tội phạm công nghệ thông tin, viễn thông nếu đủ yếu tố cấu thành tội phạm);\n"
            f"- Chế tài xử phạt vi phạm hành chính theo {sanction_doc}.\n\n"
            f"## 3. Tài liệu, chứng cứ điện tử đính kèm\n"
            f"Các thông điệp dữ liệu, log truy cập IP, ảnh chụp màn hình có xác lập nguồn gốc và tính toàn vẹn theo Luật Giao dịch điện tử `20/2023/QH15` (Điều 8, Điều 11).\n\n"
            f"## 4. Kiến nghị\n"
            f"Đề nghị Quý Cơ quan tiếp nhận xác minh, áp dụng biện pháp ngăn chặn kịp thời và xử lý nghiêm tổ chức/cá nhân vi phạm theo đúng thẩm quyền.\n"
        )
    elif template_type == "SOFTWARE_DPA_CLAUSE":
        title = "PHỤ LỤC HỢP ĐỒNG: BẢO VỆ DỮ LIỆU CÁ NHÂN & AN TOÀN THÔNG TIN (DPA)"
        body = (
            f"# {title}\n"
            f"**Bên Kiểm soát dữ liệu (Bên A):** {org_a}\n"
            f"**Bên Xử lý dữ liệu / Nhà cung cấp phần mềm (Bên B):** {org_b}\n"
            f"**Phạm vi hệ thống / dịch vụ:** {scope} — **Ngày lập:** {date_str}\n\n"
            f"## 1. Phạm vi xử lý & Cấm chuyển giao trái phép\n"
            f"Bên B chỉ xử lý dữ liệu theo văn bản chỉ dẫn của Bên A, nghiêm cấm mua bán hoặc khai thác thương mại dữ liệu cá nhân theo Luật `91/2025/QH15` (Điều 8) và Nghị định `13/2023/NĐ-CP`.\n\n"
            f"## 2. Bảo đảm an toàn thông tin & Thông báo sự cố 72 giờ\n"
            f"Bên B áp dụng mã hóa dữ liệu, phân quyền tối thiểu, kiểm thử bảo mật định kỳ theo Luật `86/2015/QH13` và thông báo sự cố cho Bên A trong thời hạn không quá **72 giờ**.\n\n"
            f"## 3. Giá trị pháp lý thông điệp dữ liệu & Chấm dứt hợp đồng\n"
            f"Các biên bản nghiệm thu, thông báo điện tử giữa hai Bên có giá trị pháp lý theo Điều 8 và Điều 11 Luật `20/2023/QH15`. Khi chấm dứt dịch vụ, Bên B bàn giao và xóa toàn bộ dữ liệu theo yêu cầu của Bên A.\n"
        )
    else:  # ADMIN_PENALTY_EXPLANATION
        title = "VĂN BẢN GIẢI TRÌNH & CAM KẾT KHẮC PHỤC HẬU QUẢ VI PHẠM HÀNH CHÍNH"
        body = (
            f"# {title}\n"
            f"*Ngày lập: {date_str}*\n\n"
            f"**Kính gửi:** {org_b} (Cơ quan có thẩm quyền xử phạt vi phạm hành chính)\n\n"
            f"**Tổ chức / Cá nhân giải trình:** {org_a}\n\n"
            f"## 1. Tóm tắt vụ việc & Nội dung giải trình\n"
            f"{scope}\n\n"
            f"## 2. Các biện pháp khắc phục đã tự nguyện thực hiện\n"
            f"- Đã chủ động gỡ bỏ/chấm dứt hành vi vi phạm, khắc phục hậu quả và phối hợp cung cấp đầy đủ thông tin, tài liệu điện tử theo yêu cầu.\n"
            f"- Rà soát quy trình tuân thủ nội bộ theo {sanction_doc}.\n\n"
            f"## 3. Đề nghị xem xét tình tiết giảm nhẹ\n"
            f"Kính đề nghị Quý Cơ quan căn cứ tinh thần tự nguyện khắc phục hậu quả, mức độ vi phạm thực tế và chủ thể vi phạm (tổ chức/cá nhân theo Điều 4 {sanction_doc}) để xem xét áp dụng mức xử lý phù hợp quy định pháp luật.\n"
        )

    if is_en:
        body = (
            f"> *[Bilingual Reference Note — Statutory terminology anchored to Vietnamese IT Law corpus as of {date_str}]*\n\n"
            + body
        )
    return title, body, list(meta["statutes"])


def generate_legal_draft(
    template_type: str,
    party_a: str = "",
    party_b: str = "",
    incident_or_scope: str = "",
    as_of: str | None = None,
    language: str = "vi",
    llm: Any = None,
    use_llm: bool = False,
) -> dict[str, Any]:
    """Sinh bản thảo văn bản pháp lý CNTT từ khung mẫu chuẩn + tùy chọn tinh chỉnh bằng LLM."""
    title, draft_md, statutes = _render_deterministic_draft(
        template_type=template_type,
        party_a=party_a,
        party_b=party_b,
        incident_or_scope=incident_or_scope,
        as_of=as_of,
        language=language,
    )
    llm_refined = False
    if use_llm and llm is not None:
        try:
            prompt = (
                "Bạn là luật sư CNTT Việt Nam. Hãy chuẩn hóa văn phong hành chính - pháp lý trang trọng cho bản thảo dưới đây "
                "nhưng PHẢI GIỮ NGUYÊN 100% số hiệu văn bản luật và Điều khoản viện dẫn, tuyệt đối KHÔNG thêm mức phạt tiền:\n\n"
                f"{draft_md}"
            )
            res = llm.invoke(prompt)
            content = getattr(res, "content", str(res)).strip()
            if len(content) > 120:
                draft_md = content
                llm_refined = True
        except Exception:
            llm_refined = False

    return {
        "template_type": template_type,
        "title": title,
        "draft_markdown": draft_md,
        "cited_statutes": statutes,
        "evaluated_as_of": parse_as_of(as_of).isoformat(),
        "language": "en" if str(language).lower().startswith("en") else "vi",
        "llm_refined": llm_refined,
    }



# ---------------------------------------------------------------------------
# 6. Tra cứu Văn bản Pháp luật (VBPL), Cập nhật Pháp lý & Thống kê Thực tế
# ---------------------------------------------------------------------------
def _infer_issuing_body(doc_code: str, doc_type: str) -> str:
    upper = (doc_code or "").upper()
    if "QH" in upper:
        return "Quốc hội"
    if "NĐ-CP" in upper or "CP-" in upper:
        return "Chính phủ"
    if "VBHN-BTTTT" in upper or "BTTTT" in upper:
        return "Bộ Thông tin và Truyền thông"
    if "VBHN-BKHCN" in upper or "BKHCN" in upper:
        return "Bộ Khoa học và Công nghệ"
    if "TT-" in upper:
        return "Bộ / Cơ quan ngang Bộ"
    if doc_type == "LAW":
        return "Quốc hội"
    return "Chính phủ"


def _infer_doc_type_label(doc_code: str, doc_type: str) -> tuple[str, str]:
    upper = (doc_code or "").upper()
    if "VBHN" in upper:
        return "CONSOLIDATED", "Văn bản hợp nhất"
    if "100/2015/QH13" in upper or "91/2015/QH13" in upper:
        return "CODE", "Bộ luật"
    if doc_type == "LAW" or "QH" in upper:
        return "LAW", "Luật"
    if doc_type == "DECREE" or "NĐ-CP" in upper or "CP-" in upper:
        return "DECREE", "Nghị định"
    return "OTHER", "Văn bản quy phạm"


def _infer_it_domain(doc_code: str, title: str) -> str:
    combined = _strip_accents_lower(f"{doc_code} {title}")
    if any(k in combined for k in ("du lieu ca nhan", "13/2023", "91/2025", "356/2025", "330/2026")):
        return "Bảo vệ dữ liệu cá nhân"
    if any(k in combined for k in ("giao dich dien tu", "20/2023", "23/2025", "thuong mai dien tu", "52/2013")):
        return "Giao dịch điện tử"
    if any(k in combined for k in ("an ninh mang", "an toan thong tin", "24/2018", "86/2015", "85/2016", "hinh su", "100/2015")):
        return "An ninh mạng & Hình sự"
    if any(k in combined for k in ("vien thong", "tan so", "24/2023", "163/2024", "42/2009", "07/2022")):
        return "Viễn thông & Tần số"
    if any(k in combined for k in ("xu phat", "15/2020", "174/2026", "14/2022", "211/2025", "147/2024")):
        return "Xử phạt & Mạng xã hội"
    return "Công nghệ thông tin & Chuyển đổi số"


def _deduped_registry_entries() -> list[dict[str, Any]]:
    by_code: dict[str, dict[str, Any]] = {}
    for entry in DOCUMENT_REGISTRY:
        code = str(entry.get("code") or "").strip()
        if not code:
            continue
        existing = by_code.get(code)
        if existing is None or (entry.get("effective_from") and not existing.get("effective_from")):
            by_code[code] = dict(entry)
    return list(by_code.values())


def search_legal_documents(
    query: str = "",
    doc_type: str = "",
    issuing_body: str = "",
    effective_from: str | None = None,
    effective_to: str | None = None,
    status: str = "",
    as_of: str | None = None,
    limit: int = 30,
    sql_engine: Any = None,
) -> dict[str, Any]:
    """Tra cứu thực tế kho văn bản pháp luật CNTT (DOCUMENT_REGISTRY + PGVector langchain_pg_embedding)."""
    eval_date = parse_as_of(as_of)
    clean_q = (query or "").strip()
    norm_q = _strip_accents_lower(clean_q)
    clean_type = (doc_type or "").strip().upper()
    clean_body = _strip_accents_lower(issuing_body or "")
    clean_status = (status or "").strip().upper()
    eff_from_filter = parse_as_of(effective_from) if effective_from else None
    eff_to_filter = parse_as_of(effective_to) if effective_to else None
    safe_limit = max(1, min(60, int(limit or 30)))

    # 1. Tìm các Điều luật khớp trong PostgreSQL nếu có từ khóa
    article_hits_by_doc: dict[str, list[dict[str, Any]]] = {}
    if sql_engine is not None and clean_q:
        try:
            like_pattern = f"%{clean_q}%"
            sql = sql_text(
                """
                SELECT
                    e.cmetadata->>'doc_code' AS doc_code,
                    e.cmetadata->>'article_number' AS article_number,
                    e.cmetadata->>'article_title' AS article_title,
                    e.cmetadata->>'effective_from' AS effective_from,
                    e.cmetadata->>'effective_to' AS effective_to,
                    LEFT(e.document, 320) AS snippet
                FROM langchain_pg_embedding e
                JOIN langchain_pg_collection c ON c.uuid = e.collection_id
                WHERE c.name = :collection
                  AND UPPER(COALESCE(e.cmetadata->>'lifecycle_status', 'ACTIVE')) NOT IN ('PREPARED', 'FAILED', 'RETIRED')
                  AND (
                    e.document ILIKE :pat
                    OR COALESCE(e.cmetadata->>'doc_code', '') ILIKE :pat
                    OR COALESCE(e.cmetadata->>'article_title', '') ILIKE :pat
                    OR COALESCE(e.cmetadata->>'article_number', '') ILIKE :pat
                  )
                LIMIT 120
                """
            )
            with sql_engine.connect() as conn:
                rows = conn.execute(sql, {"collection": COLLECTION_NAME, "pat": like_pattern}).mappings().all()
            for row in rows:
                code = str(row.get("doc_code") or "").strip()
                if not code:
                    continue
                art_no = str(row.get("article_number") or "").strip()
                bucket = article_hits_by_doc.setdefault(code, [])
                if len(bucket) < 4 and all(x["article_number"] != art_no for x in bucket):
                    bucket.append(
                        {
                            "article_number": art_no,
                            "article_title": str(row.get("article_title") or "").strip(),
                            "snippet": str(row.get("snippet") or "").strip(),
                        }
                    )
        except Exception:
            article_hits_by_doc = {}

    # 2. Tổng hợp & lọc danh mục văn bản thực tế
    items: list[dict[str, Any]] = []
    for entry in _deduped_registry_entries():
        code = str(entry.get("code") or "")
        title = str(entry.get("title") or entry.get("short") or code)
        raw_type = str(entry.get("type") or "")
        type_code, type_label = _infer_doc_type_label(code, raw_type)
        issuer = _infer_issuing_body(code, raw_type)
        domain = _infer_it_domain(code, title)

        eff_from_str = entry.get("effective_from")
        eff_to_str = entry.get("effective_to")
        if code == "15/2020/NĐ-CP" and not eff_to_str:
            eff_to_str = "2026-06-30"

        eff_from_d = parse_as_of(eff_from_str) if eff_from_str else None
        eff_to_d = parse_as_of(eff_to_str) if eff_to_str else None

        if eff_from_d and eval_date < eff_from_d:
            st_badge = "UPCOMING"
            st_label = f"Chưa có hiệu lực (từ {eff_from_str})"
        elif eff_to_d and eval_date > eff_to_d:
            st_badge = "EXPIRED"
            st_label = f"Hết hiệu lực (đến {eff_to_str})"
        else:
            st_badge = "ACTIVE"
            st_label = "Đang có hiệu lực"

        if clean_type and clean_type != "ALL" and type_code != clean_type:
            continue
        if clean_body and clean_body != "all" and clean_body not in _strip_accents_lower(issuer):
            continue
        if clean_status and clean_status != "ALL" and st_badge != clean_status:
            continue
        if eff_from_filter and eff_from_d and eff_from_d < eff_from_filter:
            continue
        if eff_to_filter and eff_from_d and eff_from_d > eff_to_filter:
            continue

        matched_articles = article_hits_by_doc.get(code, [])
        if norm_q:
            haystack = _strip_accents_lower(f"{code} {title} {issuer} {domain}")
            tokens = [tok for tok in re.split(r"\s+", norm_q) if len(tok) >= 2]
            meta_match = (norm_q in haystack) or (bool(tokens) and all(tok in haystack for tok in tokens))
            if not meta_match and not matched_articles:
                continue
            score = (3 if norm_q in _strip_accents_lower(code) else 0) + (2 if meta_match else 0) + len(matched_articles)
        else:
            score = 1

        items.append(
            {
                "doc_code": code,
                "title": title,
                "short_title": str(entry.get("short") or code),
                "doc_type": type_code,
                "doc_type_label": type_label,
                "issuing_body": issuer,
                "domain": domain,
                "effective_from": eff_from_str,
                "effective_to": eff_to_str,
                "status_badge": st_badge,
                "status_label": st_label,
                "source_url": entry.get("source_url"),
                "matching_articles": matched_articles,
                "_score": score,
                "_sort_date": eff_from_str or "1900-01-01",
            }
        )

    items.sort(key=lambda x: (x["_score"], x["_sort_date"]), reverse=True)
    cleaned_items = [
        {k: v for k, v in item.items() if not k.startswith("_")}
        for item in items[:safe_limit]
    ]
    return {
        "total": len(items),
        "evaluated_as_of": eval_date.isoformat(),
        "items": cleaned_items,
    }


def list_legal_updates(as_of: str | None = None, limit: int = 20) -> dict[str, Any]:
    """Trả về dòng thời gian cập nhật văn bản pháp luật CNTT thực tế từ kho văn bản chuẩn hóa."""
    eval_date = parse_as_of(as_of)
    safe_limit = max(1, min(50, int(limit or 20)))
    entries = _deduped_registry_entries()

    updates: list[dict[str, Any]] = []
    for entry in entries:
        code = str(entry.get("code") or "")
        title = str(entry.get("title") or entry.get("short") or code)
        eff_from = entry.get("effective_from")
        eff_to = entry.get("effective_to")
        if code == "15/2020/NĐ-CP" and not eff_to:
            eff_to = "2026-06-30"
        if not eff_from:
            continue

        eff_d = parse_as_of(eff_from)
        eff_to_d = parse_as_of(eff_to) if eff_to else None
        if eval_date < eff_d:
            st_badge = "UPCOMING"
            st_label = f"Sắp có hiệu lực ({eff_from})"
        elif eff_to_d and eval_date > eff_to_d:
            st_badge = "EXPIRED"
            st_label = f"Đã hết hiệu lực ({eff_to})"
        else:
            st_badge = "ACTIVE"
            st_label = f"Đang có hiệu lực từ {eff_from}"

        type_code, type_label = _infer_doc_type_label(code, str(entry.get("type") or ""))
        updates.append(
            {
                "doc_code": code,
                "title": title,
                "short_title": str(entry.get("short") or code),
                "doc_type": type_code,
                "doc_type_label": type_label,
                "issuing_body": _infer_issuing_body(code, str(entry.get("type") or "")),
                "domain": _infer_it_domain(code, title),
                "effective_from": eff_from,
                "effective_to": eff_to,
                "status_badge": st_badge,
                "status_label": st_label,
                "source_url": entry.get("source_url"),
                "related_documents": related_document_codes(code),
            }
        )

    updates.sort(key=lambda x: str(x.get("effective_from") or ""), reverse=True)
    return {
        "total": len(updates),
        "evaluated_as_of": eval_date.isoformat(),
        "items": updates[:safe_limit],
    }


def get_platform_stats(sql_engine: Any = None) -> dict[str, Any]:
    """Trả về số liệu thực tế của kho văn bản, vector PGVector, án lệ và benchmark."""
    total_docs = len(_deduped_registry_entries())
    total_precedents = len(search_precedents_catalog(limit=200))
    total_vectors = 0
    if sql_engine is not None:
        try:
            with sql_engine.connect() as conn:
                row = conn.execute(
                    sql_text(
                        """
                        SELECT COUNT(*) AS cnt
                        FROM langchain_pg_embedding e
                        JOIN langchain_pg_collection c ON c.uuid = e.collection_id
                        WHERE c.name = :collection
                        """
                    ),
                    {"collection": COLLECTION_NAME},
                ).first()
                if row is not None:
                    total_vectors = int(row[0] or 0)
        except Exception:
            total_vectors = 0

    return {
        "total_documents": total_docs,
        "total_vectors": total_vectors,
        "total_precedents": total_precedents,
        "benchmark_cases": 40,
        "guardrail_layers": 5,
    }


# ---------------------------------------------------------------------------
# 7. Lưu trữ Lịch sử Hội thoại theo Tài khoản & Yêu cầu Hỗ trợ (PostgreSQL + JSON)
# ---------------------------------------------------------------------------
class ConversationStore:
    """Lưu trữ phiên làm việc thật theo user_id trong PostgreSQL (fallback JSON)."""

    def __init__(self, sql_engine: Any = None, store_path: Path | None = None) -> None:
        self.sql_engine = sql_engine
        self.store_path = Path(store_path) if store_path else (DATA_DIR / ".conversations_store.json")
        self._lock = threading.RLock()
        self._pg_ready = False
        if self.sql_engine is not None:
            try:
                ddl = sql_text(
                    """
                    CREATE TABLE IF NOT EXISTS lexit_conversations (
                        id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        title TEXT NOT NULL,
                        pinned BOOLEAN NOT NULL DEFAULT FALSE,
                        messages_json TEXT NOT NULL DEFAULT '[]',
                        updated_at BIGINT NOT NULL,
                        PRIMARY KEY (user_id, id)
                    )
                    """
                )
                with self.sql_engine.begin() as conn:
                    conn.execute(ddl)
                self._pg_ready = True
            except Exception:
                self._pg_ready = False

    def _load_json(self) -> dict[str, dict[str, Any]]:
        if not self.store_path.exists():
            return {}
        try:
            data = json.loads(self.store_path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _save_json(self, payload: dict[str, dict[str, Any]]) -> None:
        self.store_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.store_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.store_path)

    def list_conversations(self, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        uid = str(user_id or "").strip()
        if not uid:
            return []
        safe_limit = max(1, min(100, int(limit or 50)))
        if self._pg_ready and self.sql_engine is not None:
            try:
                with self.sql_engine.connect() as conn:
                    rows = conn.execute(
                        sql_text(
                            """
                            SELECT id, title, pinned, messages_json, updated_at
                            FROM lexit_conversations
                            WHERE user_id = :uid
                            ORDER BY pinned DESC, updated_at DESC
                            LIMIT :lim
                            """
                        ),
                        {"uid": uid, "lim": safe_limit},
                    ).mappings().all()
                results = []
                for row in rows:
                    try:
                        msgs = json.loads(row["messages_json"] or "[]")
                    except Exception:
                        msgs = []
                    results.append(
                        {
                            "id": str(row["id"]),
                            "title": str(row["title"]),
                            "pinned": bool(row["pinned"]),
                            "messages": msgs if isinstance(msgs, list) else [],
                            "updatedAt": int(row["updated_at"]),
                        }
                    )
                return results
            except Exception:
                pass

        with self._lock:
            user_map = self._load_json().get(uid, {})
            items = list(user_map.values())
            items.sort(key=lambda x: (1 if x.get("pinned") else 0, int(x.get("updatedAt") or 0)), reverse=True)
            return items[:safe_limit]

    def upsert_conversation(self, user_id: str, conv: dict[str, Any]) -> dict[str, Any]:
        uid = str(user_id or "").strip()
        cid = str(conv.get("id") or "").strip()
        if not uid or not cid:
            raise ValueError("Thiếu mã người dùng hoặc mã phiên hội thoại.")

        title = unicodedata.normalize("NFC", str(conv.get("title") or "Cuộc trò chuyện mới").strip())[:160]
        pinned = bool(conv.get("pinned", False))
        messages = conv.get("messages") if isinstance(conv.get("messages"), list) else []
        updated_at = int(conv.get("updatedAt") or int(time.time() * 1000))
        msgs_json = json.dumps(messages, ensure_ascii=False)

        if self._pg_ready and self.sql_engine is not None:
            try:
                with self.sql_engine.begin() as conn:
                    conn.execute(
                        sql_text(
                            """
                            INSERT INTO lexit_conversations (id, user_id, title, pinned, messages_json, updated_at)
                            VALUES (:id, :uid, :title, :pinned, :msgs, :updated_at)
                            ON CONFLICT (user_id, id) DO UPDATE SET
                                title = EXCLUDED.title,
                                pinned = EXCLUDED.pinned,
                                messages_json = EXCLUDED.messages_json,
                                updated_at = EXCLUDED.updated_at
                            """
                        ),
                        {
                            "id": cid,
                            "uid": uid,
                            "title": title,
                            "pinned": pinned,
                            "msgs": msgs_json,
                            "updated_at": updated_at,
                        },
                    )
            except Exception:
                pass

        saved_obj = {
            "id": cid,
            "title": title,
            "pinned": pinned,
            "messages": messages,
            "updatedAt": updated_at,
        }
        with self._lock:
            data = self._load_json()
            data.setdefault(uid, {})[cid] = saved_obj
            self._save_json(data)
        return saved_obj

    def delete_conversation(self, user_id: str, conv_id: str) -> bool:
        uid = str(user_id or "").strip()
        cid = str(conv_id or "").strip()
        if not uid or not cid:
            return False

        deleted = False
        if self._pg_ready and self.sql_engine is not None:
            try:
                with self.sql_engine.begin() as conn:
                    res = conn.execute(
                        sql_text("DELETE FROM lexit_conversations WHERE user_id = :uid AND id = :id"),
                        {"uid": uid, "id": cid},
                    )
                    deleted = bool(res.rowcount and res.rowcount > 0)
            except Exception:
                pass

        with self._lock:
            data = self._load_json()
            if cid in data.get(uid, {}):
                data[uid].pop(cid, None)
                self._save_json(data)
                deleted = True
        return deleted


class ContactInquiryStore:
    """Lưu trữ yêu cầu hỗ trợ / liên hệ thật vào PostgreSQL (fallback JSON)."""

    def __init__(self, sql_engine: Any = None, store_path: Path | None = None) -> None:
        self.sql_engine = sql_engine
        self.store_path = Path(store_path) if store_path else (DATA_DIR / ".inquiries_store.json")
        self._lock = threading.RLock()
        self._pg_ready = False
        if self.sql_engine is not None:
            try:
                ddl = sql_text(
                    """
                    CREATE TABLE IF NOT EXISTS lexit_inquiries (
                        id TEXT PRIMARY KEY,
                        full_name TEXT NOT NULL,
                        email TEXT NOT NULL,
                        phone TEXT NOT NULL DEFAULT '',
                        organization TEXT NOT NULL DEFAULT '',
                        topic TEXT NOT NULL DEFAULT '',
                        message TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                with self.sql_engine.begin() as conn:
                    conn.execute(ddl)
                self._pg_ready = True
            except Exception:
                self._pg_ready = False

    def submit_inquiry(
        self,
        full_name: str,
        email: str,
        message: str,
        phone: str = "",
        organization: str = "",
        topic: str = "Hỗ trợ pháp lý CNTT",
    ) -> dict[str, Any]:
        cleaned_name = unicodedata.normalize("NFC", (full_name or "").strip())
        norm_email = _norm_email(email)
        cleaned_msg = unicodedata.normalize("NFC", (message or "").strip())
        if len(cleaned_name) < 2:
            raise ValueError("Họ tên cần tối thiểu 2 ký tự.")
        if not _EMAIL_RE.match(norm_email):
            raise ValueError("Địa chỉ email không hợp lệ.")
        if len(cleaned_msg) < 10:
            raise ValueError("Nội dung liên hệ cần tối thiểu 10 ký tự.")

        record = {
            "id": f"inq-{uuid.uuid4().hex[:12]}",
            "full_name": cleaned_name,
            "email": norm_email,
            "phone": (phone or "").strip()[:32],
            "organization": unicodedata.normalize("NFC", (organization or "").strip())[:160],
            "topic": unicodedata.normalize("NFC", (topic or "Hỗ trợ pháp lý CNTT").strip())[:100],
            "message": cleaned_msg[:4000],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        if self._pg_ready and self.sql_engine is not None:
            try:
                with self.sql_engine.begin() as conn:
                    conn.execute(
                        sql_text(
                            """
                            INSERT INTO lexit_inquiries (
                                id, full_name, email, phone, organization, topic, message, created_at
                            ) VALUES (
                                :id, :full_name, :email, :phone, :organization, :topic, :message, :created_at
                            )
                            """
                        ),
                        record,
                    )
            except Exception:
                pass

        with self._lock:
            existing: list[dict[str, Any]] = []
            if self.store_path.exists():
                try:
                    loaded = json.loads(self.store_path.read_text(encoding="utf-8"))
                    if isinstance(loaded, list):
                        existing = loaded
                except Exception:
                    existing = []
            existing.append(record)
            self.store_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.store_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(self.store_path)

        return {
            "ok": True,
            "id": record["id"],
            "created_at": record["created_at"],
            "message": "Đã tiếp nhận yêu cầu hỗ trợ thành công. Chúng tôi sẽ phản hồi qua email của bạn.",
        }
