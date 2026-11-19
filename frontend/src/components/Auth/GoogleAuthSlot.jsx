import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';

export function GoogleBrandIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
      />
    </svg>
  );
}

export function GoogleAuthSlot({
  mode,
  apiBaseUrl,
  apiHeaders,
  loading,
  onStartLoading,
  onEndLoading,
  onAuthSuccess,
  onError,
}) {
  const envGoogleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
  const [googleClientId, setGoogleClientId] = useState(envGoogleClientId);
  const [configLoaded, setConfigLoaded] = useState(Boolean(envGoogleClientId));
  const [failedSlotKey, setFailedSlotKey] = useState('');
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const googleBtnRef = useRef(null);
  const slotKey = `${googleClientId}:${mode}`;
  const sdkFailed = Boolean(googleClientId && failedSlotKey === slotKey);

  useEffect(() => {
    if (envGoogleClientId) return undefined;
    let cancelled = false;
    axios
      .get(`${apiBaseUrl}/auth/google-config`, { headers: apiHeaders })
      .then((res) => {
        if (cancelled) return;
        setGoogleClientId(String(res.data?.client_id || '').trim());
        setConfigLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setConfigLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [envGoogleClientId, apiBaseUrl, apiHeaders]);

  const handleGoogleCredential = useCallback(
    async (credentialResponse) => {
      const cred = credentialResponse?.credential;
      if (!cred) return;
      onStartLoading();
      try {
        const res = await axios.post(
          `${apiBaseUrl}/auth/google`,
          { credential: cred },
          { headers: apiHeaders }
        );
        onAuthSuccess(res.data.user, res.data.access_token, true);
      } catch (err) {
        onError(
          err?.response?.data?.detail ||
            'Xác thực Google thất bại. Vui lòng kiểm tra cấu hình GOOGLE_CLIENT_ID.'
        );
      } finally {
        onEndLoading();
      }
    },
    [apiBaseUrl, apiHeaders, onStartLoading, onEndLoading, onAuthSuccess, onError]
  );

  useEffect(() => {
    if (!googleClientId) return undefined;
    let cancelled = false;
    let pollTimer = null;
    let attempts = 0;

    const tryRenderGoogleButton = () => {
      const gsi = window.google?.accounts?.id;
      const hostEl = googleBtnRef.current;
      if (!gsi || !hostEl || cancelled) return false;

      gsi.initialize({
        client_id: googleClientId,
        callback: handleGoogleCredential,
      });
      hostEl.innerHTML = '';
      gsi.renderButton(hostEl, {
        theme: 'filled_black',
        size: 'large',
        shape: 'rectangular',
        text: mode === 'register' ? 'signup_with' : 'signin_with',
        locale: 'vi',
        width: 260,
      });
      return true;
    };

    if (!tryRenderGoogleButton()) {
      pollTimer = window.setInterval(() => {
        attempts += 1;
        if (tryRenderGoogleButton()) {
          window.clearInterval(pollTimer);
          pollTimer = null;
        } else if (attempts >= 20) {
          window.clearInterval(pollTimer);
          pollTimer = null;
          if (!cancelled) setFailedSlotKey(slotKey);
        }
      }, 250);
    }

    return () => {
      cancelled = true;
      if (pollTimer !== null) window.clearInterval(pollTimer);
    };
  }, [googleClientId, mode, slotKey, handleGoogleCredential]);

  const actionLabel = mode === 'register' ? 'Đăng ký bằng Google' : 'Đăng nhập bằng Google';

  if (googleClientId && !sdkFailed) {
    return (
      <div className="lexit-auth-google-section">
        <div ref={googleBtnRef} className="lexit-auth-google-gsi" />
      </div>
    );
  }

  return (
    <div className="lexit-auth-google-section">
      <button
        type="button"
        className="lexit-auth-google-pill"
        onClick={() => setShowSetupGuide((prev) => !prev)}
        disabled={loading}
        aria-expanded={showSetupGuide}
      >
        <GoogleBrandIcon />
        <span>{configLoaded ? actionLabel : 'Đang kết nối Google...'}</span>
      </button>

      {sdkFailed && (
        <p className="lexit-auth-helper-note">
          Trình duyệt chưa tải được Google Sign-In SDK (kiểm tra kết nối mạng hoặc trình chặn quảng cáo).
        </p>
      )}

      {showSetupGuide && (
        <div className="lexit-auth-google-guide" role="region" aria-label="Hướng dẫn Google OAuth">
          <p className="lexit-auth-guide-title">
            {googleClientId
              ? 'Không thể tải nút Google OAuth trực tiếp:'
              : 'Chưa cấu hình GOOGLE_CLIENT_ID trên máy chủ:'}
          </p>
          <ol className="lexit-auth-guide-list">
            <li>
              Khai báo <code>GOOGLE_CLIENT_ID=...</code> trong <code>backend/.env</code> (Google Cloud
              OAuth Web Client).
            </li>
            <li>
              Thêm <code>http://localhost:5173</code> vào <em>Authorized JavaScript origins</em> rồi
              khởi động lại backend.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
