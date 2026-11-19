import React, { useEffect, useRef } from 'react';
import { OTP_LENGTH, applyOtpPaste, sanitizeOtpDigits } from './authHelpers';

export function OtpCodeInput({
  value = '',
  onChange,
  disabled = false,
  hasError = false,
  autoFocus = true,
  describedBy,
}) {
  const inputRefs = useRef([]);
  const digits = Array.from({ length: OTP_LENGTH }, (_, idx) => {
    const ch = sanitizeOtpDigits(value)[idx];
    return ch || '';
  });

  useEffect(() => {
    if (autoFocus && !disabled) {
      inputRefs.current[0]?.focus?.();
    }
  }, [autoFocus, disabled]);

  const focusSlot = (index) => {
    const clamped = Math.max(0, Math.min(OTP_LENGTH - 1, index));
    inputRefs.current[clamped]?.focus?.();
    inputRefs.current[clamped]?.select?.();
  };

  const handleSlotChange = (index, rawText) => {
    const cleaned = sanitizeOtpDigits(rawText);
    if (!cleaned) {
      const next = [...digits];
      next[index] = '';
      onChange(next.join(''));
      return;
    }
    if (cleaned.length > 1) {
      const merged = applyOtpPaste(digits.join(''), index, cleaned, OTP_LENGTH);
      onChange(merged);
      focusSlot(Math.min(OTP_LENGTH - 1, merged.length));
      return;
    }
    const next = [...digits];
    next[index] = cleaned;
    onChange(next.join(''));
    if (index < OTP_LENGTH - 1) {
      focusSlot(index + 1);
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace') {
      if (digits[index]) {
        const next = [...digits];
        next[index] = '';
        onChange(next.join(''));
      } else if (index > 0) {
        e.preventDefault();
        const next = [...digits];
        next[index - 1] = '';
        onChange(next.join(''));
        focusSlot(index - 1);
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      focusSlot(index - 1);
    } else if (e.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
      e.preventDefault();
      focusSlot(index + 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusSlot(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusSlot(OTP_LENGTH - 1);
    }
  };

  const handlePaste = (index, e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text') || '';
    const merged = applyOtpPaste(digits.join(''), index, text, OTP_LENGTH);
    onChange(merged);
    focusSlot(Math.min(OTP_LENGTH - 1, Math.max(0, merged.length - 1)));
  };

  return (
    <fieldset className="lexit-otp-fieldset" aria-describedby={describedBy}>
      <legend className="lexit-auth-label">Mã xác thực OTP (6 chữ số)</legend>
      <div className="lexit-otp-grid" role="group" aria-label="Nhập 6 chữ số mã OTP">
        {digits.map((digit, idx) => (
          <input
            key={idx}
            ref={(el) => {
              inputRefs.current[idx] = el;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={OTP_LENGTH}
            autoComplete={idx === 0 ? 'one-time-code' : 'off'}
            className={`lexit-otp-box ${digit ? 'filled' : ''} ${hasError ? 'has-error' : ''}`}
            value={digit}
            onChange={(e) => handleSlotChange(idx, e.target.value)}
            onKeyDown={(e) => handleKeyDown(idx, e)}
            onPaste={(e) => handlePaste(idx, e)}
            onFocus={(e) => e.target.select()}
            aria-label={`Chữ số OTP thứ ${idx + 1} trên ${OTP_LENGTH}`}
            aria-invalid={hasError}
            disabled={disabled}
          />
        ))}
      </div>
    </fieldset>
  );
}
