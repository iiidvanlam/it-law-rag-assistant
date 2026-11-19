import React, { useMemo, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  MessageSquare,
  Pin,
  Scale,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
} from 'lucide-react';
import { UserAvatar } from '../../LegalWorkspaceModals';
import { AUTH_ROLE_OPTIONS, evaluatePasswordStrength } from '../Auth/authHelpers';
import './ProfileLayout.css';

const NEWSLETTER_TOPICS = [
  {
    id: 'personal_data',
    label: 'Bảo vệ dữ liệu cá nhân',
    desc: 'Luật 91/2025/QH15, Nghị định 13/2023/NĐ-CP, Nghị định 330/2026/NĐ-CP',
  },
  {
    id: 'it_sanctions',
    label: 'Xử phạt CNTT & Mạng xã hội',
    desc: 'Nghị định 174/2026/NĐ-CP, Nghị định 15/2020/NĐ-CP, Nghị định 147/2024/NĐ-CP',
  },
  {
    id: 'cybersecurity',
    label: 'An ninh mạng & Tội phạm công nghệ cao',
    desc: 'Luật An ninh mạng 24/2018, 116/2025/QH15 & Điều 285–290 BLHS',
  },
  {
    id: 'e_transactions',
    label: 'Giao dịch điện tử & Chữ ký số',
    desc: 'Luật Giao dịch điện tử 20/2023/QH15 & thông điệp dữ liệu',
  },
  {
    id: 'telecom',
    label: 'Viễn thông, Tên miền & Tần số',
    desc: 'Luật Viễn thông 24/2023/QH15 & quy định hạ tầng số',
  },
];

function formatDateTime(ts) {
  if (!ts) return 'Mới cập nhật';
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ts));
  } catch {
    return 'Mới cập nhật';
  }
}

export function ProfileLayout({
  activeTab = 'info',
  currentUser,
  userToken,
  apiBaseUrl,
  apiHeaders,
  conversations = [],
  onNavigate,
  onAuthSuccess,
  onLogout,
  onSelectConversation,
  onDeleteConversation,
  onNewChat,
}) {
  const [feedback, setFeedback] = useState({ tab: '', type: '', text: '' });

  // Tab 1: Profile Info State
  const [fullName, setFullName] = useState(currentUser?.full_name || '');
  const [role, setRole] = useState(currentUser?.role || 'Doanh nghiệp / Cá nhân');
  const [organization, setOrganization] = useState(currentUser?.organization || '');
  const [savingProfile, setSavingProfile] = useState(false);

  // Tab 2: Change Password State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // Tab 3: Newsletter Preferences State
  const initialNewsletter = currentUser?.preferences?.newsletter || {};
  const [newsletterEnabled, setNewsletterEnabled] = useState(
    initialNewsletter.enabled !== undefined ? Boolean(initialNewsletter.enabled) : true
  );
  const [newsletterTopics, setNewsletterTopics] = useState(
    Array.isArray(initialNewsletter.topics) && initialNewsletter.topics.length > 0
      ? initialNewsletter.topics
      : ['personal_data', 'it_sanctions']
  );
  const [newsletterFrequency, setNewsletterFrequency] = useState(
    initialNewsletter.frequency || 'weekly'
  );
  const [savingNewsletter, setSavingNewsletter] = useState(false);

  const authHeaders = useMemo(
    () => ({ ...apiHeaders, 'X-User-Token': userToken }),
    [apiHeaders, userToken]
  );

  const pwStrength = useMemo(() => evaluatePasswordStrength(newPassword), [newPassword]);
  const isGoogleWithoutLocalPassword =
    currentUser?.auth_provider === 'google' && !currentUser?.preferences?.has_local_password;

  const activeError = feedback.tab === activeTab && feedback.type === 'error' ? feedback.text : '';
  const activeSuccess =
    feedback.tab === activeTab && feedback.type === 'success' ? feedback.text : '';

  const savedSessions = useMemo(
    () =>
      conversations
        .filter((c) => (c.messages?.length || 0) > 0)
        .slice()
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0)),
    [conversations]
  );

  const handleTabNavigate = (path) => {
    setFeedback({ tab: '', type: '', text: '' });
    onNavigate(path);
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    const trimmedName = fullName.trim();
    if (trimmedName.length < 2) {
      setFeedback({
        tab: 'info',
        type: 'error',
        text: 'Họ và tên phải có tối thiểu 2 ký tự.',
      });
      return;
    }

    setSavingProfile(true);
    setFeedback({ tab: '', type: '', text: '' });
    try {
      const res = await axios.put(
        `${apiBaseUrl}/auth/profile`,
        {
          full_name: trimmedName,
          role: role.trim() || 'Doanh nghiệp / Cá nhân',
          organization: organization.trim(),
        },
        { headers: authHeaders }
      );
      if (res.data?.user) {
        onAuthSuccess(res.data.user, userToken);
      }
      setFeedback({
        tab: 'info',
        type: 'success',
        text: 'Đã lưu cập nhật hồ sơ cá nhân vào PostgreSQL.',
      });
    } catch (err) {
      setFeedback({
        tab: 'info',
        type: 'error',
        text: err?.response?.data?.detail || 'Không thể lưu thay đổi hồ sơ lúc này.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (!isGoogleWithoutLocalPassword && !currentPassword) {
      setFeedback({
        tab: 'change-password',
        type: 'error',
        text: 'Vui lòng nhập mật khẩu hiện tại.',
      });
      return;
    }
    if (newPassword.length < 6) {
      setFeedback({
        tab: 'change-password',
        type: 'error',
        text: 'Mật khẩu mới phải có tối thiểu 6 ký tự.',
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setFeedback({
        tab: 'change-password',
        type: 'error',
        text: 'Mật khẩu xác nhận không khớp.',
      });
      return;
    }

    setSavingPassword(true);
    setFeedback({ tab: '', type: '', text: '' });
    try {
      const res = await axios.put(
        `${apiBaseUrl}/auth/change-password`,
        {
          current_password: currentPassword,
          new_password: newPassword,
        },
        { headers: authHeaders }
      );
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      if (currentUser) {
        const nextUser = {
          ...currentUser,
          preferences: {
            ...(currentUser.preferences || {}),
            has_local_password: true,
          },
        };
        onAuthSuccess(nextUser, userToken);
      }
      setFeedback({
        tab: 'change-password',
        type: 'success',
        text: res.data?.message || 'Đã cập nhật mật khẩu thành công.',
      });
    } catch (err) {
      setFeedback({
        tab: 'change-password',
        type: 'error',
        text: err?.response?.data?.detail || 'Không thể đổi mật khẩu. Vui lòng kiểm tra lại.',
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const toggleTopic = (topicId) => {
    setNewsletterTopics((prev) =>
      prev.includes(topicId) ? prev.filter((id) => id !== topicId) : [...prev, topicId]
    );
  };

  const handleSaveNewsletter = async (e) => {
    e.preventDefault();
    setSavingNewsletter(true);
    setFeedback({ tab: '', type: '', text: '' });
    try {
      const mergedPrefs = {
        ...(currentUser?.preferences || {}),
        newsletter: {
          enabled: newsletterEnabled,
          topics: newsletterTopics,
          frequency: newsletterFrequency,
          updated_at: new Date().toISOString(),
        },
      };
      const res = await axios.put(
        `${apiBaseUrl}/auth/profile`,
        { preferences: mergedPrefs },
        { headers: authHeaders }
      );
      if (res.data?.user) {
        onAuthSuccess(res.data.user, userToken);
      }
      setFeedback({
        tab: 'receive-newsletters',
        type: 'success',
        text: 'Đã lưu cấu hình nhận bản tin cập nhật pháp lý CNTT.',
      });
    } catch (err) {
      setFeedback({
        tab: 'receive-newsletters',
        type: 'error',
        text: err?.response?.data?.detail || 'Không thể lưu cấu hình bản tin lúc này.',
      });
    } finally {
      setSavingNewsletter(false);
    }
  };

  const tabHeadingMap = {
    info: 'Hồ sơ cá nhân',
    'change-password': 'Đổi mật khẩu',
    'receive-newsletters': 'Nhận bản tin pháp lý',
    sessions: 'Lịch sử hoạt động',
  };

  const authProviderLabel =
    currentUser?.auth_provider === 'google' ? 'Google OAuth 2.0' : 'Tài khoản Email';

  return (
    <div className="lx-prof-root">
      {/* Crisp Light Top Navbar */}
      <header className="lx-prof-navbar">
        <div className="lx-prof-nav-inner">
          <a
            href="/home"
            className="lx-prof-brand"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('/home');
            }}
            aria-label="Về trang chủ LexIT"
          >
            <span className="lx-prof-brand-badge" aria-hidden="true">
              <Scale size={17} strokeWidth={2.3} />
            </span>
            <span className="lx-prof-brand-word">
              <strong>LEX</strong>
              <span>IT</span>
            </span>
          </a>

          <nav className="lx-prof-nav-links" aria-label="Điều hướng nhanh không gian làm việc">
            <button
              type="button"
              className="lx-prof-nav-link"
              onClick={() => onNavigate('/assistant/lexit/new')}
            >
              <Sparkles size={14} aria-hidden="true" />
              <span>Trợ lý LexIT</span>
            </button>
            <button
              type="button"
              className="lx-prof-nav-link"
              onClick={() => onNavigate('/assistant/legal-document')}
            >
              <BookOpen size={14} aria-hidden="true" />
              <span>Tra cứu văn bản</span>
            </button>
            <button
              type="button"
              className="lx-prof-nav-link"
              onClick={() => onNavigate('/assistant/legal-update')}
            >
              <Bell size={14} aria-hidden="true" />
              <span>Cập nhật pháp lý</span>
            </button>
          </nav>

          <div className="lx-prof-nav-user">
            <UserAvatar user={currentUser} className="lx-prof-nav-avatar" />
            <span className="lx-prof-nav-name">{currentUser?.full_name || 'Thành viên'}</span>
          </div>
        </div>
      </header>

      <main className="lx-prof-main">
        {/* Breadcrumb */}
        <nav className="lx-prof-breadcrumb" aria-label="Đường dẫn trang">
          <button
            type="button"
            className="lx-prof-crumb-link"
            onClick={() => onNavigate('/assistant/lexit/new')}
          >
            Trang chủ
          </button>
          <ChevronRight size={15} aria-hidden="true" />
          <span className="lx-prof-crumb-current">Cài đặt chung</span>
          <ChevronRight size={15} aria-hidden="true" />
          <span className="lx-prof-crumb-current strong">{tabHeadingMap[activeTab] || 'Hồ sơ'}</span>
        </nav>

        {/* 2-Column Split Cards */}
        <div className="lx-prof-grid">
          {/* Left Navigation Card */}
          <aside className="lx-prof-sidebar-card" aria-label="Danh mục cài đặt tài khoản">
            <div className="lx-prof-user-box">
              <UserAvatar user={currentUser} className="lx-prof-avatar-lg" />
              <div className="lx-prof-user-meta">
                <strong>{currentUser?.full_name || 'Thành viên LexIT'}</strong>
                <span>{currentUser?.email}</span>
                <div className="lx-prof-provider-pill">
                  <ShieldCheck size={12} aria-hidden="true" />
                  <span>{authProviderLabel}</span>
                </div>
              </div>
            </div>

            <div className="lx-prof-menu" role="navigation" aria-label="Menu tài khoản">
              <button
                type="button"
                className={`lx-prof-menu-item ${activeTab === 'info' ? 'active' : ''}`}
                onClick={() => handleTabNavigate('/profile/info')}
                aria-current={activeTab === 'info' ? 'page' : undefined}
              >
                <User size={16} aria-hidden="true" />
                <span>Hồ sơ cá nhân</span>
              </button>

              <button
                type="button"
                className={`lx-prof-menu-item ${activeTab === 'change-password' ? 'active' : ''}`}
                onClick={() => handleTabNavigate('/profile/change-password')}
                aria-current={activeTab === 'change-password' ? 'page' : undefined}
              >
                <KeyRound size={16} aria-hidden="true" />
                <span>Đổi mật khẩu</span>
              </button>

              <button
                type="button"
                className={`lx-prof-menu-item ${activeTab === 'receive-newsletters' ? 'active' : ''}`}
                onClick={() => handleTabNavigate('/profile/receive-newsletters')}
                aria-current={activeTab === 'receive-newsletters' ? 'page' : undefined}
              >
                <Mail size={16} aria-hidden="true" />
                <span>Nhận bản tin pháp lý</span>
              </button>

              <button
                type="button"
                className={`lx-prof-menu-item ${activeTab === 'sessions' ? 'active' : ''}`}
                onClick={() => handleTabNavigate('/profile/sessions')}
                aria-current={activeTab === 'sessions' ? 'page' : undefined}
              >
                <Clock size={16} aria-hidden="true" />
                <span>Lịch sử hoạt động</span>
              </button>

              <div className="lx-prof-menu-divider" />

              <button
                type="button"
                className="lx-prof-menu-item danger"
                onClick={() => {
                  onLogout();
                  onNavigate('/home');
                }}
              >
                <LogOut size={16} aria-hidden="true" />
                <span>Đăng xuất</span>
              </button>
            </div>
          </aside>

          {/* Right Content Panel */}
          <section className="lx-prof-content-card" aria-labelledby="lx-prof-panel-title">
            <header className="lx-prof-panel-head">
              <h1 id="lx-prof-panel-title">{tabHeadingMap[activeTab] || 'Hồ sơ cá nhân'}</h1>
              <p>
                {activeTab === 'info' &&
                  'Cập nhật thông tin tài khoản và vai trò chuyên môn được đồng bộ trực tiếp với PostgreSQL.'}
                {activeTab === 'change-password' &&
                  (isGoogleWithoutLocalPassword
                    ? 'Tài khoản của bạn đăng nhập bằng Google. Bạn có thể thiết lập mật khẩu đăng nhập cục bộ ngay tại đây.'
                    : 'Đổi mật khẩu định kỳ để bảo vệ phiên làm việc và lịch sử tư vấn pháp lý của bạn.')}
                {activeTab === 'receive-newsletters' &&
                  'Chọn các nhóm văn bản luật CNTT bạn muốn theo dõi khi có hiệu lực mới hoặc nghị định thay thế.'}
                {activeTab === 'sessions' &&
                  'Quản lý các phiên hội thoại pháp lý đã lưu trữ trong cơ sở dữ liệu tài khoản của bạn.'}
              </p>
            </header>

            {activeError && (
              <div className="lx-prof-alert error" role="alert">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>{activeError}</span>
              </div>
            )}

            {activeSuccess && (
              <div className="lx-prof-alert success" role="status">
                <CheckCircle2 size={16} aria-hidden="true" />
                <span>{activeSuccess}</span>
              </div>
            )}

            {/* VIEW 1: /profile/info */}
            {activeTab === 'info' && (
              <form className="lx-prof-form" onSubmit={handleSaveProfile}>
                <div className="lx-prof-field-row">
                  <div className="lx-prof-field">
                    <label htmlFor="prof-email-readonly">Địa chỉ Email</label>
                    <input
                      id="prof-email-readonly"
                      type="email"
                      value={currentUser?.email || ''}
                      disabled
                      readOnly
                    />
                    <span className="lx-prof-field-hint">
                      Phương thức: {authProviderLabel}
                      {currentUser?.preferences?.email_verified ? ' • Đã xác thực OTP/OAuth' : ''}
                    </span>
                  </div>

                  <div className="lx-prof-field">
                    <label htmlFor="prof-fullname">Họ và tên *</label>
                    <input
                      id="prof-fullname"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Nhập họ và tên đầy đủ"
                      required
                    />
                  </div>
                </div>

                <div className="lx-prof-field-row">
                  <div className="lx-prof-field">
                    <label htmlFor="prof-role-select">Vai trò chuyên môn</label>
                    <select
                      id="prof-role-select"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                    >
                      {AUTH_ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                      {!AUTH_ROLE_OPTIONS.some((o) => o.value === role) && role && (
                        <option value={role}>{role}</option>
                      )}
                    </select>
                  </div>

                  <div className="lx-prof-field">
                    <label htmlFor="prof-org-input">Tổ chức / Doanh nghiệp</label>
                    <input
                      id="prof-org-input"
                      type="text"
                      value={organization}
                      onChange={(e) => setOrganization(e.target.value)}
                      placeholder="VD: Phòng Pháp chế Công ty Công nghệ..."
                    />
                  </div>
                </div>

                <div className="lx-prof-form-actions">
                  <button
                    type="submit"
                    className="lx-prof-primary-btn"
                    disabled={savingProfile}
                  >
                    {savingProfile ? (
                      <Loader2 size={16} className="spin-icon" />
                    ) : (
                      <Check size={16} />
                    )}
                    <span>Lưu thay đổi</span>
                  </button>
                </div>
              </form>
            )}

            {/* VIEW 2: /profile/change-password */}
            {activeTab === 'change-password' && (
              <form className="lx-prof-form narrow" onSubmit={handleChangePassword}>
                {!isGoogleWithoutLocalPassword && (
                  <div className="lx-prof-field">
                    <label htmlFor="prof-cur-pw">Mật khẩu hiện tại *</label>
                    <div className="lx-prof-pw-wrap">
                      <input
                        id="prof-cur-pw"
                        type={showCurrentPw ? 'text' : 'password'}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Nhập mật khẩu hiện tại"
                        autoComplete="current-password"
                        required
                      />
                      <button
                        type="button"
                        className="lx-prof-pw-toggle"
                        onClick={() => setShowCurrentPw((v) => !v)}
                        aria-label={showCurrentPw ? 'Ẩn mật khẩu hiện tại' : 'Hiện mật khẩu hiện tại'}
                      >
                        {showCurrentPw ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                )}

                <div className="lx-prof-field">
                  <label htmlFor="prof-new-pw">Mật khẩu mới *</label>
                  <div className="lx-prof-pw-wrap">
                    <input
                      id="prof-new-pw"
                      type={showNewPw ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Tối thiểu 6 ký tự"
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      className="lx-prof-pw-toggle"
                      onClick={() => setShowNewPw((v) => !v)}
                      aria-label={showNewPw ? 'Ẩn mật khẩu mới' : 'Hiện mật khẩu mới'}
                    >
                      {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {newPassword && (
                    <div className={`lx-prof-pw-strength ${pwStrength.level}`}>
                      <span className="bars" aria-hidden="true">
                        <i className={pwStrength.score >= 1 ? 'on' : ''} />
                        <i className={pwStrength.score >= 2 ? 'on' : ''} />
                        <i className={pwStrength.score >= 3 ? 'on' : ''} />
                      </span>
                      <small>
                        Độ mạnh: <strong>{pwStrength.label}</strong> — {pwStrength.hint}
                      </small>
                    </div>
                  )}
                </div>

                <div className="lx-prof-field">
                  <label htmlFor="prof-confirm-pw">Xác nhận mật khẩu mới *</label>
                  <input
                    id="prof-confirm-pw"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Nhập lại mật khẩu mới"
                    autoComplete="new-password"
                    required
                  />
                </div>

                <div className="lx-prof-form-actions">
                  <button
                    type="submit"
                    className="lx-prof-primary-btn"
                    disabled={savingPassword}
                  >
                    {savingPassword ? (
                      <Loader2 size={16} className="spin-icon" />
                    ) : (
                      <KeyRound size={16} />
                    )}
                    <span>
                      {isGoogleWithoutLocalPassword ? 'Thiết lập mật khẩu' : 'Cập nhật mật khẩu'}
                    </span>
                  </button>
                </div>
              </form>
            )}

            {/* VIEW 3: /profile/receive-newsletters */}
            {activeTab === 'receive-newsletters' && (
              <form className="lx-prof-form" onSubmit={handleSaveNewsletter}>
                <label className="lx-prof-toggle-box">
                  <div>
                    <strong>Bật thông báo cập nhật văn bản pháp luật CNTT</strong>
                    <span>
                      Lưu cấu hình theo dõi các mốc hiệu lực mới cho địa chỉ{' '}
                      <strong>{currentUser?.email}</strong>
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={newsletterEnabled}
                    onChange={(e) => setNewsletterEnabled(e.target.checked)}
                  />
                </label>

                <fieldset className="lx-prof-fieldset" disabled={!newsletterEnabled}>
                  <legend>Lĩnh vực pháp luật CNTT quan tâm</legend>
                  <div className="lx-prof-topic-grid">
                    {NEWSLETTER_TOPICS.map((topic) => {
                      const checked = newsletterTopics.includes(topic.id);
                      return (
                        <label
                          key={topic.id}
                          className={`lx-prof-topic-card ${checked ? 'selected' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTopic(topic.id)}
                          />
                          <div>
                            <strong>{topic.label}</strong>
                            <span>{topic.desc}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset className="lx-prof-fieldset" disabled={!newsletterEnabled}>
                  <legend>Tần suất tổng hợp</legend>
                  <div className="lx-prof-radio-row">
                    <label className="lx-prof-radio-pill">
                      <input
                        type="radio"
                        name="newsletter-freq"
                        value="immediate"
                        checked={newsletterFrequency === 'immediate'}
                        onChange={() => setNewsletterFrequency('immediate')}
                      />
                      <span>Ngay khi có văn bản mới</span>
                    </label>
                    <label className="lx-prof-radio-pill">
                      <input
                        type="radio"
                        name="newsletter-freq"
                        value="weekly"
                        checked={newsletterFrequency === 'weekly'}
                        onChange={() => setNewsletterFrequency('weekly')}
                      />
                      <span>Tổng hợp hàng tuần</span>
                    </label>
                  </div>
                </fieldset>

                <div className="lx-prof-form-actions">
                  <button
                    type="submit"
                    className="lx-prof-primary-btn"
                    disabled={savingNewsletter}
                  >
                    {savingNewsletter ? (
                      <Loader2 size={16} className="spin-icon" />
                    ) : (
                      <Check size={16} />
                    )}
                    <span>Lưu thiết lập bản tin</span>
                  </button>
                </div>
              </form>
            )}

            {/* VIEW 4: /profile/sessions */}
            {activeTab === 'sessions' && (
              <div className="lx-prof-sessions">
                <div className="lx-prof-sessions-bar">
                  <span>
                    Đang lưu trữ <strong>{savedSessions.length}</strong> phiên tư vấn đã trao đổi
                  </span>
                  <button
                    type="button"
                    className="lx-prof-primary-btn small"
                    onClick={() => {
                      onNewChat();
                      onNavigate('/assistant/lexit/new');
                    }}
                  >
                    <Sparkles size={14} />
                    <span>Tạo phiên tư vấn mới</span>
                  </button>
                </div>

                {savedSessions.length === 0 ? (
                  <div className="lx-prof-empty-sessions">
                    <MessageSquare size={28} aria-hidden="true" />
                    <h3>Chưa có phiên tư vấn nào được lưu</h3>
                    <p>
                      Mọi câu hỏi và kết quả phân tích của bạn trong Trợ lý LexIT sẽ tự động đồng bộ
                      về PostgreSQL tại đây.
                    </p>
                  </div>
                ) : (
                  <div className="lx-prof-session-list">
                    {savedSessions.map((conv) => (
                      <div key={conv.id} className="lx-prof-session-row">
                        <div className="lx-prof-session-info">
                          <div className="lx-prof-session-title">
                            {conv.pinned && <Pin size={13} className="pin-icon" aria-hidden="true" />}
                            <strong>{conv.title}</strong>
                          </div>
                          <div className="lx-prof-session-meta">
                            <span>{conv.messages?.length || 0} tin nhắn</span>
                            <span>•</span>
                            <span>Cập nhật: {formatDateTime(conv.updatedAt)}</span>
                          </div>
                        </div>

                        <div className="lx-prof-session-actions">
                          <button
                            type="button"
                            className="lx-prof-outline-btn"
                            onClick={() => {
                              onSelectConversation(conv.id);
                              onNavigate('/assistant/lexit/new');
                            }}
                          >
                            <span>Mở lại</span>
                            <ChevronRight size={14} />
                          </button>
                          <button
                            type="button"
                            className="lx-prof-danger-icon-btn"
                            onClick={(e) => onDeleteConversation(e, conv.id)}
                            aria-label={`Xóa phiên ${conv.title}`}
                            title="Xóa phiên này"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
