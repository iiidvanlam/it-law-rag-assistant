import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  BookOpen,
  ExternalLink,
  Gavel,
  Loader2,
  MessageSquare,
  Search,
  Sparkles,
} from 'lucide-react';

const PRECEDENT_TAGS = [
  { id: '', label: 'Tất cả án lệ CNTT' },
  { id: 'cybercrime', label: 'Tội phạm công nghệ cao' },
  { id: 'data', label: 'Dữ liệu cá nhân' },
  { id: 'social', label: 'Mạng xã hội' },
  { id: 'ecommerce', label: 'Giao dịch điện tử' },
];

export function PrecedentSearchPage({
  apiBaseUrl,
  apiHeaders,
  defaultAsOfDate,
  onOpenArticleDetail,
  onAskAboutPrecedent,
}) {
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const fetchPrecedents = useCallback(
    async (qText = '', tagVal = '') => {
      setLoading(true);
      setErrorMsg('');
      try {
        const res = await axios.get(`${apiBaseUrl}/precedents/search`, {
          params: {
            q: String(qText || '').trim() || undefined,
            tag: tagVal || undefined,
            limit: 30,
          },
          headers: apiHeaders,
        });
        setItems(res.data?.items || []);
        setTotal(res.data?.total ?? 0);
      } catch (err) {
        setErrorMsg(
          err?.response?.data?.detail || 'Không thể tải danh sách bản án / án lệ từ máy chủ.'
        );
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, apiHeaders]
  );

  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${apiBaseUrl}/precedents/search`, {
        params: { limit: 30 },
        headers: apiHeaders,
      })
      .then((res) => {
        if (cancelled) return;
        setItems(res.data?.items || []);
        setTotal(res.data?.total ?? 0);
        setErrorMsg('');
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(
            err?.response?.data?.detail || 'Không thể tải danh sách bản án / án lệ từ máy chủ.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, apiHeaders]);

  const handleSubmit = (e) => {
    e.preventDefault();
    fetchPrecedents(query, selectedTag);
  };

  return (
    <div className="lx-ws-search-page">
      <div className="lx-ws-search-container">
        <header className="lx-ws-search-hero">
          <h1>Tìm kiếm bản án, án lệ về CNTT &amp; An ninh mạng</h1>
          <p>
            Đối chiếu thực tiễn xét xử các vụ án xâm nhập trái phép, tấn công DDoS, mua bán dữ liệu
            cá nhân, giả mạo chứng thư số và tin giả trên không gian mạng.
          </p>
        </header>

        <form className="lx-ws-search-form" onSubmit={handleSubmit}>
          <div className="lx-ws-pill-bar">
            <div className="lx-ws-pill-input-wrap">
              <Search size={18} className="lx-ws-pill-icon" aria-hidden="true" />
              <input
                type="search"
                className="lx-ws-pill-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm kiếm theo tội danh, Điều 285–290 BLHS, DDoS, dữ liệu cá nhân..."
                aria-label="Tìm kiếm bản án, án lệ"
              />
            </div>

            <button type="submit" className="lx-ws-sparkle-btn" disabled={loading}>
              {loading ? <Loader2 size={16} className="spin-icon" /> : <Sparkles size={16} />}
              <span>Tìm kiếm</span>
            </button>
          </div>

          <div className="lx-ws-tag-row">
            {PRECEDENT_TAGS.map((tag) => (
              <button
                key={tag.id || 'all'}
                type="button"
                className={`lx-ws-tag-pill ${selectedTag === tag.id ? 'active' : ''}`}
                onClick={() => {
                  setSelectedTag(tag.id);
                  fetchPrecedents(query, tag.id);
                }}
              >
                {tag.label}
              </button>
            ))}
          </div>
        </form>

        {errorMsg && (
          <div className="lexit-auth-alert error" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="lx-ws-results-meta">
          <span>
            Hiển thị <strong>{total}</strong> bản án / án lệ thực tiễn đã chuẩn hóa
          </span>
        </div>

        {loading && items.length === 0 ? (
          <div className="lx-ws-loading-state" role="status" aria-busy="true">
            <Loader2 size={22} className="spin-icon" />
            <span>Đang truy vấn kho bản án &amp; án lệ...</span>
          </div>
        ) : items.length === 0 ? (
          <div className="lx-ws-empty-results">
            <Gavel size={28} aria-hidden="true" />
            <h3>Không tìm thấy bản án phù hợp</h3>
            <p>Thử từ khóa khác như DDoS, chiếm đoạt tài sản, dữ liệu cá nhân, chữ ký số.</p>
          </div>
        ) : (
          <div className="lx-ws-doc-grid">
            {items.map((item) => {
              const caseCode = item.decision_number || item.id;
              return (
                <article key={item.id || caseCode} className="lx-ws-doc-card">
                  <div className="lx-ws-doc-top">
                    <span className="lx-ws-doc-code">{caseCode}</span>
                    <span className="lx-ws-status-badge active">
                      {item.court || 'Tòa án nhân dân'} {item.decision_date ? `• ${item.decision_date}` : ''}
                    </span>
                  </div>

                  <h2 className="lx-ws-doc-title">{item.title}</h2>
                  {(item.legal_issue || item.material_facts) && (
                    <p className="lx-ws-prec-summary">
                      {item.legal_issue || item.material_facts}
                    </p>
                  )}
                  {item.holding && (
                    <div className="lx-ws-prec-holding">
                      <strong>Nhận định pháp lý:</strong> {item.holding}
                    </div>
                  )}

                  {item.references?.length > 0 && (
                    <div className="lx-ws-prec-refs">
                      {item.references.map((ref, idx) => (
                        <button
                          key={`${item.id}-ref-${idx}`}
                          type="button"
                          className="lx-ws-action-chip"
                          onClick={() =>
                            onOpenArticleDetail({
                              docCode: ref.doc_code,
                              articleNumber: String(ref.article_number || ''),
                              asOf: defaultAsOfDate || undefined,
                            })
                          }
                        >
                          <BookOpen size={12} />
                          <span>
                            Điều {ref.article_number} {ref.doc_code}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="lx-ws-doc-actions">
                    <button
                      type="button"
                      className="lx-ws-action-chip primary"
                      onClick={() =>
                        onAskAboutPrecedent(
                          `Hãy phân tích bài học pháp lý và điều luật áp dụng từ vụ án "${item.title}" (${caseCode}).`
                        )
                      }
                    >
                      <MessageSquare size={13} />
                      <span>Phân tích cùng LexIT</span>
                    </button>
                    {item.source_url && (
                      <a
                        href={item.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="lx-ws-action-chip"
                      >
                        <ExternalLink size={13} />
                        <span>Cổng TAND Tối cao</span>
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
