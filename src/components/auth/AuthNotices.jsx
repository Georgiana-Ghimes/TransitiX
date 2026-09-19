/**
 * Pieces shared by the sign-in, sign-up and verification screens.
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink, Info, Loader2, MailCheck, XCircle } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { friendlyErrorMessage } from '@/lib/notify';
import { cn } from '@/lib/utils';

const LEVELS = {
  error: { icon: XCircle, box: 'border-red-200 bg-red-50 text-red-700' },
  warning: { icon: AlertTriangle, box: 'border-amber-200 bg-amber-50 text-amber-800' },
  info: { icon: Info, box: 'border-blue-200 bg-blue-50 text-blue-800' },
};

/** A list of `{ code, level, text }` from `emailKind.js`, one line each. */
export function NoticeList({ notices, className }) {
  if (!notices?.length) return null;
  return (
    <div className={cn('space-y-1.5', className)}>
      {notices.map((n) => {
        const meta = LEVELS[n.level] || LEVELS.warning;
        const Icon = meta.icon;
        return (
          <p
            key={n.code}
            role={n.level === 'error' ? 'alert' : undefined}
            className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-snug', meta.box)}
          >
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{n.text}</span>
          </p>
        );
      })}
    </div>
  );
}

export function ErrorBox({ message, children }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm space-y-2">
      <p>{message}</p>
      {children}
    </div>
  );
}

/**
 * A link the server handed back because no email went out.
 *
 * Only ever shown when the server has no mail provider (or it refused): without this the account
 * exists and nobody can reach it.
 */
export function DevLink({ link, label = 'Emailul nu este configurat pe server. Folosește linkul direct:' }) {
  const [copied, setCopied] = useState(false);
  if (!link) return null;
  return (
    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-left">
      <p className="text-xs text-amber-900">{label}</p>
      <p className="text-xs break-all text-foreground font-mono">{link}</p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // The link is selectable either way.
            }
          }}
        >
          {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
          {copied ? 'Copiat' : 'Copiază'}
        </Button>
        <Button type="button" className="flex-1" asChild>
          <a href={link}>
            <ExternalLink className="w-4 h-4 mr-1" />
            Deschide
          </a>
        </Button>
      </div>
    </div>
  );
}

const RESEND_COOLDOWN_S = 60;

/**
 * "Check your inbox", with a resend that cannot be hammered.
 *
 * `initialLink` is the link the server returned when it could not send the email.
 */
export function CheckEmailPanel({ email, emailSent, initialLink }) {
  const [link, setLink] = useState(initialLink || '');
  const [cooldown, setCooldown] = useState(emailSent ? RESEND_COOLDOWN_S : 0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const resend = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await api.auth.resendVerification(email);
      setMessage(res?.verify_link ? 'Link nou generat.' : 'Dacă adresa așteaptă confirmarea, am trimis un link nou.');
      if (res?.verify_link) setLink(res.verify_link);
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-50 text-emerald-600">
        <MailCheck className="w-6 h-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-sm text-foreground">
          {emailSent ? 'Am trimis un link de confirmare la' : 'Contul așteaptă confirmarea adresei'}
        </p>
        <p className="text-sm font-semibold break-all">{email}</p>
        <p className="text-xs text-muted-foreground">
          Deschide linkul din email ca să intri în cont. Linkul e valabil 48 de ore. Verifică și folderul Spam.
        </p>
      </div>

      <DevLink link={link} />

      {message && <p className="text-xs text-emerald-700">{message}</p>}
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}

      <Button type="button" variant="outline" className="w-full" onClick={resend} disabled={busy || cooldown > 0}>
        {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {cooldown > 0 ? `Retrimite linkul (${cooldown}s)` : 'Retrimite linkul'}
      </Button>
    </div>
  );
}

/** Server capabilities for the auth screens; `null` while loading, safe defaults on failure. */
export function useAuthProviders() {
  const [providers, setProviders] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.auth.providers()
      .then((p) => { if (!cancelled) setProviders(p); })
      .catch(() => {
        if (!cancelled) {
          setProviders({ signup_enabled: false, google_client_id: null, email_configured: false, failed: true });
        }
      });
    return () => { cancelled = true; };
  }, []);
  return providers;
}
