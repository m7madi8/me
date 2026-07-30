import React, { useEffect, useState } from "react";
import {
  loginWithGoogle,
  completeGoogleRedirect,
  isFirebaseConfigured,
  authErrorMessage,
} from "./auth.js";
import logoMe from "./img/logo-me.webp";

/**
 * @param {{ onClose?: () => void, compact?: boolean, bootError?: string }} props
 */
export default function LoginScreen({ onClose, compact = false, bootError = "" } = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(bootError || "");

  useEffect(() => {
    if (bootError) setError(bootError);
  }, [bootError]);

  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    let alive = true;
    (async () => {
      const res = await completeGoogleRedirect();
      if (!alive) return;
      if (res.error) setError(authErrorMessage(res.error));
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!isFirebaseConfigured()) {
    return (
      <div className={compact ? "login-modal-card" : "login-screen"} dir="rtl">
        <div className="login-card gpt">
          <img src={logoMe} alt="Mohammad" className="login-logo" />
          <p className="login-sub">إعدادات Firebase غير موجودة في هذا البناء.</p>
          {onClose && (
            <button type="button" className="btn-ghost" onClick={onClose} style={{ marginTop: 12 }}>
              إغلاق
            </button>
          )}
        </div>
      </div>
    );
  }

  async function handleGoogle() {
    setError("");
    setBusy(true);
    try {
      await loginWithGoogle();
      // Redirect flow leaves the page; popup success is handled by auth watcher.
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  }

  const host = typeof window !== "undefined" ? window.location.hostname : "";

  const card = (
    <div className="login-card gpt fade-in">
      {onClose && (
        <button type="button" className="login-close" onClick={onClose} aria-label="إغلاق">
          ×
        </button>
      )}
      <img src={logoMe} alt="Mohammad" className="login-logo" />
      <p className="login-one-line">تسجيل الدخول بـ Google</p>
      <p className="login-sub" style={{ marginTop: -8 }}>
        يُحفظ دخولك دائمًا وتُزامَن بياناتك بين أجهزتك.
      </p>

      {error && <div className="ai-error" style={{ marginBottom: 14, textAlign: "right" }}>{error}</div>}

      <button type="button" className="btn-google" onClick={handleGoogle} disabled={busy}>
        <GoogleIcon />
        {busy ? "جارٍ التحويل إلى Google…" : "تسجيل الدخول مع Google"}
      </button>

      <p className="login-persist-note">
        إذا فشل الدخول: أضف النطاق <strong>{host}</strong> في Firebase → Authorized domains
      </p>
    </div>
  );

  if (compact) {
    return (
      <div className="login-modal-backdrop" onClick={onClose} dir="rtl">
        <div onClick={(e) => e.stopPropagation()}>{card}</div>
      </div>
    );
  }

  return (
    <div className="login-screen" dir="rtl">
      {card}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.1 4 9.2 8.5 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.3 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.1 39.5 16 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.1-3.5 5.5-6.5 6.9l.1.1 6.2 5.2C36.9 41.4 44 36 44 24c0-1.3-.1-2.5-.4-3.5z" />
    </svg>
  );
}
