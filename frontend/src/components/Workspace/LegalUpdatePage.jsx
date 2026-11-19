import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BookOpen,
  Calendar,
  Clock,
  ExternalLink,
  Loader2,
  MessageSquare,
  ShieldCheck,
  UserCheck,
  Zap,
} from 'lucide-react';

const BENEFIT_ITEMS = [
  {
    icon: Clock,
    title: 'Tiết kiệm thời gian rà soát',
    desc: 'Theo dõi tập trung toàn bộ mốc hiệu lực của Luật, Nghị định CNTT, Dữ liệu cá nhân và An ninh mạng.',
  },
  {
    icon: Zap,
    title: 'Nhận diện văn bản thay thế',
    desc: 'Tự động đánh dấu văn bản sắp có hiệu lực, đang hiệu lực hoặc đã bị thay thế (như 15/2020 → 174/2026).',
  },
  {
    icon: ShieldCheck,
    title: 'Nguồn văn bản chuẩn hóa',
    desc: 'Dữ liệu trích xuất trực tiếp từ kho 47 tệp văn bản quy phạm pháp luật Việt Nam đã kiểm duyệt.',
  },
  {
    icon: UserCheck,
    title: 'Cá nhân hóa lĩnh vực',
    desc: 'Tùy chọn nhóm chủ đề quan tâm (DLCN, MXH, GDĐT, Viễn thông) lưu ngay trong hồ sơ tài khoản.',
  },
];

export function LegalUpdatePage({
  apiBaseUrl,
  apiHeaders,
  defaultAsOfDate,
  onNavigate,
  onOpenArticleDetail,
  onAskAboutDocument,
}) {
  const [updates, setUpdates] = useState([]);
  const [evaluatedAsOf, setEvaluatedAsOf] = useState(defaultAsOfDate || '2026-11-19');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${apiBaseUrl}/legal/updates`, {
        params: { as_of_date: defaultAsOfDate || undefined, limit: 24 },
        headers: apiHeaders,
      })
      .then((res) => {
        if (cancelled) return;
        setUpdates(res.data?.items || []);
        if (res.data?.evaluated_as_of) setEvaluatedAsOf(res.data.evaluated_as_of);
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(
            err?.response?.data?.detail || 'Không thể tải dòng thời gian cập nhật pháp lý.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, apiHeaders, defaultAsOfDate]);

  return (
    <div className="lx-ws-search-page">
      <div className="lx-ws-search-container">
        {/* Split Hero matching Lexcentra /assistant/legal-update */}
        <section className="lx-update-hero">
          <div className="lx-update-hero-copy">
            <h1>
              Cập nhật <span>pháp lý</span>
            </h1>
            <p>
              Theo dõi biến động hiệu lực các Luật, Nghị định mới nhất về Công nghệ thông tin, Bảo vệ
              dữ liệu cá nhân, Giao dịch điện tử và Xử phạt vi phạm hành chính.
            </p>
            <div className="lx-update-hero-actions">
              <button
                type="button"
                className="lx-update-primary-btn"
                onClick={() => onNavigate('/profile/receive-newsletters')}
              >
                <Bell size={16} aria-hidden="true" />
                <span>Thiết lập nhận cảnh báo</span>
                <ArrowRight size={15} aria-hidden="true" />
              </button>
              <a href="#lx-update-timeline" className="lx-update-outline-btn">
                <BookOpen size={15} aria-hidden="true" />
                <span>Xem dòng thời gian văn bản</span>
              </a>
            </div>
          </div>

          <div className="lx-update-hero-art" aria-hidden="true">
            <div className="lx-update-doc-card">
              <div className="lx-update-doc-line w-60" />
              <div className="lx-update-doc-line w-90" />
              <div className="lx-update-doc-line w-85" />
              <div className="lx-update-doc-line w-70" />
              <div className="lx-update-doc-line w-80" />
              <span className="lx-update-bell-badge">
                <Bell size={22} />
              </span>
            </div>
          </div>
        </section>

        {/* 4 Benefit Cards */}
        <section className="lx-update-benefits">
          <h2>Tại sao nên theo dõi cập nhật trên LexIT?</h2>
          <div className="lx-benefits-grid">
            {BENEFIT_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="lx-benefit-card">
                  <span className="lx-benefit-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Real Live Timeline Feed */}
        <section id="lx-update-timeline" className="lx-update-timeline">
          <div className="lx-timeline-header">
            <h2>Dòng thời gian văn bản pháp luật CNTT ({updates.length})</h2>
            <span>
              Đối chiếu hiệu lực tại ngày <code>{evaluatedAsOf}</code>
            </span>
          </div>

          {errorMsg && (
            <div className="lexit-auth-alert error" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          )}

          {loading ? (
            <div className="lx-ws-loading-state" role="status" aria-busy="true">
              <Loader2 size={22} className="spin-icon" />
              <span>Đang tải danh mục cập nhật pháp lý...</span>
            </div>
          ) : (
            <div className="lx-ws-doc-grid">
              {updates.map((u) => (
                <article key={u.doc_code} className="lx-ws-doc-card">
                  <div className="lx-ws-doc-top">
                    <span className="lx-ws-doc-code">{u.doc_code}</span>
                    <span className={`lx-ws-status-badge ${(u.status_badge || 'ACTIVE').toLowerCase()}`}>
                      {u.status_label}
                    </span>
                  </div>

                  <h3 className="lx-ws-doc-title">{u.title}</h3>

                  <div className="lx-ws-doc-meta">
                    <span>{u.doc_type_label}</span>
                    <span>•</span>
                    <span>{u.issuing_body}</span>
                    <span>•</span>
                    <span>{u.domain}</span>
                    <span className="inline-date">
                      <Calendar size={12} aria-hidden="true" />
                      {u.effective_from}
                      {u.effective_to ? ` → ${u.effective_to}` : ''}
                    </span>
                  </div>

                  {u.related_documents?.length > 0 && (
                    <div className="lx-update-related">
                      <span>Liên quan:</span>
                      {u.related_documents.slice(0, 4).map((rel) => (
                        <code key={rel}>{rel}</code>
                      ))}
                    </div>
                  )}

                  <div className="lx-ws-doc-actions">
                    <button
                      type="button"
                      className="lx-ws-action-chip primary"
                      onClick={() =>
                        onAskAboutDocument(
                          `Những điểm mới quan trọng nhất cần lưu ý trong ${u.short_title || u.doc_code} (hiệu lực ${u.effective_from}) là gì?`
                        )
                      }
                    >
                      <MessageSquare size={13} />
                      <span>Phân tích điểm mới</span>
                    </button>
                    <button
                      type="button"
                      className="lx-ws-action-chip"
                      onClick={() =>
                        onOpenArticleDetail({
                          docCode: u.doc_code,
                          articleNumber: '1',
                          asOfDate: evaluatedAsOf,
                        })
                      }
                    >
                      <BookOpen size={13} />
                      <span>Xem toàn văn</span>
                    </button>
                    {u.source_url && (
                      <a
                        href={u.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="lx-ws-action-chip"
                      >
                        <ExternalLink size={13} />
                        <span>Nguồn chính thức</span>
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
