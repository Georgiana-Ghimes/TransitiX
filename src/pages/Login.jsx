import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from '@/api/client';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import GoogleSignInButton, { OrDivider } from "@/components/GoogleSignInButton";
import { CheckEmailPanel, ErrorBox, useAuthProviders } from "@/components/auth/AuthNotices";
import { safeReturnTo } from "@/lib/authReturnTo";
import { isDocumentsProfile, companionAppTitle } from '@/lib/appProfile';
import { postLoginPath } from "@/lib/roles";
import { loginErrorMessage } from '@/lib/loginMessages';

/** Prefer React state; fall back to the DOM (browser autofill often skips onChange). */
function credentialsFromSubmit(event, emailState, passwordState) {
  const form = event.currentTarget;
  const data = new FormData(form);
  const email = String(emailState || data.get('email') || '').trim();
  const password = String(passwordState || data.get('password') || '');
  return { email, password };
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionCheck, setSessionCheck] = useState(() => (api.auth.getToken() ? 'checking' : 'none'));
  const [unverified, setUnverified] = useState(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const returnTo = safeReturnTo();
  const navigate = useNavigate();
  const providers = useAuthProviders();

  // A temporary password has to be replaced before anything else; the server enforces it too.
  const afterSignIn = (user) => (user?.must_change_password
    ? `/change-password${returnTo !== "/" ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`
    : postLoginPath(user, returnTo));

  useEffect(() => {
    if (!api.auth.getToken()) {
      setSessionCheck('none');
      return;
    }
    let cancelled = false;
    setSessionCheck('checking');
    api.auth.me()
      .then((u) => {
        if (cancelled) return;
        // Already signed in: land where login would have sent them (companion → /avize).
        window.location.replace(afterSignIn(u));
      })
      .catch(() => {
        if (!cancelled) setSessionCheck('none');
      });
    return () => { cancelled = true; };
    // returnTo is from the URL at mount; afterSignIn closes over it.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only session gate
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const { email: submitEmail, password: submitPassword } = credentialsFromSubmit(e, email, password);
    if (!submitEmail || !submitPassword) {
      setError('Completează emailul și parola.');
      return;
    }
    // Keep controlled fields in sync if autofill filled the DOM only.
    if (submitEmail !== email) setEmail(submitEmail);
    if (submitPassword !== password) setPassword(submitPassword);
    setLoading(true);
    try {
      const data = await api.auth.loginViaEmailPassword(submitEmail, submitPassword);
      window.location.href = afterSignIn(data?.user);
    } catch (err) {
      if (err?.data?.code === "EMAIL_NOT_VERIFIED") {
        setUnverified(err.data.email || submitEmail);
      } else {
        setError(loginErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async (credential) => {
    setError("");
    setGoogleBusy(true);
    try {
      const data = await api.auth.google({ credential, intent: "signin" });
      window.location.href = afterSignIn(data?.user);
    } catch (err) {
      if (err?.data?.code === "GOOGLE_NEEDS_COMPANY" && !err.data.domain_in_use) {
        // No account for this address yet: creating one is the sign-up screen's job.
        navigate(`/register${returnTo !== "/" ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`, {
          state: { googlePending: { ...err.data, credential } },
        });
      } else if (err?.data?.code === "GOOGLE_NEEDS_COMPANY" && err.data.domain_in_use) {
        setError(
          `Există deja conturi pe @${err.data.domain}, dar nu pentru ${err.data.email}. `
          + "Cere o invitație administratorului, apoi încearcă din nou cu Google."
        );
      } else {
        // GOOGLE_NEEDS_INVITE, ACCOUNT_DISABLED, signup closed, wrong Google link, …
        setError(loginErrorMessage(err));
      }
    } finally {
      setGoogleBusy(false);
    }
  };

  const documentsCompanion = isDocumentsProfile();
  const appTitle = companionAppTitle();

  if (sessionCheck === 'checking') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" aria-label="Se verifică sesiunea" />
      </div>
    );
  }

  return (
    <AuthLayout
      brandLogo
      title="Bine ai revenit"
      subtitle={documentsCompanion ? `Autentifică-te în ${appTitle}` : 'Autentifică-te în Transitix'}
      footer={
        <>
          Vrei acces la Transitix?{" "}
          <Link to="/request-access" className="text-primary font-medium hover:underline">
            Solicită acces
          </Link>
          {providers?.signup_enabled ? (
            <>
              {" · "}
              <Link to="/register" className="text-primary font-medium hover:underline">
                Creează cont
              </Link>
            </>
          ) : null}
        </>
      }
    >
      {unverified ? (
        <div className="space-y-4">
          <CheckEmailPanel email={unverified} emailSent={false} />
          <button
            type="button"
            onClick={() => setUnverified(null)}
            className="w-full text-xs text-muted-foreground hover:underline"
          >
            Înapoi la autentificare
          </button>
        </div>
      ) : (
      <>
      {providers?.google_signin_enabled && providers.google_client_id ? (
        <>
          <GoogleSignInButton
            clientId={providers.google_client_id}
            onCredential={handleGoogle}
            disabled={googleBusy}
          />
          <OrDivider />
        </>
      ) : null}

      <ErrorBox message={error} />

      <form onSubmit={handleSubmit} className="space-y-4" method="post" autoComplete="on">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="admin@transitix.ro"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onInput={(e) => setEmail(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Parolă</Label>
            <Link to="/forgot-password" className="text-xs text-primary hover:underline">
              Ai uitat parola?
            </Link>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onInput={(e) => setPassword(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Se autentifică...
            </>
          ) : (
            "Autentificare"
          )}
        </Button>
      </form>
      </>
      )}
    </AuthLayout>
  );
}
