import React, { useMemo, useState } from 'react';
import { ArrowLeft, Eye, EyeOff, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import {
  evaluatePasswordStrength,
  isValidEmail,
  sanitizeOtpDigits,
  validateOtpCode,
} from './authHelpers';
import { OtpCodeInput } from './OtpCodeInput';
import { OtpVerificationBanner } from './OtpVerificationBanner';

export function ForgotPasswordOtpForm({
  initialEmail = '',
  otpSession,
  loading,
  onRequestOtp,
  onSubmitReset,
  onCancelOtpStep,
  onBackToLogin,
}) {
  const [email, setEmail] = useState(initialEmail);
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submittedStep1, setSubmittedStep1] = useState(false);
  const [submittedStep2, setSubmittedStep2] = useState(false);

  const isOtpStep = Boolean(otpSession);
  const trimmedEmail = email.trim();
  const emailError =
    submittedStep1 && !isValidEmail(trimmedEmail)
      ? 'Vui lòng nhập địa chỉ email đã đăng ký hợp lệ.'
      : '';

  const strength = useMemo(() => evaluatePasswordStrength(newPassword), [newPassword]);
  const otpError = submittedStep2 ? validateOtpCode(otpCode) : '';
  const passwordError =
    submittedStep2 && newPassword.length < 6 ? 'Mật khẩu mới cần tối thiểu 6 ký tự.' : '';
  const confirmError =
    submittedStep2 && confirmPassword !== newPassword ? 'Mật khẩu xác nhận không khớp.' : '';

  const step1Ready = isValidEmail(trimmedEmail) && !loading;
  const step2Ready =
    !validateOtpCode(otpCode) &&
    newPassword.length >= 6 &&
    confirmPassword === newPassword &&
    !loading;

  const handleStep1Submit = (e) => {
    e.preventDefault();
    setSubmittedStep1(true);
    if (!isValidEmail(trimmedEmail) || loading) return;
    setOtpCode('');
    setSubmittedStep2(false);
    onRequestOtp(trimmedEmail);
  };

  const handleStep2Submit = (e) => {
    e.preventDefault();
    setSubmittedStep2(true);
    if (!step2Ready) return;
    onSubmitReset({
      email: otpSession.email || trimmedEmail,
      otp_code: sanitizeOtpDigits(otpCode),
      new_password: newPassword,
    });
  };

  return (
    <div className="lexit-otp-flow">
      <div className="lexit-auth-steps" aria-label="Tiến trình đặt lại mật khẩu">
        <span className={`lexit-auth-step ${!isOtpStep ? 'active' : 'done'}`}>
          1. Nhập email
        </span>
        <span className="lexit-auth-step-sep" aria-hidden="true">→</span>
        <span className={`lexit-auth-step ${isOtpStep ? 'active' : ''}`}>
          2. OTP & Mật khẩu mới
        </span>
      </div>

      {!isOtpStep ? (
        <form className="lexit-auth-form" onSubmit={handleStep1Submit} noValidate>
          <p className="lexit-auth-divider" style={{ marginBottom: '0.25rem' }}>
            Nhập email tài khoản để nhận mã xác thực OTP 6 chữ số:
          </p>

          <div className="lexit-auth-field">
            <label htmlFor="lexit-reset-email" className="lexit-auth-label">
              Email tài khoản
            </label>
            <input
              id="lexit-reset-email"
              name="email"
              type="email"
              autoComplete="email"
              className={`lexit-auth-input ${emailError ? 'has-error' : ''}`}
              placeholder="Nhập email đã đăng ký"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? 'lexit-reset-email-err' : undefined}
              disabled={loading}
              required
            />
            {emailError && (
              <p id="lexit-reset-email-err" className="lexit-auth-field-error" role="alert">
                {emailError}
              </p>
            )}
          </div>

          <button
            type="submit"
            className={`lexit-auth-submit-btn ${step1Ready ? 'ready' : ''}`}
            disabled={loading}
            aria-disabled={!step1Ready}
            aria-busy={loading}
          >
            {loading ? <Loader2 size={16} className="spin-icon" /> : <Sparkles size={15} />}
            <span>{loading ? 'Đang gửi mã OTP...' : 'Gửi mã OTP đặt lại mật khẩu'}</span>
          </button>
        </form>
      ) : (
        <form className="lexit-auth-form" onSubmit={handleStep2Submit} noValidate>
          <OtpVerificationBanner
            email={otpSession.email || trimmedEmail}
            otpSession={otpSession}
            loading={loading}
            onResend={() => onRequestOtp(otpSession.email || trimmedEmail)}
            onBack={() => {
              setOtpCode('');
              setSubmittedStep2(false);
              onCancelOtpStep();
            }}
            backLabel="Đổi email"
          />

          <div className="lexit-auth-field">
            <OtpCodeInput
              value={otpCode}
              onChange={setOtpCode}
              disabled={loading}
              hasError={Boolean(otpError)}
              describedBy={otpError ? 'lexit-reset-otp-err' : undefined}
            />
            {otpError && (
              <p id="lexit-reset-otp-err" className="lexit-auth-field-error" role="alert">
                {otpError}
              </p>
            )}
          </div>

          <div className="lexit-auth-field">
            <label htmlFor="lexit-reset-new-password" className="lexit-auth-label">
              Mật khẩu mới
            </label>
            <div className="lexit-auth-password-wrap">
              <input
                id="lexit-reset-new-password"
                type={showNewPassword ? 'text' : 'password'}
                autoComplete="new-password"
                className={`lexit-auth-input has-trailing ${passwordError ? 'has-error' : ''}`}
                placeholder="Nhập mật khẩu mới (tối thiểu 6 ký tự)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                aria-invalid={Boolean(passwordError)}
                disabled={loading}
                required
              />
              <button
                type="button"
                className="lexit-auth-eye-btn"
                onClick={() => setShowNewPassword((prev) => !prev)}
                aria-label={showNewPassword ? 'Ẩn mật khẩu mới' : 'Hiện mật khẩu mới'}
                aria-pressed={showNewPassword}
                disabled={loading}
              >
                {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {newPassword && (
              <div className="lexit-auth-strength" aria-live="polite">
                <div className="lexit-auth-strength-bars" aria-hidden="true">
                  {[1, 2, 3].map((step) => (
                    <span
                      key={step}
                      className={`lexit-auth-strength-bar ${
                        strength.score >= step ? `level-${strength.level}` : ''
                      }`}
                    />
                  ))}
                </div>
                <span className={`lexit-auth-strength-text level-${strength.level}`}>
                  Độ mạnh: <strong>{strength.label}</strong> — {strength.hint}
                </span>
              </div>
            )}
            {passwordError && (
              <p className="lexit-auth-field-error" role="alert">
                {passwordError}
              </p>
            )}
          </div>

          <div className="lexit-auth-field">
            <label htmlFor="lexit-reset-confirm" className="lexit-auth-label">
              Xác nhận mật khẩu mới
            </label>
            <div className="lexit-auth-password-wrap">
              <input
                id="lexit-reset-confirm"
                type={showConfirmPassword ? 'text' : 'password'}
                autoComplete="new-password"
                className={`lexit-auth-input has-trailing ${confirmError ? 'has-error' : ''}`}
                placeholder="Nhập lại mật khẩu mới"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                aria-invalid={Boolean(confirmError)}
                disabled={loading}
                required
              />
              <button
                type="button"
                className="lexit-auth-eye-btn"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                aria-label={showConfirmPassword ? 'Ẩn mật khẩu xác nhận' : 'Hiện mật khẩu xác nhận'}
                aria-pressed={showConfirmPassword}
                disabled={loading}
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {confirmError && (
              <p className="lexit-auth-field-error" role="alert">
                {confirmError}
              </p>
            )}
          </div>

          <button
            type="submit"
            className={`lexit-auth-submit-btn ${step2Ready ? 'ready' : ''}`}
            disabled={loading}
            aria-disabled={!step2Ready}
            aria-busy={loading}
          >
            {loading ? <Loader2 size={16} className="spin-icon" /> : <ShieldCheck size={16} />}
            <span>{loading ? 'Đang cập nhật mật khẩu...' : 'Xác nhận OTP & Đặt lại mật khẩu'}</span>
          </button>
        </form>
      )}

      <div className="lexit-auth-footer-row">
        <button
          type="button"
          className="lexit-auth-utility-link"
          onClick={onBackToLogin}
          disabled={loading}
        >
          <ArrowLeft size={14} aria-hidden="true" />
          <span>Quay lại Đăng nhập</span>
        </button>
      </div>
    </div>
  );
}
