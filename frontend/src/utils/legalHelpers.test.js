import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStatuteTarget,
  formatRuleBadge,
  cleanLegalMarkdown,
  escapeHtml,
  safeCopyToClipboard,
  buildLocalFallbackSimulation,
  extractEffectiveAsOf,
  buildSymbolicState,
  resolveArticleDrawerAsOf,
  canSubmitMessage,
  buildChatSubmissionPayload,
  getBenchmarkBannerInfo,
  formatPgVectorStatusLabel,
  extractBase64FromDataUrl,
  formatApiErrorMessage,
} from './legalHelpers.js';

test('parseStatuteTarget extracts docCode and articleNumber from STATUTE source_id', () => {
  const result = parseStatuteTarget({
    source_id: 'STATUTE:15/2020/NĐ-CP:ART:101',
    title: 'Nghị định 15/2020/NĐ-CP',
    article: 'Điều 101',
  });
  assert.deepEqual(result, { docCode: '15/2020/NĐ-CP', articleNumber: '101' });
});

test('parseStatuteTarget falls back to title and article text when source_id is absent', () => {
  const result = parseStatuteTarget({
    title: 'Luật 91/2025/QH15 Bảo vệ dữ liệu cá nhân',
    article: 'Khoản 2 Điều 23a',
  });
  assert.deepEqual(result, { docCode: '91/2025/QH15', articleNumber: '23a' });
});

test('parseStatuteTarget returns null for incomplete sources', () => {
  assert.equal(parseStatuteTarget({ title: 'Tài liệu không mã', article: 'Không rõ' }), null);
});

test('formatRuleBadge maps known rules, criminal prefix, and unknown fallback', () => {
  assert.equal(formatRuleBadge('INDIVIDUAL_HALVING'), 'Nguyên tắc khung phạt đối với Cá nhân (bằng 1/2 Tổ chức)');
  assert.equal(formatRuleBadge('CRIMINAL_STATUTORY_ARTICLE_288'), 'Căn cứ truy cứu trách nhiệm hình sự');
  assert.equal(formatRuleBadge('CUSTOM_RULE'), 'CUSTOM_RULE');
  assert.equal(formatRuleBadge(''), 'Nguyên tắc pháp lý');
});

test('cleanLegalMarkdown normalizes spacing, prefixes, and symbolic operators', () => {
  const raw = 'Quy định pháp lu ật:\n- Hành vi: Chia sẻ tin giả Căn cứ: Điều 101 Hiệu lực: 2026-07-01\n- [VIOLATION] Xúc phạm danh dự\n- Quy tắc [AGE_14_16]: 14 <= tuổi -> cảnh cáo (Nguồn - https://example.com)';
  const cleaned = cleanLegalMarkdown(raw);
  assert.match(cleaned, /pháp luật/);
  assert.match(cleaned, /- Hành vi vi phạm: Xúc phạm danh dự/);
  assert.match(cleaned, /\n  \+ Căn cứ:/);
  assert.match(cleaned, /\n  \+ Hiệu lực:/);
  assert.match(cleaned, /≤/);
  assert.match(cleaned, /→/);
  assert.doesNotMatch(cleaned, /https:\/\/example\.com/);
});

test('escapeHtml escapes HTML special characters safely', () => {
  assert.equal(
    escapeHtml(`<script>alert("x" & 'y')</script>`),
    '&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;'
  );
  assert.equal(escapeHtml(null), '');
});

test('safeCopyToClipboard uses execCommand fallback when not in a secure context (HTTP LAN)', async () => {
  let appendedNode = null;
  let removedNode = null;
  let execCommandCalledWith = null;
  const fakeTextarea = {
    value: '',
    style: {},
    focus() {},
    select() {},
  };
  const fakeDoc = {
    createElement(tag) {
      assert.equal(tag, 'textarea');
      return fakeTextarea;
    },
    body: {
      appendChild(node) {
        appendedNode = node;
      },
      removeChild(node) {
        removedNode = node;
      },
    },
    execCommand(cmd) {
      execCommandCalledWith = cmd;
      return true;
    },
  };

  const ok = await safeCopyToClipboard('Điều 101 NĐ 15/2020', {
    navigator: {},
    window: { isSecureContext: false },
    document: fakeDoc,
  });

  assert.equal(ok, true);
  assert.equal(fakeTextarea.value, 'Điều 101 NĐ 15/2020');
  assert.equal(execCommandCalledWith, 'copy');
  assert.equal(appendedNode, fakeTextarea);
  assert.equal(removedNode, fakeTextarea);
});

test('safeCopyToClipboard falls back to execCommand when navigator.clipboard.writeText rejects', async () => {
  let execCommandCalled = false;
  const fakeTextarea = { value: '', style: {}, focus() {}, select() {} };
  const fakeDoc = {
    createElement: () => fakeTextarea,
    body: { appendChild() {}, removeChild() {} },
    execCommand: () => {
      execCommandCalled = true;
      return true;
    },
  };

  const ok = await safeCopyToClipboard('Nội dung thử nghiệm', {
    navigator: {
      clipboard: {
        writeText: () => Promise.reject(new Error('Clipboard denied')),
      },
    },
    window: { isSecureContext: true },
    document: fakeDoc,
  });

  assert.equal(ok, true);
  assert.equal(execCommandCalled, true);
});

test('buildLocalFallbackSimulation applies individual halving, age 14-16 warning, and 330/2026 org 2x cap', () => {
  const nd15Primary = {
    doc_code: '15/2020/NĐ-CP',
    article_number: 101,
    base_min: 10_000_000,
    base_max: 20_000_000,
    effective_to: '2026-06-30',
  };
  const adultInd = buildLocalFallbackSimulation(nd15Primary, 'INDIVIDUAL', 'ADULT');
  assert.match(adultInd.display, /5\.000\.000/);
  assert.match(adultInd.display, /10\.000\.000/);
  assert.equal(adultInd.effective_to, '2026-06-30');

  const minor15 = buildLocalFallbackSimulation(nd15Primary, 'INDIVIDUAL', '14_16');
  assert.match(minor15.display, /0 đồng/);
  assert.match(minor15.basis, /134/);

  const nd330Primary = {
    doc_code: '330/2026/NĐ-CP',
    article_number: 12,
    base_min: 60_000_000,
    base_max: 120_000_000,
  };
  const org330 = buildLocalFallbackSimulation(nd330Primary, 'ORGANIZATION', 'ADULT');
  assert.match(org330.display, /120\.000\.000/);
  assert.match(org330.display, /200\.000\.000/);
});

test('extractEffectiveAsOf and buildSymbolicState preserve effective_as_of from /chat and /chat/stream payloads', () => {
  const streamMeta = {
    type: 'meta',
    effective_as_of: '2026-06-30',
    symbolic_reasoning: { as_of_date: '2026-06-30', rule_steps: [] },
    graph_view: { nodes: [] },
    sources: [{ title: 'NĐ 15/2020' }],
  };
  assert.equal(extractEffectiveAsOf(streamMeta), '2026-06-30');
  const symbolicState = buildSymbolicState(streamMeta);
  assert.equal(symbolicState.effective_as_of, '2026-06-30');
  assert.equal(resolveArticleDrawerAsOf(symbolicState, ''), '2026-06-30');
});

test('resolveArticleDrawerAsOf falls back from effective_as_of to reasoning.as_of_date to userAsOfDate', () => {
  assert.equal(
    resolveArticleDrawerAsOf({ reasoning: { as_of_date: '2025-12-31' } }, ''),
    '2025-12-31'
  );
  assert.equal(resolveArticleDrawerAsOf(null, '2026-07-01'), '2026-07-01');
  assert.equal(resolveArticleDrawerAsOf(null, ''), '');
});

test('canSubmitMessage blocks composer submission when evidenceAttachment is invalid even if text is typed', () => {
  const invalidAttachment = {
    filename: 'meme.png',
    is_valid_evidence: false,
    rejection_reason: 'Không có nội dung pháp lý',
    extracted_text: '',
  };

  assert.equal(
    canSubmitMessage({
      rawTyped: 'Hãy xử phạt hành vi này',
      evidenceAttachment: invalidAttachment,
      isLoading: false,
      hasExplicitQuestion: false,
    }),
    false
  );

  assert.equal(
    canSubmitMessage({
      rawTyped: 'Câu hỏi mẫu từ chip',
      evidenceAttachment: invalidAttachment,
      isLoading: false,
      hasExplicitQuestion: true,
    }),
    true
  );
});

test('buildChatSubmissionPayload ignores and preserves composer evidenceAttachment when clicking sample or followup chips', () => {
  const validAttachment = {
    filename: 'evidence.png',
    is_valid_evidence: true,
    extracted_text: 'Bài đăng xúc phạm danh dự trên mạng xã hội',
  };

  const chipSubmission = buildChatSubmissionPayload({
    rawTyped: 'Theo Điều 8 Luật ANM 2018, hành vi nào bị nghiêm cấm?',
    evidenceAttachment: validAttachment,
    selectedTopicFilter: 'ALL',
    topicFilters: [],
    asOfDate: '2026-07-01',
    hasExplicitQuestion: true,
  });

  assert.equal(chipSubmission.shouldClearEvidence, false);
  assert.equal(chipSubmission.shouldClearInput, false);
  assert.doesNotMatch(chipSubmission.textToSend, /BẰNG CHỨNG ĐÍNH KÈM/);
  assert.match(chipSubmission.textToSend, /Điều 8 Luật ANM 2018/);

  const composerSubmission = buildChatSubmissionPayload({
    rawTyped: 'Phân tích mức phạt',
    evidenceAttachment: validAttachment,
    selectedTopicFilter: 'SNS',
    topicFilters: [{ id: 'SNS', promptHint: 'Mạng xã hội' }],
    asOfDate: '',
    hasExplicitQuestion: false,
  });

  assert.equal(composerSubmission.shouldClearEvidence, true);
  assert.equal(composerSubmission.shouldClearInput, true);
  assert.match(composerSubmission.textToSend, /\[BẰNG CHỨNG ĐÍNH KÈM: evidence\.png\]/);
});

test('getBenchmarkBannerInfo handles symbolic_verified, live_llm, and not_run modes accurately', () => {
  const verifiedBanner = getBenchmarkBannerInfo({ mode: 'symbolic_verified', total_cases: 40 });
  assert.ok(verifiedBanner);
  assert.equal(verifiedBanner.variant, 'info');
  assert.match(verifiedBanner.text, /Symbolic/i);

  const liveBanner = getBenchmarkBannerInfo({ mode: 'live_llm', total_cases: 40 });
  assert.ok(liveBanner);
  assert.equal(liveBanner.variant, 'success');
  assert.match(liveBanner.text, /40/);

  const notRunBanner = getBenchmarkBannerInfo({ mode: 'not_run', message: 'Chưa chạy' });
  assert.deepEqual(notRunBanner, { variant: 'info', text: 'Chưa chạy' });
});

test('formatPgVectorStatusLabel does not return hardcoded 4.332 count when offline or unknown', () => {
  assert.equal(formatPgVectorStatusLabel(false), 'PGVector Vector DB');
  assert.equal(formatPgVectorStatusLabel(true), 'PGVector Vector DB');
  assert.equal(formatPgVectorStatusLabel(true, 4500), 'PGVector (4.500 Vectors)');
});

test('extractBase64FromDataUrl strips data URI prefix cleanly', () => {
  assert.equal(extractBase64FromDataUrl('data:application/pdf;base64,JVBERi0x'), 'JVBERi0x');
  assert.equal(extractBase64FromDataUrl('plainbase64'), 'plainbase64');
  assert.equal(extractBase64FromDataUrl(''), '');
});

test('canSubmitMessage allows valid evidence without text and blocks empty/loading states', () => {
  const validAttachment = {
    filename: 'doc.pdf',
    is_valid_evidence: true,
    extracted_text: 'Nội dung hợp đồng',
  };
  assert.equal(
    canSubmitMessage({ rawTyped: '', evidenceAttachment: validAttachment, isLoading: false }),
    true
  );
  assert.equal(
    canSubmitMessage({ rawTyped: '   ', evidenceAttachment: null, isLoading: false }),
    false
  );
  assert.equal(
    canSubmitMessage({ rawTyped: 'Câu hỏi', evidenceAttachment: null, isLoading: true }),
    false
  );
});

test('formatApiErrorMessage extracts detail string, validation array, 429 rate-limit, and fallback', () => {
  assert.equal(
    formatApiErrorMessage({ response: { data: { detail: 'Tiến trình đang chạy' } } }, 'fallback'),
    'Tiến trình đang chạy'
  );
  assert.equal(
    formatApiErrorMessage({ response: { data: { detail: [{ msg: 'Thiếu trường' }] } } }, 'fallback'),
    'Thiếu trường'
  );
  assert.match(
    formatApiErrorMessage({ response: { status: 429 } }, 'fallback'),
    /429/
  );
  assert.equal(formatApiErrorMessage({}, 'Lỗi mặc định'), 'Lỗi mặc định');
});
