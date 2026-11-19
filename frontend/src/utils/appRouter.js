export function parseAppRoute(pathname = '/', search = '') {
  const cleanPath = String(pathname || '/')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '') || '/';

  const params = new URLSearchParams(search || '');
  const next = params.get('next') || '';

  if (cleanPath === '/' || cleanPath === '/home') {
    return { shell: 'home', page: 'home', path: '/home', next: '' };
  }
  if (cleanPath === '/auth/register' || cleanPath === '/register') {
    return { shell: 'auth', page: 'register', path: '/auth/register', next };
  }
  if (cleanPath === '/auth/login' || cleanPath === '/login') {
    return { shell: 'auth', page: 'login', path: '/auth/login', next };
  }
  if (
    cleanPath === '/assistant' ||
    cleanPath === '/assistant/lexit' ||
    cleanPath === '/assistant/lexit/new' ||
    cleanPath === '/assistant/lexgpt' ||
    cleanPath === '/assistant/lexgpt/new'
  ) {
    return { shell: 'workspace', page: 'chat', path: '/assistant/lexit/new', next: '' };
  }
  if (cleanPath === '/assistant/legal-document') {
    return { shell: 'workspace', page: 'legal-document', path: '/assistant/legal-document', next: '' };
  }
  if (cleanPath === '/assistant/judgement' || cleanPath === '/assistant/precedents') {
    return { shell: 'workspace', page: 'judgement', path: '/assistant/judgement', next: '' };
  }
  if (cleanPath === '/assistant/legal-update') {
    return { shell: 'workspace', page: 'legal-update', path: '/assistant/legal-update', next: '' };
  }
  if (cleanPath === '/profile' || cleanPath === '/profile/info') {
    return { shell: 'profile', page: 'info', path: '/profile/info', next: '' };
  }
  if (cleanPath === '/profile/change-password') {
    return { shell: 'profile', page: 'change-password', path: '/profile/change-password', next: '' };
  }
  if (cleanPath === '/profile/receive-newsletters') {
    return { shell: 'profile', page: 'receive-newsletters', path: '/profile/receive-newsletters', next: '' };
  }
  if (cleanPath === '/profile/sessions') {
    return { shell: 'profile', page: 'sessions', path: '/profile/sessions', next: '' };
  }
  return { shell: 'home', page: 'home', path: '/home', next: '' };
}

export function isProtectedShell(shell) {
  return shell === 'workspace' || shell === 'profile';
}

export function buildLoginRedirectPath(targetPath = '/assistant/lexit/new') {
  const safeTarget = sanitizeNextPath(targetPath);
  return `/auth/login?next=${encodeURIComponent(safeTarget)}`;
}

export function sanitizeNextPath(nextPath = '') {
  const raw = String(nextPath || '').trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/auth/')) {
    return '/assistant/lexit/new';
  }
  return raw;
}
