const RULE_LABELS_VI = {
  BASE_SUBJECT: 'Xác định chủ thể áp dụng gốc',
  ORG_MULTIPLIER: 'Hệ số nhân khung phạt đối với Tổ chức',
  INDIVIDUAL_HALVING: 'Nguyên tắc khung phạt đối với Cá nhân (bằng 1/2 Tổ chức)',
  CAP_CHECK: 'Kiểm tra mức trần phạt tiền tối đa',
  WARNING_PENALTY: 'Hình thức xử phạt cảnh cáo',
  WARNING_OR_FINE: 'Hình thức xử phạt cảnh cáo hoặc phạt tiền',
  AGE_UNDER_14: 'Nguyên tắc độ tuổi (Dưới 14 tuổi)',
  UNDER_14_EXEMPTION: 'Nguyên tắc miễn xử phạt hành chính (Dưới 14 tuổi)',
  AGE_14_16: 'Nguyên tắc độ tuổi (Từ đủ 14 đến dưới 16 tuổi)',
  AGE_14_16_WARNING: 'Nguyên tắc xử lý người từ đủ 14 đến dưới 16 tuổi',
  AGE_16_18: 'Nguyên tắc độ tuổi (Từ đủ 16 đến dưới 18 tuổi)',
  AGE_RANGE_NEEDS_EXACT_AGE: 'Yêu cầu xác định độ tuổi chính xác của người chưa thành niên',
  MULTI_HOP_CRIMINAL_ESCALATION: 'Chuyển hóa trách nhiệm hình sự liên đới',
  MULTI_HOP_STATUTORY_REFERENCE: 'Dẫn chiếu quy phạm pháp luật kế thừa',
  CURATED_STATUTORY_FALLBACK: 'Quy phạm pháp luật áp dụng',
  STATUTE_OF_LIMITATIONS_CHECK: 'Kiểm tra thời hiệu xử phạt vi phạm hành chính',
  HISTORICAL_VALIDITY_LOCK: 'Hiệu lực văn bản theo thời điểm áp dụng',
  INCREMENTAL_SUPERSEDED_PROVISION: 'Quy định sửa đổi, bổ sung kế thừa',
  PROHIBITIVE_ARTICLE_MAPPING: 'Quy phạm nghiêm cấm',
  IRRELEVANT_QUERY_GUARDRAIL: 'Chốt chặn phạm vi tư vấn pháp luật CNTT',
  OUT_OF_SCOPE_GUARDRAIL: 'Chốt chặn văn bản ngoài phạm vi CNTT',
  INVALID_DOCUMENT_GUARDRAIL: 'Chốt chặn văn bản chưa có trong kho dữ liệu',
  AMBIGUOUS_ARTICLE_GUARDRAIL: 'Yêu cầu làm rõ số hiệu văn bản quy phạm pháp luật',
  ARTICLE_NOT_FOUND_IN_DOC_GUARDRAIL: 'Chốt chặn điều khoản không tồn tại trong văn bản',
  INVALID_EVIDENCE_GUARDRAIL: 'Kiểm duyệt bằng chứng đầu vào',
  ZERO_EVIDENCE_GUARDRAIL: 'Thông báo tra cứu dữ liệu pháp luật',
};

export function parseStatuteTarget(src) {
  const sid = String(src?.source_id || '');
  const parts = sid.split(':');
  if (parts[0] === 'STATUTE' && parts[1] && parts[3]) {
    return { docCode: parts[1], articleNumber: parts[3] };
  }
  const titleCode = String(src?.title || '').match(/\d+\/\d{4}\/[A-ZĐ0-9-]+/i)?.[0] || '';
  const artNum = String(src?.article || '').match(/Điều\s+(\d+[a-z]?)/i)?.[1] || '';
  if (titleCode && artNum) return { docCode: titleCode, articleNumber: artNum };
  return null;
}

export function formatRuleBadge(ruleCode) {
  const code = String(ruleCode || '').trim();
  if (RULE_LABELS_VI[code]) return RULE_LABELS_VI[code];
  if (code.startsWith('CRIMINAL_STATUTORY_ARTICLE_')) return 'Căn cứ truy cứu trách nhiệm hình sự';
  return code || 'Nguyên tắc pháp lý';
}

export function cleanLegalMarkdown(rawText) {
  if (!rawText) return '';
  let text = String(rawText);
  text = text.replace(/pháp lu ật/gi, 'pháp luật');
  text = text.replace(/^(\s*-\s+Hành vi:[^\n]*?)\s+Căn cứ:\s*/gm, '$1\n  + Căn cứ: ');
  text = text.replace(/^(\s*(?:\+\s+)?Căn cứ:[^\n]*?)\s+Hiệu lực:\s*/gm, '$1\n  + Hiệu lực: ');
  text = text.replace(/^\s*Căn cứ:\s*/gm, '  + Căn cứ: ');
  text = text.replace(/^\s*Hiệu lực:\s*/gm, '  + Hiệu lực: ');
  text = text.replace(/- \[(PROVISION|VIOLATION|CRIME)\]\s*/g, (_, kind) => {
    if (kind === 'VIOLATION') return '- Hành vi vi phạm: ';
    if (kind === 'CRIME') return '- Tội danh hình sự: ';
    return '- Quy định pháp luật: ';
  });
  text = text.replace(/- Quy tắc \[([A-Z0-9_]+)\]:/g, (_, code) => `- ${formatRuleBadge(code)}:`);
  text = text.replace(/\s*[-—]\s*https?:\/\/\S+\)/g, ')');
  text = text.replace(/ <= /g, ' ≤ ').replace(/ -> /g, ' → ');
  return text;
}

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function copyViaExecCommand(text, doc) {
  if (!doc?.createElement || !doc?.body) return false;
  let textArea = null;
  try {
    textArea = doc.createElement('textarea');
    textArea.value = String(text ?? '');
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    doc.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const ok = Boolean(doc.execCommand?.('copy'));
    return ok;
  } catch {
    return false;
  } finally {
    if (textArea && doc.body?.removeChild) {
      try {
        doc.body.removeChild(textArea);
      } catch {
        // ignore cleanup error
      }
    }
  }
}

export async function safeCopyToClipboard(text, env = {}) {
  const nav = env.navigator ?? globalThis.navigator;
  const win = env.window ?? globalThis.window;
  const doc = env.document ?? globalThis.document;
  const content = String(text ?? '');

  if (nav?.clipboard?.writeText && win?.isSecureContext) {
    try {
      await nav.clipboard.writeText(content);
      return true;
    } catch {
      return copyViaExecCommand(content, doc);
    }
  }
  return copyViaExecCommand(content, doc);
}

export function buildLocalFallbackSimulation(primary, subject, ageGroup) {
  const baseMin = Number(primary?.base_min) || 0;
  const baseMax = Number(primary?.base_max) || 0;
  const docCode = primary?.doc_code || '15/2020/NĐ-CP';
  const artNum = Number(primary?.article_number) || 0;
  const isIndividualOnly =
    (docCode === '15/2020/NĐ-CP' && artNum === 106) ||
    (docCode === '174/2026/NĐ-CP' && artNum === 101);
  const isDecree330IndBase = docCode === '330/2026/NĐ-CP' && artNum >= 9 && artNum <= 49;
  const fmt = (n) => `${Math.round(n).toLocaleString('vi-VN')} đồng`;

  if (subject === 'ORGANIZATION') {
    if (isIndividualOnly) {
      return {
        display: 'Không áp dụng cho tổ chức',
        formula: `Điều ${artNum} chỉ điều chỉnh hành vi của cá nhân (người chơi)`,
        basis: `Khoản 3 Điều 4 Nghị định ${docCode}`,
        effective_to: primary?.effective_to || null,
      };
    }
    if (isDecree330IndBase) {
      const orgMin = Math.min(baseMin * 2, 200_000_000);
      const orgMax = Math.min(baseMax * 2, 200_000_000);
      return {
        display: `${fmt(orgMin)} – ${fmt(orgMax)}`,
        formula: 'Tổ chức = 2 × mức phạt Cá nhân (trần 200 triệu đồng)',
        basis: 'Điều 7 Nghị định 330/2026/NĐ-CP',
        effective_to: primary?.effective_to || null,
      };
    }
    return {
      display: `${fmt(baseMin)} – ${fmt(baseMax)}`,
      formula: '100% khung chuẩn Tổ chức',
      basis: `Khoản 3 Điều 4 Nghị định ${docCode}`,
      effective_to: primary?.effective_to || null,
    };
  }

  let indMin = baseMin;
  let indMax = baseMax;
  let formulaBase = '100% khung cá nhân';

  if (!isIndividualOnly && !isDecree330IndBase) {
    indMin = baseMin / 2;
    indMax = baseMax / 2;
    formulaBase = '1/2 khung phạt của Tổ chức';
  }

  const INDIVIDUAL_40M_RANGES = {
    '15/2020/NĐ-CP': [[5, 14], [107, 112]],
    '174/2026/NĐ-CP': [[5, 14], [106, 112]],
    '330/2026/NĐ-CP': [],
  };
  const ranges40m = INDIVIDUAL_40M_RANGES[docCode] || [];
  const cap = ranges40m.some(([low, high]) => artNum >= low && artNum <= high) ? 40_000_000 : 100_000_000;
  indMax = Math.min(indMax, cap);
  indMin = Math.min(indMin, cap);

  if (ageGroup === 'UNDER_14') {
    return {
      display: '0 đồng (Chưa đủ tuổi chịu trách nhiệm hành chính)',
      formula: 'Dưới 14 tuổi không bị xử phạt vi phạm hành chính',
      basis: 'Điều 5 Luật Xử lý vi phạm hành chính',
      effective_to: primary?.effective_to || null,
    };
  }
  if (ageGroup === '14_16') {
    return {
      display: '0 đồng (Phạt cảnh cáo — Không phạt tiền)',
      formula: 'Từ đủ 14 đến dưới 16 tuổi chỉ áp dụng hình thức Cảnh cáo',
      basis: 'Điều 22 & Điều 134 Luật Xử lý vi phạm hành chính',
      effective_to: primary?.effective_to || null,
    };
  }
  if (ageGroup === '16_18') {
    return {
      display: `Tối đa không quá ${fmt(indMax / 2)} (Trần vị thành niên 16 – <18 tuổi)`,
      formula: `≤ 1/2 mức phạt cá nhân thành niên (${fmt(indMin)} – ${fmt(indMax)})`,
      basis: `Điều 134 Luật XLVPHC & Điều 4 Nghị định ${docCode}`,
      effective_to: primary?.effective_to || null,
    };
  }

  return {
    display: `${fmt(indMin)} – ${fmt(indMax)}`,
    formula: formulaBase,
    basis: docCode === '330/2026/NĐ-CP' ? 'Điều 7 Nghị định 330/2026/NĐ-CP' : `Khoản 3 Điều 4 Nghị định ${docCode}`,
    effective_to: primary?.effective_to || null,
  };
}

export function extractEffectiveAsOf(payload) {
  return (
    payload?.effective_as_of ||
    payload?.symbolic_reasoning?.as_of_date ||
    payload?.reasoning?.as_of_date ||
    null
  );
}

export function buildSymbolicState(payload) {
  return {
    reasoning: payload?.symbolic_reasoning,
    graph: payload?.graph_view,
    sources: payload?.sources,
    effective_as_of: extractEffectiveAsOf(payload),
  };
}

export function resolveArticleDrawerAsOf(activeSymbolic, userAsOfDate = '') {
  return (
    activeSymbolic?.effective_as_of ||
    activeSymbolic?.reasoning?.as_of_date ||
    userAsOfDate ||
    ''
  );
}

export function canSubmitMessage({
  rawTyped,
  evidenceAttachment,
  isLoading,
  hasExplicitQuestion = false,
}) {
  if (isLoading) return false;
  const trimmed = String(rawTyped || '').trim();
  if (hasExplicitQuestion) {
    return Boolean(trimmed);
  }
  if (evidenceAttachment?.is_valid_evidence === false) {
    return false;
  }
  return Boolean(trimmed || evidenceAttachment);
}

export function buildChatSubmissionPayload({
  rawTyped,
  evidenceAttachment,
  selectedTopicFilter = 'ALL',
  topicFilters = [],
  asOfDate = '',
  hasExplicitQuestion = false,
}) {
  const trimmed = String(rawTyped || '').trim();
  const useEvidence =
    !hasExplicitQuestion &&
    Boolean(evidenceAttachment) &&
    evidenceAttachment.is_valid_evidence !== false;

  const topicMeta = topicFilters.find((t) => t.id === selectedTopicFilter);
  const topicQuestion =
    selectedTopicFilter !== 'ALL' && topicMeta?.promptHint && !useEvidence
      ? `${trimmed} (${topicMeta.promptHint})`
      : trimmed;

  const extractedSnippet = String(evidenceAttachment?.extracted_text || '').slice(0, 1200);
  const textToSend = useEvidence
    ? `[BẰNG CHỨNG ĐÍNH KÈM: ${evidenceAttachment.filename}]\nNội dung trích xuất OCR: "${extractedSnippet}"\n\nCâu hỏi tư vấn: ${trimmed || 'Hãy phân tích hành vi vi phạm pháp luật trong bằng chứng trên và tính mức xử phạt.'}`
    : topicQuestion;

  const asOfDateToSend = asOfDate || null;
  const questionDisplay = useEvidence
    ? `📎 [Bằng chứng: ${evidenceAttachment.filename}]\n${trimmed || 'Phân tích hành vi vi phạm và tính mức phạt từ bằng chứng đính kèm.'}`
    : trimmed;

  const displayUserText = asOfDateToSend
    ? `${questionDisplay}\n\n[Tra cứu theo ngày ${asOfDateToSend}]`
    : questionDisplay;

  return {
    textToSend,
    asOfDateToSend,
    displayUserText,
    shouldClearInput: !hasExplicitQuestion,
    shouldClearEvidence: useEvidence,
  };
}

export function getBenchmarkBannerInfo(data) {
  if (!data) return null;
  if (data.mode === 'symbolic_verified') {
    return {
      variant: 'info',
      text: `Chế độ kiểm chứng Symbolic Rule Engine (${data.total_cases || 40} ca chuẩn vàng). Nhấn nút bên dưới để chạy đối chứng trực tiếp với LLM.`,
    };
  }
  if (data.mode === 'live_llm') {
    return {
      variant: 'success',
      text: `Đã hoàn tất chạy kiểm thử Live LLM trên ${data.total_cases || 40} kịch bản chuẩn vàng.`,
    };
  }
  if (data.mode === 'not_run' && data.message) {
    return {
      variant: 'info',
      text: data.message,
    };
  }
  return null;
}

export function formatPgVectorStatusLabel(pgvectorReady, vectorCount = null) {
  if (pgvectorReady && Number.isFinite(vectorCount) && vectorCount > 0) {
    return `PGVector (${vectorCount.toLocaleString('vi-VN')} Vectors)`;
  }
  return 'PGVector Vector DB';
}

export function extractBase64FromDataUrl(dataUrl) {
  const resultStr = String(dataUrl || '');
  return resultStr.includes(',') ? resultStr.split(',')[1] : resultStr;
}

export function formatApiErrorMessage(err, fallbackMsg = 'Đã xảy ra lỗi khi kết nối máy chủ.') {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (Array.isArray(detail) && detail.length > 0) {
    return detail.map((d) => d?.msg || JSON.stringify(d)).join('; ');
  }
  if (err?.response?.status === 429) {
    return 'Hệ thống đang giới hạn tốc độ yêu cầu (HTTP 429). Vui lòng đợi ít giây rồi thử lại.';
  }
  if (typeof err?.message === 'string' && err.message.trim()) return err.message.trim();
  return fallbackMsg;
}
