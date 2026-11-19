"""Unit & API contract tests for Auth/Profile, Follow-up Suggestions, Precedents,
Full-Text Article Drawer, IT Compliance Review, and Legal Drafting Wizards.
"""

from __future__ import annotations

import base64
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import HTTPException
import main
from workspace_tools import (
    AuthManager,
    DRAFT_TEMPLATES_CATALOG,
    extract_document_text_from_base64,
    generate_legal_draft,
    generate_suggested_followups,
    get_article_detail_with_history,
    match_precedents_for_articles,
    review_it_compliance_document,
    search_precedents_catalog,
)


class AuthManagerTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.store_path = Path(self._tmp.name) / "users.json"
        self.auth = AuthManager(sql_engine=None, store_path=self.store_path, secret_key="test-secret-lexit")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_no_seeded_demo_account_exists(self) -> None:
        with self.assertRaises(ValueError):
            self.auth.login_user("demo@lexit.vn", "LexIT@2026")
        self.assertFalse(hasattr(self.auth, "login_with_google_demo"))

    def test_register_duplicate_and_profile_update(self) -> None:
        user, token = self.auth.register_user(
            email="Lawyer@Company.VN ",
            password="StrongPass123",
            full_name="Nguyễn An",
            role="Luật sư CNTT",
            organization="Hãng Luật A",
        )
        self.assertEqual(user["email"], "lawyer@company.vn")
        self.assertEqual(user["credits"], 100)

        with self.assertRaises(ValueError):
            self.auth.register_user("lawyer@company.vn", "AnotherPass1", "Trùng Email")

        with self.assertRaises(ValueError):
            self.auth.login_user("lawyer@company.vn", "WrongPass")

        self.assertIsNone(self.auth.verify_access_token(token + "tampered"))

        updated = self.auth.update_profile(
            user["id"],
            full_name="Nguyễn An Updated",
            role="DPO / An toàn thông tin",
            organization="Tập đoàn B",
        )
        self.assertIsNotNone(updated)
        self.assertEqual(updated["full_name"], "Nguyễn An Updated")
        self.assertEqual(updated["role"], "DPO / An toàn thông tin")
        self.assertEqual(updated["organization"], "Tập đoàn B")

    def test_change_password_validates_current_and_persists(self) -> None:
        user, _ = self.auth.register_user("pw.change@lexit.vn", "Initial@123", "Nguyễn Minh")
        with self.assertRaises(ValueError):
            self.auth.change_password(user["id"], "WrongCurrent", "Updated@456")

        res = self.auth.change_password(user["id"], "Initial@123", "Updated@456")
        self.assertTrue(res["ok"])
        with self.assertRaises(ValueError):
            self.auth.login_user("pw.change@lexit.vn", "Initial@123")
        logged_in, _ = self.auth.login_user("pw.change@lexit.vn", "Updated@456")
        self.assertEqual(logged_in["id"], user["id"])

    def test_google_oauth_token_login_and_validation(self) -> None:
        with self.assertRaises(RuntimeError):
            self.auth.login_with_google_token("dummy.jwt.token", client_id="")

        fake_claims = {
            "sub": "109876543210987654321",
            "email": "RealUser@Gmail.com",
            "email_verified": True,
            "name": "Người Dùng Thật",
            "picture": "https://lh3.googleusercontent.com/a/avatar-test",
            "hd": "lexit.vn",
        }
        user1, token1 = self.auth.login_with_google_token(
            "valid.id.token.string",
            client_id="client-123.apps.googleusercontent.com",
            verifier=lambda tok, cid: fake_claims,
        )
        self.assertEqual(user1["email"], "realuser@gmail.com")
        self.assertEqual(user1["auth_provider"], "google")
        self.assertEqual(user1["credits"], 250)
        self.assertEqual(user1["organization"], "lexit.vn")
        self.assertEqual(
            user1["preferences"]["avatar_url"],
            "https://lh3.googleusercontent.com/a/avatar-test",
        )
        self.assertEqual(self.auth.verify_access_token(token1)["id"], user1["id"])

        # Re-login with updated Google picture updates profile in-place without duplicating user
        updated_claims = {**fake_claims, "picture": "https://lh3.googleusercontent.com/a/avatar-v2"}
        user2, _ = self.auth.login_with_google_token(
            "valid.id.token.string.v2",
            client_id="client-123.apps.googleusercontent.com",
            verifier=lambda tok, cid: updated_claims,
        )
        self.assertEqual(user2["id"], user1["id"])
        self.assertEqual(
            user2["preferences"]["avatar_url"],
            "https://lh3.googleusercontent.com/a/avatar-v2",
        )

        # Unverified email must be rejected
        with self.assertRaises(ValueError):
            self.auth.login_with_google_token(
                "unverified.id.token",
                client_id="client-123.apps.googleusercontent.com",
                verifier=lambda tok, cid: {**fake_claims, "email_verified": False},
            )


class FollowupAndPrecedentTests(unittest.TestCase):
    def test_followups_for_guardrail_and_normal_reasoning(self) -> None:
        blocked = generate_suggested_followups(
            "Mua đất giấy tay?",
            {"guardrail_blocked": True, "facts": {}},
            [],
        )
        self.assertEqual(len(blocked), 3)

        normal = generate_suggested_followups(
            "Cá nhân đăng tin sai sự thật trên mạng xã hội phạt bao nhiêu?",
            {
                "guardrail_blocked": False,
                "facts": {"subjects": ["INDIVIDUAL"], "age_band": None},
                "matched_precedents": [{"id": "PREC-SNS-2024-HP"}],
            },
            [{"source_id": "STATUTE:15/2020/NĐ-CP:article:101", "title": "Nghị định 15/2020/NĐ-CP"}],
        )
        self.assertGreaterEqual(len(normal), 2)
        self.assertLessEqual(len(normal), 4)
        self.assertTrue(any("tổ chức" in q.lower() for q in normal))

    def test_precedents_search_and_article_matching(self) -> None:
        all_items = search_precedents_catalog(limit=20)
        self.assertEqual(len(all_items), 8)

        ransomware = search_precedents_catalog(query="ransomware mã độc")
        self.assertGreaterEqual(len(ransomware), 1)
        self.assertEqual(ransomware[0]["id"], "PREC-286-2022-HN")

        matched = match_precedents_for_articles([("15/2020/NĐ-CP", "101"), ("174/2026/NĐ-CP", "95")])
        self.assertGreaterEqual(len(matched), 1)
        self.assertEqual(matched[0]["id"], "PREC-SNS-2024-HP")


class ArticleDetailAndComplianceTests(unittest.TestCase):
    def test_article_detail_transitions_and_temporal_badges(self) -> None:
        old_view = get_article_detail_with_history(
            doc_code="15/2020/NĐ-CP",
            article_number="101",
            as_of="2026-06-30",
        )
        self.assertEqual(old_view["doc_code"], "15/2020/NĐ-CP")
        self.assertIsNotNone(old_view["transition"])
        self.assertEqual(old_view["transition"]["successor_doc"], "174/2026/NĐ-CP")
        self.assertEqual(old_view["transition"]["successor_article"], "95")
        self.assertEqual(old_view["status_badge"], "ACTIVE")

        expired_view = get_article_detail_with_history(
            doc_code="15/2020/NĐ-CP",
            article_number="101",
            as_of="2026-11-02",
        )
        self.assertEqual(expired_view["status_badge"], "EXPIRED")

        upcoming_view = get_article_detail_with_history(
            doc_code="174/2026/NĐ-CP",
            article_number="95",
            as_of="2026-06-30",
        )
        self.assertEqual(upcoming_view["status_badge"], "UPCOMING")
        self.assertEqual(upcoming_view["transition"]["predecessor_doc"], "15/2020/NĐ-CP")

    def test_compliance_review_high_vs_low_and_penalty_rules(self) -> None:
        weak_policy = "Chúng tôi thu thập số điện thoại người dùng để gửi tin nhắn quảng cáo khuyến mãi."
        penalty_stub = {("330/2026/NĐ-CP", "50"): {"min_amount": 50_000_000, "max_amount": 70_000_000}}
        res_weak = review_it_compliance_document(
            document_text=weak_policy,
            doc_type="PRIVACY_POLICY",
            subject="INDIVIDUAL",
            as_of="2026-11-02",
            penalty_lookup=penalty_stub,
        )
        self.assertEqual(res_weak["risk_level"], "HIGH")
        self.assertLess(res_weak["compliance_score"], 50)
        f0 = next(f for f in res_weak["findings"] if f["referenced_statute"] == "330/2026/NĐ-CP Điều 50")
        self.assertIsNotNone(f0["calculated_penalty"])
        self.assertEqual(f0["calculated_penalty"]["min_amount"], 25_000_000)

        strong_policy = (
            "Chính sách bảo mật: Chúng tôi thu thập dữ liệu cá nhân dựa trên sự đồng ý của chủ thể dữ liệu, "
            "nêu rõ mục đích xử lý, loại dữ liệu và cam kết không mua bán dữ liệu cá nhân. "
            "Khi có sự cố dữ liệu hoặc vi phạm bảo mật, chúng tôi thông báo trong 72 giờ tới Bộ Công an. "
            "Chủ thể dữ liệu có quyền truy cập, chỉnh sửa dữ liệu, xóa dữ liệu và rút lại sự đồng ý. "
            "Khi chuyển dữ liệu ra nước ngoài, chúng tôi lập hồ sơ đánh giá tác động DPIA. "
            "Email tiếp thị luôn có cơ chế từ chối nhận quảng cáo (opt-out) tránh tin nhắn rác. "
            "Các giao dịch xác nhận bằng thông điệp dữ liệu và chữ ký điện tử bảo đảm toàn vẹn dữ liệu. "
            "Hệ thống áp dụng mã hóa, kiểm soát truy cập, sao lưu an toàn thông tin, "
            "và phối hợp cơ quan chức năng gỡ bỏ nội dung vi phạm trong 24 giờ."
        )
        res_strong = review_it_compliance_document(
            document_text=strong_policy,
            doc_type="PRIVACY_POLICY",
            subject="ORGANIZATION",
            as_of="2026-06-30",
        )
        self.assertEqual(res_strong["risk_level"], "LOW")
        self.assertGreaterEqual(res_strong["compliance_score"], 85)

    def test_extract_txt_from_base64(self) -> None:
        sample = "Điều khoản bảo vệ dữ liệu cá nhân trên ứng dụng."
        b64 = base64.b64encode(sample.encode("utf-8")).decode("ascii")
        self.assertEqual(extract_document_text_from_base64("policy.txt", b64), sample)

    def test_legal_draft_all_5_templates(self) -> None:
        for tpl in DRAFT_TEMPLATES_CATALOG:
            res = generate_legal_draft(
                template_type=tpl,
                party_a="Công ty Demo A",
                party_b="Cục An ninh mạng",
                incident_or_scope="Kiểm thử khởi tạo mẫu văn bản pháp lý",
                as_of="2026-11-02",
                language="en" if tpl == "DATA_BREACH_72H" else "vi",
            )
            self.assertEqual(res["template_type"], tpl)
            self.assertGreater(len(res["draft_markdown"]), 100)
            self.assertTrue(len(res["cited_statutes"]) >= 2)


class WorkspaceApiEndpointsTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.test_auth = AuthManager(
            sql_engine=None,
            store_path=Path(self._tmp.name) / "api_users.json",
            secret_key="api-test-secret",
        )
        self._auth_patch = patch.object(main, "_get_auth_manager", return_value=self.test_auth)
        self._sql_patch = patch.object(main, "_sql_engine", None)
        self._neo4j_patch = patch.object(main, "neo4j_driver", None)
        self._auth_patch.start()
        self._sql_patch.start()
        self._neo4j_patch.start()

    def tearDown(self) -> None:
        self._neo4j_patch.stop()
        self._sql_patch.stop()
        self._auth_patch.stop()
        self._tmp.cleanup()

    def test_workspace_routes_registered(self) -> None:
        paths = {getattr(r, "path", None) for r in main.app.routes}
        expected = {
            "/auth/register",
            "/auth/otp/request",
            "/auth/register/verify-otp",
            "/auth/password/reset",
            "/auth/change-password",
            "/auth/login",
            "/auth/google",
            "/auth/google-config",
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
        self.assertTrue(expected.issubset(paths))
        self.assertNotIn("/auth/google-demo", paths)

    def test_auth_and_profile_endpoints(self) -> None:
        reg = main.auth_register(
            main.AuthRegisterRequest(
                email="tester@lexit.vn",
                password="Password123",
                full_name="Tester LexIT",
                role="Chuyên viên Pháp chế CNTT",
                organization="Org A",
            )
        )
        token = reg["access_token"]
        self.assertEqual(reg["user"]["email"], "tester@lexit.vn")

        with self.assertRaises(HTTPException) as cm:
            main.auth_me(x_user_token=None)
        self.assertEqual(cm.exception.status_code, 401)

        me = main.auth_me(x_user_token=token)
        self.assertEqual(me["user"]["email"], "tester@lexit.vn")

        upd = main.auth_update_profile(
            main.AuthProfileUpdateRequest(organization="Org B"),
            x_user_token=token,
        )
        self.assertEqual(upd["user"]["organization"], "Org B")

        chg = main.auth_change_password(
            main.AuthChangePasswordRequest(current_password="Password123", new_password="Password456!"),
            x_user_token=token,
        )
        self.assertTrue(chg["ok"])
        re_login = main.auth_login(main.AuthLoginRequest(email="tester@lexit.vn", password="Password456!"))
        self.assertEqual(re_login["user"]["email"], "tester@lexit.vn")

        with patch.dict("os.environ", {"GOOGLE_CLIENT_ID": ""}):
            cfg_off = main.auth_google_config()
            self.assertFalse(cfg_off["enabled"])
            with self.assertRaises(HTTPException) as cm503:
                main.auth_google(main.GoogleTokenLoginRequest(credential="dummy.jwt.token.payload.12345"))
            self.assertEqual(cm503.exception.status_code, 503)

        with patch.dict("os.environ", {"GOOGLE_CLIENT_ID": "test-cid.apps.googleusercontent.com"}):
            cfg_on = main.auth_google_config()
            self.assertTrue(cfg_on["enabled"])
            self.assertEqual(cfg_on["client_id"], "test-cid.apps.googleusercontent.com")

            with patch("workspace_tools.verify_google_id_token", side_effect=ValueError("bad sig")):
                with self.assertRaises(HTTPException) as cm401:
                    main.auth_google(main.GoogleTokenLoginRequest(credential="invalid.jwt.token.payload.12345"))
                self.assertEqual(cm401.exception.status_code, 401)

            with patch(
                "workspace_tools.verify_google_id_token",
                return_value={
                    "sub": "google-sub-999",
                    "email": "oauth.user@gmail.com",
                    "email_verified": True,
                    "name": "OAuth Google User",
                    "picture": "https://example.com/p.png",
                },
            ):
                gg_real = main.auth_google(
                    main.GoogleTokenLoginRequest(credential="valid.jwt.token.payload.1234567890")
                )
                self.assertEqual(gg_real["user"]["email"], "oauth.user@gmail.com")
                self.assertEqual(gg_real["user"]["auth_provider"], "google")
                self.assertIn("access_token", gg_real)

    def test_workspace_endpoints_contract(self) -> None:
        prec = main.search_precedents_endpoint(q="DDoS")
        self.assertGreaterEqual(prec["total"], 1)

        art = main.legal_article_detail_endpoint(
            doc_code="15/2020/NĐ-CP",
            article_number="101",
            as_of_date="2026-06-30",
        )
        self.assertEqual(art["status_badge"], "ACTIVE")

        comp = main.compliance_review_endpoint(
            main.ComplianceReviewRequest(
                document_text="Chính sách bảo mật thu thập thông tin cá nhân và gửi email marketing.",
                doc_type="PRIVACY_POLICY",
                subject="ORGANIZATION",
                use_llm=False,
            )
        )
        self.assertIn("compliance_score", comp)

        tpls = main.drafting_templates_endpoint()
        self.assertEqual(len(tpls["templates"]), 5)

        draft = main.drafting_generate_endpoint(
            main.LegalDraftRequest(
                template_type="PRIVACY_POLICY",
                party_a="Công ty Test",
                party_b="Người dùng",
                incident_or_scope="Ứng dụng di động TestApp",
                use_llm=False,
            )
        )
        self.assertIn("91/2025/QH15", draft["draft_markdown"])

        docs = main.legal_documents_search_endpoint(q="174/2026", doc_type="DECREE", as_of_date="2026-11-19")
        self.assertGreaterEqual(docs["total"], 1)
        self.assertEqual(docs["items"][0]["doc_code"], "174/2026/NĐ-CP")

        updates = main.legal_updates_endpoint(as_of_date="2026-11-19", limit=15)
        self.assertGreaterEqual(updates["total"], 10)

        stats = main.platform_stats_endpoint()
        self.assertGreaterEqual(stats["total_documents"], 35)
        self.assertEqual(stats["benchmark_cases"], 40)

        reg = main.auth_register(
            main.AuthRegisterRequest(
                email="conv.owner@lexit.vn",
                password="Password123!",
                full_name="Owner User",
            )
        )
        token = reg["access_token"]
        conv_store = main.ConversationStore(sql_engine=None, store_path=Path(self._tmp.name) / "convs.json")
        inq_store = main.ContactInquiryStore(sql_engine=None, store_path=Path(self._tmp.name) / "inqs.json")
        with patch.object(main, "_get_conversation_store", return_value=conv_store), patch.object(
            main, "_get_inquiry_store", return_value=inq_store
        ):
            saved = main.upsert_conversation_endpoint(
                "conv-real-1",
                main.ConversationUpsertRequest(
                    id="conv-real-1",
                    title="Tư vấn NĐ 174/2026",
                    pinned=True,
                    messages=[{"role": "user", "text": "Hỏi xử phạt MXH"}],
                ),
                x_user_token=token,
            )
            self.assertEqual(saved["conversation"]["title"], "Tư vấn NĐ 174/2026")
            listed = main.list_conversations_endpoint(x_user_token=token)
            self.assertEqual(len(listed["items"]), 1)
            deleted = main.delete_conversation_endpoint("conv-real-1", x_user_token=token)
            self.assertTrue(deleted["deleted"])

            inq = main.submit_contact_inquiry_endpoint(
                main.ContactInquiryRequest(
                    full_name="Trần Minh Anh",
                    email="minhanh@company.vn",
                    phone="0901234567",
                    organization="Công ty Tech VN",
                    topic="Tích hợp hệ thống pháp chế",
                    message="Cần hỗ trợ kết nối dữ liệu văn bản nội bộ doanh nghiệp.",
                )
            )
            self.assertTrue(inq["ok"])
            self.assertTrue(inq["id"].startswith("inq-"))


if __name__ == "__main__":
    unittest.main()
