import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileSignature,
  Gavel,
  Loader2,
  LogIn,
  LogOut,
  Printer,
  Search,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Upload,
  User,
  X,
} from 'lucide-react';
import {
  escapeHtml,
  safeCopyToClipboard,
  extractBase64FromDataUrl,
} from './utils/legalHelpers';

function useModalFocusManagement(isOpen, focusTargetRef) {
  const previousFocusRef = useRef(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const timer = window.setTimeout(() => {
        focusTargetRef.current?.focus?.();
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (!isOpen && wasOpenRef.current) {
      wasOpenRef.current = false;
      previousFocusRef.current?.focus?.();
      previousFocusRef.current = null;
    }
    return undefined;
  }, [isOpen, focusTargetRef]);
}

function getAuthHeaders(apiHeaders, userToken) {
  return {
    ...(apiHeaders || {}),
    ...(userToken ? { 'X-User-Token': userToken } : {}),
  };
}

function GoogleMarkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
      />
    </svg>
  );
}

export function UserAvatar({ user, className = 'user-avatar-sm' }) {
  const avatarUrl = String(user?.preferences?.avatar_url || '').trim();
  const [failedUrl, setFailedUrl] = useState('');
  const initial = (user?.full_name || user?.email || 'U').charAt(0).toUpperCase();
  const canShowImg = Boolean(avatarUrl && failedUrl !== avatarUrl);

  return (
    <span className={className}>
      {canShowImg ? (
        <img
          src={avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="avatar-img-fill"
          onError={() => setFailedUrl(avatarUrl)}
        />
      ) : (
        initial
      )}
    </span>
  );
}

// ============================================================================
// 1. AuthModal: Đăng nhập / Đăng ký / Hồ sơ Chuyên gia & Google OAuth 2.0
// ============================================================================
export function AuthModal({
  isOpen,
  onClose,
  initialMode = 'login',
  apiBaseUrl,
  apiHeaders,
  currentUser,
  userToken,
  onAuthSuccess,
  onLogout,
  theme = 'light',
}) {
  const [tab, setTab] = useState(currentUser ? 'profile' : initialMode);
  const closeBtnRef = useRef(null);
  const wasOpenSyncRef = useRef(false);

  useModalFocusManagement(isOpen, closeBtnRef);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('Chuyên viên Pháp chế CNTT');
  const [organization, setOrganization] = useState('');

  const [profileName, setProfileName] = useState(currentUser?.full_name || '');
  const [profileRole, setProfileRole] = useState(currentUser?.role || '');
  const [profileOrg, setProfileOrg] = useState(currentUser?.organization || '');

  const envGoogleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
  const [googleClientId, setGoogleClientId] = useState(envGoogleClientId);
  const [googleConfigLoaded, setGoogleConfigLoaded] = useState(Boolean(envGoogleClientId));
  const [googleSdkFailed, setGoogleSdkFailed] = useState(false);
  const [showGoogleGuide, setShowGoogleGuide] = useState(false);
  const googleBtnRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const syncProfileDraft = useCallback((userObj) => {
    setProfileName(userObj?.full_name || '');
    setProfileRole(userObj?.role || '');
    setProfileOrg(userObj?.organization || '');
  }, []);

  useEffect(() => {
    if (isOpen && !wasOpenSyncRef.current) {
      wasOpenSyncRef.current = true;
      setTab(currentUser ? 'profile' : initialMode);
      setErrorMsg('');
      setSuccessMsg('');
      setShowGoogleGuide(false);
      setGoogleSdkFailed(false);
      syncProfileDraft(currentUser);
    } else if (!isOpen && wasOpenSyncRef.current) {
      wasOpenSyncRef.current = false;
    }
  }, [isOpen, currentUser, initialMode, syncProfileDraft]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || currentUser || envGoogleClientId) return undefined;
    let cancelled = false;
    axios
      .get(`${apiBaseUrl}/auth/google-config`, { headers: apiHeaders })
      .then((res) => {
        if (cancelled) return;
        setGoogleClientId(String(res.data?.client_id || '').trim());
        setGoogleConfigLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setGoogleConfigLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, currentUser, envGoogleClientId, apiBaseUrl, apiHeaders]);

  const handleGoogleCredential = useCallback(
    async (credentialResponse) => {
      const cred = credentialResponse?.credential;
      if (!cred) return;
      setLoading(true);
      setErrorMsg('');
      setSuccessMsg('');
      try {
        const res = await axios.post(
          `${apiBaseUrl}/auth/google`,
          { credential: cred },
          { headers: apiHeaders }
        );
        onAuthSuccess(res.data.user, res.data.access_token);
        syncProfileDraft(res.data.user);
        onClose();
      } catch (err) {
        setErrorMsg(
          err?.response?.data?.detail || 'Xác thực Google thất bại. Vui lòng kiểm tra GOOGLE_CLIENT_ID.'
        );
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, apiHeaders, onAuthSuccess, onClose, syncProfileDraft]
  );

  useEffect(() => {
    if (!isOpen || currentUser || !googleClientId || (tab !== 'login' && tab !== 'register')) {
      return undefined;
    }
    let cancelled = false;
    let pollTimer = null;
    let attempts = 0;

    const tryRenderGoogleButton = () => {
      const gsi = window.google?.accounts?.id;
      const hostEl = googleBtnRef.current;
      if (!gsi || !hostEl || cancelled) return false;

      gsi.initialize({
        client_id: googleClientId,
        callback: handleGoogleCredential,
      });
      hostEl.innerHTML = '';
      const slotWidth = Math.max(240, Math.min(390, hostEl.clientWidth || 360));
      gsi.renderButton(hostEl, {
        theme: theme === 'dark' ? 'filled_black' : 'outline',
        size: 'large',
        shape: 'rectangular',
        text: tab === 'register' ? 'signup_with' : 'continue_with',
        locale: 'vi',
        width: slotWidth,
      });
      return true;
    };

    if (!tryRenderGoogleButton()) {
      pollTimer = window.setInterval(() => {
        attempts += 1;
        if (tryRenderGoogleButton()) {
          window.clearInterval(pollTimer);
          pollTimer = null;
        } else if (attempts >= 24) {
          window.clearInterval(pollTimer);
          pollTimer = null;
          if (!cancelled) setGoogleSdkFailed(true);
        }
      }, 250);
    }

    return () => {
      cancelled = true;
      if (pollTimer !== null) window.clearInterval(pollTimer);
    };
  }, [isOpen, currentUser, googleClientId, tab, theme, handleGoogleCredential]);

  const renderGoogleOAuthSection = (unconfiguredLabel) => {
    if (googleClientId) {
      return (
        <div className="google-gsi-box">
          <div ref={googleBtnRef} className="google-gsi-slot" />
          {googleSdkFailed && (
            <p className="google-gsi-fallback-note">
              Không tải được Google Sign-In SDK (kiểm tra mạng hoặc trình chặn quảng cáo).
            </p>
          )}
        </div>
      );
    }

    return (
      <div className="google-unconfigured-wrap">
        <button
          type="button"
          className="workspace-btn google-oauth-btn full"
          onClick={() => setShowGoogleGuide((prev) => !prev)}
          disabled={loading}
        >
          <GoogleMarkIcon />
          <span>{googleConfigLoaded ? unconfiguredLabel : 'Đang kiểm tra Google OAuth...'}</span>
        </button>
        {showGoogleGuide && (
          <div className="google-setup-guide">
            <strong>Cách bật Đăng nhập Google thật (OAuth 2.0):</strong>
            <ol>
              <li>
                Vào Google Cloud Console → <em>Credentials</em> → tạo{' '}
                <strong>OAuth client ID (Web application)</strong>.
              </li>
              <li>
                Thêm <code>http://localhost:5173</code> và <code>http://127.0.0.1:5173</code> vào{' '}
                <em>Authorized JavaScript origins</em>.
              </li>
              <li>
                Thêm <code>GOOGLE_CLIENT_ID=...</code> vào <code>backend/.env</code> và khởi động lại
                backend.
              </li>
            </ol>
          </div>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await axios.post(
        `${apiBaseUrl}/auth/login`,
        { email, password },
        { headers: apiHeaders }
      );
      onAuthSuccess(res.data.user, res.data.access_token);
      syncProfileDraft(res.data.user);
      setSuccessMsg('Đăng nhập thành công!');
      onClose();
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || 'Không thể đăng nhập. Vui lòng kiểm tra thông tin.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await axios.post(
        `${apiBaseUrl}/auth/register`,
        {
          email,
          password,
          full_name: fullName,
          role,
          organization,
        },
        { headers: apiHeaders }
      );
      onAuthSuccess(res.data.user, res.data.access_token);
      syncProfileDraft(res.data.user);
      onClose();
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || 'Không thể tạo tài khoản. Vui lòng kiểm tra dữ liệu.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await axios.put(
        `${apiBaseUrl}/auth/profile`,
        {
          full_name: profileName,
          role: profileRole,
          organization: profileOrg,
        },
        { headers: getAuthHeaders(apiHeaders, userToken) }
      );
      onAuthSuccess(res.data.user, userToken);
      setSuccessMsg('Đã cập nhật hồ sơ chuyên gia thành công.');
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || 'Không thể cập nhật hồ sơ.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="workspace-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Tài khoản LexIT Workspace"
      onClick={onClose}
    >
      <div className="workspace-modal-card auth-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="workspace-modal-header">
          <div className="workspace-modal-title-group">
            <div className="workspace-modal-icon">
              <User size={18} />
            </div>
            <div>
              <h3>{currentUser ? 'Hồ sơ Thành viên LexIT' : 'Tài khoản LexIT LegalTech'}</h3>
              <p>Đồng bộ lịch sử tư vấn, rà soát tuân thủ và kho mẫu hợp đồng CNTT</p>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="workspace-close-btn"
            onClick={onClose}
            aria-label="Đóng cửa sổ tài khoản"
          >
            <X size={18} />
          </button>
        </div>

        {!currentUser ? (
          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'login'}
              className={`auth-tab-btn ${tab === 'login' ? 'active' : ''}`}
              onClick={() => {
                setTab('login');
                setErrorMsg('');
              }}
            >
              Đăng nhập
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'register'}
              className={`auth-tab-btn ${tab === 'register' ? 'active' : ''}`}
              onClick={() => {
                setTab('register');
                setErrorMsg('');
              }}
            >
              Đăng ký miễn phí
            </button>
          </div>
        ) : null}

        {errorMsg && (
          <div className="workspace-alert error" role="alert">
            <AlertTriangle size={15} />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="workspace-alert success" role="status">
            <CheckCircle2 size={15} />
            <span>{successMsg}</span>
          </div>
        )}

        {currentUser ? (
          <form className="workspace-form" onSubmit={handleUpdateProfile}>
            <div className="profile-summary-banner">
              <UserAvatar user={currentUser} className="profile-avatar-circle" />
              <div className="profile-meta">
                <strong>{currentUser.full_name}</strong>
                <span>{currentUser.email}</span>
              </div>
              <div className="profile-credits-badge" title="Hạn mức phân tích nâng cao">
                <Sparkles size={13} />
                <span>{currentUser.credits ?? 100} Credits</span>
              </div>
            </div>

            <div className="form-field">
              <label htmlFor="prof-fullname">Họ và tên</label>
              <input
                id="prof-fullname"
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                required
              />
            </div>

            <div className="form-grid-2">
              <div className="form-field">
                <label htmlFor="prof-role">Vai trò chuyên môn</label>
                <select
                  id="prof-role"
                  value={profileRole}
                  onChange={(e) => setProfileRole(e.target.value)}
                >
                  <option value="Chuyên viên Pháp chế CNTT">Chuyên viên Pháp chế CNTT</option>
                  <option value="Luật sư Tranh tụng">Luật sư Tranh tụng</option>
                  <option value="Quản trị An toàn thông tin (CISO/DPO)">CISO / DPO Doanh nghiệp</option>
                  <option value="Doanh nghiệp / Cá nhân">Doanh nghiệp / Cá nhân</option>
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="prof-org">Tổ chức / Công ty</label>
                <input
                  id="prof-org"
                  type="text"
                  value={profileOrg}
                  onChange={(e) => setProfileOrg(e.target.value)}
                  placeholder="VD: Công ty Công nghệ XYZ"
                />
              </div>
            </div>

            <div className="workspace-modal-actions between">
              <button
                type="button"
                className="workspace-btn danger-outline"
                onClick={() => {
                  onLogout();
                  onClose();
                }}
              >
                <LogOut size={15} />
                <span>Đăng xuất</span>
              </button>
              <button type="submit" className="workspace-btn primary" disabled={loading}>
                {loading ? <Loader2 size={15} className="spin-icon" /> : <Check size={15} />}
                <span>Lưu thay đổi</span>
              </button>
            </div>
          </form>
        ) : tab === 'login' ? (
          <form className="workspace-form" onSubmit={handleLogin}>
            <div className="form-field">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.vn"
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="login-password">Mật khẩu</label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nhập mật khẩu..."
                required
              />
            </div>

            <button type="submit" className="workspace-btn primary full" disabled={loading}>
              {loading ? <Loader2 size={15} className="spin-icon" /> : <LogIn size={15} />}
              <span>Đăng nhập</span>
            </button>

            <div className="auth-divider">
              <span>Hoặc tiếp tục với Google</span>
            </div>

            {renderGoogleOAuthSection('Đăng nhập bằng Google (Chưa bật Client ID)')}
          </form>
        ) : (
          <form className="workspace-form" onSubmit={handleRegister}>
            <div className="form-field">
              <label htmlFor="reg-name">Họ và tên</label>
              <input
                id="reg-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nguyễn Văn A"
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="reg-email">Email công việc / cá nhân</label>
              <input
                id="reg-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="phapche@doanhnghiep.vn"
                required
              />
            </div>
            <div className="form-grid-2">
              <div className="form-field">
                <label htmlFor="reg-role">Vai trò</label>
                <select id="reg-role" value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="Chuyên viên Pháp chế CNTT">Pháp chế CNTT</option>
                  <option value="Luật sư">Luật sư</option>
                  <option value="DPO / An toàn thông tin">DPO / An toàn thông tin</option>
                  <option value="Doanh nghiệp / Cá nhân">Doanh nghiệp / Cá nhân</option>
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="reg-org">Tổ chức (tùy chọn)</label>
                <input
                  id="reg-org"
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="Tên công ty / đơn vị"
                />
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="reg-password">Mật khẩu (tối thiểu 6 ký tự)</label>
              <input
                id="reg-password"
                type="password"
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Tạo mật khẩu bảo mật"
                required
              />
            </div>
            <button type="submit" className="workspace-btn primary full" disabled={loading}>
              {loading ? <Loader2 size={15} className="spin-icon" /> : <Sparkles size={15} />}
              <span>Đăng ký & Nhận 100 Credits</span>
            </button>

            <div className="auth-divider">
              <span>Hoặc tạo tài khoản bằng Google</span>
            </div>

            {renderGoogleOAuthSection('Đăng ký nhanh bằng Google (Chưa bật Client ID)')}
          </form>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 2. ComplianceReviewModal: Rà soát Tuân thủ Hợp đồng / Chính sách CNTT
// ============================================================================
const SAMPLE_POLICY_TEXT = `CHÍNH SÁCH BẢO MẬT ỨNG DỤNG CÔNG NGHỆ
Chúng tôi thu thập họ tên, số điện thoại và nhật ký sử dụng ứng dụng để cung cấp dịch vụ.
Dữ liệu có thể được gửi kèm email quảng cáo sản phẩm mới cho khách hàng.
Máy chủ lưu trữ hiện đặt trên nền tảng điện toán đám mây tại nước ngoài.`;

export function ComplianceReviewModal({
  isOpen,
  onClose,
  apiBaseUrl,
  apiHeaders,
  userToken,
  defaultAsOfDate,
  onSendResultToChat,
}) {
  const [docType, setDocType] = useState('PRIVACY_POLICY');
  const [subject, setSubject] = useState('ORGANIZATION');
  const [asOfDate, setAsOfDate] = useState(defaultAsOfDate || '');
  const [docText, setDocText] = useState(SAMPLE_POLICY_TEXT);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [useLlm, setUseLlm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [report, setReport] = useState(null);
  const [copiedId, setCopiedId] = useState('');
  const closeBtnRef = useRef(null);
  const wasOpenSyncRef = useRef(false);

  useModalFocusManagement(isOpen, closeBtnRef);

  useEffect(() => {
    if (isOpen && !wasOpenSyncRef.current) {
      wasOpenSyncRef.current = true;
      setAsOfDate(defaultAsOfDate || '');
    } else if (!isOpen && wasOpenSyncRef.current) {
      wasOpenSyncRef.current = false;
    }
  }, [isOpen, defaultAsOfDate]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleFilePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = () => {
      const base64Part = extractBase64FromDataUrl(reader.result);
      setUploadedFile({ filename: file.name, base64: base64Part });
      setErrorMsg('');
    };
    reader.onerror = () => {
      setUploadedFile(null);
      setErrorMsg('Không đọc được tệp đã chọn. Vui lòng thử lại hoặc chọn tệp khác.');
    };
    reader.readAsDataURL(file);
  };

  const handleRunReview = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await axios.post(
        `${apiBaseUrl}/compliance/review`,
        {
          document_text: uploadedFile ? null : docText,
          file_base64: uploadedFile ? uploadedFile.base64 : null,
          filename: uploadedFile ? uploadedFile.filename : 'policy.txt',
          doc_type: docType,
          subject,
          as_of_date: asOfDate || null,
          use_llm: useLlm,
        },
        { headers: getAuthHeaders(apiHeaders, userToken) }
      );
      setReport(res.data);
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || 'Không thể thực hiện rà soát tuân thủ.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyClause = (ruleId, clauseText) => {
    safeCopyToClipboard(clauseText);
    setCopiedId(ruleId);
    setTimeout(() => setCopiedId(''), 1800);
  };

  return (
    <div
      className="workspace-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Rà soát Tuân thủ Pháp luật CNTT"
      onClick={onClose}
    >
      <div className="workspace-modal-card wide" onClick={(e) => e.stopPropagation()}>
        <div className="workspace-modal-header">
          <div className="workspace-modal-title-group">
            <div className="workspace-modal-icon emerald">
              <Shield size={18} />
            </div>
            <div>
              <h3>Rà soát Tuân thủ Hợp đồng & Chính sách CNTT</h3>
              <p>Đối chiếu 8 chốt chặn luật định (Luật 91/2025, NĐ 13/2023, NĐ 356/2025, Luật 20/2023, NĐ 174 & NĐ 330/2026)</p>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="workspace-close-btn"
            onClick={onClose}
            aria-label="Đóng cửa sổ rà soát tuân thủ"
          >
            <X size={18} />
          </button>
        </div>

        <form className="workspace-form" onSubmit={handleRunReview}>
          <div className="form-grid-3">
            <div className="form-field">
              <label htmlFor="comp-type">Loại tài liệu</label>
              <select id="comp-type" value={docType} onChange={(e) => setDocType(e.target.value)}>
                <option value="PRIVACY_POLICY">Chính sách Bảo mật (Privacy Policy)</option>
                <option value="SOFTWARE_CONTRACT">Hợp đồng Phần mềm / SaaS / DPA</option>
                <option value="TOS">Điều khoản Sử dụng Nền tảng (ToS)</option>
                <option value="DATA_BREACH_PLAN">Quy trình Ứng cứu Sự cố An toàn mạng</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="comp-subject">Chủ thể áp dụng chế tài</label>
              <select id="comp-subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
                <option value="ORGANIZATION">Tổ chức / Doanh nghiệp</option>
                <option value="INDIVIDUAL">Cá nhân / Hộ kinh doanh</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="comp-date">Mốc ngày đánh giá</label>
              <input
                id="comp-date"
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
              />
            </div>
          </div>

          <div className="form-field">
            <div className="field-header-inline">
              <label htmlFor="comp-textarea">Nội dung hợp đồng / chính sách cần rà soát</label>
              <label className="upload-inline-btn">
                <Upload size={13} />
                <span>{uploadedFile ? uploadedFile.filename : 'Tải tệp (.pdf / .docx / .txt)'}</span>
                <input
                  type="file"
                  accept=".txt,.md,.pdf,.docx"
                  className="sr-only"
                  onChange={handleFilePick}
                />
              </label>
            </div>
            {uploadedFile ? (
              <div className="uploaded-pill">
                <span>Đã chọn tệp: <b>{uploadedFile.filename}</b></span>
                <button
                  type="button"
                  onClick={() => setUploadedFile(null)}
                  aria-label="Xóa tệp đã chọn"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <textarea
                id="comp-textarea"
                rows={5}
                value={docText}
                onChange={(e) => setDocText(e.target.value)}
                placeholder="Dán nội dung điều khoản hợp đồng, chính sách bảo mật..."
              />
            )}
          </div>

          <div className="workspace-modal-actions between">
            <label className="inline-checkbox">
              <input
                type="checkbox"
                checked={useLlm}
                onChange={(e) => setUseLlm(e.target.checked)}
              />
              <span>Bổ sung nhận xét tổng hợp bằng LLM</span>
            </label>
            <button type="submit" className="workspace-btn primary" disabled={loading}>
              {loading ? <Loader2 size={15} className="spin-icon" /> : <ShieldCheck size={15} />}
              <span>Phân tích Rủi ro & Chế tài</span>
            </button>
          </div>
        </form>

        {errorMsg && (
          <div className="workspace-alert error" role="alert">
            <AlertTriangle size={15} />
            <span>{errorMsg}</span>
          </div>
        )}

        {report && (
          <div className="compliance-report-panel">
            <div className="compliance-score-header">
              <div className={`score-circle ${String(report.risk_level || '').toLowerCase()}`}>
                <strong>{report.compliance_score}</strong>
                <span>/100</span>
              </div>
              <div className="score-meta">
                <div className="score-badges">
                  <span className={`risk-badge ${String(report.risk_level || '').toLowerCase()}`}>
                    Rủi ro: {report.risk_level}
                  </span>
                  <span className="count-pill pass">Đạt: {report.counts?.pass ?? 0}</span>
                  <span className="count-pill partial">Bổ sung: {report.counts?.partial ?? 0}</span>
                  <span className="count-pill missing">Thiếu: {report.counts?.missing ?? 0}</span>
                </div>
                <p>{report.summary}</p>
                {report.llm_advisory && <p className="llm-note">{report.llm_advisory}</p>}
              </div>
              <button
                type="button"
                className="workspace-btn secondary"
                onClick={() => {
                  const missing = (report.findings || [])
                    .filter((f) => f.status !== 'PASS')
                    .map((f) => `- ${f.title} (${f.referenced_statute})`)
                    .join('\n');
                  onSendResultToChat(
                    `Tôi vừa rà soát tuân thủ ${report.doc_type} (điểm ${report.compliance_score}/100, mức ${report.risk_level}). Hãy phân tích chi tiết các hạng mục còn thiếu sau:\n${missing}`
                  );
                  onClose();
                }}
              >
                <Send size={14} />
                <span>Hỏi sâu trong Chat</span>
              </button>
            </div>

            <div className="compliance-findings-list">
              {(report.findings || []).map((item) => (
                <div key={item.rule_id} className={`finding-card ${item.status.toLowerCase()}`}>
                  <div className="finding-top">
                    <span className={`finding-status ${item.status.toLowerCase()}`}>
                      {item.status === 'PASS' ? (
                        <CheckCircle2 size={14} />
                      ) : (
                        <ShieldAlert size={14} />
                      )}
                      {item.status}
                    </span>
                    <strong>{item.title}</strong>
                    <span className="finding-statute">{item.referenced_statute}</span>
                  </div>
                  <div className="finding-basis">Căn cứ: {item.legal_basis}</div>
                  <p className="finding-detail">{item.risk_detail}</p>
                  {item.penalty_reference && (
                    <div className="finding-penalty">
                      <b>Chế tài tham chiếu:</b> {item.penalty_reference}
                    </div>
                  )}
                  {item.recommended_clause && (
                    <div className="finding-suggestion">
                      <div className="suggestion-head">
                        <span>Điều khoản đề xuất bổ sung:</span>
                        <button
                          type="button"
                          onClick={() => handleCopyClause(item.rule_id, item.recommended_clause)}
                        >
                          {copiedId === item.rule_id ? <Check size={12} /> : <Copy size={12} />}
                          <span>{copiedId === item.rule_id ? 'Đã chép' : 'Chép điều khoản'}</span>
                        </button>
                      </div>
                      <p>{item.recommended_clause}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 3. LegalDraftingModal: Wizard 3 bước Soạn thảo Văn bản & Hợp đồng CNTT
// ============================================================================
const DRAFT_TEMPLATES = [
  {
    id: 'DATA_BREACH_72H',
    title: 'Thông báo sự cố lộ/lọt dữ liệu cá nhân (Trong 72 giờ)',
    desc: 'Gửi Cục An ninh mạng & chủ thể dữ liệu theo Điều 23 NĐ 13/2023/NĐ-CP & Luật 91/2025/QH15.',
  },
  {
    id: 'PRIVACY_POLICY',
    title: 'Chính sách Bảo mật & Xử lý Dữ liệu Cá nhân (App / Website)',
    desc: 'Chuẩn Opt-in, Opt-out, DPIA/TIA theo Luật 91/2025/QH15, NĐ 356/2025/NĐ-CP & Luật 20/2023/QH15.',
  },
  {
    id: 'CYBERCRIME_REPORT',
    title: 'Đơn trình báo Tấn công mạng / Giả mạo / Lừa đảo CNC',
    desc: 'Trình báo hành vi xâm nhập, ransomware, DDoS, giả mạo website kèm nhật ký chứng cứ số.',
  },
  {
    id: 'SOFTWARE_DPA_CLAUSE',
    title: 'Phụ lục Điều khoản Bảo vệ Dữ liệu (DPA) cho Hợp đồng Phần mềm',
    desc: 'Ràng buộc Bên xử lý dữ liệu phần mềm/SaaS không mua bán data & báo cáo sự cố 72h.',
  },
  {
    id: 'ADMIN_PENALTY_EXPLANATION',
    title: 'Văn bản Giải trình Vi phạm Hành chính lĩnh vực CNTT',
    desc: 'Giải trình tình tiết giảm nhẹ và khắc phục hậu quả theo NĐ 15/2020 / NĐ 174/2026 / NĐ 330/2026.',
  },
];

export function LegalDraftingModal({
  isOpen,
  onClose,
  apiBaseUrl,
  apiHeaders,
  userToken,
  defaultAsOfDate,
  onSendDraftToChat,
}) {
  const [step, setStep] = useState(1);
  const [templateType, setTemplateType] = useState('DATA_BREACH_72H');
  const [partyA, setPartyA] = useState('Công ty Công nghệ ABC');
  const [partyB, setPartyB] = useState('Cục An ninh mạng và PCTP sử dụng CNC / Đối tác');
  const [scope, setScope] = useState('Phát hiện truy cập trái phép vào cơ sở dữ liệu tài khoản khách hàng qua API chưa xác thực.');
  const [language, setLanguage] = useState('vi');
  const [asOfDate, setAsOfDate] = useState(defaultAsOfDate || '');
  const [useLlm, setUseLlm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [draftResult, setDraftResult] = useState(null);
  const [editableMarkdown, setEditableMarkdown] = useState('');
  const [copied, setCopied] = useState(false);
  const closeBtnRef = useRef(null);
  const wasOpenSyncRef = useRef(false);

  useModalFocusManagement(isOpen, closeBtnRef);

  useEffect(() => {
    if (isOpen && !wasOpenSyncRef.current) {
      wasOpenSyncRef.current = true;
      setAsOfDate(defaultAsOfDate || '');
    } else if (!isOpen && wasOpenSyncRef.current) {
      wasOpenSyncRef.current = false;
    }
  }, [isOpen, defaultAsOfDate]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await axios.post(
        `${apiBaseUrl}/drafting/generate`,
        {
          template_type: templateType,
          party_a: partyA,
          party_b: partyB,
          incident_or_scope: scope,
          as_of_date: asOfDate || null,
          language,
          use_llm: useLlm,
        },
        { headers: getAuthHeaders(apiHeaders, userToken) }
      );
      setDraftResult(res.data);
      setEditableMarkdown(res.data.draft_markdown || '');
      setStep(3);
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || 'Không thể khởi tạo bản thảo văn bản.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadDoc = () => {
    const htmlContent = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>${escapeHtml(
      draftResult?.title || 'Van_ban_phap_ly_LexIT'
    )}</title><style>body{font-family:'Times New Roman',serif;line-height:1.55;margin:32px;white-space:pre-wrap;}</style></head><body>${escapeHtml(
      editableMarkdown
    )}</body></html>`;
    const blob = new Blob([htmlContent], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${templateType.toLowerCase()}_lexit.doc`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    const win = window.open('', '_blank', 'width=860,height=760');
    if (win) {
      win.document.write(
        `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>${escapeHtml(
          draftResult?.title || 'Bản thảo LexIT'
        )}</title><style>body{font-family:'Times New Roman',serif;max-width:780px;margin:36px auto;line-height:1.6;white-space:pre-wrap;}</style></head><body>${escapeHtml(
          editableMarkdown
        )}<script>window.print();</script></body></html>`
      );
      win.document.close();
    }
  };

  return (
    <div
      className="workspace-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Soạn thảo Văn bản & Hợp đồng CNTT"
      onClick={onClose}
    >
      <div className="workspace-modal-card wide" onClick={(e) => e.stopPropagation()}>
        <div className="workspace-modal-header">
          <div className="workspace-modal-title-group">
            <div className="workspace-modal-icon">
              <FileSignature size={18} />
            </div>
            <div>
              <h3>Soạn thảo Văn bản & Hợp đồng Pháp lý CNTT</h3>
              <p>Quy trình 3 bước theo khung điều khoản chuẩn — gắn sẵn số hiệu văn bản luật hiện hành</p>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="workspace-close-btn"
            onClick={onClose}
            aria-label="Đóng trình soạn thảo văn bản"
          >
            <X size={18} />
          </button>
        </div>

        <div className="wizard-steps-bar" aria-label="Tiến trình soạn thảo">
          {[1, 2, 3].map((num) => (
            <button
              key={num}
              type="button"
              className={`wizard-step-pill ${step === num ? 'active' : step > num ? 'done' : ''}`}
              onClick={() => {
                if (num < 3 || draftResult) setStep(num);
              }}
            >
              <span>{num}</span>
              <b>{num === 1 ? 'Chọn Mẫu văn bản' : num === 2 ? 'Điền Thông số' : 'Xem trước & Xuất file'}</b>
            </button>
          ))}
        </div>

        {errorMsg && (
          <div className="workspace-alert error" role="alert">
            <AlertTriangle size={15} />
            <span>{errorMsg}</span>
          </div>
        )}

        {step === 1 && (
          <div className="wizard-body">
            <div className="template-grid">
              {DRAFT_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  className={`template-card ${templateType === tpl.id ? 'selected' : ''}`}
                  onClick={() => setTemplateType(tpl.id)}
                >
                  <strong>{tpl.title}</strong>
                  <span>{tpl.desc}</span>
                </button>
              ))}
            </div>
            <div className="workspace-modal-actions end">
              <button type="button" className="workspace-btn primary" onClick={() => setStep(2)}>
                <span>Tiếp theo: Điền thông tin</span>
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="wizard-body workspace-form">
            <div className="form-grid-2">
              <div className="form-field">
                <label htmlFor="draft-partya">Bên A / Đơn vị lập văn bản</label>
                <input
                  id="draft-partya"
                  type="text"
                  value={partyA}
                  onChange={(e) => setPartyA(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="draft-partyb">Bên B / Cơ quan tiếp nhận</label>
                <input
                  id="draft-partyb"
                  type="text"
                  value={partyB}
                  onChange={(e) => setPartyB(e.target.value)}
                />
              </div>
            </div>
            <div className="form-grid-2">
              <div className="form-field">
                <label htmlFor="draft-lang">Ngôn ngữ / Chú giải</label>
                <select id="draft-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="vi">Tiếng Việt (Chuẩn hành chính - tư pháp)</option>
                  <option value="en">Song ngữ tham chiếu (English + Vietnamese Statutes)</option>
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="draft-date">Ngày hiệu lực / Ngày lập</label>
                <input
                  id="draft-date"
                  type="date"
                  value={asOfDate}
                  onChange={(e) => setAsOfDate(e.target.value)}
                />
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="draft-scope">Nội dung sự việc / Phạm vi dịch vụ / Yêu cầu chính</label>
              <textarea
                id="draft-scope"
                rows={4}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              />
            </div>
            <div className="workspace-modal-actions between">
              <button type="button" className="workspace-btn secondary" onClick={() => setStep(1)}>
                <ChevronLeft size={15} />
                <span>Quay lại</span>
              </button>
              <div className="actions-cluster">
                <label className="inline-checkbox">
                  <input
                    type="checkbox"
                    checked={useLlm}
                    onChange={(e) => setUseLlm(e.target.checked)}
                  />
                  <span>Chuẩn hóa văn phong bằng LLM</span>
                </label>
                <button
                  type="button"
                  className="workspace-btn primary"
                  disabled={loading}
                  onClick={handleGenerate}
                >
                  {loading ? <Loader2 size={15} className="spin-icon" /> : <Sparkles size={15} />}
                  <span>Khởi tạo Bản thảo</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 3 && draftResult && (
          <div className="wizard-body">
            <div className="draft-statute-chips">
              {(draftResult.cited_statutes || []).map((st) => (
                <span key={st} className="statute-chip">{st}</span>
              ))}
            </div>
            <div className="draft-split-preview">
              <textarea
                className="draft-editor-area"
                aria-label="Chỉnh sửa nội dung bản thảo Markdown"
                value={editableMarkdown}
                onChange={(e) => setEditableMarkdown(e.target.value)}
              />
              <div className="draft-rendered-preview">
                <ReactMarkdown>{editableMarkdown}</ReactMarkdown>
              </div>
            </div>
            <div className="workspace-modal-actions between">
              <button type="button" className="workspace-btn secondary" onClick={() => setStep(2)}>
                <ChevronLeft size={15} />
                <span>Sửa thông số</span>
              </button>
              <div className="actions-cluster">
                <button
                  type="button"
                  className="workspace-btn secondary"
                  onClick={() => {
                    safeCopyToClipboard(editableMarkdown);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copied ? 'Đã chép' : 'Sao chép'}</span>
                </button>
                <button type="button" className="workspace-btn secondary" onClick={handlePrint}>
                  <Printer size={14} />
                  <span>In / PDF</span>
                </button>
                <button type="button" className="workspace-btn secondary" onClick={handleDownloadDoc}>
                  <Download size={14} />
                  <span>Tải .DOC</span>
                </button>
                <button
                  type="button"
                  className="workspace-btn primary"
                  onClick={() => {
                    onSendDraftToChat(
                      `Hãy rà soát rủi ro pháp lý và hoàn thiện thêm căn cứ cho bản thảo "${draftResult.title}" sau:\n\n${editableMarkdown.slice(0, 2200)}`
                    );
                    onClose();
                  }}
                >
                  <Send size={14} />
                  <span>Phân tích thêm</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 4. PrecedentExplorerModal: Tra cứu Án lệ & Thực tiễn xét xử CNTT
// ============================================================================
export function PrecedentExplorerModal({
  isOpen,
  onClose,
  apiBaseUrl,
  apiHeaders,
  onAskAboutPrecedent,
}) {
  const [query, setQuery] = useState('');
  const [docFilter, setDocFilter] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const searchInputRef = useRef(null);

  useModalFocusManagement(isOpen, searchInputRef);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await axios.get(`${apiBaseUrl}/precedents/search`, {
          params: { q: query, doc_code: docFilter, limit: 20 },
          headers: apiHeaders,
        });
        if (!cancelled) setItems(res.data?.items || []);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const timer = setTimeout(load, 180);
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, query, docFilter, apiBaseUrl, apiHeaders, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="workspace-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Kho Bản án và Án lệ CNTT"
      onClick={onClose}
    >
      <div className="workspace-modal-card wide" onClick={(e) => e.stopPropagation()}>
        <div className="workspace-modal-header">
          <div className="workspace-modal-title-group">
            <div className="workspace-modal-icon purple">
              <Gavel size={18} />
            </div>
            <div>
              <h3>Kho Bản án & Thực tiễn Xét xử Tội phạm Công nghệ cao</h3>
              <p>Đối chiếu ranh giới xử phạt hành chính và trách nhiệm hình sự (Điều 285–290 BLHS, Giao dịch điện tử, Mạng xã hội)</p>
            </div>
          </div>
          <button
            type="button"
            className="workspace-close-btn"
            onClick={onClose}
            aria-label="Đóng kho bản án"
          >
            <X size={18} />
          </button>
        </div>

        <div className="precedent-filter-bar">
          <div className="search-input-wrap">
            <Search size={15} />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo từ khóa (VD: ransomware, DDoS, mua bán data, BTS giả, email)..."
              aria-label="Tìm kiếm bản án"
            />
          </div>
          <select
            value={docFilter}
            onChange={(e) => setDocFilter(e.target.value)}
            aria-label="Lọc theo văn bản luật"
          >
            <option value="">Tất cả văn bản liên quan</option>
            <option value="100/2015/QH13">Bộ luật Hình sự (100/2015/QH13)</option>
            <option value="15/2020/NĐ-CP">Nghị định 15/2020/NĐ-CP</option>
            <option value="174/2026/NĐ-CP">Nghị định 174/2026/NĐ-CP</option>
            <option value="330/2026/NĐ-CP">Nghị định 330/2026/NĐ-CP</option>
            <option value="20/2023/QH15">Luật Giao dịch điện tử (20/2023/QH15)</option>
          </select>
        </div>

        <div className="precedents-scroll-list">
          {loading ? (
            <div className="drawer-loading">
              <Loader2 size={20} className="spin-icon" />
              <span>Đang tải hồ sơ bản án...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              <Gavel size={28} />
              <p>Không tìm thấy hồ sơ bản án phù hợp bộ lọc.</p>
            </div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="precedent-catalog-card">
                <div className="precedent-card-head">
                  <span className="precedent-id-badge">{item.decision_number}</span>
                  <span className="precedent-date-badge">{item.decision_date}</span>
                  <a href={item.source_url} target="_blank" rel="noreferrer" className="precedent-ext-link">
                    <span>toaan.gov.vn</span>
                    <ExternalLink size={12} />
                  </a>
                </div>
                <h4>{item.title}</h4>
                <p className="precedent-issue"><b>Vấn đề pháp lý:</b> {item.legal_issue}</p>
                <p className="precedent-holding"><b>Kết luận trọng tâm:</b> {item.holding}</p>
                <div className="precedent-refs-row">
                  {(item.references || []).map((r, i) => (
                    <span key={i} className="statute-chip">
                      {r.relation}: Điều {r.article_number} ({r.doc_code})
                    </span>
                  ))}
                </div>
                <div className="precedent-card-foot">
                  <span className="precedent-court">{item.court}</span>
                  <button
                    type="button"
                    className="workspace-btn secondary sm"
                    onClick={() => {
                      onAskAboutPrecedent(
                        `Phân tích bài học pháp lý và ranh giới xử phạt từ hồ sơ ${item.decision_number} (${item.title})`
                      );
                      onClose();
                    }}
                  >
                    <Send size={13} />
                    <span>Hỏi tiếp trong Chat</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 5. ArticleDetailDrawer: Ngăn kéo Toàn văn Điều luật & Lược đồ Hiệu lực
// ============================================================================
export function ArticleDetailDrawer({
  target,
  onClose,
  apiBaseUrl,
  apiHeaders,
  onNavigateArticle,
  onAskAboutArticle,
}) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const closeBtnRef = useRef(null);

  useModalFocusManagement(Boolean(target), closeBtnRef);

  useEffect(() => {
    if (!target) return undefined;
    let cancelled = false;
    const fetchDetail = async () => {
      setLoading(true);
      try {
        const res = await axios.get(`${apiBaseUrl}/legal/article-detail`, {
          params: {
            doc_code: target.docCode,
            article_number: target.articleNumber,
            as_of_date: target.asOf || undefined,
          },
          headers: apiHeaders,
        });
        if (!cancelled) setDetail(res.data);
      } catch {
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchDetail();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
    };
  }, [target, apiBaseUrl, apiHeaders, onClose]);

  if (!target) return null;

  return (
    <div
      className="article-drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Toàn văn điều luật và lược đồ hiệu lực"
      onClick={onClose}
    >
      <aside className="article-drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <span className="drawer-doc-code">{target.docCode}</span>
            <h3>
              Điều {target.articleNumber}
              {detail?.article_title ? `: ${detail.article_title}` : ''}
            </h3>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="workspace-close-btn"
            onClick={onClose}
            aria-label="Đóng toàn văn điều luật"
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="drawer-loading">
            <Loader2 size={20} className="spin-icon" />
            <span>Đang truy xuất toàn văn & lược đồ hiệu lực từ PGVector / Neo4j...</span>
          </div>
        ) : detail ? (
          <div className="drawer-body">
            <div className="drawer-doc-title">{detail.doc_title}</div>

            {/* 3 mốc thời gian hiệu lực */}
            <div className="drawer-dates-grid">
              <div className="date-badge-card">
                <Calendar size={14} />
                <div>
                  <span>Hiệu lực từ</span>
                  <b>{detail.effective_from || 'Chưa ghi nhận'}</b>
                </div>
              </div>
              <div className="date-badge-card">
                <Calendar size={14} />
                <div>
                  <span>Hết hiệu lực</span>
                  <b>{detail.effective_to || 'Đang có hiệu lực'}</b>
                </div>
              </div>
              <div className={`date-badge-card status-${String(detail.status_badge || 'unknown').toLowerCase()}`}>
                <Shield size={14} />
                <div>
                  <span>Tại {detail.evaluated_as_of}</span>
                  <b>{detail.status_label}</b>
                </div>
              </div>
            </div>

            {detail.transition && (
              <div className="drawer-transition-box">
                <div className="transition-head">
                  <Sparkles size={14} />
                  <span>Lược đồ Chuyển tiếp / Kế thừa quy định</span>
                </div>
                <p>{detail.transition.note}</p>
                {detail.transition.successor_doc && (
                  <button
                    type="button"
                    className="workspace-btn secondary sm"
                    onClick={() =>
                      onNavigateArticle(
                        detail.transition.successor_doc,
                        detail.transition.successor_article
                      )
                    }
                  >
                    <span>
                      Xem Điều {detail.transition.successor_article} ({detail.transition.successor_doc})
                    </span>
                    <ChevronRight size={14} />
                  </button>
                )}
                {detail.transition.predecessor_doc && (
                  <button
                    type="button"
                    className="workspace-btn secondary sm"
                    onClick={() =>
                      onNavigateArticle(
                        detail.transition.predecessor_doc,
                        detail.transition.predecessor_article
                      )
                    }
                  >
                    <span>
                      Xem Điều tiền thân: Điều {detail.transition.predecessor_article} (
                      {detail.transition.predecessor_doc})
                    </span>
                    <ChevronRight size={14} />
                  </button>
                )}
              </div>
            )}

            <div className="drawer-fulltext-box">
              <div className="fulltext-label">
                <BookOpen size={14} />
                <span>Nội dung Điều luật (Nguyên văn kho dữ liệu)</span>
                {detail.page != null && <span className="page-tag">Trang {detail.page}</span>}
              </div>
              <pre className="drawer-fulltext-pre">{detail.full_text}</pre>
            </div>

            {detail.related_documents?.length > 0 && (
              <div className="drawer-related-section">
                <div className="related-label">Văn bản sửa đổi / liên quan:</div>
                <div className="related-chips">
                  {detail.related_documents.map((d) => (
                    <span key={d} className="statute-chip">{d}</span>
                  ))}
                </div>
              </div>
            )}

            {detail.precedents?.length > 0 && (
              <div className="drawer-related-section">
                <div className="related-label">Án lệ / Bản án dẫn chiếu:</div>
                {detail.precedents.map((p) => (
                  <div key={p.id} className="mini-precedent-card">
                    <b>{p.decision_number}</b> — {p.title}
                    <p>{p.holding}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="drawer-footer-actions">
              {detail.source_url && (
                <a href={detail.source_url} target="_blank" rel="noreferrer" className="workspace-btn secondary">
                  <span>Mở nguồn gốc</span>
                  <ExternalLink size={14} />
                </a>
              )}
              <button
                type="button"
                className="workspace-btn primary"
                onClick={() => {
                  onAskAboutArticle(
                    `Phân tích chi tiết điều kiện áp dụng và mức xử phạt theo Điều ${target.articleNumber} ${target.docCode}`
                  );
                  onClose();
                }}
              >
                <Send size={14} />
                <span>Hỏi sâu về Điều này</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <BookOpen size={28} />
            <p>Không tải được chi tiết Điều luật.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
