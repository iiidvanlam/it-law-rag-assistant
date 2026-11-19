import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAuthRoute,
  getAuthPath,
  isValidEmail,
  evaluatePasswordStrength,
  validateLoginForm,
  validateRegisterForm,
  readStoredAuth,
  persistStoredAuth,
  clearStoredAuth,
  readRememberedEmail,
  persistRememberedEmail,
  sanitizeOtpDigits,
  applyOtpPaste,
  formatCountdown,
  validateOtpCode,
} from './authHelpers.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
  };
}

test('parseAuthRoute recognizes /auth/register, /auth/login, and workspace root', () => {
  assert.equal(parseAuthRoute('/auth/register'), 'register');
  assert.equal(parseAuthRoute('/auth/register/'), 'register');
  assert.equal(parseAuthRoute('/register'), 'register');
  assert.equal(parseAuthRoute('/auth/login'), 'login');
  assert.equal(parseAuthRoute('/AUTH/LOGIN/'), 'login');
  assert.equal(parseAuthRoute('/'), null);
  assert.equal(parseAuthRoute('/assistant'), null);

  assert.equal(getAuthPath('register'), '/auth/register');
  assert.equal(getAuthPath('login'), '/auth/login');
  assert.equal(getAuthPath(null), '/');
});

test('evaluatePasswordStrength classifies empty, weak, medium, and strong passwords', () => {
  assert.equal(evaluatePasswordStrength('').level, 'empty');
  assert.equal(evaluatePasswordStrength('12345').level, 'weak');
  assert.equal(evaluatePasswordStrength('abcdef').level, 'medium');
  assert.equal(evaluatePasswordStrength('LexIT@2026').level, 'strong');
});

test('validateLoginForm catches invalid email and missing password', () => {
  assert.equal(isValidEmail('luatsu@lexit.vn'), true);
  assert.equal(isValidEmail('invalid-email'), false);

  const empty = validateLoginForm({ email: '', password: '' });
  assert.equal(empty.valid, false);
  assert.ok(empty.errors.email);
  assert.ok(empty.errors.password);

  const ok = validateLoginForm({ email: 'lawyer@example.vn', password: 'LexIT@2026' });
  assert.equal(ok.valid, true);
});

test('validateRegisterForm enforces name, email, password, confirm match, and terms', () => {
  const mismatch = validateRegisterForm({
    fullName: 'Nguyen Van A',
    email: 'a@lexit.vn',
    password: 'Password1!',
    confirmPassword: 'Password2!',
    acceptTerms: true,
  });
  assert.equal(mismatch.valid, false);
  assert.ok(mismatch.errors.confirmPassword);

  const noTerms = validateRegisterForm({
    fullName: 'Nguyen Van A',
    email: 'a@lexit.vn',
    password: 'Password1!',
    confirmPassword: 'Password1!',
    acceptTerms: false,
  });
  assert.equal(noTerms.valid, false);
  assert.ok(noTerms.errors.acceptTerms);

  const valid = validateRegisterForm({
    fullName: 'Nguyen Van A',
    email: 'a@lexit.vn',
    password: 'Password1!',
    confirmPassword: 'Password1!',
    acceptTerms: true,
  });
  assert.equal(valid.valid, true);
});

test('persistStoredAuth respects rememberMe between localStorage and sessionStorage', () => {
  const local = createMemoryStorage();
  const session = createMemoryStorage();
  const user = { id: 'u1', email: 'lawyer@example.vn', full_name: 'Nguyen Van A' };

  persistStoredAuth({ user, token: 'tok-session', rememberMe: false }, local, session);
  assert.equal(local.getItem('lexit_user_token_v1'), null);
  assert.equal(session.getItem('lexit_user_token_v1'), 'tok-session');
  assert.deepEqual(readStoredAuth(local, session), { token: 'tok-session', user });

  persistStoredAuth({ user, token: 'tok-local', rememberMe: true }, local, session);
  assert.equal(local.getItem('lexit_user_token_v1'), 'tok-local');
  assert.equal(session.getItem('lexit_user_token_v1'), null);
  assert.deepEqual(readStoredAuth(local, session), { token: 'tok-local', user });

  persistRememberedEmail('lawyer@example.vn', true, local);
  assert.equal(readRememberedEmail(local), 'lawyer@example.vn');
  persistRememberedEmail('lawyer@example.vn', false, local);
  assert.equal(readRememberedEmail(local), '');

  clearStoredAuth(local, session);
  assert.deepEqual(readStoredAuth(local, session), { token: '', user: null });
});

test('OTP helpers sanitize digits, handle full/partial paste, format countdown, and validate length', () => {
  assert.equal(sanitizeOtpDigits(' 12-34a5678 '), '123456');
  assert.equal(applyOtpPaste('', 0, '654 321'), '654321');
  assert.equal(applyOtpPaste('12', 2, '3456'), '123456');
  assert.equal(applyOtpPaste('111111', 3, '987654'), '987654');
  assert.equal(formatCountdown(300), '05:00');
  assert.equal(formatCountdown(65), '01:05');
  assert.equal(formatCountdown(-4), '00:00');
  assert.ok(validateOtpCode('12345'));
  assert.equal(validateOtpCode('123456'), '');
});
