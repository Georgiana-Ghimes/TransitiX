/**
 * "Autentifică-te cu Google", through Google Identity Services.
 *
 * The visible button is ours, so it matches the rest of the auth screens and says exactly what we
 * want. The click lands on Google's own button, rendered on top of it and made transparent: that
 * is what hands back a signed ID token, which the server verifies. Nothing here is trusted, the
 * credential is only passed on.
 *
 * Without a client id the button is hidden in a production build (a button that can only fail is
 * worse than none). In development it stays visible and says what is missing.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import GoogleIcon from '@/components/GoogleIcon';
import { cn } from '@/lib/utils';

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
let scriptPromise = null;

function loadScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('Serviciul Google nu a putut fi încărcat.'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export const GOOGLE_LABELS = {
  signin: 'Autentifică-te cu Google',
  signup: 'Înregistrează-te cu Google',
};

function FaceButton({ label, busy, disabled, className, onClick }) {
  return (
    <button
      type="button"
      tabIndex={onClick ? 0 : -1}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-full h-12 rounded-md border border-input bg-background text-sm font-medium text-foreground',
        'inline-flex items-center justify-center gap-3 transition-colors',
        'group-hover:bg-muted/60 disabled:opacity-50',
        className,
      )}
    >
      {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <GoogleIcon className="w-5 h-5" />}
      {label}
    </button>
  );
}

export default function GoogleSignInButton({ clientId, onCredential, mode = 'signin', disabled = false }) {
  const wrapper = useRef(null);
  const overlay = useRef(null);
  const callback = useRef(onCredential);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hint, setHint] = useState('');
  callback.current = onCredential;
  const label = GOOGLE_LABELS[mode] || GOOGLE_LABELS.signin;

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !overlay.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => callback.current?.(response.credential),
          ux_mode: 'popup',
          context: mode === 'signup' ? 'signup' : 'signin',
        });
        overlay.current.innerHTML = '';
        // Google caps the rendered width at 400px; the face button is never wider on these screens.
        const width = Math.min(Math.max(wrapper.current?.offsetWidth || 320, 200), 400);
        window.google.accounts.id.renderButton(overlay.current, {
          type: 'standard',
          size: 'large',
          text: mode === 'signup' ? 'signup_with' : 'signin_with',
          locale: 'ro',
          width,
        });
        setReady(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [clientId, mode]);

  if (!clientId) {
    if (!import.meta.env.DEV) return null;
    return (
      <div className="space-y-1.5">
        <FaceButton
          label={label}
          onClick={() => setHint(
            'Google nu e configurat pe server: setează GOOGLE_CLIENT_ID în server/.env și repornește API-ul. '
            + '(Butonul e vizibil doar în development.)'
          )}
        />
        {hint && <p className="text-xs text-amber-700 text-center">{hint}</p>}
      </div>
    );
  }

  if (failed) {
    return (
      <div className="space-y-1.5">
        <FaceButton label={label} disabled />
        <p className="text-xs text-muted-foreground text-center">
          Serviciul Google nu s-a putut încărca (conexiune sau blocare de reclame). Folosește emailul și parola.
        </p>
      </div>
    );
  }

  return (
    <div ref={wrapper} className={cn('group relative w-full', disabled && 'pointer-events-none')}>
      <FaceButton label={label} busy={disabled} disabled={disabled || !ready} />
      {/* Google's button, on top and transparent: it receives the click and opens the popup. */}
      <div
        ref={overlay}
        aria-label={label}
        className="absolute inset-0 flex items-center justify-center overflow-hidden opacity-[0.01] cursor-pointer"
      />
    </div>
  );
}

/** The "sau" rule between Google and the email form. */
export function OrDivider() {
  return (
    <div className="flex items-center gap-3 my-5 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      sau cu email
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
