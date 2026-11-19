import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  ArrowRight,
  ArrowUp,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Cpu,
  FileSignature,
  Gavel,
  KeyRound,
  LogOut,
  Mail,
  MessageSquare,
  Scale,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';
import { UserAvatar } from '../../LegalWorkspaceModals';
import { AuthWireframeBackdrop } from '../Auth/AuthWireframeBackdrop';
import { ContactInquiryModal } from './ContactInquiryModal';
import './HomePage.css';

const CORE_STATUTE_PILLS = [
  'Nghị định 174/2026/NĐ-CP',
  'Nghị định 330/2026/NĐ-CP',
  'Luật Bảo vệ DLCN 91/2025/QH15',
  'Nghị định 13/2023/NĐ-CP',
  'Nghị định 147/2024/NĐ-CP',
  'Luật Giao dịch điện tử 20/2023/QH15',
  'Luật An ninh mạng 24/2018/QH14',
  'Bộ luật Hình sự (Điều 285–290)',
];

const BLOCKED_THREATS = [
  'Văn bản giả mạo / ngoài kho',
  'Tư vấn ngoài phạm vi CNTT',
  'Bịa đặt khung tiền phạt',
  'Sai chủ thể & độ tuổi XLVPHC',
];

const VERIFIED_GUARANTEES = [
  'PGVector HNSW 3072 chiều',
  'Rule Engine tất định 100%',
  'Kiểm soát hiệu lực theo ngày',
  'Google OAuth 2.0 & Email OTP',
];

export function HomePage({
  apiBaseUrl,
  apiHeaders,
  currentUser,
  onNavigate,
  onOpenBenchmark,
  onLogout,
}) {
  const [stats, setStats] = useState({
    total_documents: 39,
    total_vectors: 4852,
    total_precedents: 8,
    benchmark_cases: 40,
    guardrail_layers: 5,
  });
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${apiBaseUrl}/stats/overview`, { headers: apiHeaders })
      .then((res) => {
        if (!cancelled && res.data) {
          setStats((prev) => ({
            total_documents: res.data.total_documents || prev.total_documents,
            total_vectors: res.data.total_vectors || prev.total_vectors,
            total_precedents: res.data.total_precedents || prev.total_precedents,
            benchmark_cases: res.data.benchmark_cases || prev.benchmark_cases,
            guardrail_layers: res.data.guardrail_layers || prev.guardrail_layers,
          }));
        }
      })
      .catch(() => {
        // Giữ số liệu chuẩn đã kiểm chứng nếu backend chưa bật
      });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, apiHeaders]);

  useEffect(() => {
    if (!avatarMenuOpen) return undefined;
    const onOutsideClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setAvatarMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onOutsideClick);
    return () => window.removeEventListener('mousedown', onOutsideClick);
  }, [avatarMenuOpen]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="lx-home-root">
      <AuthWireframeBackdrop />

      {/* 1. STICKY DARK GLASS TOP NAVBAR */}
      <header className="lx-home-navbar">
        <div className="lx-home-nav-inner">
          <a
            href="/home"
            className="lx-brand-logo"
            onClick={(e) => {
              e.preventDefault();
              scrollToTop();
            }}
            aria-label="LexIT — Trang chủ"
          >
            <span className="lx-brand-emblem" aria-hidden="true">
              <Scale size={18} strokeWidth={2.3} />
            </span>
            <span className="lx-brand-word">
              <strong>LEX</strong>
              <span>IT</span>
            </span>
          </a>

          <nav className="lx-home-nav-links" aria-label="Điều hướng chính">
            <a href="#features" className="lx-nav-link">
              Tính năng
            </a>
            <button
              type="button"
              className="lx-nav-link"
              onClick={() => onNavigate('/assistant/legal-document')}
            >
              Tra cứu văn bản
            </button>
            <button
              type="button"
              className="lx-nav-link"
              onClick={() => onNavigate('/assistant/judgement')}
            >
              Án lệ CNTT
            </button>
            <button type="button" className="lx-nav-link" onClick={onOpenBenchmark}>
              Kiểm chứng 40 ca
            </button>
          </nav>

          <div className="lx-home-nav-actions">
            {currentUser ? (
              <div className="lx-avatar-dropdown-wrap" ref={menuRef}>
                <button
                  type="button"
                  className="lx-home-enter-pill"
                  onClick={() => onNavigate('/assistant/lexit/new')}
                >
                  <Sparkles size={14} aria-hidden="true" />
                  <span>Trợ lý LexIT</span>
                </button>
                <button
                  type="button"
                  className="lx-avatar-trigger"
                  onClick={() => setAvatarMenuOpen((prev) => !prev)}
                  aria-expanded={avatarMenuOpen}
                  aria-label={`Tài khoản ${currentUser.full_name}`}
                >
                  <UserAvatar user={currentUser} className="lx-avatar-circle" />
                </button>

                {avatarMenuOpen && (
                  <div className="lx-avatar-menu" role="menu">
                    <div className="lx-avatar-menu-head">
                      <strong>{currentUser.full_name}</strong>
                      <span>{currentUser.email}</span>
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAvatarMenuOpen(false);
                        onNavigate('/profile/info');
                      }}
                    >
                      <User size={15} />
                      <span>Hồ sơ cá nhân</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAvatarMenuOpen(false);
                        onNavigate('/profile/change-password');
                      }}
                    >
                      <KeyRound size={15} />
                      <span>Đổi mật khẩu</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAvatarMenuOpen(false);
                        onNavigate('/profile/receive-newsletters');
                      }}
                    >
                      <Mail size={15} />
                      <span>Nhận bản tin pháp lý</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="danger"
                      onClick={() => {
                        setAvatarMenuOpen(false);
                        onLogout();
                      }}
                    >
                      <LogOut size={15} />
                      <span>Đăng xuất</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="lx-guest-actions">
                <button
                  type="button"
                  className="lx-nav-link"
                  onClick={() => onNavigate('/auth/login')}
                >
                  Đăng nhập
                </button>
                <button
                  type="button"
                  className="lx-nav-register-btn"
                  onClick={() => onNavigate('/auth/register')}
                >
                  Đăng ký
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="lx-home-main">
        {/* 2. HERO SECTION (2-COLUMN SPLIT) */}
        <section className="lx-hero-section">
          <div className="lx-hero-grid">
            <div className="lx-hero-copy">
              <h1 className="lx-hero-title">
                <span className="lx-hero-title-top">Trợ lý AI cho</span>
                <span className="lx-hero-title-accent">
                  Pháp luật CNTT và Tuân thủ An toàn mạng
                </span>
              </h1>

              <p className="lx-hero-subtitle">
                Nền tảng Neuro-Symbolic Hybrid RAG chuyên sâu pháp luật Công nghệ thông tin Việt Nam —
                kết hợp truy xuất ngữ nghĩa PGVector 3072 chiều và động cơ suy luận tất định để tính
                khung xử phạt, rà soát hợp đồng và tra cứu điều luật chuẩn xác theo từng mốc hiệu lực.
              </p>

              <div className="lx-hero-cta-stack">
                <button
                  type="button"
                  className="lx-hero-primary-btn"
                  onClick={() => onNavigate('/assistant/lexit/new')}
                >
                  <Sparkles size={17} aria-hidden="true" />
                  <span>Khám phá LexIT</span>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>

                <button
                  type="button"
                  className="lx-hero-secondary-btn"
                  onClick={() =>
                    onNavigate(currentUser ? '/assistant/legal-document' : '/auth/register')
                  }
                >
                  <span>
                    {currentUser ? 'Tra cứu kho văn bản pháp luật' : 'Tạo tài khoản xác thực OTP'}
                  </span>
                </button>
              </div>
            </div>

            {/* Live Workspace Preview Window */}
            <div className="lx-hero-preview" aria-label="Xem trước giao diện Trợ lý LexIT">
              <div className="lx-preview-frame">
                <div className="lx-preview-chrome">
                  <span className="dot red" />
                  <span className="dot yellow" />
                  <span className="dot green" />
                  <span className="lx-preview-url">lexit.vn/assistant/lexit/new</span>
                </div>

                <div className="lx-preview-body">
                  <aside className="lx-preview-sidebar" aria-hidden="true">
                    <div className="lx-pv-brand">LEXIT</div>
                    <div className="lx-pv-pill active">✦ Trợ lý LexIT</div>
                    <div className="lx-pv-group">Tính năng nổi bật</div>
                    <div className="lx-pv-item">Soạn thảo văn bản</div>
                    <div className="lx-pv-item">Rà soát tuân thủ</div>
                    <div className="lx-pv-item">Tra cứu văn bản luật</div>
                    <div className="lx-pv-item">Tra cứu bản án/án lệ</div>
                    <div className="lx-pv-item">Cập nhật pháp lý</div>
                  </aside>

                  <div className="lx-preview-chat">
                    <div className="lx-pv-msg user">
                      Theo Nghị định 174/2026/NĐ-CP, tổ chức chia sẻ thông tin sai sự thật gây hoang
                      mang dư luận trên mạng xã hội bị xử phạt bao nhiêu tiền?
                    </div>
                    <div className="lx-pv-msg bot">
                      <div className="lx-pv-badge">
                        <ShieldCheck size={12} /> Rule Engine tất định • Điều 95 NĐ 174/2026/NĐ-CP
                      </div>
                      <p>
                        Căn cứ <strong>Điểm a Khoản 1 Điều 95 Nghị định 174/2026/NĐ-CP</strong> (hiệu
                        lực từ 01/07/2026): đối với <strong>Tổ chức</strong>, mức phạt tiền từ{' '}
                        <strong>20.000.000 đồng đến 30.000.000 đồng</strong> kèm biện pháp khắc phục
                        hậu quả buộc gỡ bỏ thông tin sai sự thật.
                      </p>
                      <div className="lx-pv-calc-bar">
                        <span>Chủ thể: Tổ chức (100% khung gốc)</span>
                        <strong>20.000.000 – 30.000.000 VNĐ</strong>
                      </div>
                    </div>
                  </div>

                  <aside className="lx-preview-drawer" aria-hidden="true">
                    <div className="lx-pv-drawer-head">
                      <BookOpen size={13} /> Văn bản liên quan
                    </div>
                    <div className="lx-pv-citation">
                      <strong>Nghị định 174/2026/NĐ-CP</strong>
                      <span>Điều 95 • Đang có hiệu lực</span>
                      <p>Vi phạm quy định về trách nhiệm sử dụng dịch vụ mạng xã hội...</p>
                    </div>
                    <div className="lx-pv-citation">
                      <strong>Nghị định 15/2020/NĐ-CP</strong>
                      <span>Điều 101 • Hết hiệu lực 30/06/2026</span>
                      <p>Văn bản tiền nhiệm đã được thay thế bởi Điều 95 NĐ 174/2026.</p>
                    </div>
                  </aside>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. REAL VERIFIED STATS & LEGAL CORPUS STRIP */}
        <section className="lx-stats-section" aria-label="Quy mô dữ liệu thực tế của LexIT">
          <h2 className="lx-section-heading-sm">Dữ liệu chuẩn hóa & Kiểm chứng thực tế</h2>

          <div className="lx-stats-grid">
            <div className="lx-stat-card">
              <strong>{stats.total_documents}</strong>
              <span>Văn bản Luật & Nghị định CNTT</span>
            </div>
            <div className="lx-stat-card">
              <strong>{stats.total_vectors.toLocaleString('vi-VN')}</strong>
              <span>Vector ngữ nghĩa PGVector (3072d)</span>
            </div>
            <div className="lx-stat-card">
              <strong>{stats.benchmark_cases}/40 (100%)</strong>
              <span>Độ chính xác trên 5 thước đo</span>
            </div>
            <div className="lx-stat-card">
              <strong>{stats.total_precedents} Án lệ • {stats.guardrail_layers} Chốt chặn</strong>
              <span>Đối chiếu bản án & chống ảo giác</span>
            </div>
          </div>

          <div className="lx-statutes-marquee" aria-label="Các văn bản pháp luật cốt lõi">
            {CORE_STATUTE_PILLS.map((law) => (
              <button
                key={law}
                type="button"
                className="lx-statute-chip"
                onClick={() => onNavigate('/assistant/legal-document')}
              >
                <BookOpen size={13} aria-hidden="true" />
                <span>{law}</span>
              </button>
            ))}
          </div>
        </section>

        {/* 4. FEATURE SHOWCASE BLOCKS (3 ALTERNATING CARDS) */}
        <section id="features" className="lx-features-section">
          <div className="lx-features-header">
            <h2 className="lx-gradient-heading">
              Trợ lý AI tra cứu hệ thống pháp luật CNTT Việt Nam
            </h2>
            <p className="lx-features-lead">
              Mọi công cụ pháp chế từ hỏi đáp điều luật, tính khung phạt hành chính, rà soát rủi ro
              hợp đồng đến soạn thảo văn bản đều kết nối trực tiếp cơ sở dữ liệu thật.
            </p>
          </div>

          {/* Card 1: Hỏi đáp & Suy luận tất định */}
          <article className="lx-feature-card">
            <div className="lx-feature-copy">
              <span className="lx-feature-eyebrow">01 • HỎI ĐÁP & SUY LUẬN SYMBOLIC</span>
              <h3>Hỏi đáp pháp lý CNTT 24/7</h3>
              <p>
                Truy xuất đồng thời PGVector HNSW và bộ quy tắc tất định để trả lời kèm Điểm, Khoản,
                Điều chính xác. Tự động tính khung phạt theo chủ thể (Cá nhân / Tổ chức), độ tuổi
                Luật XLVPHC (&lt;14, 14–16, 16–18) và cảnh báo chuyển hóa hình sự BLHS Điều 285–290.
              </p>
              <button
                type="button"
                className="lx-feature-btn"
                onClick={() => onNavigate('/assistant/lexit/new')}
              >
                <span>Mở Trợ lý LexIT</span>
                <ArrowRight size={15} />
              </button>
            </div>
            <div className="lx-feature-visual">
              <div className="lx-mini-panel">
                <div className="lx-mini-row">
                  <Cpu size={16} />
                  <strong>Mô phỏng khung phạt What-If Sandbox</strong>
                </div>
                <div className="lx-mini-metrics">
                  <div>
                    <small>Cá nhân (18+)</small>
                    <strong>10 – 15 triệu đ</strong>
                  </div>
                  <div>
                    <small>Tổ chức (×2)</small>
                    <strong>20 – 30 triệu đ</strong>
                  </div>
                  <div>
                    <small>14 – &lt;16 tuổi</small>
                    <strong>Phạt cảnh cáo</strong>
                  </div>
                </div>
                <div className="lx-mini-footer">
                  <CheckCircle2 size={14} /> 0% ảo giác số tiền phạt nhờ hậu kiểm Output Verifier
                </div>
              </div>
            </div>
          </article>

          {/* Card 2: Rà soát văn bản */}
          <article className="lx-feature-card reverse">
            <div className="lx-feature-copy">
              <span className="lx-feature-eyebrow">02 • RÀ SOÁT TUÂN THỦ</span>
              <h3>Rà soát hợp đồng & chính sách CNTT</h3>
              <p>
                Tải lên tệp PDF, DOCX, TXT hoặc dán điều khoản chính sách bảo mật, hợp đồng phần mềm.
                Hệ thống quét 8 tiêu chuẩn tuân thủ theo Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15,
                Nghị định 13/2023/NĐ-CP và chấm điểm rủi ro kèm khung phạt tương ứng.
              </p>
              <button
                type="button"
                className="lx-feature-btn"
                onClick={() => onNavigate('/assistant/lexit/new')}
              >
                <span>Vào không gian Rà soát</span>
                <ArrowRight size={15} />
              </button>
            </div>
            <div className="lx-feature-visual">
              <div className="lx-mini-panel">
                <div className="lx-mini-row">
                  <Shield size={16} />
                  <strong>Phân tích lỗ hổng tuân thủ tự động</strong>
                </div>
                <ul className="lx-mini-checklist">
                  <li className="risk">Thiếu quy trình thông báo lộ lọt dữ liệu trong 72 giờ</li>
                  <li className="risk">Chưa quy định quyền rút lại sự đồng ý của chủ thể dữ liệu</li>
                  <li className="ok">Đã ghi nhận điều khoản bảo mật thông điệp dữ liệu điện tử</li>
                </ul>
              </div>
            </div>
          </article>

          {/* Card 3: Soạn thảo & Tra cứu VBPL + Án lệ */}
          <article className="lx-feature-card">
            <div className="lx-feature-copy">
              <span className="lx-feature-eyebrow">03 • SOẠN THẢO & KHO VĂN BẢN</span>
              <h3>Soạn thảo văn bản & Tra cứu Án lệ</h3>
              <p>
                Soạn thảo nhanh 5 biểu mẫu chuẩn pháp chế CNTT (Thông báo sự cố dữ liệu 72h, Chính sách
                bảo mật, Đơn trình báo PA05, Phụ lục DPA, Văn bản giải trình) và tra cứu toàn văn điều
                luật, lược đồ chuyển tiếp hiệu lực, bản án công nghệ cao trực tiếp từ kho PostgreSQL.
              </p>
              <div className="lx-feature-btn-row">
                <button
                  type="button"
                  className="lx-feature-btn"
                  onClick={() => onNavigate('/assistant/legal-document')}
                >
                  <Search size={15} />
                  <span>Tra cứu Văn bản luật</span>
                </button>
                <button
                  type="button"
                  className="lx-feature-btn ghost"
                  onClick={() => onNavigate('/assistant/judgement')}
                >
                  <Gavel size={15} />
                  <span>Tra cứu Án lệ</span>
                </button>
              </div>
            </div>
            <div className="lx-feature-visual">
              <div className="lx-mini-panel">
                <div className="lx-mini-row">
                  <FileSignature size={16} />
                  <strong>5 Biểu mẫu Pháp chế xuất file Word (.doc)</strong>
                </div>
                <div className="lx-mini-tags">
                  <span>Thông báo vi phạm DLCN 72h</span>
                  <span>Chính sách bảo mật NĐ 13</span>
                  <span>Đơn trình báo PA05</span>
                  <span>Phụ lục DPA phần mềm</span>
                  <span>Giải trình xử phạt VPHC</span>
                </div>
              </div>
            </div>
          </article>
        </section>

        {/* 5. ENTERPRISE ANTI-HALLUCINATION & SECURITY */}
        <section className="lx-security-section" aria-labelledby="lx-security-title">
          <h2 id="lx-security-title" className="lx-security-heading">
            Chống ảo giác & Bảo mật cấp Hệ thống
          </h2>
          <p className="lx-security-sub">
            Mọi câu trả lời pháp lý được kiểm soát bởi kiến trúc 5 chốt chặn kiểm duyệt, mã hóa mật
            khẩu PBKDF2-SHA256 và xác thực tài khoản thật qua Google OAuth 2.0 & Email OTP.
          </p>

          <div className="lx-security-diagram">
            <div className="lx-sec-col">
              <div className="lx-sec-col-title danger">Chặn tự động (Guardrails)</div>
              {BLOCKED_THREATS.map((item) => (
                <div key={item} className="lx-sec-pill danger">
                  <ShieldAlert size={15} aria-hidden="true" />
                  <span>{item}</span>
                </div>
              ))}
            </div>

            <div className="lx-sec-core" aria-hidden="true">
              <div className="lx-sec-shield-glow">
                <ShieldCheck size={52} strokeWidth={1.7} />
              </div>
              <span>LexIT Guard v2.2</span>
            </div>

            <div className="lx-sec-col">
              <div className="lx-sec-col-title verified">Xác thực & Tin cậy</div>
              {VERIFIED_GUARANTEES.map((item) => (
                <div key={item} className="lx-sec-pill verified">
                  <CheckCircle2 size={15} aria-hidden="true" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="lx-security-tagline">CHÍNH XÁC. MINH BẠCH. TIN CẬY.</p>

          <div className="lx-security-actions">
            <button type="button" className="lx-feature-btn" onClick={onOpenBenchmark}>
              <BarChart3 size={15} />
              <span>Xem báo cáo đối chứng 40 ca (100%)</span>
            </button>
          </div>
        </section>
      </main>

      {/* 6. CLEAN 3-COLUMN DARK FOOTER */}
      <footer className="lx-home-footer">
        <div className="lx-footer-grid">
          <div className="lx-footer-col">
            <div className="lx-brand-logo" style={{ marginBottom: '0.75rem' }}>
              <span className="lx-brand-emblem" aria-hidden="true">
                <Scale size={16} />
              </span>
              <span className="lx-brand-word">
                <strong>LEX</strong>
                <span>IT</span>
              </span>
            </div>
            <p>
              Hệ thống Trợ lý ảo tư vấn Luật Công nghệ thông tin & An toàn mạng Việt Nam vận hành
              trên kiến trúc Neuro-Symbolic Hybrid RAG (PostgreSQL PGVector + Rule Engine tất định).
            </p>
          </div>

          <div className="lx-footer-col">
            <h4>Không gian làm việc</h4>
            <button type="button" onClick={() => onNavigate('/assistant/lexit/new')}>
              Trợ lý hỏi đáp LexIT
            </button>
            <button type="button" onClick={() => onNavigate('/assistant/legal-document')}>
              Tra cứu văn bản pháp luật
            </button>
            <button type="button" onClick={() => onNavigate('/assistant/judgement')}>
              Tra cứu bản án & án lệ CNTT
            </button>
            <button type="button" onClick={() => onNavigate('/assistant/legal-update')}>
              Cập nhật pháp lý CNTT
            </button>
          </div>

          <div className="lx-footer-col">
            <h4>Tài khoản & Hỗ trợ</h4>
            <button
              type="button"
              onClick={() => onNavigate(currentUser ? '/profile/info' : '/auth/login')}
            >
              {currentUser ? 'Hồ sơ & Cài đặt tài khoản' : 'Đăng nhập / Đăng ký OTP'}
            </button>
            <button type="button" onClick={onOpenBenchmark}>
              Kết quả Benchmark 40 kịch bản
            </button>
            <button type="button" onClick={() => setShowContactModal(true)}>
              Gửi yêu cầu hỗ trợ kỹ thuật
            </button>
          </div>
        </div>

        <div className="lx-footer-bottom">
          <span>© 2026 LexIT LegalTech — Dữ liệu pháp luật Công nghệ thông tin Việt Nam</span>
          <span>Thông tin tư vấn kèm trích dẫn điều luật gốc phục vụ đối chiếu chuyên môn</span>
        </div>
      </footer>

      {/* Floating Contact & Scroll-to-Top Controls */}
      <div className="lx-floating-widgets">
        <button
          type="button"
          className="lx-contact-fab"
          onClick={() => setShowContactModal(true)}
        >
          <MessageSquare size={15} aria-hidden="true" />
          <span>Liên hệ</span>
        </button>
        <button
          type="button"
          className="lx-scrolltop-fab"
          onClick={scrollToTop}
          aria-label="Cuộn lên đầu trang"
          title="Lên đầu trang"
        >
          <ArrowUp size={16} />
        </button>
      </div>

      <ContactInquiryModal
        isOpen={showContactModal}
        onClose={() => setShowContactModal(false)}
        apiBaseUrl={apiBaseUrl}
        apiHeaders={apiHeaders}
        currentUser={currentUser}
      />
    </div>
  );
}
