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
import { friendlyErrorMessage } from '@/lib/notify';

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [existingSession, setExistingSession] = useState(null);
  const [unverified, setUnverified] = useState(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const returnTo = safeReturnTo();
  const navigate = useNavigate();
  const providers = useAuthProviders();

  useEffect(() => {
    if (!api.auth.getToken()) return;
    api.auth.me()
      .then((u) => setExistingSession(u))
      .catch(() => setExistingSession(null));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api.auth.loginViaEmailPassword(email, password);
      window.location.href = afterSignIn(data?.user);
    } catch (err) {
      if (err?.data?.code === "EMAIL_NOT_VERIFIED") {
        setUnverified(err.data.email || email);
      } else {
        setError(friendlyErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  // A temporary password has to be replaced before anything else; the server enforces it too.
  const afterSignIn = (user) => (user?.must_change_password
    ? `/change-password${returnTo !== "/" ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`
    : postLoginPath(user, returnTo));

  const handleGoogle = async (credential) => {
    setError("");
    setGoogleBusy(true);
    try {
      const data = await api.auth.google({ credential, intent: "signin" });
      window.location.href = afterSignIn(data?.user);
    } catch (err) {
      if (err?.data?.code === "GOOGLE_NEEDS_INVITE") {
        // Domain already has a company, this mailbox does not: creating another firm from Login
        // is how people end up locked out of the one their colleagues use.
        setError(err.data.message || friendlyErrorMessage(err));
      } else if (err?.data?.code === "GOOGLE_NEEDS_COMPANY") {
        if (err.data.domain_in_use) {
          setError(
            `Există deja conturi pe @${err.data.domain}, dar nu pentru ${err.data.email}. `
            + "Cere o invitație administratorului, apoi încearcă din nou cu Google."
          );
        } else {
          // No account for this address yet: creating one is the sign-up screen's job.
          navigate(`/register${returnTo !== "/" ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`, {
            state: { googlePending: { ...err.data, credential } },
          });
        }
      } else {
        setError(friendlyErrorMessage(err));
      }
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleClearSession = async () => {
    await api.auth.logout(false);
    setExistingSession(null);
  };

  const documentsCompanion = isDocumentsProfile();
  const appTitle = companionAppTitle();

  return (
    <AuthLayout
      brandLogo
      title="Bine ai revenit"
      subtitle={documentsCompanion ? `Autentifică-te în ${appTitle}` : 'Autentifică-te în Transitix'}
      footer={
        !providers?.signup_enabled ? null : (
        <>
          Nu ai cont?{" "}
          <Link
            to={"/register" + (returnTo !== "/" ? "?returnTo=" + encodeURIComponent(returnTo) : "")}
            className="text-primary font-medium hover:underline"
          >
            Creează unul
          </Link>
        </>
        )
      }
    >
      {existingSession && (
        <div className="mb-4 p-3 rounded-lg bg-slate-100 text-slate-700 text-sm flex items-center justify-between gap-3">
          <span>
            Ești conectat ca <strong>{existingSession.email}</strong>
            {existingSession.role ? ` (${existingSession.role})` : ""}.
          </span>
          <button
            type="button"
            onClick={handleClearSession}
            className="shrink-0 text-primary font-medium hover:underline"
          >
            Deconectează
          </button>
        </div>
      )}

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
      {providers && (providers.google_client_id || import.meta.env.DEV) && (
        <>
          <GoogleSignInButton
            clientId={providers.google_client_id}
            onCredential={handleGoogle}
            disabled={googleBusy}
          />
          <OrDivider />
        </>
      )}

      <ErrorBox message={error} />

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="admin@transitix.ro"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
