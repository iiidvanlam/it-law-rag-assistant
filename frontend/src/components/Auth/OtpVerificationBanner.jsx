import React, { useEffect, useState } from 'react';
import { Clock, MailCheck, RefreshCw } from 'lucide-react';
import { formatCountdown } from './authHelpers';

export function OtpVerificationBanner({
  email,
  otpSession,
  loading,
  onResend,
  onBack,
  backLabel = 'Đổi email',
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const expiresLeft = Math.max(
    0,
    Math.ceil(((otpSession?.expiresAtMs || 0) - nowMs) / 1000)
  );
  const resendLeft = Math.max(
    0,
    Math.ceil(((otpSession?.resendAtMs || 0) - nowMs) / 1000)
  );

  return (
    <div className="lexit-otp-meta-card">
      <div className="lexit-otp-target-row">
        <div className="lexit-otp-target-info">
          <MailCheck size={16} aria-hidden="true" />
          <div>
            <span>Mã OTP 6 chữ số đã gửi tới hộp thư</span>
            <strong>{email}</strong>
          </div>
        </div>
        {onBack && (
          <button
            type="button"
            className="lexit-auth-inline-link lexit-otp-change-btn"
            onClick={onBack}
            disabled={loading}
          >
            {backLabel}
          </button>
        )}
      </div>

      <div className="lexit-otp-timers-row">
        <span className={`lexit-otp-expiry ${expiresLeft === 0 ? 'expired' : ''}`}>
          <Clock size={13} aria-hidden="true" />
          {expiresLeft > 0
            ? `Hiệu lực còn ${formatCountdown(expiresLeft)}`
            : 'Mã OTP đã hết hạn — hãy gửi lại mã mới'}
        </span>

        <button
          type="button"
          className="lexit-otp-resend-btn"
          onClick={onResend}
          disabled={loading || resendLeft > 0}
        >
          <RefreshCw size={13} aria-hidden="true" />
          <span>
            {resendLeft > 0 ? `Gửi lại sau ${resendLeft}s` : 'Gửi lại mã OTP'}
          </span>
        </button>
      </div>
    </div>
  );
}
