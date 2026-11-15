"""Bộ kiểm thử 30 ca đời thực (Batch 20 & Real-World QA Overhaul).

Bao gồm:
- 15 ca Phủ định (Negative / Out-of-Scope / Trivia):
  Đất đai, hôn nhân, lao động, giao thông thuần túy, thủ thuật sửa máy tính, chuyện phiếm...
  Khẳng định 100% kích hoạt IRRELEVANT_QUERY_GUARDRAIL hoặc OUT_OF_SCOPE_GUARDRAIL, cấm tư vấn pháp luật CNTT hoặc tính phạt tiền.
- 15 ca Khẳng định Thực tế Đời thường (Positive / Real-World IT Law):
  Hỏi tự nhiên về lừa đảo Telegram/OTP, bán thông tin khách hàng, SIM rác, xúc phạm trên Facebook/TikTok,
  phát tán mã độc, deepfake AI, email spam, không gỡ bỏ nội dung...
  Khẳng định 100% lọt qua Guardrail, nhận diện đúng căn cứ pháp lý và không bị rỗng/ảo giác.
"""

from __future__ import annotations

import unittest
from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from main import ChatRequest, _has_domain_relevance, _prepare_retrieval_bundle
from legal_rules import analyze_question


NEGATIVE_QUERIES = [
    "Tôi mới mua đất bằng giấy tay có hợp pháp không?",
    "Công ty tôi sa thải nhân viên đang mang thai bị phạt bao nhiêu?",
    "Em vượt đèn đỏ không đội mũ bảo hiểm phạt bao nhiêu?",
    "Vợ chồng ly hôn chia tài sản thế nào?",
    "Tôi buồn quá hôm nay ăn gì?",
    "Máy tính em bị màn hình xanh cài lại Win sao ạ?",
    "Điểm chuẩn ngành CNTT năm nay bao nhiêu?",
    "Thủ tục cấp sổ đỏ lần đầu cần giấy tờ gì?",
    "Mức đóng bảo hiểm xã hội tự nguyện là bao nhiêu?",
    "Hôm nay trời nắng hay mưa?",
    "Cách nấu món canh chua cá lóc ngon?",
    "Tách thửa đất nông nghiệp ở Bình Dương cần điều kiện gì?",
    "Thủ tục làm giấy khai sinh cho con muộn bị phạt thế nào?",
    "Mua laptop nào tốt cho sinh viên kinh tế?",
    "Quyền nuôi con dưới 36 tháng tuổi khi ly hôn thuộc về ai?",
]

REAL_WORLD_IT_QUERIES = [
    (
        "Bị lừa đảo chiếm đoạt tiền qua nhóm Telegram làm nhiệm vụ thì xử lý thế nào?",
        {"100/2015/QH13", "174/2026/NĐ-CP", "116/2025/QH15", "BLHS", "290", "174"},
    ),
    (
        "Lập tài khoản Facebook giả danh người khác đi vay tiền bị phạt bao nhiêu?",
        {"174/2026/NĐ-CP", "15/2020/NĐ-CP", "100/2015/QH13", "95", "101", "BLHS"},
    ),
    (
        "Nhân viên công ty tự ý lấy số điện thoại khách hàng bán cho bên khác có vi phạm không?",
        {"330/2026/NĐ-CP", "13/2023/NĐ-CP", "91/2025/QH15", "174/2026/NĐ-CP", "50", "84"},
    ),
    (
        "Phát tán tin nhắn quảng cáo rác qua SMS bị phạt bao nhiêu tiền?",
        {"174/2026/NĐ-CP", "15/2020/NĐ-CP", "89", "94"},
    ),
    (
        "Dùng AI cắt ghép khuôn mặt người khác đăng lên TikTok xúc phạm danh dự thì bị tội gì?",
        {"100/2015/QH13", "174/2026/NĐ-CP", "155", "156", "95", "101", "BLHS"},
    ),
    (
        "Bán SIM rác kích hoạt sẵn thông tin thuê bao bị phạt bao nhiêu?",
        {"174/2026/NĐ-CP", "15/2020/NĐ-CP", "32"},
    ),
    (
        "Tấn công DDoS làm sập website bán hàng của đối thủ có bị đi tù không?",
        {"100/2015/QH13", "116/2025/QH15", "287", "BLHS"},
    ),
    (
        "Đăng bài sai sự thật lên trang cá nhân mạng xã hội bị phạt thế nào?",
        {"174/2026/NĐ-CP", "15/2020/NĐ-CP", "95", "101"},
    ),
    (
        "Bình luận xúc phạm uy tín của cơ quan nhà nước trên Facebook bị phạt bao nhiêu?",
        {"174/2026/NĐ-CP", "15/2020/NĐ-CP", "95", "101"},
    ),
    (
        "Gửi email spam quảng cáo không có sự đồng ý của người nhận bị xử lý ra sao?",
        {"174/2026/NĐ-CP", "15/2020/NĐ-CP", "89"},
    ),
    (
        "Phát tán mã độc virus chiếm quyền điều khiển máy tính của người khác bị tội gì?",
        {"100/2015/QH13", "116/2025/QH15", "286", "BLHS"},
    ),
    (
        "Chiếm đoạt tài khoản ngân hàng bằng link lừa đảo mã OTP bị xử lý hình sự thế nào?",
        {"100/2015/QH13", "290", "BLHS"},
    ),
    (
        "Cung cấp trò chơi điện tử G1 trên mạng không có giấy phép bị phạt bao nhiêu?",
        {"174/2026/NĐ-CP", "15/2020/NĐ-CP", "98", "103"},
    ),
    (
        "Không gỡ bỏ thông tin vi phạm pháp luật theo yêu cầu của cơ quan có thẩm quyền bị phạt thế nào?",
        {"174/2026/NĐ-CP", "15/2020/NĐ-CP", "94", "100"},
    ),
    (
        "Tiết lộ bí mật đời tư của người khác trên mạng xã hội bị phạt bao nhiêu?",
        {"174/2026/NĐ-CP", "15/2020/NĐ-CP", "95", "101"},
    ),
]


class RealWorldNegativeQueriesTests(unittest.TestCase):
    """Kiểm thử 15 ca ngoài lề / ngoài phạm vi pháp luật CNTT."""

    def test_negative_queries_are_not_domain_relevant(self):
        for q in NEGATIVE_QUERIES:
            with self.subTest(query=q):
                facts = analyze_question(q)
                self.assertFalse(
                    _has_domain_relevance(q, facts),
                    f"Câu hỏi ngoài lề '{q}' không được nhận diện là domain-relevant",
                )

    def test_negative_queries_trigger_guardrail_early_response(self):
        for q in NEGATIVE_QUERIES:
            with self.subTest(query=q):
                req = ChatRequest(question=q)
                bundle = _prepare_retrieval_bundle(req)
                self.assertIsNotNone(
                    bundle.get("early_response"),
                    f"Câu hỏi ngoài lề '{q}' phải kích hoạt early_response",
                )
                early = bundle["early_response"]
                rule_names = [s.get("rule") for s in early.get("symbolic_reasoning", {}).get("rule_steps", [])]
                self.assertTrue(
                    any(r in {"IRRELEVANT_QUERY_GUARDRAIL", "OUT_OF_SCOPE_GUARDRAIL"} for r in rule_names),
                    f"Câu hỏi '{q}' kích hoạt rule không đúng: {rule_names}",
                )
                self.assertIn("THÔNG BÁO PHẠM VI TƯ VẤN", early["answer"])


class RealWorldPositiveQueriesTests(unittest.TestCase):
    """Kiểm thử 15 ca đời thực trong phạm vi pháp luật CNTT."""

    def test_positive_queries_are_domain_relevant(self):
        for q, _ in REAL_WORLD_IT_QUERIES:
            with self.subTest(query=q):
                facts = analyze_question(q)
                self.assertTrue(
                    _has_domain_relevance(q, facts),
                    f"Câu hỏi pháp luật CNTT '{q}' phải được nhận diện là domain-relevant",
                )

    def test_positive_queries_pass_guardrail_and_retrieve_basis(self):
        for q, expected_tokens in REAL_WORLD_IT_QUERIES:
            with self.subTest(query=q):
                req = ChatRequest(question=q)
                bundle = _prepare_retrieval_bundle(req)
                # Không được bị chặn bởi IRRELEVANT_QUERY_GUARDRAIL hoặc OUT_OF_SCOPE_GUARDRAIL
                if bundle.get("early_response"):
                    rule_names = [s.get("rule") for s in bundle["early_response"].get("symbolic_reasoning", {}).get("rule_steps", [])]
                    self.assertNotIn(
                        "IRRELEVANT_QUERY_GUARDRAIL",
                        rule_names,
                        f"Câu hỏi '{q}' bị chặn nhầm bởi IRRELEVANT_QUERY_GUARDRAIL",
                    )
                    self.assertNotIn(
                        "OUT_OF_SCOPE_GUARDRAIL",
                        rule_names,
                        f"Câu hỏi '{q}' bị chặn nhầm bởi OUT_OF_SCOPE_GUARDRAIL",
                    )

                # Kiểm tra có trích xuất căn cứ pháp lý hoặc hành vi xử phạt
                reasoning = bundle.get("symbolic_reasoning") or bundle.get("early_response", {}).get("symbolic_reasoning", {})
                matched_actions = reasoning.get("matched_actions", [])
                penalty_calcs = reasoning.get("penalty_calculations", [])
                rule_steps = reasoning.get("rule_steps", [])

                has_evidence = bool(matched_actions or penalty_calcs or rule_steps or bundle.get("sources"))
                self.assertTrue(
                    has_evidence,
                    f"Câu hỏi đời thực '{q}' không thu thập được căn cứ hoặc hành vi xử lý",
                )

                # Kiểm tra văn bản hoặc số điều dự kiến xuất hiện trong căn cứ
                found_text = " ".join([
                    str(matched_actions),
                    str(penalty_calcs),
                    str(rule_steps),
                    str(bundle.get("sources", [])),
                    str(bundle.get("hybrid_prompt_text", "")),
                ])
                matches = [tok for tok in expected_tokens if tok in found_text]
                self.assertTrue(
                    bool(matches),
                    f"Câu hỏi '{q}' không khớp bất kỳ token căn cứ mong đợi nào {expected_tokens} trong: {found_text[:200]}",
                )


if __name__ == "__main__":
    unittest.main()
