import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, ArrowRight, CheckCircle2, LogOut, Sparkles, X } from 'lucide-react';
import { UserAvatar } from '../../LegalWorkspaceModals';
import { AuthBrandHeader, AuthWireframeBackdrop } from './AuthWireframeBackdrop';
import { GoogleAuthSlot } from './GoogleAuthSlot';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import { ForgotPasswordOtpForm } from './ForgotPasswordOtpForm';
import { persistRememberedEmail } from './authHelpers';
import './AuthPage.css';

export function AuthPage({
  mode = 'login',
  onChangeMode,
  onClose,
  onAuthComplete,
  apiBaseUrl,
  apiHeaders,
  currentUser,
  onAuthSuccess,
  onLogout,
}) {
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState({ mode: '', type: '', text: '' });
  const [otpSession, setOtpSession] = useState(null);
  const [forgotPasswordState, setForgotPasswordState] = useState({ active: false, email: '' });
  const [loginPrefillEmail, setLoginPrefillEmail] = useState('');
  const headingRef = useRef(null);

  const isRegister = mode === 'register';
  const isForgotPassword = !isRegister && forgotPasswordState.active;
  const activeRegisterOtp = isRegister && otpSession?.purpose === 'register' ? otpSession : null;
  const activeResetOtp =
    isForgotPassword && otpSession?.purpose === 'reset_password' ? otpSession : null;
  const hasRegisterOtp = Boolean(activeRegisterOtp);
  const hasResetOtp = Boolean(activeResetOtp);

  const errorMsg = feedback.mode === mode && feedback.type === 'error' ? feedback.text : '';
  const successMsg = feedback.mode === mode && feedback.type === 'success' ? feedback.text : '';

  const finishAuthRedirect = useCallback(() => {
    if (onAuthComplete) {
      onAuthComplete();
    } else {
      onClose();
    }
  }, [onAuthComplete, onClose]);

  const setErrorMsg = useCallback(
    (text) => setFeedback(text ? { mode, type: 'error', text } : { mode: '', type: '', text: '' }),
    [mode]
  );
  const setSuccessMsg = useCallback(
    (text) => setFeedback(text ? { mode, type: 'success', text } : { mode: '', type: '', text: '' }),
    [mode]
  );

  useEffect(() => {
    const previousTitle = document.title;
    if (isForgotPassword) {
      document.title = 'Đặt lại mật khẩu OTP — LexIT';
    } else {
      document.title = isRegister ? 'Đăng ký tài khoản — LexIT' : 'Đăng nhập — LexIT';
    }
    return () => {
      document.title = previousTitle;
    };
  }, [isRegister, isForgotPassword]);

  useEffect(() => {
    headingRef.current?.focus?.();
  }, [mode, isForgotPassword, hasRegisterOtp, hasResetOtp]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [loading, onClose]);

  const handleSwitchMode = useCallback(
    (nextMode) => {
      setFeedback({ mode: '', type: '', text: '' });
      setOtpSession(null);
      setForgotPasswordState({ active: false, email: '' });
      onChangeMode(nextMode);
    },
    [onChangeMode]
  );

  const handleStartLoading = useCallback(() => {
    setLoading(true);
    setFeedback({ mode: '', type: '', text: '' });
  }, []);

  const handleEndLoading = useCallback(() => {
    setLoading(false);
  }, []);

  const handleGoogleSuccess = useCallback(
    (user, token, rememberMe = true) => {
      onAuthSuccess(user, token, rememberMe);
      finishAuthRedirect();
    },
    [onAuthSuccess, finishAuthRedirect]
  );

  const handleRequestOtp = async (email, purpose) => {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await axios.post(
        `${apiBaseUrl}/auth/otp/request`,
        { email, purpose },
        { headers: apiHeaders }
      );
      const data = res.data || {};
      const now = Date.now();
      setOtpSession({
        purpose,
        email: data.email || email,
        expiresAtMs: now + (Number(data.expires_in_seconds) || 300) * 1000,
        resendAtMs: now + (Number(data.resend_after_seconds) || 60) * 1000,
        deliveryChannel: data.delivery_channel || 'smtp',
      });
      if (data.message) {
        setSuccessMsg(data.message);
      }
    } catch (err) {
      setErrorMsg(
        err?.response?.data?.detail ||
          'Không thể gửi mã OTP qua email. Vui lòng kiểm tra cấu hình SMTP hoặc thử lại sau.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndRegister = async (payload) => {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await axios.post(`${apiBaseUrl}/auth/register/verify-otp`, payload, {
        headers: apiHeaders,
      });
      persistRememberedEmail(payload.email, true);
      setOtpSession(null);
      onAuthSuccess(res.data.user, res.data.access_token, true);
      setSuccessMsg('Xác thực OTP & tạo tài khoản thành công!');
      finishAuthRedirect();
    } catch (err) {
      setErrorMsg(
        err?.response?.data?.detail || 'Xác thực OTP thất bại. Vui lòng kiểm tra lại mã 6 chữ số.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitPasswordReset = async (payload) => {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await axios.post(`${apiBaseUrl}/auth/password/reset`, payload, {
        headers: apiHeaders,
      });
      setOtpSession(null);
      setForgotPasswordState({ active: false, email: '' });
      setLoginPrefillEmail(payload.email);
      setFeedback({
        mode: 'login',
        type: 'success',
        text: res.data?.message || 'Đặt lại mật khẩu thành công. Bạn có thể đăng nhập ngay.',
      });
    } catch (err) {
      setErrorMsg(
        err?.response?.data?.detail || 'Không thể đặt lại mật khẩu. Vui lòng kiểm tra mã OTP.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSubmit = async ({ email, password, rememberMe }) => {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await axios.post(
        `${apiBaseUrl}/auth/login`,
        { email, password },
        { headers: apiHeaders }
      );
      persistRememberedEmail(email, rememberMe);
      onAuthSuccess(res.data.user, res.data.access_token, rememberMe);
      setSuccessMsg('Đăng nhập thành công!');
      finishAuthRedirect();
    } catch (err) {
      setErrorMsg(
        err?.response?.data?.detail || 'Email hoặc mật khẩu chưa chính xác. Vui lòng thử lại.'
      );
    } finally {
      setLoading(false);
    }
  };

  const showGoogleSection = !currentUser && !isForgotPassword && !activeRegisterOtp;
  const pageTitle = currentUser
    ? 'Bạn đã đăng nhập'
    : isForgotPassword
      ? 'Đặt lại mật khẩu'
      : activeRegisterOtp
        ? 'Xác thực OTP'
        : isRegister
          ? 'Đăng ký'
          : 'Đăng nhập';

  return (
    <div className="lexit-auth-shell">
      <AuthWireframeBackdrop />

      <div className="lexit-auth-container">
        <AuthBrandHeader onGoHome={onClose} />

        <main className="lexit-auth-card" aria-labelledby="lexit-auth-title">
          <div className="lexit-auth-card-header">
            <h1 id="lexit-auth-title" ref={headingRef} tabIndex={-1} className="lexit-auth-title">
              {pageTitle}
            </h1>
            <button
              type="button"
              className="lexit-auth-close-btn"
              onClick={onClose}
              aria-label="Đóng và quay lại trang chủ"
              disabled={loading}
            >
              <X size={20} />
            </button>
          </div>

          {errorMsg && (
            <div className="lexit-auth-alert error" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="lexit-auth-alert success" role="status">
              <CheckCircle2 size={16} aria-hidden="true" />
              <span>{successMsg}</span>
            </div>
          )}

          {currentUser ? (
            <div className="lexit-auth-signed-in">
              <div className="lexit-auth-user-summary">
                <UserAvatar user={currentUser} className="lexit-auth-avatar-lg" />
                <div className="lexit-auth-user-details">
                  <strong>{currentUser.full_name}</strong>
                  <span>{currentUser.email}</span>
                  <small>{currentUser.role || 'Thành viên LexIT'}</small>
                </div>
              </div>

              <button
                type="button"
                className="lexit-auth-submit-btn ready"
                onClick={finishAuthRedirect}
              >
                <Sparkles size={15} aria-hidden="true" />
                <span>Vào không gian tư vấn LexIT</span>
                <ArrowRight size={15} aria-hidden="true" />
              </button>

              <button type="button" className="lexit-auth-secondary-btn" onClick={onLogout}>
                <LogOut size={15} aria-hidden="true" />
                <span>Đăng xuất để đổi tài khoản</span>
              </button>
            </div>
          ) : (
            <>
              {showGoogleSection && (
                <>
                  <GoogleAuthSlot
                    mode={mode}
                    apiBaseUrl={apiBaseUrl}
                    apiHeaders={apiHeaders}
                    loading={loading}
                    onStartLoading={handleStartLoading}
                    onEndLoading={handleEndLoading}
                    onAuthSuccess={handleGoogleSuccess}
                    onError={setErrorMsg}
                  />
                  <p className="lexit-auth-divider">hoặc bằng cách nhập các thông tin sau:</p>
                </>
              )}

              {isRegister ? (
                <RegisterForm
                  loading={loading}
                  otpSession={activeRegisterOtp}
                  onRequestOtp={(email) => handleRequestOtp(email, 'register')}
                  onVerifyAndRegister={handleVerifyAndRegister}
                  onCancelOtpStep={() => {
                    setOtpSession(null);
                    setErrorMsg('');
                    setSuccessMsg('');
                  }}
                  onSwitchToLogin={() => handleSwitchMode('login')}
                  onGoHome={onClose}
                />
              ) : isForgotPassword ? (
                <ForgotPasswordOtpForm
                  initialEmail={forgotPasswordState.email}
                  otpSession={activeResetOtp}
                  loading={loading}
                  onRequestOtp={(email) => handleRequestOtp(email, 'reset_password')}
                  onSubmitReset={handleSubmitPasswordReset}
                  onCancelOtpStep={() => {
                    setOtpSession(null);
                    setErrorMsg('');
                    setSuccessMsg('');
                  }}
                  onBackToLogin={() => {
                    setOtpSession(null);
                    setErrorMsg('');
                    setSuccessMsg('');
                    setForgotPasswordState({ active: false, email: '' });
                  }}
                />
              ) : (
                <LoginForm
                  key={loginPrefillEmail || 'default-login'}
                  initialEmail={loginPrefillEmail}
                  loading={loading}
                  onSubmit={handleLoginSubmit}
                  onOpenForgotPassword={(prefill) => {
                    setErrorMsg('');
                    setSuccessMsg('');
                    setOtpSession(null);
                    setForgotPasswordState({ active: true, email: prefill });
                  }}
                  onSwitchToRegister={() => handleSwitchMode('register')}
                  onGoHome={onClose}
                />
              )}
            </>
          )}
        </main>

        <footer className="lexit-auth-page-footer">
          <span>LexIT Neuro-Symbolic Legal AI • Xác thực Email OTP & Google OAuth 2.0</span>
        </footer>
      </div>
    </div>
  );
}
