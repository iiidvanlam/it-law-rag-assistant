import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  MessageSquare,
  Search,
  Sparkles,
} from 'lucide-react';

const DOC_TYPE_OPTIONS = [
  { value: 'ALL', label: 'Tất cả loại văn bản' },
  { value: 'LAW', label: 'Luật' },
  { value: 'DECREE', label: 'Nghị định' },
  { value: 'CONSOLIDATED', label: 'Văn bản hợp nhất' },
  { value: 'CODE', label: 'Bộ luật' },
];

const ISSUER_OPTIONS = [
  { value: 'ALL', label: 'Tất cả cơ quan ban hành' },
  { value: 'Quốc hội', label: 'Quốc hội' },
  { value: 'Chính phủ', label: 'Chính phủ' },
  { value: 'Bộ Thông tin và Truyền thông', label: 'Bộ Thông tin và Truyền thông' },
  { value: 'Bộ Khoa học và Công nghệ', label: 'Bộ Khoa học và Công nghệ' },
];

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'Mọi trạng thái hiệu lực' },
  { value: 'ACTIVE', label: 'Đang có hiệu lực' },
  { value: 'UPCOMING', label: 'Chưa có hiệu lực' },
  { value: 'EXPIRED', label: 'Hết hiệu lực' },
];

export function LegalDocumentSearchPage({
  apiBaseUrl,
  apiHeaders,
  defaultAsOfDate,
  onOpenArticleDetail,
  onAskAboutDocument,
}) {
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [docType, setDocType] = useState('ALL');
  const [issuingBody, setIssuingBody] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [asOfDate, setAsOfDate] = useState(defaultAsOfDate || '2026-11-19');

  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const runSearch = useCallback(
    async (paramsInput) => {
      setLoading(true);
      setErrorMsg('');
      const params = {
        q: String(paramsInput.q || '').trim(),
        doc_type: paramsInput.docType || 'ALL',
        issuing_body: paramsInput.issuingBody || 'ALL',
        status: paramsInput.status || 'ALL',
        effective_from: paramsInput.effectiveFrom || undefined,
        effective_to: paramsInput.effectiveTo || undefined,
        as_of_date: paramsInput.asOfDate || undefined,
        limit: 40,
      };
      try {
        const res = await axios.get(`${apiBaseUrl}/legal/documents/search`, {
          params,
          headers: apiHeaders,
        });
        setResults(res.data?.items || []);
        setTotal(res.data?.total ?? 0);
      } catch (err) {
        setErrorMsg(
          err?.response?.data?.detail || 'Không thể kết nối máy chủ để tra cứu văn bản pháp luật.'
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
      .get(`${apiBaseUrl}/legal/documents/search`, {
        params: {
          q: '',
          doc_type: 'ALL',
          issuing_body: 'ALL',
          status: 'ALL',
          as_of_date: defaultAsOfDate || '2026-11-19',
          limit: 40,
        },
        headers: apiHeaders,
      })
      .then((res) => {
        if (cancelled) return;
        setResults(res.data?.items || []);
        setTotal(res.data?.total ?? 0);
        setErrorMsg('');
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(
            err?.response?.data?.detail || 'Không thể kết nối máy chủ để tra cứu văn bản pháp luật.'
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

  const handleSubmit = (e) => {
    e.preventDefault();
    runSearch({
      q: query,
      docType,
      issuingBody,
      status,
      effectiveFrom,
      effectiveTo,
      asOfDate,
    });
  };

  const handleResetFilters = () => {
    setDocType('ALL');
    setIssuingBody('ALL');
    setStatus('ALL');
    setEffectiveFrom('');
    setEffectiveTo('');
    runSearch({
      q: query,
      docType: 'ALL',
      issuingBody: 'ALL',
      status: 'ALL',
      effectiveFrom: '',
      effectiveTo: '',
      asOfDate,
    });
  };

  return (
    <div className="lx-ws-search-page">
      <div className="lx-ws-search-container">
        <header className="lx-ws-search-hero">
          <h1>Tìm kiếm văn bản pháp luật CNTT Việt Nam</h1>
          <p>
            Tra cứu trực tiếp kho văn bản quy phạm pháp luật Công nghệ thông tin, An ninh mạng &amp;
            Dữ liệu cá nhân lưu trữ trong PostgreSQL PGVector.
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
                placeholder="Tìm kiếm theo số hiệu (VD: 174/2026), tên luật hoặc nội dung điều khoản..."
                aria-label="Từ khóa tìm kiếm văn bản pháp luật"
              />
              <button
                type="button"
                className={`lx-ws-filter-chip ${showFilters ? 'open' : ''}`}
                onClick={() => setShowFilters((prev) => !prev)}
                aria-expanded={showFilters}
              >
                <span>Bộ lọc</span>
                {showFilters ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
            </div>

            <button type="submit" className="lx-ws-sparkle-btn" disabled={loading}>
              {loading ? <Loader2 size={16} className="spin-icon" /> : <Sparkles size={16} />}
              <span>Tìm kiếm</span>
            </button>
          </div>

          {showFilters && (
            <div className="lx-ws-filter-card" role="region" aria-label="Bộ lọc văn bản pháp luật">
              <div className="lx-ws-filter-row">
                <label htmlFor="lx-doc-type">Loại văn bản pháp luật</label>
                <select
                  id="lx-doc-type"
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                >
                  {DOC_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="lx-ws-filter-row">
                <label htmlFor="lx-doc-issuer">Cơ quan ban hành</label>
                <select
                  id="lx-doc-issuer"
                  value={issuingBody}
                  onChange={(e) => setIssuingBody(e.target.value)}
                >
                  {ISSUER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="lx-ws-filter-row">
                <label htmlFor="lx-doc-status">Trạng thái &amp; Mốc đối chiếu</label>
                <div className="lx-ws-filter-split">
                  <select
                    id="lx-doc-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={asOfDate}
                    onChange={(e) => setAsOfDate(e.target.value)}
                    aria-label="Đánh giá hiệu lực tại ngày"
                  />
                </div>
              </div>

              <div className="lx-ws-filter-row">
                <label htmlFor="lx-doc-eff-from">Thời gian hiệu lực</label>
                <div className="lx-ws-filter-split">
                  <input
                    id="lx-doc-eff-from"
                    type="date"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    aria-label="Hiệu lực từ ngày"
                  />
                  <input
                    type="date"
                    value={effectiveTo}
                    onChange={(e) => setEffectiveTo(e.target.value)}
                    aria-label="Hiệu lực đến ngày"
                  />
                </div>
              </div>

              <div className="lx-ws-filter-footer">
                <button type="button" className="lx-ws-text-btn" onClick={handleResetFilters}>
                  Đặt lại bộ lọc
                </button>
              </div>
            </div>
          )}
        </form>

        {errorMsg && (
          <div className="lexit-auth-alert error" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="lx-ws-results-meta">
          <span>
            Tìm thấy <strong>{total}</strong> văn bản pháp luật (đối chiếu hiệu lực ngày{' '}
            <code>{asOfDate}</code>)
          </span>
        </div>

        {loading && results.length === 0 ? (
          <div className="lx-ws-loading-state" role="status" aria-busy="true">
            <Loader2 size={22} className="spin-icon" />
            <span>Đang truy vấn kho văn bản PGVector...</span>
          </div>
        ) : results.length === 0 ? (
          <div className="lx-ws-empty-results">
            <BookOpen size={28} aria-hidden="true" />
            <h3>Không có văn bản phù hợp</h3>
            <p>Hãy thử nới rộng bộ lọc hoặc nhập số hiệu khác (VD: 174/2026, 91/2025, 13/2023).</p>
          </div>
        ) : (
          <div className="lx-ws-doc-grid">
            {results.map((doc) => (
              <article key={doc.doc_code} className="lx-ws-doc-card">
                <div className="lx-ws-doc-top">
                  <span className="lx-ws-doc-code">{doc.doc_code}</span>
                  <span className={`lx-ws-status-badge ${(doc.status_badge || 'ACTIVE').toLowerCase()}`}>
                    {doc.status_label}
                  </span>
                </div>

                <h2 className="lx-ws-doc-title">{doc.title}</h2>

                <div className="lx-ws-doc-meta">
                  <span>{doc.doc_type_label}</span>
                  <span>•</span>
                  <span>{doc.issuing_body}</span>
                  <span>•</span>
                  <span>{doc.domain}</span>
                  {doc.effective_from && (
                    <>
                      <span>•</span>
                      <span className="inline-date">
                        <Calendar size={12} aria-hidden="true" />
                        Hiệu lực: {doc.effective_from}
                        {doc.effective_to ? ` → ${doc.effective_to}` : ''}
                      </span>
                    </>
                  )}
                </div>

                {doc.matching_articles?.length > 0 && (
                  <div className="lx-ws-matched-articles">
                    <div className="lx-ws-matched-label">Điều luật khớp từ khóa:</div>
                    {doc.matching_articles.map((art) => (
                      <button
                        key={`${doc.doc_code}-${art.article_number}`}
                        type="button"
                        className="lx-ws-article-hit"
                        onClick={() =>
                          onOpenArticleDetail({
                            docCode: doc.doc_code,
                            articleNumber: art.article_number,
                            asOfDate,
                          })
                        }
                      >
                        <strong>
                          Điều {art.article_number}
                          {art.article_title ? `. ${art.article_title}` : ''}
                        </strong>
                        <span>{art.snippet}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="lx-ws-doc-actions">
                  <button
                    type="button"
                    className="lx-ws-action-chip primary"
                    onClick={() =>
                      onAskAboutDocument(
                        `Hãy tóm tắt các quy định trọng tâm và mức xử phạt đáng chú ý trong ${doc.short_title || doc.doc_code}.`
                      )
                    }
                  >
                    <MessageSquare size={13} />
                    <span>Hỏi LexIT</span>
                  </button>
                  <button
                    type="button"
                    className="lx-ws-action-chip"
                    onClick={() =>
                      onOpenArticleDetail({
                        docCode: doc.doc_code,
                        articleNumber: doc.matching_articles?.[0]?.article_number || '1',
                        asOfDate,
                      })
                    }
                  >
                    <BookOpen size={13} />
                    <span>Xem Điều luật</span>
                  </button>
                  {doc.source_url && (
                    <a
                      href={doc.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="lx-ws-action-chip"
                    >
                      <ExternalLink size={13} />
                      <span>Văn bản gốc</span>
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
