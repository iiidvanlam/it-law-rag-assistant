"""Hậu kiểm Đầu ra Ký hiệu (Post-Generation Symbolic Output Verifier).

Chức năng:
Kiểm chứng câu trả lời do LLM sinh ra dựa trên Ground Truth của Symbolic Engine.
Phát hiện và trung hòa ảo giác về tiền phạt, chế tài với người chưa đủ tuổi chịu trách nhiệm,
và quy phạm cấm không có chế tài phạt tiền.
"""

from __future__ import annotations

import re
from typing import Any


_CURRENCY_FINE_PATTERN = re.compile(
    r"\b\d+(?:[.,]\d+)*\s*(?:(?:triệu|nghìn|ngàn|tỷ)(?:\s*(?:đồng|vnđ|vnd))?|đồng|vnđ|vnd)\b|\b\d{1,3}(?:[.,]\d{3})+\s*đ\b",
    re.IGNORECASE,
)


def _verify_and_guard_llm_output(answer: str, bundle: dict[str, Any]) -> str:
    """Hậu kiểm câu trả lời của LLM trước khi trả về cho người dùng."""
    if not answer or not isinstance(answer, str):
        return answer

    symbolic = bundle.get("symbolic_reasoning") or {}
    rule_steps = symbolic.get("rule_steps") or []
    penalty_calcs = symbolic.get("penalty_calculations") or []
    sources = bundle.get("sources") or []

    # 1. Kiểm tra trường hợp Người chưa thành niên dưới 14 tuổi
    has_under_14 = any(s.get("rule") == "AGE_UNDER_14" for s in rule_steps)
    if has_under_14:
        # Người dưới 14 tuổi không bị xử phạt VPHC. Nếu LLM bịa tiền phạt, trung hòa ngay.
        if _CURRENCY_FINE_PATTERN.search(answer):
            under_14_notice = (
                "⚠️ **Căn cứ pháp lý về độ tuổi:** Theo Điều 5 Luật Xử lý vi phạm hành chính, "
                "người dưới 14 tuổi không bị xử phạt vi phạm hành chính (không áp dụng hình thức phạt tiền hay phạt cảnh cáo).\n\n"
            )
            sanitized = _CURRENCY_FINE_PATTERN.sub("[Không áp dụng phạt tiền]", answer)
            return under_14_notice + sanitized

    # 1b. Kiểm tra trường hợp Người từ đủ 14 đến dưới 16 tuổi (AGE_14_16 / AGE_14_16_WARNING)
    has_14_to_16 = any(s.get("rule") in {"AGE_14_16", "AGE_14_16_WARNING"} for s in rule_steps)
    if has_14_to_16 and not has_under_14:
        lower_ans = answer.lower()
        affirms_no_fine = (
            "không phạt tiền" in lower_ans
            or "không áp dụng hình thức phạt tiền" in lower_ans
            or "không bị phạt tiền" in lower_ans
            or "chỉ bị phạt cảnh cáo" in lower_ans
            or "chỉ phạt cảnh cáo" in lower_ans
            or "chỉ áp dụng hình thức cảnh cáo" in lower_ans
            or "chỉ áp dụng hình thức phạt cảnh cáo" in lower_ans
            or "cảnh cáo, không phạt tiền" in lower_ans
        )
        if _CURRENCY_FINE_PATTERN.search(answer) and not affirms_no_fine:
            warning_notice = (
                "⚠️ **Căn cứ pháp lý về độ tuổi:** Theo Điều 22 và Điều 134 Luật Xử lý vi phạm hành chính, "
                "người từ đủ 14 tuổi đến dưới 16 tuổi không bị áp dụng hình thức phạt tiền; "
                "nếu vi phạm do lỗi cố ý thì chỉ bị áp dụng hình thức xử phạt cảnh cáo.\n\n"
            )
            answer = warning_notice + _CURRENCY_FINE_PATTERN.sub("[Không áp dụng phạt tiền - chỉ phạt cảnh cáo nếu cố ý]", answer)

    # 2. Kiểm tra Quy phạm cấm / Không có chế tài tiền phạt
    has_criminal = any(
        str(s.get("rule", "")).startswith("CRIMINAL_STATUTORY")
        or s.get("rule") == "MULTI_HOP_CRIMINAL_ESCALATION"
        for s in rule_steps
    ) or any(bool(p.get("criminal_escalations")) for p in penalty_calcs)

    snippets_have_fine = any(
        _CURRENCY_FINE_PATTERN.search(s.get("snippet", "") or s.get("content", ""))
        for s in sources
    )

    if not penalty_calcs and not has_criminal and not snippets_have_fine:
        # Nếu không có tính phạt tất định, không có chuyển hóa hình sự và nguồn luật không có khung phạt,
        # LLM tự bịa số tiền phạt VNĐ thì trung hòa số tiền bịa đặt đó
        if _CURRENCY_FINE_PATTERN.search(answer):
            answer = _CURRENCY_FINE_PATTERN.sub("", answer)
            if "không quy định mức phạt tiền trực tiếp" not in answer:
                answer += (
                    "\n\n*Lưu ý: Quy định này quy định các hành vi bị nghiêm cấm/nghĩa vụ, không quy định trực tiếp "
                    "chế tài tiền phạt. Mức phạt tiền (nếu có) được áp dụng theo các Nghị định xử phạt VPHC chuyên ngành "
                    "hoặc xử lý hình sự nếu đủ yếu tố cấu thành.*"
                )

    # 3. Kiểm tra tính chuẩn xác của Khung phạt tất định (Math Verification)
    if penalty_calcs and not has_under_14 and not has_14_to_16:
        # Đảm bảo số liệu của Symbolic Engine luôn hiện diện rõ ràng nếu câu trả lời bị thiếu hoặc sai lệch
        for calc in penalty_calcs:
            calcs_list = calc.get("calculations") or calc.get("results") or []
            for r in calcs_list:
                if r.get("applicable") and r.get("display") and r.get("display") not in answer:
                    disp = r.get("display")
                    subj = r.get("subject_label", "Đối tượng")
                    if f"Khung phạt áp dụng cho {subj}:" not in answer and disp != "?":
                        answer += f"\n\n📌 **Khung phạt chuẩn hóa (Symbolic Engine):** Đối với {subj}: {disp}."

    return answer
