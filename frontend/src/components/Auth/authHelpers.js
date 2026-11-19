const TOKEN_STORAGE_KEY = 'lexit_user_token_v1';
const PROFILE_STORAGE_KEY = 'lexit_user_profile_v1';
const REMEMBER_EMAIL_KEY = 'lexit_remembered_email_v1';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const OTP_LENGTH = 6;

export function sanitizeOtpDigits(raw = '', length = OTP_LENGTH) {
  return String(raw || '').replace(/\D+/g, '').slice(0, length);
}

export function applyOtpPaste(currentValue = '', startIndex = 0, pastedText = '', length = OTP_LENGTH) {
  const incoming = sanitizeOtpDigits(pastedText, length);
  if (!incoming) {
    return sanitizeOtpDigits(currentValue, length);
  }
  // If user pastes a full OTP code into any slot, fill from slot 0
  const baseStart = incoming.length >= length ? 0 : Math.max(0, Math.min(startIndex, length - 1));
  const slots = Array.from({ length }, (_, idx) => {
    const ch = String(currentValue || '')[idx];
    return ch && /\d/.test(ch) ? ch : '';
  });
  for (let i = 0; i < incoming.length && baseStart + i < length; i += 1) {
    slots[baseStart + i] = incoming[i];
  }
  return slots.join('');
}

export function formatCountdown(totalSeconds = 0) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function validateOtpCode(code = '', length = OTP_LENGTH) {
  const digits = sanitizeOtpDigits(code, length);
  if (digits.length < length) {
    return `Vui lòng nhập đủ ${length} chữ số mã OTP.`;
  }
  return '';
}

export const AUTH_ROLE_OPTIONS = Object.freeze([
  { value: 'Chuyên viên Pháp chế CNTT', label: 'Chuyên viên Pháp chế CNTT' },
  { value: 'Luật sư Tranh tụng', label: 'Luật sư / Văn phòng Luật' },
  { value: 'Quản trị An toàn thông tin (CISO/DPO)', label: 'CISO / DPO Doanh nghiệp' },
  { value: 'Doanh nghiệp / Cá nhân', label: 'Doanh nghiệp / Cá nhân' },
  { value: 'Sinh viên / Nghiên cứu Luật', label: 'Sinh viên / Nghiên cứu Luật' },
]);

export function parseAuthRoute(pathname = '') {
  const normalized = String(pathname || '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
  if (normalized === '/auth/register' || normalized === '/register') {
    return 'register';
  }
  if (normalized === '/auth/login' || normalized === '/login') {
    return 'login';
  }
  return null;
}

export function getAuthPath(mode) {
  if (mode === 'register') return '/auth/register';
  if (mode === 'login') return '/auth/login';
  return '/';
}

export function isValidEmail(email = '') {
  return EMAIL_PATTERN.test(String(email || '').trim());
}

export function evaluatePasswordStrength(password = '') {
  const raw = String(password || '');
  if (!raw) {
    return { level: 'empty', score: 0, label: '', hint: 'Tối thiểu 6 ký tự' };
  }
  if (raw.length < 6) {
    return {
      level: 'weak',
      score: 1,
      label: 'Yếu',
      hint: 'Cần ít nhất 6 ký tự',
    };
  }

  let complexity = 0;
  if (raw.length >= 8) complexity += 1;
  if (/[A-Z]/.test(raw) && /[a-z]/.test(raw)) complexity += 1;
  if (/\d/.test(raw)) complexity += 1;
  if (/[^A-Za-z0-9]/.test(raw)) complexity += 1;

  if (complexity >= 3) {
    return {
      level: 'strong',
      score: 3,
      label: 'Mạnh',
      hint: 'Mật khẩu đạt chuẩn an toàn',
    };
  }
  return {
    level: 'medium',
    score: 2,
    label: 'Trung bình',
    hint: 'Thêm chữ hoa, số hoặc ký tự đặc biệt để mạnh hơn',
  };
}

export function validateLoginForm({ email = '', password = '' }) {
  const errors = {};
  const trimmedEmail = String(email || '').trim();
  if (!trimmedEmail) {
    errors.email = 'Vui lòng nhập địa chỉ email.';
  } else if (!isValidEmail(trimmedEmail)) {
    errors.email = 'Địa chỉ email chưa đúng định dạng.';
  }
  if (!password) {
    errors.password = 'Vui lòng nhập mật khẩu.';
  }
  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function validateRegisterForm({
  fullName = '',
  email = '',
  password = '',
  confirmPassword = '',
  acceptTerms = false,
}) {
  const errors = {};
  const trimmedName = String(fullName || '').trim();
  const trimmedEmail = String(email || '').trim();

  if (trimmedName.length < 2) {
    errors.fullName = 'Họ và tên cần ít nhất 2 ký tự.';
  }
  if (!trimmedEmail) {
    errors.email = 'Vui lòng nhập địa chỉ email.';
  } else if (!isValidEmail(trimmedEmail)) {
    errors.email = 'Địa chỉ email chưa đúng định dạng.';
  }
  if (String(password || '').length < 6) {
    errors.password = 'Mật khẩu cần tối thiểu 6 ký tự.';
  }
  if (!confirmPassword) {
    errors.confirmPassword = 'Vui lòng nhập lại mật khẩu để xác nhận.';
  } else if (confirmPassword !== password) {
    errors.confirmPassword = 'Mật khẩu xác nhận không khớp.';
  }
  if (!acceptTerms) {
    errors.acceptTerms = 'Vui lòng đồng ý với điều khoản sử dụng và bảo mật dữ liệu.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function readStoredAuth(localStore = globalThis.localStorage, sessionStore = globalThis.sessionStorage) {
  const tryRead = (store) => {
    if (!store) return null;
    try {
      const token = store.getItem(TOKEN_STORAGE_KEY) || '';
      const rawUser = store.getItem(PROFILE_STORAGE_KEY);
      const user = rawUser ? JSON.parse(rawUser) : null;
      if (token || user) {
        return { token, user };
      }
    } catch {
      return null;
    }
    return null;
  };

  return tryRead(localStore) || tryRead(sessionStore) || { token: '', user: null };
}

export function persistStoredAuth(
  { user, token, rememberMe = true },
  localStore = globalThis.localStorage,
  sessionStore = globalThis.sessionStorage
) {
  const target = rememberMe ? localStore : sessionStore;
  const secondary = rememberMe ? sessionStore : localStore;

  try {
    if (secondary) {
      secondary.removeItem(TOKEN_STORAGE_KEY);
      secondary.removeItem(PROFILE_STORAGE_KEY);
    }
    if (target) {
      if (token) target.setItem(TOKEN_STORAGE_KEY, token);
      if (user) target.setItem(PROFILE_STORAGE_KEY, JSON.stringify(user));
    }
  } catch {
    // ignore storage quota errors
  }
}

export function clearStoredAuth(localStore = globalThis.localStorage, sessionStore = globalThis.sessionStorage) {
  [localStore, sessionStore].forEach((store) => {
    if (!store) return;
    try {
      store.removeItem(TOKEN_STORAGE_KEY);
      store.removeItem(PROFILE_STORAGE_KEY);
    } catch {
      // ignore
    }
  });
}

export function readRememberedEmail(localStore = globalThis.localStorage) {
  if (!localStore) return '';
  try {
    return localStore.getItem(REMEMBER_EMAIL_KEY) || '';
  } catch {
    return '';
  }
}

export function persistRememberedEmail(email, rememberMe, localStore = globalThis.localStorage) {
  if (!localStore) return;
  try {
    if (rememberMe && String(email || '').trim()) {
      localStore.setItem(REMEMBER_EMAIL_KEY, String(email).trim());
    } else {
      localStore.removeItem(REMEMBER_EMAIL_KEY);
    }
  } catch {
    // ignore
  }
}
