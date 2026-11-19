import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import axios from 'axios';
import {
  Send, Loader2, Scale, ToggleLeft, ToggleRight,
  ShieldCheck, Cpu, GitBranch, CheckCircle2,
  ChevronLeft, ChevronRight, Info,
  BookOpen, RefreshCw, X,
  PanelLeftOpen, Maximize2, Minimize2,
  Copy, Check,
  Layers, Paperclip, FileText,
  BarChart3, Sliders, Mic, MicOff, Volume2, VolumeX, Eye,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import './App.css';
import './components/Workspace/WorkspaceShell.css';
import {
  ArticleDetailDrawer,
  ComplianceReviewModal,
  LegalDraftingModal,
} from './LegalWorkspaceModals';
import { AuthPage } from './components/Auth/AuthPage';
import { AuthWireframeBackdrop } from './components/Auth/AuthWireframeBackdrop';
import {
  readStoredAuth,
  persistStoredAuth,
  clearStoredAuth,
} from './components/Auth/authHelpers';
import { HomePage } from './components/Landing/HomePage';
import { WorkspaceSidebar } from './components/Workspace/WorkspaceSidebar';
import { LegalDocumentSearchPage } from './components/Workspace/LegalDocumentSearchPage';
import { PrecedentSearchPage } from './components/Workspace/PrecedentSearchPage';
import { LegalUpdatePage } from './components/Workspace/LegalUpdatePage';
import { ProfileLayout } from './components/Profile/ProfileLayout';
import {
  parseAppRoute,
  isProtectedShell,
  buildLoginRedirectPath,
  sanitizeNextPath,
} from './utils/appRouter';
import {
  parseStatuteTarget,
  formatRuleBadge,
  cleanLegalMarkdown,
  escapeHtml,
  safeCopyToClipboard,
  buildLocalFallbackSimulation,
  buildSymbolicState,
  resolveArticleDrawerAsOf,
  canSubmitMessage,
  buildChatSubmissionPayload,
  getBenchmarkBannerInfo,
  extractBase64FromDataUrl,
  formatApiErrorMessage,
} from './utils/legalHelpers';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
const API_HEADERS = import.meta.env.VITE_LAW_API_KEY
  ? { 'X-API-Key': import.meta.env.VITE_LAW_API_KEY }
  : {};
const EMPTY_MESSAGES = Object.freeze([]);
const TOPIC_FILTERS = [
  { id: 'ALL', label: 'Tất cả lĩnh vực', promptHint: '' },
  { id: 'DLP', label: 'Dữ liệu cá nhân', promptHint: 'Bảo vệ dữ liệu cá nhân (Luật 91/2025/QH15, NĐ 13/2023, NĐ 330/2026)' },
  { id: 'SNS', label: 'Mạng xã hội & MXH', promptHint: 'Mạng xã hội và thông tin trên mạng (NĐ 15/2020, NĐ 174/2026)' },
  { id: 'ETX', label: 'Giao dịch điện tử', promptHint: 'Giao dịch điện tử và thông điệp dữ liệu (Luật 20/2023/QH15)' },
  { id: 'CYBER', label: 'An ninh mạng & BLHS', promptHint: 'An ninh mạng và tội phạm công nghệ cao (Điều 285-290 BLHS)' },
];

let fallbackMessageIdCounter = 0;

function createMessageId() {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `bot-${randomId || `${Date.now()}-${++fallbackMessageIdCounter}`}`;
}

const SAMPLE_QUESTIONS = [
  {
    title: 'Xử phạt theo quy định hiện hành',
    tag: 'Nghị định 174/2026',
    text: 'Theo Nghị định 174/2026/NĐ-CP, tổ chức chia sẻ thông tin sai sự thật gây hoang mang dư luận trên mạng xã hội bị xử lý thế nào?'
  },
  {
    title: 'Độ tuổi vị thành niên (15 tuổi)',
    tag: 'Luật XLVPHC & NĐ 15/2020',
    text: 'Theo quy định có hiệu lực đến hết ngày 30/06/2026, một học sinh 15 tuổi đăng thông tin sai sự thật trên mạng xã hội có bị phạt tiền theo Nghị định 15/2020/NĐ-CP không?'
  },
  {
    title: 'Bảo vệ dữ liệu cá nhân',
    tag: 'Nghị định 13/2023 & Luật 91/2025',
    text: 'Theo Nghị định 13/2023/NĐ-CP và Luật Bảo vệ dữ liệu cá nhân, quyền của chủ thể dữ liệu và nghĩa vụ khi xử lý dữ liệu cá nhân nhạy cảm là gì?'
  },
  {
    title: 'Quy định lịch sử Điều 106',
    tag: 'NĐ 15/2020 đến 30/06/2026',
    text: 'Theo Điều 106 Nghị định 15/2020/NĐ-CP, có hiệu lực đến hết ngày 30/06/2026, người chơi game online lợi dụng trò chơi điện tử để thực hiện hành vi vi phạm pháp luật bị phạt bao nhiêu?'
  },
  {
    title: 'Văn bản không có trong kho',
    tag: 'Symbolic Guardrail',
    text: 'Theo Nghị định 9999/2025/NĐ-CP thì hành vi bình luận xúc phạm người khác trên Facebook bị phạt bao nhiêu tiền?'
  },
  {
    title: 'An ninh mạng & Hành vi nghiêm cấm',
    tag: 'Điều 8 Luật An ninh mạng 2018',
    text: 'Theo Điều 8 Luật An ninh mạng 2018, những hành vi nào bị nghiêm cấm trên không gian mạng?'
  }
];

// ============================================================================
// VŨ KHÍ 3: BẢNG ĐIỀU KHIỂN MÔ PHỎNG TÌNH HUỐNG PHÁP LÝ (INTERACTIVE WHAT-IF SANDBOX)
// ============================================================================
const SUPPORTED_SANDBOX_DECREES = new Set(['15/2020/NĐ-CP', '174/2026/NĐ-CP', '330/2026/NĐ-CP']);

function WhatIfSandbox({ penaltyCalcs = [] }) {
  const [simSubject, setSimSubject] = useState('INDIVIDUAL'); // 'ORGANIZATION' | 'INDIVIDUAL'
  const [simAgeGroup, setSimAgeGroup] = useState('ADULT');    // 'ADULT' | '16_18' | '14_16' | 'UNDER_14'
  const [simulation, setSimulation] = useState(null);

  const primary = penaltyCalcs[0];
  const isSupported = Boolean(
    primary?.action_id &&
    primary?.rule_supported &&
    (!primary.doc_code || SUPPORTED_SANDBOX_DECREES.has(primary.doc_code))
  );
  const selectedAge = { ADULT: 18, '16_18': 17, '14_16': 15, UNDER_14: 13 }[simAgeGroup];
  const simulationKey = `${primary?.action_id || ''}:${simSubject}:${selectedAge}`;

  useEffect(() => {
    if (!isSupported) return undefined;
    let cancelled = false;
    axios.post(
      `${API_BASE_URL}/penalty/simulate`,
      { action_id: primary.action_id, subject: simSubject, age: selectedAge },
      { headers: API_HEADERS },
    ).then((response) => {
      if (!cancelled) setSimulation({ key: simulationKey, data: response.data });
    }).catch(() => {
      if (!cancelled) {
        setSimulation({
          key: simulationKey,
          data: buildLocalFallbackSimulation(primary, simSubject, simAgeGroup),
        });
      }
    });
    return () => { cancelled = true; };
  }, [isSupported, primary, selectedAge, simAgeGroup, simSubject, simulationKey]);

  if (!isSupported) return null;
  const currentSimulation = simulation?.key === simulationKey ? simulation.data : null;
  const isSimulationLoading = !currentSimulation;

  return (
    <div className="card-box sandbox-box">
      <div className="card-box-title">
        <Sliders size={14} className="icon-purple" aria-hidden="true" />
        <span>Mô phỏng Tình huống Pháp lý (Symbolic What-If Sandbox)</span>
      </div>
      <p className="sandbox-sub">
        Mỗi thay đổi được tính lại bằng quy tắc phía máy chủ và dữ liệu mức phạt trong đồ thị.
      </p>

      <div className="sandbox-controls">
        <div className="sandbox-row">
          <span className="sandbox-label">1. Chủ thể vi phạm:</span>
          <div className="sandbox-pills" role="group" aria-label="Chọn chủ thể vi phạm">
            <button
              type="button"
              className={`sandbox-pill ${simSubject === 'ORGANIZATION' ? 'active' : ''}`}
              aria-pressed={simSubject === 'ORGANIZATION'}
              onClick={() => setSimSubject('ORGANIZATION')}
            >
              🏢 Tổ chức
            </button>
            <button
              type="button"
              className={`sandbox-pill ${simSubject === 'INDIVIDUAL' ? 'active' : ''}`}
              aria-pressed={simSubject === 'INDIVIDUAL'}
              onClick={() => setSimSubject('INDIVIDUAL')}
            >
              👤 Cá nhân
            </button>
          </div>
        </div>

        {simSubject === 'INDIVIDUAL' && (
          <div className="sandbox-row">
            <span className="sandbox-label">2. Độ tuổi chủ thể:</span>
            <div className="sandbox-pills" role="group" aria-label="Chọn độ tuổi chủ thể">
              {[
                { id: 'ADULT', label: '≥ 18 tuổi' },
                { id: '16_18', label: '16 – <18 tuổi' },
                { id: '14_16', label: '14 – <16 tuổi' },
                { id: 'UNDER_14', label: '< 14 tuổi' },
              ].map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`sandbox-pill ${simAgeGroup === g.id ? 'active' : ''}`}
                  aria-pressed={simAgeGroup === g.id}
                  onClick={() => setSimAgeGroup(g.id)}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        )}

      </div>

      <div className="sandbox-output" aria-live="polite">
        {isSimulationLoading ? (
          <div className="skeleton-lines" role="status" aria-busy="true" aria-label="Đang tính toán mô phỏng">
            <div className="skeleton-bar w-75" />
            <div className="skeleton-bar w-55" />
          </div>
        ) : currentSimulation ? (
          <>
            <div className="sandbox-result-main">{currentSimulation.display}</div>
            <div className="sandbox-result-meta">
              <span><b>Công thức:</b> {currentSimulation.formula}</span>
              <span><b>Căn cứ:</b> {currentSimulation.basis}</span>
              {currentSimulation.effective_to && <span><b>Hiệu lực đến:</b> {currentSimulation.effective_to}</span>}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ============================================================================
// VŨ KHÍ 4: XUẤT PHIẾU TƯ VẤN PHÁP LÝ / ĐƠN TRÌNH BÁO AN NINH MẠNG (PRINT/PDF)
// ============================================================================
function exportLegalAdvisoryReport(questionText, botMsg) {
  const sym = botMsg?.symbolicData;
  const calcs = sym?.reasoning?.penalty_calculations || [];
  const sources = sym?.sources || [];
  const nowStr = new Date().toLocaleString('vi-VN');

  const calcRowsHtml = calcs
    .map(
      (c) => `
      <div style="border:1px solid #cbd5e1;border-radius:8px;padding:12px;margin-bottom:10px;background:#f8fafc;">
        <div style="font-weight:700;color:#0f172a;margin-bottom:4px;">Hành vi: ${escapeHtml(c.action)}</div>
        <div style="font-size:12px;color:#2563eb;font-weight:600;margin-bottom:8px;">Căn cứ: ${escapeHtml(c.clause)}, ${escapeHtml(c.article)}</div>
        ${(c.calculations || [])
          .map(
            (r) =>
              `<div style="font-size:13px;margin:3px 0;">• <b>${escapeHtml(r.subject_label)}:</b> <span style="color:#dc2626;font-weight:700;">${escapeHtml(r.display)}</span> <i>(${escapeHtml(r.formula)})</i></div>`
          )
          .join('')}
        ${
          c.sanctions?.length
            ? `<div style="font-size:12.5px;margin-top:6px;color:#475569;"><b>Biện pháp khắc phục hậu quả:</b> ${escapeHtml(c.sanctions.join('; '))}</div>`
            : ''
        }
        ${
          c.criminal_escalations?.length
            ? `<div style="font-size:12.5px;margin-top:6px;color:#991b1b;background:#fef2f2;padding:6px 8px;border-radius:6px;"><b>⚖️ Cảnh báo Chuyển hóa Hình sự (Multi-Hop):</b> ${c.criminal_escalations
                .map((ce) => `${escapeHtml(ce.title)} — ${escapeHtml(ce.penalty)}`)
                .join(' | ')}</div>`
            : ''
        }
      </div>`
    )
    .join('');

  const sourcesHtml = sources
    .map((s) => {
      const pageStr = s.page != null ? ` (Trang ${escapeHtml(s.page)})` : '';
      const safeUrl = s.source_url && /^https?:\/\//i.test(s.source_url) ? s.source_url : null;
      const linkHtml = safeUrl
        ? ` — <a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;">Xem văn bản gốc</a>`
        : '';
      return `<li style="margin-bottom:6px;"><b>${escapeHtml(s.title)}</b> — ${escapeHtml(s.article)}${pageStr}: <i>"${escapeHtml(s.snippet)}"</i>${linkHtml}</li>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <title>Phiếu Tư vấn Pháp lý CNTT — LexIT Neuro-Symbolic</title>
  <style>
    body { font-family: "Times New Roman", Times, serif; color: #111827; max-width: 820px; margin: 28px auto; padding: 0 24px; line-height: 1.55; }
    .header-table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
    .header-table td { text-align: center; vertical-align: top; }
    .report-title { text-align: center; font-size: 20px; font-weight: bold; text-transform: uppercase; margin: 18px 0 4px; color: #1e3a8a; }
    .report-sub { text-align: center; font-size: 13px; font-style: italic; color: #4b5563; margin-bottom: 20px; }
    .section-title { font-size: 15px; font-weight: bold; text-transform: uppercase; color: #1e3a8a; border-bottom: 1.5px solid #1e3a8a; padding-bottom: 4px; margin: 18px 0 10px; }
    .box { background: #f9fafb; border: 1px solid #d1d5db; border-radius: 6px; padding: 12px 14px; font-size: 14px; white-space: pre-wrap; }
    .print-bar { display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 16px; font-family: sans-serif; }
    .print-btn { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; font-weight: 600; cursor: pointer; }
    @media print { .print-bar { display: none; } body { margin: 0; } }
  </style>
</head>
<body>
  <div class="print-bar">
    <button class="print-btn" onclick="window.print()">🖨️ In Phiếu Tư vấn / Lưu PDF</button>
  </div>
  <table class="header-table">
    <tr>
      <td style="width:45%;">
        <b>HỆ THỐNG TRỢ LÝ ẢO PHÁP LUẬT LEX-IT</b><br/>
        <span>Kiến trúc Neuro-Symbolic Hybrid AI</span>
      </td>
      <td style="width:55%;">
        <b>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</b><br/>
        <b>Độc lập - Tự do - Hạnh phúc</b><br/>
        <span>───────────────</span>
      </td>
    </tr>
  </table>
  <div class="report-title">PHIẾU TƯ VẤN PHÁP LUẬT CÔNG NGHỆ THÔNG TIN & AN NINH MẠNG</div>
  <div class="report-sub">Thời điểm trích xuất: ${escapeHtml(nowStr)} • Mã kiểm chứng: Symbolic-Rule-Engine-v2.2</div>

  <div class="section-title">I. NỘI DUNG TÌNH HUỐNG / YÊU CẦU TƯ VẤN</div>
  <div class="box">${escapeHtml(questionText || 'Tư vấn pháp luật CNTT')}</div>

  ${
    calcRowsHtml
      ? `<div class="section-title">II. BẢNG TÍNH KHUNG HÌNH PHẠT & CHẾ TÀI TẤT ĐỊNH (SYMBOLIC ENGINE)</div>${calcRowsHtml}`
      : ''
  }

  <div class="section-title">III. Ý KIẾN TƯ VẤN PHÁP LÝ CHI TIẾT</div>
  <div class="box">${escapeHtml(botMsg?.text || '')}</div>

  ${
    sourcesHtml
      ? `<div class="section-title">IV. CĂN CỨ VĂN BẢN QUY PHẠM PHÁP LUẬT TRÍCH DẪN</div><ul style="font-size:13.5px;padding-left:20px;">${sourcesHtml}</ul>`
      : ''
  }

  <div style="margin-top:26px;font-size:12.5px;color:#4b5563;border-top:1px dashed #cbd5e1;padding-top:10px;">
    <b>Hướng dẫn trình báo khi bị xâm phạm quyền và lợi ích hợp pháp trên không gian mạng:</b><br/>
    1. Lưu giữ nguyên trạng bằng chứng điện tử (ảnh chụp màn hình kèm URL, thời gian, sao kê giao dịch, hợp đồng điện tử).<br/>
    2. Nộp đơn trình báo kèm Phiếu tư vấn này tới Phòng An ninh mạng và phòng, chống tội phạm sử dụng công nghệ cao (PA05 - Công an tỉnh/thành phố) hoặc Cơ quan điều tra nơi cư trú.
  </div>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=800');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

// ============================================================================
// VŨ KHÍ 5: MODAL BẢNG THỰC NGHIỆM ĐỊNH LƯỢNG TRỰC TIẾP (LIVE BENCHMARK MODAL)
// ============================================================================
function BenchmarkModal({ isOpen, onClose, data, isLoading, error, onRunBenchmark }) {
  const closeBtnRef = useRef(null);
  const previousFocusRef = useRef(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const timer = window.setTimeout(() => closeBtnRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
    if (!isOpen && wasOpenRef.current) {
      wasOpenRef.current = false;
      previousFocusRef.current?.focus?.();
      previousFocusRef.current = null;
    }
    return undefined;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const bannerInfo = getBenchmarkBannerInfo(data);
  const hasAnswerDetails = (data?.cases || []).some(
    (c) => Boolean(c.hybrid_answer || c.naive_answer)
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card benchmark-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="benchmark-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon" aria-hidden="true">
              <BarChart3 size={18} />
            </div>
            <div>
              <h3 id="benchmark-modal-title">
                Thực nghiệm Định lượng: Naive RAG vs. Neuro-Symbolic Hybrid RAG
              </h3>
              <p>
                Đánh giá khoa học trên <b>{data?.total_cases || 40} ca chuẩn vàng do chuyên gia gán nhãn</b> (5 thước đo độc lập)
              </p>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="modal-close-btn"
            aria-label="Đóng bảng thực nghiệm định lượng"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {!isLoading && error && (
            <div className="benchmark-error-box" role="alert">
              <p>{error}</p>
              <button
                type="button"
                className="workspace-btn secondary"
                onClick={() => onRunBenchmark(false)}
              >
                <RefreshCw size={14} aria-hidden="true" />
                <span>Thử lại</span>
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="benchmark-loading" role="status" aria-busy="true">
              <Loader2 size={24} className="spin-icon" aria-hidden="true" />
              <span>Đang chạy thực nghiệm định lượng trên bộ kịch bản chuẩn vàng...</span>
              <div className="skeleton-lines" style={{ width: '100%', maxWidth: '520px' }}>
                <div className="skeleton-bar w-90" />
                <div className="skeleton-bar w-75" />
                <div className="skeleton-bar w-55" />
              </div>
            </div>
          ) : data ? (
            <>
              {bannerInfo && (
                <div className={`benchmark-note ${bannerInfo.variant}`}>
                  {bannerInfo.text}
                </div>
              )}
              {data.evaluation_note && (
                <div className="benchmark-note">{data.evaluation_note}</div>
              )}
              <div className="benchmark-metrics-grid">
                {(data.metrics || []).map((m, idx) => (
                  <div key={idx} className="bench-metric-card">
                    <div className="bench-metric-title">{m.name}</div>
                    <div className="bench-bars">
                      <div className="bench-bar-row">
                        <span className="bench-bar-label">Naive RAG:</span>
                        <div className="bench-bar-track">
                          <div className="bench-bar-fill naive" style={{ width: `${m.naive}%` }} />
                        </div>
                        <span className="bench-bar-val">{m.naive}%</span>
                      </div>
                      <div className="bench-bar-row">
                        <span className="bench-bar-label">Neuro-Symbolic:</span>
                        <div className="bench-bar-track">
                          <div className="bench-bar-fill hybrid" style={{ width: `${m.hybrid}%` }} />
                        </div>
                        <span className="bench-bar-val highlight">{m.hybrid}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bench-table-wrap">
                <table className="bench-table">
                  <thead>
                    <tr>
                      <th>Mã Ca</th>
                      <th>Kịch bản Kiểm thử Pháp lý</th>
                      <th>Căn cứ Luật (N / H)</th>
                      <th>Mức phạt (N / H)</th>
                      <th>Guardrail (N / H)</th>
                      <th>Hiệu lực Ngày (N / H)</th>
                      <th>Bằng chứng (N / H)</th>
                      <th>Tốc độ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.cases || []).map((c) => (
                      <tr key={c.id}>
                        <td><b>{c.id}</b></td>
                        <td>{c.category}</td>
                        <td className="center-cell">
                          {c.n_citation ? '✅' : '❌'} / <b>{c.h_citation ? '✅' : '❌'}</b>
                        </td>
                        <td className="center-cell">
                          {c.n_fine_age ? '✅' : '❌'} / <b>{c.h_fine_age ? '✅' : '❌'}</b>
                        </td>
                        <td className="center-cell">
                          {c.n_subject_guardrail ? '✅' : '❌'} / <b>{c.h_subject_guardrail ? '✅' : '❌'}</b>
                        </td>
                        <td className="center-cell">
                          {c.n_temporal ? '✅' : '❌'} / <b>{c.h_temporal ? '✅' : '❌'}</b>
                        </td>
                        <td className="center-cell">
                          {c.n_grounded ? '✅' : '❌'} / <b>{c.h_grounded ? '✅' : '❌'}</b>
                        </td>
                        <td className="center-cell">{c.elapsed_seconds}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hasAnswerDetails && (
                <details className="benchmark-answers">
                  <summary>Xem câu trả lời gốc để rà soát từng ca</summary>
                  {data.cases.map((c) => (
                    <section key={`${c.id}-answers`}>
                      <b>{c.id}: {c.category}</b>
                      <p><b>Naive RAG</b><br />{c.naive_answer}</p>
                      <p><b>Hybrid RAG</b><br />{c.hybrid_answer}</p>
                    </section>
                  ))}
                </details>
              )}
            </>
          ) : null}

          <div className="modal-actions space-between">
            <button
              type="button"
              className="open-neo4j-web-btn"
              onClick={() => onRunBenchmark(true)}
              disabled={isLoading}
            >
              <RefreshCw size={14} aria-hidden="true" />
              <span>Chạy kiểm thử LLM thực tế (có thể tính phí)</span>
            </button>
            <button type="button" onClick={onClose} className="close-modal-secondary">
              Đóng bảng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN APP: KIẾN TRÚC 3 SHELL LEXIT (PUBLIC LANDING / DARK AI WORKSPACE / LIGHT PROFILE)
// ============================================================================
function createBlankConversation() {
  return {
    id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: 'Cuộc trò chuyện mới',
    pinned: false,
    updatedAt: Date.now(),
    messages: [],
  };
}

function getConversationSignature(conv) {
  if (!conv) return '';
  return `${conv.id}|${conv.title || ''}|${Boolean(conv.pinned)}|${conv.messages?.length || 0}|${conv.updatedAt || 0}`;
}

function App() {
  // Toàn bộ định tuyến ứng dụng 3 Shell (/home, /auth/*, /assistant/*, /profile/*)
  const [appRoute, setAppRoute] = useState(() =>
    parseAppRoute(window.location.pathname, window.location.search)
  );

  const navigateTo = useCallback((targetPath, { replace = false } = {}) => {
    const rawTarget = String(targetPath || '/home');
    const url = new URL(rawTarget, window.location.origin);
    const fullTarget = `${url.pathname}${url.search}`;
    const currentFull = `${window.location.pathname}${window.location.search}`;
    if (fullTarget !== currentFull) {
      if (replace) {
        window.history.replaceState({}, '', fullTarget);
      } else {
        window.history.pushState({}, '', fullTarget);
      }
    }
    setAppRoute(parseAppRoute(url.pathname, url.search));
  }, []);

  // Chuẩn hóa URL "/" -> "/home" và đồng bộ nút Back/Forward của trình duyệt
  useEffect(() => {
    if (window.location.pathname === '/' || window.location.pathname === '') {
      window.history.replaceState({}, '', '/home');
    }
    const onPopState = () => {
      setAppRoute(parseAppRoute(window.location.pathname, window.location.search));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Đặt data-theme phù hợp cho từng shell (Light cho /profile/*, Dark cho /home, /auth/*, /assistant/*)
  useEffect(() => {
    document.documentElement.setAttribute(
      'data-theme',
      appRoute.shell === 'profile' ? 'light' : 'dark'
    );
  }, [appRoute.shell]);

  // Quản lý danh sách cuộc trò chuyện (đồng bộ PostgreSQL + bộ nhớ đệm localStorage)
  const [conversations, setConversations] = useState(() => {
    try {
      const saved = localStorage.getItem('lexit_conversations_v2');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((c) => ({
            ...c,
            messages: Array.isArray(c.messages)
              ? c.messages.map((m) => (m && m.streaming ? { ...m, streaming: false } : m))
              : [],
          }));
        }
      }
    } catch {
      // ignore
    }
    return [createBlankConversation()];
  });

  const [activeConvId, setActiveConvId] = useState(() => conversations[0]?.id || 'conv-default');
  const [input, setInput] = useState('');
  const [asOfDate, setAsOfDate] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isComparisonMode, setIsComparisonMode] = useState(false);
  const [showSymbolicPanel, setShowSymbolicPanel] = useState(false);
  const [isGraphFullscreen, setIsGraphFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState('sources'); // 'sources' | 'rules'
  const [isLoading, setIsLoading] = useState(false);
  const [currentSymbolicData, setCurrentSymbolicData] = useState(null);
  const [copiedMsgIdx, setCopiedMsgIdx] = useState(null);

  // Bằng chứng Ảnh chụp màn hình / PDF đính kèm (OCR & Vision Evidence)
  const [evidenceAttachment, setEvidenceAttachment] = useState(null);
  const [isUploadingEvidence, setIsUploadingEvidence] = useState(false);
  const evidenceInputRef = useRef(null);

  // Bảng Thực nghiệm Định lượng Trực tiếp (Benchmark Modal)
  const [showBenchmarkModal, setShowBenchmarkModal] = useState(false);
  const [benchmarkData, setBenchmarkData] = useState(null);
  const [isLoadingBenchmark, setIsLoadingBenchmark] = useState(false);
  const [benchmarkError, setBenchmarkError] = useState('');

  const [backendStatus, setBackendStatus] = useState({ pgvector: false, vectorCount: null });

  // Tài khoản & Bộ công cụ LegalTech
  const [userToken, setUserToken] = useState(() => readStoredAuth().token);
  const [currentUser, setCurrentUser] = useState(() => readStoredAuth().user);
  const [showComplianceModal, setShowComplianceModal] = useState(false);
  const [showDraftingModal, setShowDraftingModal] = useState(false);
  const [articleDetailTarget, setArticleDetailTarget] = useState(null);

  // Tìm kiếm / Ghim / Đổi tên lịch sử & Lọc chủ đề + Giọng nói (Mic / TTS)
  const [historySearch, setHistorySearch] = useState('');
  const [renamingConvId, setRenamingConvId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [selectedTopicFilter, setSelectedTopicFilter] = useState('ALL');
  const [isListening, setIsListening] = useState(false);
  const [speakingMsgIdx, setSpeakingMsgIdx] = useState(null);
  const recognitionRef = useRef(null);

  const chatEndRef = useRef(null);
  const scrollViewportRef = useRef(null);
  const isNearBottomRef = useRef(true);
  const textareaRef = useRef(null);
  const abortControllerRef = useRef(null);
  const syncedSignaturesRef = useRef(new Map());

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConvId) || conversations[0],
    [conversations, activeConvId]
  );
  const messages = activeConversation?.messages ?? EMPTY_MESSAGES;

  // Lưu bản sao dự phòng hội thoại vào localStorage
  useEffect(() => {
    try {
      localStorage.setItem('lexit_conversations_v2', JSON.stringify(conversations));
    } catch {
      // ignore
    }
  }, [conversations]);

  const persistConversationToBackend = useCallback(
    (conv, tokenOverride) => {
      const token = tokenOverride || userToken;
      if (!token || !conv?.id || !(conv.messages?.length > 0)) return;
      if (conv.messages.some((m) => m?.streaming)) return;
      const sig = getConversationSignature(conv);
      if (syncedSignaturesRef.current.get(conv.id) === sig) return;
      syncedSignaturesRef.current.set(conv.id, sig);
      axios
        .put(
          `${API_BASE_URL}/conversations/${encodeURIComponent(conv.id)}`,
          {
            id: conv.id,
            title: conv.title || 'Cuộc trò chuyện mới',
            pinned: Boolean(conv.pinned),
            messages: conv.messages,
            updatedAt: conv.updatedAt || Date.now(),
          },
          { headers: { ...API_HEADERS, 'X-User-Token': token } }
        )
        .catch(() => {
          syncedSignaturesRef.current.delete(conv.id);
        });
    },
    [userToken]
  );

  // Tự động đồng bộ hội thoại đang mở về PostgreSQL khi AI trả lời xong
  useEffect(() => {
    if (!userToken || isLoading || !activeConversation) return;
    if ((activeConversation.messages?.length || 0) === 0) return;
    persistConversationToBackend(activeConversation, userToken);
  }, [userToken, isLoading, activeConversation, persistConversationToBackend]);

  // Xác thực lại phiên đăng nhập & tải lịch sử hội thoại thật từ PostgreSQL
  useEffect(() => {
    if (!userToken) return undefined;
    let cancelled = false;
    const headers = { ...API_HEADERS, 'X-User-Token': userToken };

    axios
      .get(`${API_BASE_URL}/auth/me`, { headers })
      .then((res) => {
        if (!cancelled && res.data?.user) {
          setCurrentUser(res.data.user);
          let persistedInLocal = true;
          try {
            persistedInLocal = Boolean(localStorage.getItem('lexit_user_token_v1'));
          } catch {
            persistedInLocal = true;
          }
          persistStoredAuth({
            user: res.data.user,
            token: userToken,
            rememberMe: persistedInLocal,
          });
        }
      })
      .catch((err) => {
        if (!cancelled && err?.response?.status === 401) {
          setUserToken('');
          setCurrentUser(null);
          clearStoredAuth();
        }
      });

    axios
      .get(`${API_BASE_URL}/conversations`, { headers, params: { limit: 50 } })
      .then((res) => {
        if (cancelled) return;
        const serverItems = Array.isArray(res.data?.items) ? res.data.items : [];
        if (serverItems.length === 0) return;
        const normalized = serverItems.map((c) => {
          const cleanConv = {
            id: c.id,
            title: c.title || 'Cuộc trò chuyện mới',
            pinned: Boolean(c.pinned),
            updatedAt: c.updatedAt || Date.now(),
            messages: Array.isArray(c.messages)
              ? c.messages.map((m) => (m && m.streaming ? { ...m, streaming: false } : m))
              : [],
          };
          syncedSignaturesRef.current.set(cleanConv.id, getConversationSignature(cleanConv));
          return cleanConv;
        });

        setConversations((prev) => {
          const blankLocal = prev.find((c) => (c.messages?.length || 0) === 0);
          const fresh = blankLocal || createBlankConversation();
          const merged = [fresh, ...normalized.filter((c) => c.id !== fresh.id)];
          return merged;
        });
      })
      .catch(() => {
        // Giữ nguyên bộ nhớ đệm nếu backend tạm thời chưa kết nối
      });

    return () => {
      cancelled = true;
    };
  }, [userToken]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop?.();
        window.speechSynthesis?.cancel?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const handleAuthSuccess = useCallback((userObj, tokenStr, rememberMe = true) => {
    setCurrentUser(userObj);
    setUserToken(tokenStr || '');
    persistStoredAuth({ user: userObj, token: tokenStr || '', rememberMe });
  }, []);

  const handleLogout = useCallback(() => {
    abortControllerRef.current?.abort();
    setUserToken('');
    setCurrentUser(null);
    clearStoredAuth();
    syncedSignaturesRef.current.clear();
    const fresh = createBlankConversation();
    setConversations([fresh]);
    setActiveConvId(fresh.id);
    setCurrentSymbolicData(null);
  }, []);

  const togglePinConversation = (e, id) => {
    e.stopPropagation();
    const target = conversations.find((c) => c.id === id);
    const nextConv = target ? { ...target, pinned: !target.pinned } : null;
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c))
    );
    if (nextConv) {
      persistConversationToBackend(nextConv);
    }
  };

  const startRenameConversation = (e, conv) => {
    e.stopPropagation();
    setRenamingConvId(conv.id);
    setRenameDraft(conv.title || '');
  };

  const commitRenameConversation = (id) => {
    const trimmed = renameDraft.trim();
    if (trimmed) {
      const target = conversations.find((c) => c.id === id);
      const nextConv = target ? { ...target, title: trimmed } : null;
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: trimmed } : c))
      );
      if (nextConv) {
        persistConversationToBackend(nextConv);
      }
    }
    setRenamingConvId(null);
    setRenameDraft('');
  };

  const selectConversationById = useCallback(
    (convId) => {
      if (convId !== activeConvId) {
        abortControllerRef.current?.abort();
        setIsLoading(false);
      }
      setActiveConvId(convId);
      const found = conversations.find((c) => c.id === convId);
      const lastSym = found?.messages
        ?.slice()
        .reverse()
        .find((m) => m.symbolicData)?.symbolicData;
      setCurrentSymbolicData(lastSym || null);
    },
    [activeConvId, conversations]
  );

  const toggleVoiceInput = () => {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      window.alert('Trình duyệt của bạn chưa hỗ trợ Web Speech API (khuyến nghị Chrome/Edge).');
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop?.();
      setIsListening(false);
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'vi-VN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      if (transcript.trim()) {
        setInput((prev) => (prev ? `${prev} ${transcript.trim()}` : transcript.trim()));
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const toggleReadAloud = (idx, rawText) => {
    if (!window.speechSynthesis) return;
    if (speakingMsgIdx === idx) {
      window.speechSynthesis.cancel();
      setSpeakingMsgIdx(null);
      return;
    }
    window.speechSynthesis.cancel();
    const plainText = String(rawText || '')
      .replace(/[#*`>_~|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1500);
    if (!plainText) return;
    const utter = new SpeechSynthesisUtterance(plainText);
    utter.lang = 'vi-VN';
    utter.rate = 1.02;
    utter.onend = () => setSpeakingMsgIdx(null);
    utter.onerror = () => setSpeakingMsgIdx(null);
    setSpeakingMsgIdx(idx);
    window.speechSynthesis.speak(utter);
  };

  // Kiểm tra sức khỏe Backend & PGVector ngay khi mở App
  const checkBackendHealth = useCallback(() => {
    axios
      .get(`${API_BASE_URL}/health`, { headers: API_HEADERS })
      .then((res) => {
        setBackendStatus({
          pgvector: Boolean(res.data?.pgvector_ready),
          vectorCount: typeof res.data?.vector_count === 'number' ? res.data.vector_count : null,
        });
      })
      .catch(() => {
        setBackendStatus({ pgvector: false, vectorCount: null });
      });
  }, []);

  useEffect(() => {
    checkBackendHealth();
  }, [checkBackendHealth]);

  useEffect(() => {
    if (isNearBottomRef.current) {
      chatEndRef.current?.scrollIntoView({ behavior: isLoading ? 'auto' : 'smooth' });
    }
  }, [messages, isLoading]);

  const handleViewportScroll = useCallback((e) => {
    const el = e.currentTarget;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  // Tự động co giãn chiều cao ô nhập giống ChatGPT
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '24px';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  // Tạo cuộc trò chuyện mới
  const createNewChat = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsLoading(false);
    const existingBlank = conversations.find((c) => (c.messages?.length || 0) === 0);
    if (existingBlank) {
      setActiveConvId(existingBlank.id);
      setCurrentSymbolicData(null);
      setInput('');
      return;
    }
    const newConv = createBlankConversation();
    setConversations((prev) => [newConv, ...prev]);
    setActiveConvId(newConv.id);
    setCurrentSymbolicData(null);
    setInput('');
  }, [conversations]);

  const deleteConversation = useCallback(
    (e, id) => {
      e?.stopPropagation?.();
      if (id === activeConvId) {
        abortControllerRef.current?.abort();
        setIsLoading(false);
      }
      syncedSignaturesRef.current.delete(id);
      if (userToken) {
        axios
          .delete(`${API_BASE_URL}/conversations/${encodeURIComponent(id)}`, {
            headers: { ...API_HEADERS, 'X-User-Token': userToken },
          })
          .catch(() => {
            // ignore network errors on delete
          });
      }
      setConversations((prev) => {
        const remaining = prev.filter((c) => c.id !== id);
        if (remaining.length === 0) {
          const fallback = createBlankConversation();
          setActiveConvId(fallback.id);
          return [fallback];
        }
        if (id === activeConvId) {
          setActiveConvId(remaining[0].id);
        }
        return remaining;
      });
    },
    [activeConvId, userToken]
  );

  // Vũ khí 1: Xử lý tải lên ảnh chụp màn hình / PDF bằng chứng để OCR tự động
  const handleEvidenceUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (file.size > 10 * 1024 * 1024) {
      setEvidenceAttachment({
        filename: file.name,
        char_count: 0,
        word_count: 0,
        extracted_text: '',
        is_valid_evidence: false,
        rejection_reason: 'Tệp vượt giới hạn 10 MB.',
      });
      return;
    }
    setIsUploadingEvidence(true);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64Part = extractBase64FromDataUrl(reader.result);
        const res = await axios.post(`${API_BASE_URL}/analyze-evidence`, {
          filename: file.name,
          content_base64: base64Part,
        }, { headers: API_HEADERS });
        setEvidenceAttachment(res.data);
      } catch (err) {
        console.error('Lỗi phân tích bằng chứng:', err);
        setEvidenceAttachment({
          filename: file.name,
          char_count: 0,
          word_count: 0,
          extracted_text: '',
          is_valid_evidence: false,
          rejection_reason: 'Không thể trích xuất văn bản hợp lệ từ tệp đính kèm.',
        });
      } finally {
        setIsUploadingEvidence(false);
      }
    };
    reader.onerror = () => {
      setIsUploadingEvidence(false);
      setEvidenceAttachment({
        filename: file.name,
        char_count: 0,
        word_count: 0,
        extracted_text: '',
        is_valid_evidence: false,
        rejection_reason: 'Không đọc được tệp từ thiết bị. Vui lòng thử lại hoặc chọn tệp khác.',
      });
    };
    reader.readAsDataURL(file);
  };

  // Vũ khí 5: Mở & chạy Bảng Thực nghiệm Định lượng (Benchmark)
  const handleRunBenchmark = useCallback(async (live = false) => {
    setShowBenchmarkModal(true);
    setIsLoadingBenchmark(true);
    setBenchmarkError('');
    try {
      const res = await axios.get(`${API_BASE_URL}/benchmark/run`, { params: { live }, headers: API_HEADERS });
      setBenchmarkData(res.data);
    } catch (err) {
      console.error('Lỗi chạy benchmark:', err);
      setBenchmarkError(
        formatApiErrorMessage(
          err,
          'Không thể chạy kiểm thử Benchmark lúc này. Vui lòng kiểm tra kết nối Backend.'
        )
      );
    } finally {
      setIsLoadingBenchmark(false);
    }
  }, []);

  // Gửi câu hỏi với luồng Streaming thời gian thực
  const sendMessage = async (questionText) => {
    const hasExplicitQuestion = typeof questionText === 'string' && questionText.trim().length > 0;
    const rawTyped = (hasExplicitQuestion ? questionText : input).trim();
    if (!canSubmitMessage({ rawTyped, evidenceAttachment, isLoading, hasExplicitQuestion })) return;

    const {
      textToSend,
      asOfDateToSend,
      displayUserText,
      shouldClearInput,
      shouldClearEvidence,
    } = buildChatSubmissionPayload({
      rawTyped,
      evidenceAttachment,
      selectedTopicFilter,
      topicFilters: TOPIC_FILTERS,
      asOfDate,
      hasExplicitQuestion,
    });

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    isNearBottomRef.current = true;
    const targetConvId = activeConvId;

    const historyPayload = messages
      .filter((m) => !m.streaming && m.text && !String(m.text).startsWith('⚠️'))
      .slice(-4)
      .map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        text: String(m.text || '').slice(0, 1800),
      }));

    const userMessage = { id: createMessageId(), role: 'user', text: displayUserText };
    const updatedTitle =
      messages.length === 0
        ? displayUserText.slice(0, 38) + (displayUserText.length > 38 ? '…' : '')
        : activeConversation.title;

    const botMsgId = createMessageId();
    const initialBotMessage = {
      id: botMsgId,
      role: 'bot',
      text: '',
      naiveText: null,
      symbolicData: null,
      streaming: true,
    };

    setConversations((prev) =>
      prev.map((c) =>
        c.id === targetConvId
          ? {
              ...c,
              title: updatedTitle,
              updatedAt: Date.now(),
              messages: [...c.messages, userMessage, initialBotMessage],
            }
          : c
      )
    );

    if (shouldClearInput) setInput('');
    if (shouldClearEvidence) setEvidenceAttachment(null);
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...API_HEADERS },
        signal: controller.signal,
        body: JSON.stringify({
          question: textToSend,
          as_of_date: asOfDateToSend,
          comparison_mode: isComparisonMode,
          history: historyPayload,
        }),
      });

      if (!res.ok || !res.body) {
        let detailMsg = '';
        try {
          const errPayload = await res.json();
          if (typeof errPayload?.detail === 'string') {
            detailMsg = errPayload.detail;
          } else if (Array.isArray(errPayload?.detail)) {
            detailMsg = errPayload.detail.map((d) => d.msg || JSON.stringify(d)).join('; ');
          }
        } catch {
          // ignore non-JSON error body
        }
        const httpErr = new Error(detailMsg || `HTTP ${res.status}`);
        httpErr.status = res.status;
        httpErr.detail = detailMsg;
        throw httpErr;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedText = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          let evt;
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }

          if (evt.type === 'meta') {
            const latestSymbolic = buildSymbolicState(evt);
            setCurrentSymbolicData(latestSymbolic);
            setConversations((prev) =>
              prev.map((c) =>
                c.id === targetConvId
                  ? {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === botMsgId
                          ? {
                              ...m,
                              symbolicData: latestSymbolic,
                              suggestedFollowups: evt.suggested_followups || m.suggestedFollowups || [],
                            }
                          : m
                      ),
                    }
                  : c
              )
            );
          } else if (evt.type === 'token') {
            accumulatedText += evt.content || '';
            const snapshot = accumulatedText;
            setConversations((prev) =>
              prev.map((c) =>
                c.id === targetConvId
                  ? {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === botMsgId ? { ...m, text: snapshot } : m
                      ),
                    }
                  : c
              )
            );
          } else if (evt.type === 'done') {
            const finalText = evt.answer || accumulatedText;
            setConversations((prev) =>
              prev.map((c) =>
                c.id === targetConvId
                  ? {
                      ...c,
                      updatedAt: Date.now(),
                      messages: c.messages.map((m) =>
                        m.id === botMsgId
                          ? {
                              ...m,
                              text: finalText,
                              naiveText: evt.naive_answer,
                              suggestedFollowups: evt.suggested_followups || m.suggestedFollowups || [],
                              streaming: false,
                            }
                          : m
                      ),
                    }
                  : c
              )
            );
          }
        }
      }

      if (buffer.trim()) {
        try {
          const evt = JSON.parse(buffer.trim());
          if (evt.type === 'token') {
            accumulatedText += evt.content || '';
            const snapshot = accumulatedText;
            setConversations((prev) =>
              prev.map((c) =>
                c.id === targetConvId
                  ? {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === botMsgId ? { ...m, text: snapshot } : m
                      ),
                    }
                  : c
              )
            );
          } else if (evt.type === 'done') {
            const finalText = evt.answer || accumulatedText;
            setConversations((prev) =>
              prev.map((c) =>
                c.id === targetConvId
                  ? {
                      ...c,
                      updatedAt: Date.now(),
                      messages: c.messages.map((m) =>
                        m.id === botMsgId
                          ? {
                              ...m,
                              text: finalText,
                              naiveText: evt.naive_answer,
                              suggestedFollowups: evt.suggested_followups || m.suggestedFollowups || [],
                              streaming: false,
                            }
                          : m
                      ),
                    }
                  : c
              )
            );
          }
        } catch {
          // ignore trailing incomplete JSON
        }
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.error('Lỗi gọi API:', error);
      let recovered = false;
      if (error?.status !== 401 && error?.status !== 413 && error?.status !== 429) {
        try {
          const fallbackRes = await fetch(`${API_BASE_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...API_HEADERS },
            signal: controller.signal,
            body: JSON.stringify({
              question: textToSend,
              as_of_date: asOfDateToSend,
              comparison_mode: isComparisonMode,
              history: historyPayload,
            }),
          });
          if (fallbackRes.ok) {
            const data = await fallbackRes.json();
            const latestSymbolic = buildSymbolicState(data);
            setCurrentSymbolicData(latestSymbolic);
            setConversations((prev) =>
              prev.map((c) =>
                c.id === targetConvId
                  ? {
                      ...c,
                      updatedAt: Date.now(),
                      messages: c.messages.map((m) =>
                        m.id === botMsgId
                          ? {
                              ...m,
                              text: data.answer || '',
                              naiveText: data.naive_answer,
                              symbolicData: latestSymbolic,
                              suggestedFollowups: data.suggested_followups || [],
                              streaming: false,
                            }
                          : m
                      ),
                    }
                  : c
              )
            );
            recovered = true;
          }
        } catch {
          // fallback also failed
        }
      }
      if (!recovered) {
        const errText = error?.status
          ? `⚠️ **Yêu cầu không thành công (HTTP ${error.status}):** ${error.detail || 'Máy chủ từ chối yêu cầu hoặc quá tải tạm thời. Vui lòng thử lại.'}`
          : '⚠️ **Không thể kết nối tới máy chủ Backend (`http://127.0.0.1:8000`).**\n\nHãy đảm bảo bạn đã chạy lệnh `python main.py` trong thư mục `backend/` và container Docker PostgreSQL (`law_postgres_graph`) đang hoạt động.';
        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetConvId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === botMsgId ? { ...m, text: errText, streaming: false } : m
                  ),
                }
              : c
          )
        );
      }
    } finally {
      setIsLoading(false);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === targetConvId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === botMsgId && m.streaming ? { ...m, streaming: false } : m
                ),
              }
            : c
        )
      );
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const copyMessage = (idx, text) => {
    safeCopyToClipboard(text);
    setCopiedMsgIdx(idx);
    setTimeout(() => setCopiedMsgIdx(null), 1800);
  };

  const activeSymbolic =
    currentSymbolicData ||
    messages
      .slice()
      .reverse()
      .find((m) => m.symbolicData)?.symbolicData;

  const openArticleDetail = useCallback(
    (payload) => {
      if (!payload?.docCode || !payload?.articleNumber) return;
      setArticleDetailTarget({
        docCode: payload.docCode,
        articleNumber: String(payload.articleNumber),
        asOf: payload.asOf || payload.asOfDate || resolveArticleDrawerAsOf(activeSymbolic, asOfDate),
      });
    },
    [activeSymbolic, asOfDate]
  );

  const askInWorkspaceChat = (promptText) => {
    if (appRoute.shell !== 'workspace' || appRoute.page !== 'chat') {
      navigateTo('/assistant/lexit/new');
    }
    sendMessage(promptText);
  };

  // ====================================================================
  // SHELL 1: PUBLIC DARK MARKETING LANDING (/home)
  // ====================================================================
  if (appRoute.shell === 'home') {
    return (
      <div className="lx-home-shell-wrap dark-theme">
        <HomePage
          apiBaseUrl={API_BASE_URL}
          apiHeaders={API_HEADERS}
          currentUser={currentUser}
          onNavigate={navigateTo}
          onOpenBenchmark={() => handleRunBenchmark(false)}
          onLogout={() => {
            handleLogout();
            navigateTo('/home');
          }}
        />
        <BenchmarkModal
          isOpen={showBenchmarkModal}
          onClose={() => setShowBenchmarkModal(false)}
          data={benchmarkData}
          isLoading={isLoadingBenchmark}
          error={benchmarkError}
          onRunBenchmark={handleRunBenchmark}
        />
      </div>
    );
  }

  // ====================================================================
  // AUTH SHELL (/auth/login, /auth/register) & PROTECTED ROUTE GUARD
  // ====================================================================
  if (appRoute.shell === 'auth' || (isProtectedShell(appRoute.shell) && !currentUser)) {
    const isGuardRedirect = appRoute.shell !== 'auth';
    const authMode = isGuardRedirect ? 'login' : appRoute.page;
    const redirectDestination = sanitizeNextPath(
      isGuardRedirect ? appRoute.path : appRoute.next || '/assistant/lexit/new'
    );

    return (
      <AuthPage
        mode={authMode}
        onChangeMode={(nextMode) => {
          const targetAuthPath =
            nextMode === 'register'
              ? `/auth/register?next=${encodeURIComponent(redirectDestination)}`
              : buildLoginRedirectPath(redirectDestination);
          navigateTo(targetAuthPath);
        }}
        onClose={() => navigateTo('/home')}
        onAuthComplete={() => navigateTo(redirectDestination, { replace: true })}
        apiBaseUrl={API_BASE_URL}
        apiHeaders={API_HEADERS}
        currentUser={currentUser}
        onAuthSuccess={handleAuthSuccess}
        onLogout={() => {
          handleLogout();
          navigateTo('/home');
        }}
      />
    );
  }

  // ====================================================================
  // SHELL 3: CRISP LIGHT-MODE ACCOUNT & SETTINGS SHELL (/profile/*)
  // ====================================================================
  if (appRoute.shell === 'profile') {
    return (
      <ProfileLayout
        key={`${appRoute.page}-${currentUser?.id || 'user'}`}
        activeTab={appRoute.page}
        currentUser={currentUser}
        userToken={userToken}
        apiBaseUrl={API_BASE_URL}
        apiHeaders={API_HEADERS}
        conversations={conversations}
        onNavigate={navigateTo}
        onAuthSuccess={handleAuthSuccess}
        onLogout={() => {
          handleLogout();
          navigateTo('/home');
        }}
        onSelectConversation={selectConversationById}
        onDeleteConversation={deleteConversation}
        onNewChat={createNewChat}
      />
    );
  }

  // ====================================================================
  // SHELL 2: FULL-HEIGHT DARK AI WORKSPACE (/assistant/*)
  // ====================================================================
  return (
    <div className="lx-ws-root chatgpt-app dark-theme">
      <AuthWireframeBackdrop />

      {/* Lớp phủ mờ đóng sidebar khi bấm ra ngoài trên thiết bị di động */}
      {sidebarOpen && (
        <div
          className="sidebar-mobile-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* 1. LEFT DARK WORKSPACE SIDEBAR */}
      <WorkspaceSidebar
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
        activePage={appRoute.page}
        currentUser={currentUser}
        backendStatus={backendStatus}
        conversations={conversations}
        activeConvId={activeConvId}
        historySearch={historySearch}
        onHistorySearchChange={setHistorySearch}
        renamingConvId={renamingConvId}
        renameDraft={renameDraft}
        onRenameDraftChange={setRenameDraft}
        onStartRename={startRenameConversation}
        onCommitRename={commitRenameConversation}
        onCancelRename={() => {
          setRenamingConvId(null);
          setRenameDraft('');
        }}
        onSelectConversation={selectConversationById}
        onTogglePin={togglePinConversation}
        onDeleteConversation={deleteConversation}
        onNewChat={createNewChat}
        onNavigate={navigateTo}
        onOpenDrafting={() => setShowDraftingModal(true)}
        onOpenCompliance={() => setShowComplianceModal(true)}
        onOpenBenchmark={() => handleRunBenchmark(false)}
        onLogout={() => {
          handleLogout();
          navigateTo('/home');
        }}
      />

      {/* 2. MAIN WORKSPACE STAGE */}
      <div className="lx-ws-stage">
        {!sidebarOpen && (
          <button
            type="button"
            className="lx-ws-floating-open-sidebar"
            onClick={() => setSidebarOpen(true)}
            title="Mở thanh bên"
            aria-label="Mở thanh bên điều hướng"
          >
            <PanelLeftOpen size={17} />
          </button>
        )}

        {appRoute.page === 'legal-document' ? (
          <LegalDocumentSearchPage
            apiBaseUrl={API_BASE_URL}
            apiHeaders={API_HEADERS}
            defaultAsOfDate={asOfDate || '2026-11-19'}
            onOpenArticleDetail={openArticleDetail}
            onAskAboutDocument={askInWorkspaceChat}
          />
        ) : appRoute.page === 'judgement' ? (
          <PrecedentSearchPage
            apiBaseUrl={API_BASE_URL}
            apiHeaders={API_HEADERS}
            defaultAsOfDate={asOfDate || '2026-11-19'}
            onOpenArticleDetail={openArticleDetail}
            onAskAboutPrecedent={askInWorkspaceChat}
          />
        ) : appRoute.page === 'legal-update' ? (
          <LegalUpdatePage
            apiBaseUrl={API_BASE_URL}
            apiHeaders={API_HEADERS}
            defaultAsOfDate={asOfDate || '2026-11-19'}
            onNavigate={navigateTo}
            onOpenArticleDetail={openArticleDetail}
            onAskAboutDocument={askInWorkspaceChat}
          />
        ) : (
          <div className="lx-ws-chat-wrap">
            {/* KHU VỰC HỎI ĐÁP AI TRUNG TÂM */}
            <main className="chatgpt-main lx-ws-chat-main">
              <header className="chatgpt-topbar lx-ws-chat-topbar">
                <div className="topbar-left" style={!sidebarOpen ? { paddingLeft: '2.75rem' } : undefined}>
                  <div className="model-selector-pill">
                    <Scale size={16} className="model-icon" />
                    <span className="model-name">LexIT Neuro-Symbolic</span>
                    <span className="model-version">2.2 Hybrid</span>
                  </div>
                </div>

                <div className="topbar-right">
                  <button
                    type="button"
                    className="topbar-pill-btn benchmark-trigger-btn"
                    onClick={() => handleRunBenchmark(false)}
                    title="Mở bảng thực nghiệm định lượng 40 ca (Naive RAG vs. Hybrid RAG)"
                    aria-label="Kiểm chứng 40 ca"
                  >
                    <BarChart3 size={15} />
                    <span>Kiểm chứng 40 ca</span>
                  </button>

                  <button
                    type="button"
                    className={`topbar-pill-btn ${isComparisonMode ? 'active-ab' : ''}`}
                    onClick={() => setIsComparisonMode(!isComparisonMode)}
                    aria-pressed={isComparisonMode}
                    title="So sánh song song Naive Vector RAG vs. Neuro-Symbolic Hybrid RAG"
                    aria-label="So sánh đối chứng A/B"
                  >
                    {isComparisonMode ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}
                    <span>So sánh A/B</span>
                  </button>

                  <button
                    type="button"
                    className={`topbar-pill-btn ${showSymbolicPanel ? 'active-graph' : ''}`}
                    onClick={() => setShowSymbolicPanel(!showSymbolicPanel)}
                    aria-pressed={showSymbolicPanel}
                    aria-label="Bật hoặc tắt bảng Văn bản liên quan và Dấu vết Logic"
                  >
                    <BookOpen size={15} />
                    <span>Văn bản & Dấu vết</span>
                  </button>
                </div>
              </header>

              {/* Nội dung cuộc trò chuyện hoặc Màn hình Chào mừng Dark LexIT */}
              <div
                ref={scrollViewportRef}
                className="chatgpt-scroll-viewport"
                onScroll={handleViewportScroll}
              >
                {messages.length === 0 ? (
                  <div className="chatgpt-welcome lx-ws-welcome">
                    <div className="welcome-badge-hero lx-ws-welcome-badge">
                      <Scale size={28} />
                    </div>
                    <h1 className="welcome-heading">
                      Chào {currentUser?.full_name?.split(' ').slice(-1)[0] || 'bạn'}! LexIT có thể giúp gì về Pháp luật CNTT hôm nay?
                    </h1>
                    <p className="lx-ws-welcome-sub">
                      Truy vấn trực tiếp PGVector 3072 chiều kết hợp Rule Engine tất định để tính mức phạt,
                      kiểm soát hiệu lực văn bản theo ngày và rà soát chứng cứ OCR.
                    </p>

                    <div className="starter-grid">
                      {SAMPLE_QUESTIONS.map((item, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="starter-card"
                          onClick={() => sendMessage(item.text)}
                        >
                          <div className="starter-card-top">
                            <span className="starter-card-title">{item.title}</span>
                            <span className="starter-card-tag">{item.tag}</span>
                          </div>
                          <p className="starter-card-desc">{item.text}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className={`chatgpt-thread ${isComparisonMode ? 'wide' : ''}`}>
                    {messages.map((msg, index) => {
                      if (msg.role === 'user') {
                        return (
                          <div key={msg.id || `user-${index}`} className="chatgpt-user-turn">
                            <div className="chatgpt-user-bubble">{msg.text}</div>
                          </div>
                        );
                      }

                      const stepCount = msg.symbolicData?.reasoning?.rule_steps?.length || 0;
                      const srcCount = msg.symbolicData?.sources?.length || 0;

                      return (
                        <div key={msg.id || `bot-${index}`} className="chatgpt-bot-turn">
                          <div className="chatgpt-bot-avatar">
                            <Scale size={16} />
                          </div>
                          <div className="chatgpt-bot-content">
                            <div className="bot-author-line">
                              <span className="bot-author-name">LexIT Neuro-Symbolic</span>
                              <span className="bot-author-badge">Hybrid AI</span>
                            </div>

                            {msg.streaming && !msg.text ? (
                              <div
                                className="chatgpt-loading-box"
                                role="status"
                                aria-live="polite"
                                aria-busy="true"
                              >
                                <div className="loading-title">
                                  Đang truy xuất căn cứ pháp luật & suy luận Symbolic...
                                </div>
                                <div className="loading-steps-inline">
                                  <span>1. PGVector Hybrid</span>
                                  <span>→</span>
                                  <span>2. Phân tích Điều luật</span>
                                  <span>→</span>
                                  <span>3. Rule Engine</span>
                                </div>
                                <div className="skeleton-lines" aria-hidden="true">
                                  <div className="skeleton-bar w-90" />
                                  <div className="skeleton-bar w-75" />
                                  <div className="skeleton-bar w-55" />
                                </div>
                              </div>
                            ) : isComparisonMode && msg.naiveText ? (
                              <div className="comparison-container">
                                <div className="comparison-card naive-card">
                                  <div className="card-header naive-header">
                                    <span className="card-badge">NAIVE VECTOR RAG (CHỈ DÙNG VECTOR)</span>
                                    <span className="warning-chip">Dễ nhầm chủ thể/mức phạt</span>
                                  </div>
                                  <div className="card-body markdown-prose">
                                    <ReactMarkdown>{cleanLegalMarkdown(msg.naiveText)}</ReactMarkdown>
                                  </div>
                                </div>

                                <div className="comparison-card hybrid-card">
                                  <div className="card-header hybrid-header">
                                    <span className="card-badge highlight">NEURO-SYMBOLIC HYBRID RAG</span>
                                    <span className="success-chip">Chính xác theo Rule Engine</span>
                                  </div>
                                  <div className="card-body markdown-prose">
                                    <ReactMarkdown>{cleanLegalMarkdown(msg.text)}</ReactMarkdown>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="markdown-prose">
                                <ReactMarkdown>{cleanLegalMarkdown(msg.text)}</ReactMarkdown>
                              </div>
                            )}

                            {msg.text && (
                              <div className="bot-message-actions">
                                <button
                                  type="button"
                                  className="msg-action-btn"
                                  onClick={() => copyMessage(index, msg.text)}
                                  title="Sao chép câu trả lời"
                                >
                                  {copiedMsgIdx === index ? <Check size={14} /> : <Copy size={14} />}
                                  <span>{copiedMsgIdx === index ? 'Đã chép' : 'Sao chép'}</span>
                                </button>

                                <button
                                  type="button"
                                  className="msg-action-btn report-export-btn"
                                  onClick={() =>
                                    exportLegalAdvisoryReport(
                                      index > 0 ? messages[index - 1]?.text : '',
                                      msg
                                    )
                                  }
                                  title="Xuất Phiếu Tư vấn Pháp lý / Đơn trình báo chuẩn mẫu (In / PDF)"
                                >
                                  <FileText size={14} />
                                  <span>Xuất Phiếu Tư vấn</span>
                                </button>

                                {msg.symbolicData && (
                                  <>
                                    <button
                                      type="button"
                                      className="msg-action-chip"
                                      onClick={() => {
                                        setCurrentSymbolicData(msg.symbolicData);
                                        setShowSymbolicPanel(true);
                                        setActiveTab('sources');
                                      }}
                                    >
                                      <BookOpen size={13} />
                                      <span>Văn bản liên quan ({srcCount})</span>
                                    </button>
                                    <button
                                      type="button"
                                      className="msg-action-chip rule-chip"
                                      onClick={() => {
                                        setCurrentSymbolicData(msg.symbolicData);
                                        setShowSymbolicPanel(true);
                                        setActiveTab('rules');
                                      }}
                                    >
                                      <GitBranch size={13} />
                                      <span>Dấu vết Logic ({stepCount} bước)</span>
                                    </button>
                                  </>
                                )}

                                <button
                                  type="button"
                                  className={`msg-action-btn ${speakingMsgIdx === index ? 'active-tts' : ''}`}
                                  onClick={() => toggleReadAloud(index, msg.text)}
                                  title={speakingMsgIdx === index ? 'Dừng đọc giọng nói' : 'Nghe đọc câu trả lời (TTS)'}
                                  aria-label={speakingMsgIdx === index ? 'Dừng đọc câu trả lời' : 'Nghe đọc câu trả lời'}
                                >
                                  {speakingMsgIdx === index ? <VolumeX size={14} /> : <Volume2 size={14} />}
                                  <span>{speakingMsgIdx === index ? 'Dừng đọc' : 'Nghe đọc'}</span>
                                </button>
                              </div>
                            )}

                            {!msg.streaming && msg.suggestedFollowups?.length > 0 && (
                              <div className="followup-chips-container" aria-label="Câu hỏi gợi ý tiếp theo">
                                <span className="followup-label">Hỏi tiếp:</span>
                                <div className="followup-chips-list">
                                  {msg.suggestedFollowups.map((q, qIdx) => (
                                    <button
                                      key={qIdx}
                                      type="button"
                                      className="followup-chip-btn"
                                      onClick={() => sendMessage(q)}
                                      disabled={isLoading}
                                    >
                                      <span>{q}</span>
                                      <ChevronRight size={12} />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    <div ref={chatEndRef} />
                  </div>
                )}
              </div>

              {/* Ô nhập câu hỏi nổi ở đáy phong cách Dark Navy Workspace */}
              <div className="chatgpt-composer-zone lx-ws-composer-zone">
                <input
                  ref={evidenceInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.bmp,.pdf,.docx,.txt,.md"
                  className="sr-only"
                  aria-label="Chọn tệp bằng chứng để tải lên"
                  onChange={handleEvidenceUpload}
                />
                <form
                  className="chatgpt-composer-box lx-ws-composer-box"
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendMessage();
                  }}
                >
                  {evidenceAttachment && (
                    <div
                      className={`evidence-attachment-banner ${
                        evidenceAttachment.is_valid_evidence === false ? 'invalid' : ''
                      }`}
                      role="status"
                      aria-live="polite"
                    >
                      <div className="evidence-banner-left">
                        <Paperclip size={14} className="evidence-icon" />
                        <div className="evidence-info">
                          <span className="evidence-name">
                            {evidenceAttachment.is_valid_evidence === false ? '⚠️ Ảnh/Tệp không hợp lệ: ' : 'Bằng chứng: '}
                            <b>{evidenceAttachment.filename}</b> ({evidenceAttachment.char_count} ký tự OCR)
                          </span>
                          <span className="evidence-preview">
                            {evidenceAttachment.is_valid_evidence === false
                              ? evidenceAttachment.rejection_reason || 'Không tìm thấy văn bản pháp lý hoặc hành vi vi phạm trong ảnh.'
                              : `${evidenceAttachment.extracted_text.slice(0, 140)}...`}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="evidence-remove-btn"
                        onClick={() => setEvidenceAttachment(null)}
                        title="Gỡ bằng chứng đính kèm"
                        aria-label="Gỡ bằng chứng đính kèm"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  <div className="topic-filter-bar" role="group" aria-label="Lọc lĩnh vực pháp luật CNTT">
                    {TOPIC_FILTERS.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={`topic-filter-chip ${selectedTopicFilter === t.id ? 'active' : ''}`}
                        onClick={() => setSelectedTopicFilter(t.id)}
                        aria-pressed={selectedTopicFilter === t.id}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <label className="as-of-date-control" title="Bỏ trống để tra cứu theo ngày hiện tại">
                    <span>Áp dụng quy định theo ngày</span>
                    <input
                      type="date"
                      value={asOfDate}
                      onChange={(event) => setAsOfDate(event.target.value)}
                      disabled={isLoading}
                      aria-label="Ngày áp dụng quy định pháp luật"
                    />
                    {asOfDate && (
                      <button type="button" onClick={() => setAsOfDate('')} disabled={isLoading}>
                        Hôm nay
                      </button>
                    )}
                  </label>

                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Hỏi bất kỳ quy định, mức xử phạt, hoặc đính kèm ảnh chụp bằng chứng / PDF..."
                    aria-label="Nhập câu hỏi tư vấn pháp luật CNTT"
                    disabled={isLoading}
                    className="chatgpt-textarea"
                  />

                  <div className="composer-bottom-row">
                    <div className="composer-tags">
                      <button
                        type="button"
                        className={`composer-chip ${evidenceAttachment ? 'active' : ''}`}
                        onClick={() => evidenceInputRef.current?.click()}
                        disabled={isUploadingEvidence || isLoading}
                        title="Đính kèm ảnh chụp màn hình tin nhắn/bài đăng vi phạm hoặc hợp đồng PDF/DOCX để OCR tự động"
                      >
                        {isUploadingEvidence ? <Loader2 size={13} className="spin-icon" /> : <Paperclip size={13} />}
                        <span>
                          {isUploadingEvidence
                            ? 'Đang OCR bằng chứng...'
                            : evidenceAttachment
                              ? 'Đã đính kèm Bằng chứng'
                              : 'Đính kèm Bằng chứng (Ảnh/PDF)'}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`composer-chip ${isComparisonMode ? 'active' : ''}`}
                        onClick={() => setIsComparisonMode(!isComparisonMode)}
                        aria-pressed={isComparisonMode}
                      >
                        <Layers size={13} />
                        <span>Đối chứng A/B: {isComparisonMode ? 'Bật' : 'Tắt'}</span>
                      </button>
                    </div>

                    <div className="composer-right-controls">
                      <button
                        type="button"
                        className={`voice-mic-btn ${isListening ? 'listening' : ''}`}
                        onClick={toggleVoiceInput}
                        disabled={isLoading}
                        title={isListening ? 'Dừng thu âm giọng nói' : 'Nhập câu hỏi bằng giọng nói tiếng Việt'}
                        aria-label={isListening ? 'Dừng thu âm giọng nói' : 'Nhập câu hỏi bằng giọng nói'}
                      >
                        {isListening ? <MicOff size={15} /> : <Mic size={15} />}
                      </button>

                      <button
                        type="submit"
                        disabled={!canSubmitMessage({ rawTyped: input, evidenceAttachment, isLoading, hasExplicitQuestion: false })}
                        className="chatgpt-send-btn lx-ws-send-btn"
                        title={
                          evidenceAttachment?.is_valid_evidence === false
                            ? 'Tệp đính kèm không hợp lệ. Vui lòng gỡ tệp trước khi gửi câu hỏi.'
                            : 'Gửi câu hỏi (Enter)'
                        }
                        aria-label="Gửi câu hỏi"
                      >
                        {isLoading ? <Loader2 size={16} className="spin-icon" /> : <Send size={15} />}
                      </button>
                    </div>
                  </div>
                </form>
                <div className="legal-disclaimer">
                  Thông tin tra cứu tự động kèm trích dẫn văn bản gốc; không thay thế ý kiến tư vấn pháp lý chính thức.
                </div>
              </div>
            </main>

            {/* Nút tab nổi mép phải mở ngăn kéo Văn bản liên quan */}
            {!showSymbolicPanel && (
              <button
                type="button"
                className="lx-ws-right-edge-tab"
                onClick={() => setShowSymbolicPanel(true)}
                title="Mở bảng Văn bản liên quan & Dấu vết Logic"
                aria-label="Mở bảng Văn bản liên quan và Dấu vết Logic"
              >
                <ChevronLeft size={16} />
              </button>
            )}

            {/* 3. NGĂN KÉO PHẢI: VĂN BẢN LIÊN QUAN & DẤU VẾT LOGIC (KHÔNG ĐỒ THỊ 3D) */}
            {showSymbolicPanel && (
              <aside
                className={`symbolic-panel lx-ws-right-drawer ${isGraphFullscreen ? 'fullscreen-panel' : ''}`}
                aria-label="Bảng Văn bản liên quan và Dấu vết Logic"
              >
                <div className="panel-header">
                  <div className="panel-title-group">
                    <Cpu size={18} className="panel-header-icon" />
                    <div>
                      <h3 className="panel-title">Văn bản liên quan &amp; Dấu vết</h3>
                      <span className="panel-sub">
                        Trích dẫn PGVector • Rule Engine tất định
                      </span>
                    </div>
                  </div>
                  <div className="panel-header-actions">
                    <button
                      type="button"
                      className="panel-close-btn"
                      onClick={() => setIsGraphFullscreen(!isGraphFullscreen)}
                      title={isGraphFullscreen ? 'Thu nhỏ' : 'Mở rộng toàn màn hình'}
                      aria-label={isGraphFullscreen ? 'Thu nhỏ bảng phân tích' : 'Mở rộng bảng phân tích toàn màn hình'}
                    >
                      {isGraphFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                    </button>
                    <button
                      type="button"
                      className="panel-close-btn"
                      onClick={() => {
                        setIsGraphFullscreen(false);
                        setShowSymbolicPanel(false);
                      }}
                      title="Đóng bảng"
                      aria-label="Đóng bảng Văn bản liên quan"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                <div className="panel-tabs" role="tablist" aria-label="Các chế độ xem phân tích">
                  <button
                    type="button"
                    id="tab-sources"
                    role="tab"
                    aria-selected={activeTab === 'sources'}
                    aria-controls="tabpanel-symbolic"
                    className={`panel-tab ${activeTab === 'sources' ? 'active' : ''}`}
                    onClick={() => setActiveTab('sources')}
                  >
                    <BookOpen size={14} />
                    <span>Văn bản liên quan</span>
                  </button>
                  <button
                    type="button"
                    id="tab-rules"
                    role="tab"
                    aria-selected={activeTab === 'rules'}
                    aria-controls="tabpanel-symbolic"
                    className={`panel-tab ${activeTab === 'rules' ? 'active' : ''}`}
                    onClick={() => setActiveTab('rules')}
                  >
                    <GitBranch size={14} />
                    <span>Dấu vết Logic</span>
                  </button>
                </div>

                <div
                  id="tabpanel-symbolic"
                  role="tabpanel"
                  aria-labelledby={`tab-${activeTab}`}
                  className="panel-content"
                >
                  {activeTab === 'rules' && (
                    !activeSymbolic ? (
                      <div className="empty-state">
                        <Info size={32} className="empty-icon" />
                        <p>Hãy đặt một câu hỏi pháp lý để xem dấu vết suy luận tất định (Rule Trace).</p>
                        <small>
                          Hệ thống sẽ hiển thị từng bước đối chiếu điều luật, chủ thể và khung xử phạt tại đây.
                        </small>
                      </div>
                    ) : (
                      <div className="rules-view">
                        <div className="card-box">
                          <div className="card-box-title">
                            <CheckCircle2 size={14} className="icon-success" />
                            <span>Thực thể phát hiện (Symbolic Query Facts)</span>
                          </div>
                          <div className="facts-grid">
                            <div className="fact-item">
                              <span className="fact-label">Chủ thể áp dụng:</span>
                              <span className="fact-value">
                                {activeSymbolic.reasoning?.facts?.subjects
                                  ?.map((s) => (s === 'ORGANIZATION' ? 'Tổ chức' : 'Cá nhân'))
                                  .join(', ') || 'Chung'}
                              </span>
                            </div>
                            {activeSymbolic.reasoning?.facts?.age && (
                              <div className="fact-item">
                                <span className="fact-label">Độ tuổi phát hiện:</span>
                                <span className="fact-value highlight-age">
                                  {activeSymbolic.reasoning.facts.age} tuổi
                                </span>
                              </div>
                            )}
                            {activeSymbolic.reasoning?.facts?.article_refs?.length > 0 && (
                              <div className="fact-item">
                                <span className="fact-label">Điều luật truy vấn:</span>
                                <span className="fact-value">
                                  Điều {activeSymbolic.reasoning.facts.article_refs.join(', ')}
                                </span>
                              </div>
                            )}
                            {activeSymbolic.reasoning?.facts?.doc_hints?.length > 0 && (
                              <div className="fact-item">
                                <span className="fact-label">Văn bản nhận diện:</span>
                                <span className="fact-value">
                                  {activeSymbolic.reasoning.facts.doc_hints.join(', ')}
                                </span>
                              </div>
                            )}
                            {activeSymbolic.reasoning?.facts?.invalid_docs?.length > 0 && (
                              <div className="fact-item">
                                <span className="fact-label">Cảnh báo Guardrail:</span>
                                <span className="fact-value text-danger">
                                  {activeSymbolic.reasoning.facts.invalid_docs.join(', ')} (Không có trong kho dữ liệu)
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {activeSymbolic.reasoning?.penalty_calculations?.length > 0 && (
                          <div className="card-box">
                            <div className="card-box-title">
                              <Scale size={14} className="icon-primary" />
                              <span>Mức phạt &amp; Chế tài tính toán tất định</span>
                            </div>
                            <div className="calcs-list">
                              {activeSymbolic.reasoning.penalty_calculations.map((calc, i) => (
                                <div key={i} className="calc-card">
                                  <div className="calc-action-title">{calc.action}</div>
                                  <div className="calc-basis-tag">
                                    {calc.clause}, {calc.article}
                                  </div>
                                  <div className="calc-results-list">
                                    {calc.calculations.map((c, j) => (
                                      <div key={j} className="calc-result-row">
                                        <span className="result-subject">{c.subject_label}:</span>
                                        <span className="result-amount">{c.display}</span>
                                        <span className="result-formula">({c.formula})</span>
                                      </div>
                                    ))}
                                  </div>
                                  {calc.sanctions?.length > 0 && (
                                    <div className="calc-sanctions-box">
                                      <b>🛠️ Biện pháp bổ sung / Khắc phục:</b>
                                      {calc.sanctions.map((s, idx) => (
                                        <div key={idx}>• {s}</div>
                                      ))}
                                    </div>
                                  )}
                                  {calc.criminal_escalations?.length > 0 && (
                                    <div className="calc-criminal-box">
                                      <b>⚖️ Liên đới Trách nhiệm Hình sự (Multi-Hop → BLHS 2015):</b>
                                      {calc.criminal_escalations.map((ce, idx) => (
                                        <div key={idx} className="criminal-item">
                                          <div>• <b>{ce.title}</b></div>
                                          <div className="criminal-sub">Điều kiện: {ce.condition}</div>
                                          <div className="criminal-pen">Khung hình phạt: {ce.penalty}</div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {activeSymbolic.reasoning?.penalty_calculations?.length > 0 && (
                          <WhatIfSandbox penaltyCalcs={activeSymbolic.reasoning.penalty_calculations} />
                        )}

                        {activeSymbolic.reasoning?.law_paths?.length > 0 && (
                          <div className="card-box">
                            <div className="card-box-title">
                              <GitBranch size={14} className="icon-purple" />
                              <span>Đường dẫn dẫn chiếu nhiều bước</span>
                            </div>
                            {activeSymbolic.reasoning.law_paths.map((path, idx) => (
                              <div key={idx} className="step-item">
                                <div className="step-badge">
                                  {(path.nodes || []).map((node) => `Điều ${node.number}`).join(' → ')}
                                </div>
                                <div className="step-detail">
                                  {(path.nodes?.at(-1)?.text || '').slice(0, 900)}
                                </div>
                                <div className="step-basis">
                                  {path.doc_title || path.doc_code}
                                  {path.source_url && (
                                    <> • <a href={path.source_url} target="_blank" rel="noreferrer">Mở nguồn</a></>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {activeSymbolic.reasoning?.matched_precedents?.length > 0 && (
                          <div className="card-box">
                            <div className="card-box-title">
                              <BookOpen size={14} className="icon-purple" />
                              <span>Án lệ / bản án có liên kết căn cứ</span>
                            </div>
                            {activeSymbolic.reasoning.matched_precedents.map((precedent) => (
                              <div key={precedent.id} className="source-card">
                                <div className="source-header">
                                  <span className="source-title">{precedent.title}</span>
                                  <span className="source-page">{precedent.status || 'UNKNOWN'}</span>
                                </div>
                                <div className="source-article">
                                  {precedent.court} • {precedent.decision_number} • {precedent.decision_date}
                                </div>
                                <p className="source-snippet"><b>Vấn đề pháp lý:</b> {precedent.legal_issue}</p>
                                <p className="source-snippet"><b>Kết luận:</b> {precedent.holding}</p>
                                <p className="source-effective-date">
                                  Liên kết {precedent.relation} với Điều {precedent.article_number} {precedent.doc_code}.
                                  {precedent.status === 'UNKNOWN' && ' Chưa xác minh trạng thái án lệ.'}
                                </p>
                                {precedent.source_url && (
                                  <a className="source-official-link" href={precedent.source_url} target="_blank" rel="noreferrer">
                                    Mở nguồn chính thức
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="card-box">
                          <div className="card-box-title">
                            <ShieldCheck size={14} className="icon-purple" />
                            <span>
                              Các bước suy luận luật (Deterministic Rule Trace)
                              {activeSymbolic.reasoning?.as_of_date
                                ? ` • áp dụng tại ${activeSymbolic.reasoning.as_of_date}`
                                : ''}
                            </span>
                          </div>
                          {activeSymbolic.reasoning?.rule_steps?.length > 0 ? (
                            <div className="steps-timeline">
                              {activeSymbolic.reasoning.rule_steps.map((step, idx) => (
                                <div key={idx} className="step-item">
                                  <div className="step-badge">{formatRuleBadge(step.rule)}</div>
                                  <div className="step-detail">{step.detail}</div>
                                  <div className="step-basis">Căn cứ: {step.basis}</div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="muted-note">
                              Truy vấn quy định chung (không phát sinh phép chia khung phạt tiền).
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  )}

                  {activeTab === 'sources' && (
                    <div className="sources-view">
                      <div className="card-box-title">
                        <BookOpen size={14} className="icon-primary" />
                        <span>Nguồn luật và án lệ đã truy xuất</span>
                      </div>
                      {activeSymbolic?.sources?.length > 0 ? (
                        activeSymbolic.sources.map((src, i) => (
                          <div key={i} className="source-card">
                            <div className="source-header">
                              <span className="source-title">{src.title}</span>
                              {src.page != null && <span className="source-page">Trang {src.page}</span>}
                            </div>
                            <div className="source-article">{src.article}</div>
                            {src.source_type === 'PRECEDENT' && (
                              <div className="source-effective-date">
                                Quyết định ngày {src.decision_date || 'không rõ'} • trạng thái: {src.status || 'chưa xác minh'}
                              </div>
                            )}
                            {(src.effective_from || src.effective_to) && (
                              <div className="source-effective-date">
                                Hiệu lực: {src.effective_from || 'không rõ'} đến {src.effective_to || 'chưa ghi nhận ngày kết thúc'}
                              </div>
                            )}
                            <p className="source-snippet">{src.snippet}</p>
                            <div className="source-card-actions">
                              {src.source_type !== 'PRECEDENT' && parseStatuteTarget(src) && (
                                <button
                                  type="button"
                                  className="source-detail-btn"
                                  onClick={() => {
                                    const parsed = parseStatuteTarget(src);
                                    if (parsed) {
                                      openArticleDetail({
                                        ...parsed,
                                        asOf: resolveArticleDrawerAsOf(activeSymbolic, asOfDate),
                                      });
                                    }
                                  }}
                                >
                                  <Eye size={13} />
                                  <span>Xem toàn văn &amp; Lược đồ hiệu lực</span>
                                </button>
                              )}
                              {src.source_url && (
                                <a className="source-official-link" href={src.source_url} target="_blank" rel="noreferrer">
                                  Mở nguồn chính thức
                                </a>
                              )}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="empty-state">
                          <BookOpen size={28} className="empty-icon" />
                          <p>Chưa có đoạn trích dẫn cho câu hỏi hiện tại.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </aside>
            )}
          </div>
        )}
      </div>

      {/* Modals & Drawers dùng chung trong không gian làm việc */}
      <BenchmarkModal
        isOpen={showBenchmarkModal}
        onClose={() => setShowBenchmarkModal(false)}
        data={benchmarkData}
        isLoading={isLoadingBenchmark}
        error={benchmarkError}
        onRunBenchmark={handleRunBenchmark}
      />

      <ComplianceReviewModal
        isOpen={showComplianceModal}
        onClose={() => setShowComplianceModal(false)}
        apiBaseUrl={API_BASE_URL}
        apiHeaders={API_HEADERS}
        userToken={userToken}
        defaultAsOfDate={asOfDate}
        onSendResultToChat={askInWorkspaceChat}
      />

      <LegalDraftingModal
        isOpen={showDraftingModal}
        onClose={() => setShowDraftingModal(false)}
        apiBaseUrl={API_BASE_URL}
        apiHeaders={API_HEADERS}
        userToken={userToken}
        defaultAsOfDate={asOfDate}
        onSendDraftToChat={askInWorkspaceChat}
      />

      <ArticleDetailDrawer
        target={articleDetailTarget}
        onClose={() => setArticleDetailTarget(null)}
        apiBaseUrl={API_BASE_URL}
        apiHeaders={API_HEADERS}
        onNavigateArticle={(docCode, articleNumber) =>
          openArticleDetail({
            docCode,
            articleNumber,
            asOf: articleDetailTarget?.asOf || resolveArticleDrawerAsOf(activeSymbolic, asOfDate),
          })
        }
        onAskAboutArticle={askInWorkspaceChat}
      />
    </div>
  );
}

export default App;
