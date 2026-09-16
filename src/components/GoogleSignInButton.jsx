/**
 * "Continuă cu Google", through Google Identity Services.
 *
 * Google renders its own button (their branding rules require it) and hands back an ID token;
 * the server verifies it. Nothing here is trusted: the credential is only passed on.
 *
 * Renders nothing without a client id, so a server with Google switched off shows no dead button.
 */
import React, { useEffect, useRef, useState } from 'react';

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

export default function GoogleSignInButton({ clientId, onCredential, text = 'continue_with', disabled = false }) {
  const holder = useRef(null);
  const callback = useRef(onCredential);
  const [failed, setFailed] = useState(false);
  callback.current = onCredential;

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !holder.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => callback.current?.(response.credential),
          ux_mode: 'popup',
          context: text === 'signup_with' ? 'signup' : 'signin',
        });
        holder.current.innerHTML = '';
        window.google.accounts.id.renderButton(holder.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text,
          shape: 'rectangular',
          logo_alignment: 'center',
          locale: 'ro',
          width: Math.min(holder.current.offsetWidth || 320, 400),
        });
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [clientId, text]);

  if (!clientId) return null;
  if (failed) {
    return (
      <p className="text-xs text-muted-foreground text-center">
        Butonul Google nu s-a putut încărca (conexiune sau blocare de reclame). Folosește emailul și parola.
      </p>
    );
  }
  return (
    <div
      ref={holder}
      aria-disabled={disabled}
      className={`w-full min-h-[44px] flex justify-center ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    />
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
