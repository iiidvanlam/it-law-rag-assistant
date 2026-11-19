"""Unit & API contract tests for real SMTP Email OTP registration and password reset."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import HTTPException
import main
from workspace_tools import AuthManager, OtpCooldownError, send_otp_email


class AuthOtpManagerTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.store_path = Path(self._tmp.name) / "users.json"
        self.auth = AuthManager(sql_engine=None, store_path=self.store_path, secret_key="otp-test-secret")
        self.sent_codes: list[tuple[str, str, str]] = []

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _capture_sender(self, email: str, code: str, purpose: str, _ttl: int) -> str:
        self.sent_codes.append((email, purpose, code))
        return "smtp"

    def test_unconfigured_smtp_raises_error_no_dev_preview(self) -> None:
        with patch.dict("os.environ", {"SMTP_HOST": "", "SMTP_USER": "", "SMTP_PASSWORD": ""}):
            with self.assertRaisesRegex(RuntimeError, "chưa cấu hình SMTP"):
                self.auth.request_otp("real.user@lexit.vn", purpose="register", now_ts=1_000)

        # Ensure failed SMTP rolls back OTP record cleanly
        store_data = json.loads(self.store_path.read_text(encoding="utf-8"))
        self.assertNotIn("register:real.user@lexit.vn", store_data.get("otps", {}))

    def test_register_otp_full_lifecycle_and_single_use(self) -> None:
        otp_res = self.auth.request_otp(
            "New.User@LexIT.vn ",
            purpose="register",
            email_sender=self._capture_sender,
            now_ts=1_000,
        )

        self.assertTrue(otp_res["ok"])
        self.assertEqual(otp_res["email"], "new.user@lexit.vn")
        self.assertEqual(otp_res["delivery_channel"], "smtp")
        self.assertNotIn("dev_otp_code", otp_res)

        code = self.sent_codes[-1][2]
        self.assertRegex(code, r"^\d{6}$")

        # Never persist plaintext OTP code in store
        raw_store = self.store_path.read_text(encoding="utf-8")
        self.assertNotIn(code, raw_store)

        user, token = self.auth.register_with_otp(
            email="new.user@lexit.vn",
            otp_code=code,
            password="StrongPass@123",
            full_name="Nguyễn Minh Quân",
            role="Luật sư CNTT",
            organization="LexIT Lab",
            now_ts=1_045,
        )
        self.assertEqual(user["email"], "new.user@lexit.vn")
        self.assertEqual(user["preferences"].get("email_verified"), True)
        self.assertEqual(self.auth.verify_access_token(token)["id"], user["id"])

        # OTP was consumed and email is now registered
        store_data = json.loads(self.store_path.read_text(encoding="utf-8"))
        self.assertNotIn("register:new.user@lexit.vn", store_data.get("otps", {}))
        with self.assertRaises(ValueError):
            self.auth.request_otp(
                "new.user@lexit.vn",
                purpose="register",
                email_sender=self._capture_sender,
                now_ts=2_000,
            )

    def test_otp_resend_cooldown_and_expiry(self) -> None:
        first = self.auth.request_otp(
            "cooldown@lexit.vn",
            purpose="register",
            email_sender=self._capture_sender,
            now_ts=5_000,
        )
        with self.assertRaises(OtpCooldownError) as ctx:
            self.auth.request_otp(
                "cooldown@lexit.vn",
                purpose="register",
                email_sender=self._capture_sender,
                now_ts=5_025,
            )
        self.assertEqual(ctx.exception.retry_after_seconds, 35)

        self.auth.request_otp(
            "cooldown@lexit.vn",
            purpose="register",
            email_sender=self._capture_sender,
            now_ts=5_060,
        )
        second_code = self.sent_codes[-1][2]
        self.assertRegex(second_code, r"^\d{6}$")

        with self.assertRaisesRegex(ValueError, "hết hạn"):
            self.auth.register_with_otp(
                email="cooldown@lexit.vn",
                otp_code=second_code,
                password="StrongPass@123",
                full_name="Tester",
                now_ts=5_060 + 301,
            )
        self.assertTrue(first["ok"])

    def test_otp_max_attempts_lockout(self) -> None:
        self.auth.request_otp(
            "lockout@lexit.vn",
            purpose="register",
            email_sender=self._capture_sender,
            now_ts=10_000,
        )
        real_code = self.sent_codes[-1][2]
        wrong_code = "000000" if real_code != "000000" else "999999"

        for expected_remaining in (4, 3, 2, 1):
            with self.assertRaisesRegex(ValueError, f"còn {expected_remaining} lần thử"):
                self.auth.register_with_otp(
                    email="lockout@lexit.vn",
                    otp_code=wrong_code,
                    password="StrongPass@123",
                    full_name="Lockout User",
                    now_ts=10_010,
                )

        with self.assertRaisesRegex(ValueError, "bị khóa sau 5 lần thử"):
            self.auth.register_with_otp(
                email="lockout@lexit.vn",
                otp_code=wrong_code,
                password="StrongPass@123",
                full_name="Lockout User",
                now_ts=10_015,
            )

        with self.assertRaisesRegex(ValueError, "không tồn tại"):
            self.auth.register_with_otp(
                email="lockout@lexit.vn",
                otp_code=real_code,
                password="StrongPass@123",
                full_name="Lockout User",
                now_ts=10_020,
            )

    def test_reset_password_with_otp_updates_password(self) -> None:
        self.auth.register_user("reset@lexit.vn", "OldPass@123", "Người Dùng Reset")

        with self.assertRaisesRegex(ValueError, "Không tìm thấy tài khoản"):
            self.auth.request_otp(
                "missing@lexit.vn",
                purpose="reset_password",
                email_sender=self._capture_sender,
                now_ts=20_000,
            )

        self.auth.request_otp(
            "reset@lexit.vn",
            purpose="reset_password",
            email_sender=self._capture_sender,
            now_ts=20_000,
        )
        reset_code = self.sent_codes[-1][2]

        reset_res = self.auth.reset_password_with_otp(
            email="reset@lexit.vn",
            otp_code=reset_code,
            new_password="NewStrongPass@456",
            now_ts=20_030,
        )
        self.assertTrue(reset_res["ok"])

        with self.assertRaises(ValueError):
            self.auth.login_user("reset@lexit.vn", "OldPass@123")
        user, _ = self.auth.login_user("reset@lexit.vn", "NewStrongPass@456")
        self.assertEqual(user["email"], "reset@lexit.vn")

    def test_smtp_delivery_sends_tls_message(self) -> None:
        mock_smtp = MagicMock()
        mock_cm = MagicMock()
        mock_cm.__enter__.return_value = mock_smtp

        env = {
            "SMTP_HOST": "smtp.example.com",
            "SMTP_PORT": "587",
            "SMTP_USER": "noreply@lexit.vn",
            "SMTP_PASSWORD": "app-password-16",
            "SMTP_FROM": "LexIT <noreply@lexit.vn>",
        }
        with patch.dict("os.environ", env), patch("workspace_tools.smtplib.SMTP", return_value=mock_cm):
            channel = send_otp_email("user@lexit.vn", "123456", "register")
            self.assertEqual(channel, "smtp")
            mock_smtp.starttls.assert_called_once()
            mock_smtp.login.assert_called_once_with("noreply@lexit.vn", "app-password-16")
            mock_smtp.send_message.assert_called_once()


class AuthOtpRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.auth = AuthManager(
            sql_engine=None,
            store_path=Path(self._tmp.name) / "route_users.json",
            secret_key="route-otp-secret",
        )

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_otp_fastapi_routes_end_to_end(self) -> None:
        captured: list[str] = []

        def fake_smtp_send(_email: str, code: str, _purpose: str, _ttl: int) -> str:
            captured.append(code)
            return "smtp"

        with patch.object(main, "_get_auth_manager", return_value=self.auth):
            # Without SMTP configured -> HTTP 503
            with patch.dict("os.environ", {"SMTP_HOST": "", "SMTP_USER": "", "SMTP_PASSWORD": ""}):
                with self.assertRaises(HTTPException) as err503:
                    main.auth_request_otp(
                        main.AuthOtpRequest(email="api.otp@lexit.vn", purpose="register")
                    )
                self.assertEqual(err503.exception.status_code, 503)

            with patch("workspace_tools.send_otp_email", side_effect=fake_smtp_send):
                otp_resp = main.auth_request_otp(
                    main.AuthOtpRequest(email="api.otp@lexit.vn", purpose="register")
                )
                self.assertTrue(otp_resp["ok"])
                self.assertEqual(otp_resp["delivery_channel"], "smtp")
                self.assertNotIn("dev_otp_code", otp_resp)

                # Immediate second call hits 429 cooldown
                with self.assertRaises(HTTPException) as cooldown_err:
                    main.auth_request_otp(
                        main.AuthOtpRequest(email="api.otp@lexit.vn", purpose="register")
                    )
                self.assertEqual(cooldown_err.exception.status_code, 429)
                self.assertIn("Retry-After", cooldown_err.exception.headers)

                reg_resp = main.auth_register_verify_otp(
                    main.AuthRegisterVerifyOtpRequest(
                        email="api.otp@lexit.vn",
                        otp_code=captured[-1],
                        password="OtpPassword@1",
                        full_name="Phạm Minh Tâm",
                    )
                )
                self.assertEqual(reg_resp["user"]["email"], "api.otp@lexit.vn")
                self.assertTrue(reg_resp["access_token"])

                main.auth_request_otp(
                    main.AuthOtpRequest(email="api.otp@lexit.vn", purpose="reset_password")
                )
                reset_done = main.auth_password_reset(
                    main.AuthPasswordResetRequest(
                        email="api.otp@lexit.vn",
                        otp_code=captured[-1],
                        new_password="BrandNewPassword@2",
                    )
                )
                self.assertTrue(reset_done["ok"])

                login_resp = main.auth_login(
                    main.AuthLoginRequest(email="api.otp@lexit.vn", password="BrandNewPassword@2")
                )
                self.assertEqual(login_resp["user"]["email"], "api.otp@lexit.vn")


if __name__ == "__main__":
    unittest.main()
