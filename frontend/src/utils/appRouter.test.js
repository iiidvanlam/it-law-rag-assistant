import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAppRoute,
  isProtectedShell,
  buildLoginRedirectPath,
  sanitizeNextPath,
} from './appRouter.js';

test('parseAppRoute resolves landing, auth, workspace, and profile shells accurately', () => {
  assert.deepEqual(parseAppRoute('/'), {
    shell: 'home',
    page: 'home',
    path: '/home',
    next: '',
  });
  assert.deepEqual(parseAppRoute('/home'), {
    shell: 'home',
    page: 'home',
    path: '/home',
    next: '',
  });
  assert.deepEqual(parseAppRoute('/auth/login', '?next=%2Fassistant%2Flegal-document'), {
    shell: 'auth',
    page: 'login',
    path: '/auth/login',
    next: '/assistant/legal-document',
  });
  assert.equal(parseAppRoute('/auth/register').page, 'register');
  assert.equal(parseAppRoute('/assistant/lexit/new').page, 'chat');
  assert.equal(parseAppRoute('/assistant/lexgpt/new').page, 'chat');
  assert.equal(parseAppRoute('/assistant/legal-document').page, 'legal-document');
  assert.equal(parseAppRoute('/assistant/judgement').page, 'judgement');
  assert.equal(parseAppRoute('/assistant/legal-update').page, 'legal-update');
  assert.equal(parseAppRoute('/profile/info').page, 'info');
  assert.equal(parseAppRoute('/profile/change-password').page, 'change-password');
  assert.equal(parseAppRoute('/profile/receive-newsletters').page, 'receive-newsletters');
  assert.equal(parseAppRoute('/profile/sessions').page, 'sessions');
});

test('auth guard helpers protect workspace/profile shells and sanitize next redirect', () => {
  assert.equal(isProtectedShell('home'), false);
  assert.equal(isProtectedShell('auth'), false);
  assert.equal(isProtectedShell('workspace'), true);
  assert.equal(isProtectedShell('profile'), true);

  assert.equal(sanitizeNextPath('/assistant/judgement'), '/assistant/judgement');
  assert.equal(sanitizeNextPath('https://evil.example'), '/assistant/lexit/new');
  assert.equal(sanitizeNextPath('//evil.example'), '/assistant/lexit/new');
  assert.equal(sanitizeNextPath('/auth/login'), '/assistant/lexit/new');
  assert.equal(
    buildLoginRedirectPath('/assistant/legal-document'),
    '/auth/login?next=%2Fassistant%2Flegal-document'
  );
});
