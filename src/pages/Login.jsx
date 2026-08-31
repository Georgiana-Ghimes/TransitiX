import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from '@/api/client';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
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
  const returnTo = safeReturnTo();

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
      window.location.href = postLoginPath(data?.user, returnTo);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
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
        <>
          Vrei acces la Transitix?{" "}
          <Link to="/request-access" className="text-primary font-medium hover:underline">
            Solicită acces
          </Link>
        </>
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

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

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
    </AuthLayout>
  );
}
