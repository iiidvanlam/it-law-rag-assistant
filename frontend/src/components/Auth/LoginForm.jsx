import React, { useMemo, useState } from 'react';
import { Check, Eye, EyeOff, Loader2, Sparkles } from 'lucide-react';
import { readRememberedEmail, validateLoginForm } from './authHelpers';

export function LoginForm({
  initialEmail = '',
  loading,
  onSubmit,
  onOpenForgotPassword,
  onSwitchToRegister,
  onGoHome,
}) {
  const [email, setEmail] = useState(() => initialEmail || readRememberedEmail());
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });
  const [submitted, setSubmitted] = useState(false);

  const validation = useMemo(
    () => validateLoginForm({ email, password }),
    [email, password]
  );

  const emailError = submitted || touched.email ? validation.errors.email : '';
  const passwordError = submitted || touched.password ? validation.errors.password : '';
  const isReady = validation.valid && !loading;

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (!validation.valid || loading) return;
    onSubmit({ email: email.trim(), password, rememberMe });
  };

  return (
    <form className="lexit-auth-form" onSubmit={handleSubmit} noValidate>
      <div className="lexit-auth-field">
        <label htmlFor="lexit-login-email" className="lexit-auth-label">
          Email
        </label>
        <input
          id="lexit-login-email"
          name="email"
          type="email"
          autoComplete="email"
          className={`lexit-auth-input ${emailError ? 'has-error' : ''}`}
          placeholder="Nhập email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
          aria-invalid={Boolean(emailError)}
          aria-describedby={emailError ? 'lexit-login-email-err' : undefined}
          disabled={loading}
          required
        />
        {emailError && (
          <p id="lexit-login-email-err" className="lexit-auth-field-error" role="alert">
            {emailError}
          </p>
        )}
      </div>

      <div className="lexit-auth-field">
        <label htmlFor="lexit-login-password" className="lexit-auth-label">
          Mật khẩu
        </label>
        <div className="lexit-auth-password-wrap">
          <input
            id="lexit-login-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            className={`lexit-auth-input has-trailing ${passwordError ? 'has-error' : ''}`}
            placeholder="Nhập mật khẩu của bạn"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
            aria-invalid={Boolean(passwordError)}
            aria-describedby={passwordError ? 'lexit-login-password-err' : undefined}
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
        {passwordError && (
          <p id="lexit-login-password-err" className="lexit-auth-field-error" role="alert">
            {passwordError}
          </p>
        )}
      </div>

      <div className="lexit-auth-meta-row">
        <label className="lexit-auth-checkbox">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            disabled={loading}
          />
          <span className="lexit-auth-checkbox-box" aria-hidden="true">
            {rememberMe && <Check size={12} strokeWidth={3} />}
          </span>
          <span>Ghi nhớ mật khẩu</span>
        </label>

        <button
          type="button"
          className="lexit-auth-inline-link"
          onClick={() => onOpenForgotPassword(email.trim())}
          disabled={loading}
        >
          Quên mật khẩu
        </button>
      </div>

      <button
        type="submit"
        className={`lexit-auth-submit-btn ${isReady ? 'ready' : ''}`}
        disabled={loading}
        aria-disabled={!isReady}
        aria-busy={loading}
      >
        {loading ? <Loader2 size={16} className="spin-icon" /> : <Sparkles size={15} />}
        <span>{loading ? 'Đang xác thực...' : 'Đăng nhập'}</span>
      </button>

      <div className="lexit-auth-footer-row">
        <p className="lexit-auth-switch-text">
          Bạn chưa có tài khoản?{' '}
          <a
            href="/auth/register"
            className="lexit-auth-switch-link"
            onClick={(e) => {
              e.preventDefault();
              onSwitchToRegister();
            }}
          >
            Đăng ký ngay
          </a>
        </p>

        <button
          type="button"
          className="lexit-auth-utility-link"
          onClick={onGoHome}
          disabled={loading}
        >
          Về trang chủ
        </button>
      </div>
    </form>
  );
}
