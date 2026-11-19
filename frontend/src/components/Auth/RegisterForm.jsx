import React, { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  AUTH_ROLE_OPTIONS,
  evaluatePasswordStrength,
  sanitizeOtpDigits,
  validateOtpCode,
  validateRegisterForm,
} from './authHelpers';
import { OtpCodeInput } from './OtpCodeInput';
import { OtpVerificationBanner } from './OtpVerificationBanner';

export function RegisterForm({
  loading,
  otpSession,
  onRequestOtp,
  onVerifyAndRegister,
  onCancelOtpStep,
  onSwitchToLogin,
  onGoHome,
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState(AUTH_ROLE_OPTIONS[0].value);
  const [organization, setOrganization] = useState('');
  const [showOrgFields, setShowOrgFields] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [touched, setTouched] = useState({});
  const [submittedStep1, setSubmittedStep1] = useState(false);

  const [otpCode, setOtpCode] = useState('');
  const [submittedStep2, setSubmittedStep2] = useState(false);

  const isOtpStep = Boolean(otpSession);
  const strength = useMemo(() => evaluatePasswordStrength(password), [password]);
  const validation = useMemo(
    () =>
      validateRegisterForm({
        fullName,
        email,
        password,
        confirmPassword,
        acceptTerms,
      }),
    [fullName, email, password, confirmPassword, acceptTerms]
  );

  const errFor = (field) => (submittedStep1 || touched[field] ? validation.errors[field] : '');
  const markTouched = (field) => setTouched((prev) => ({ ...prev, [field]: true }));
  const step1Ready = validation.valid && !loading;

  const otpError = submittedStep2 ? validateOtpCode(otpCode) : '';
  const step2Ready = !validateOtpCode(otpCode) && !loading;

  const handleStep1Submit = (e) => {
    e.preventDefault();
    setSubmittedStep1(true);
    if (!validation.valid || loading) return;
    setOtpCode('');
    setSubmittedStep2(false);
    onRequestOtp(email.trim());
  };

  const handleStep2Submit = (e) => {
    e.preventDefault();
    setSubmittedStep2(true);
    if (validateOtpCode(otpCode) || loading) return;
    onVerifyAndRegister({
      email: otpSession.email || email.trim(),
      otp_code: sanitizeOtpDigits(otpCode),
      full_name: fullName.trim(),
      password,
      role,
      organization: organization.trim(),
    });
  };

  return (
    <div className="lexit-otp-flow">
      <div className="lexit-auth-steps" aria-label="Các bước đăng ký tài khoản">
        <span className={`lexit-auth-step ${!isOtpStep ? 'active' : 'done'}`}>
          1. Thông tin tài khoản
        </span>
        <span className="lexit-auth-step-sep" aria-hidden="true">→</span>
        <span className={`lexit-auth-step ${isOtpStep ? 'active' : ''}`}>
          2. Xác thực OTP
        </span>
      </div>

      {isOtpStep ? (
        <form className="lexit-auth-form" onSubmit={handleStep2Submit} noValidate>
          <OtpVerificationBanner
            email={otpSession.email || email.trim()}
            otpSession={otpSession}
            loading={loading}
            onResend={() => onRequestOtp(otpSession.email || email.trim())}
            onBack={() => {
              setOtpCode('');
              setSubmittedStep2(false);
              onCancelOtpStep();
            }}
            backLabel="Sửa thông tin"
          />

          <div className="lexit-auth-field">
            <OtpCodeInput
              value={otpCode}
              onChange={setOtpCode}
              disabled={loading}
              hasError={Boolean(otpError)}
              describedBy={otpError ? 'lexit-reg-otp-err' : undefined}
            />
            {otpError && (
              <p id="lexit-reg-otp-err" className="lexit-auth-field-error" role="alert">
                {otpError}
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
            <span>{loading ? 'Đang xác thực & khởi tạo...' : 'Xác nhận OTP & Hoàn tất đăng ký'}</span>
          </button>

          <div className="lexit-auth-footer-row">
            <p className="lexit-auth-switch-text">
              Đã có tài khoản?{' '}
              <a
                href="/auth/login"
                className="lexit-auth-switch-link"
                onClick={(e) => {
                  e.preventDefault();
                  onSwitchToLogin();
                }}
              >
                Đăng nhập ngay
              </a>
            </p>
          </div>
        </form>
      ) : (
        <form className="lexit-auth-form" onSubmit={handleStep1Submit} noValidate>
          <div className="lexit-auth-field">
            <label htmlFor="lexit-reg-name" className="lexit-auth-label">
              Họ và tên
            </label>
            <input
              id="lexit-reg-name"
              name="name"
              type="text"
              autoComplete="name"
              className={`lexit-auth-input ${errFor('fullName') ? 'has-error' : ''}`}
              placeholder="Nhập họ và tên của bạn"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              onBlur={() => markTouched('fullName')}
              aria-invalid={Boolean(errFor('fullName'))}
              aria-describedby={errFor('fullName') ? 'lexit-reg-name-err' : undefined}
              disabled={loading}
              required
            />
            {errFor('fullName') && (
              <p id="lexit-reg-name-err" className="lexit-auth-field-error" role="alert">
                {errFor('fullName')}
              </p>
            )}
          </div>

          <div className="lexit-auth-field">
            <label htmlFor="lexit-reg-email" className="lexit-auth-label">
              Email nhận mã OTP
            </label>
            <input
              id="lexit-reg-email"
              name="email"
              type="email"
              autoComplete="email"
              className={`lexit-auth-input ${errFor('email') ? 'has-error' : ''}`}
              placeholder="Nhập email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => markTouched('email')}
              aria-invalid={Boolean(errFor('email'))}
              aria-describedby={errFor('email') ? 'lexit-reg-email-err' : undefined}
              disabled={loading}
              required
            />
            {errFor('email') && (
              <p id="lexit-reg-email-err" className="lexit-auth-field-error" role="alert">
                {errFor('email')}
              </p>
            )}
          </div>

          <div className="lexit-auth-field">
            <label htmlFor="lexit-reg-password" className="lexit-auth-label">
              Mật khẩu
            </label>
            <div className="lexit-auth-password-wrap">
              <input
                id="lexit-reg-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                className={`lexit-auth-input has-trailing ${errFor('password') ? 'has-error' : ''}`}
                placeholder="Tạo mật khẩu (tối thiểu 6 ký tự)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => markTouched('password')}
                aria-invalid={Boolean(errFor('password'))}
                aria-describedby="lexit-reg-password-hint"
                disabled={loading}
                required
              />
              <button
                type="button"
                className="lexit-auth-eye-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                aria-pressed={showPassword}
                disabled={loading}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {password && (
              <div id="lexit-reg-password-hint" className="lexit-auth-strength" aria-live="polite">
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
            {errFor('password') && (
              <p className="lexit-auth-field-error" role="alert">
                {errFor('password')}
              </p>
            )}
          </div>

          <div className="lexit-auth-field">
            <label htmlFor="lexit-reg-confirm" className="lexit-auth-label">
              Xác nhận mật khẩu
            </label>
            <div className="lexit-auth-password-wrap">
              <input
                id="lexit-reg-confirm"
                name="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                autoComplete="new-password"
                className={`lexit-auth-input has-trailing ${errFor('confirmPassword') ? 'has-error' : ''}`}
                placeholder="Nhập lại mật khẩu của bạn"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onBlur={() => markTouched('confirmPassword')}
                aria-invalid={Boolean(errFor('confirmPassword'))}
                aria-describedby={errFor('confirmPassword') ? 'lexit-reg-confirm-err' : undefined}
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
            {errFor('confirmPassword') && (
              <p id="lexit-reg-confirm-err" className="lexit-auth-field-error" role="alert">
                {errFor('confirmPassword')}
              </p>
            )}
          </div>

          <div className="lexit-auth-optional-block">
            <button
              type="button"
              className="lexit-auth-optional-toggle"
              onClick={() => setShowOrgFields((prev) => !prev)}
              aria-expanded={showOrgFields}
            >
              <span>Thông tin nghề nghiệp & đơn vị (tuỳ chọn)</span>
              {showOrgFields ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>

            {showOrgFields && (
              <div className="lexit-auth-grid-2">
                <div className="lexit-auth-field">
                  <label htmlFor="lexit-reg-role" className="lexit-auth-label">
                    Vai trò
                  </label>
                  <select
                    id="lexit-reg-role"
                    className="lexit-auth-input lexit-auth-select"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    disabled={loading}
                  >
                    {AUTH_ROLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="lexit-auth-field">
                  <label htmlFor="lexit-reg-org" className="lexit-auth-label">
                    Tổ chức / Công ty
                  </label>
                  <input
                    id="lexit-reg-org"
                    type="text"
                    autoComplete="organization"
                    className="lexit-auth-input"
                    placeholder="VD: Công ty Công nghệ ABC"
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="lexit-auth-terms-wrap">
            <label className="lexit-auth-checkbox">
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                disabled={loading}
              />
              <span className="lexit-auth-checkbox-box" aria-hidden="true">
                {acceptTerms && <Check size={12} strokeWidth={3} />}
              </span>
              <span className="lexit-auth-terms-text">
                Tôi đồng ý với Điều khoản sử dụng & Chính sách bảo vệ dữ liệu cá nhân (Nghị định 13/2023/NĐ-CP)
              </span>
            </label>
            {errFor('acceptTerms') && (
              <p className="lexit-auth-field-error" role="alert">
                {errFor('acceptTerms')}
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
            <span>{loading ? 'Đang gửi mã OTP...' : 'Tiếp tục & Nhận mã OTP'}</span>
          </button>

          <div className="lexit-auth-footer-row">
            <p className="lexit-auth-switch-text">
              Bạn đã có tài khoản?{' '}
              <a
                href="/auth/login"
                className="lexit-auth-switch-link"
                onClick={(e) => {
                  e.preventDefault();
                  onSwitchToLogin();
                }}
              >
                Đăng nhập ngay
              </a>
            </p>

            <button
              type="button"
              className="lexit-auth-utility-link"
              onClick={onGoHome}
              disabled={loading}
            >
              <span>Về trang chủ</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
