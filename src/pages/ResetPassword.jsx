/**
 * Choosing a password from an emailed link: a reset, or accepting an invitation. The two share
 * one server path on purpose, "prove it is your mailbox, then choose".
 */
import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from '@/api/client';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { ErrorBox } from "@/components/auth/AuthNotices";
import { friendlyErrorMessage } from '@/lib/notify';
import { PASSWORD_MIN_LENGTH, passwordProblem } from '@/lib/emailKind';

function PasswordInput({ id, value, onChange, autoFocus, invalid }) {
  return (
    <div className="relative">
      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
      <Input
        id={id}
        type="password"
        autoComplete="new-password"
        autoFocus={autoFocus}
        placeholder="••••••••"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        className={`pl-10 h-12 ${invalid ? "border-red-400" : ""}`}
        required
      />
    </div>
  );
}

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const resetToken = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const problem = newPassword ? passwordProblem(newPassword) : null;
  const mismatch = confirmPassword && newPassword !== confirmPassword;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const p = passwordProblem(newPassword);
    if (p) return setError(p);
    if (newPassword !== confirmPassword) return setError("Parolele nu coincid.");
    setLoading(true);
    try {
      await api.auth.resetPassword({ resetToken, newPassword });
      setDone(true);
      setTimeout(() => { window.location.href = "/login"; }, 1500);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const backToLogin = (
    <Link to="/login" className="text-primary font-medium hover:underline">Înapoi la autentificare</Link>
  );

  if (!resetToken) {
    return (
      <AuthLayout
        icon={AlertTriangle}
        title="Link invalid"
        subtitle="Linkul nu conține codul necesar"
        footer={<Link to="/forgot-password" className="text-primary font-medium hover:underline">Cere un link nou</Link>}
      >
        <p className="text-sm text-foreground text-center">
          Deschide linkul direct din email, fără să-l modifici. Pentru o invitație expirată, cere
          administratorului să o retrimită.
        </p>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout icon={CheckCircle2} title="Parolă salvată" footer={backToLogin}>
        <p className="text-sm text-center">Te poți autentifica acum cu noua parolă. Te redirecționăm…</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={Lock}
      title="Alege parola"
      subtitle="Pentru resetare sau pentru invitația primită"
      footer={backToLogin}
    >
      <ErrorBox message={error}>
        {/expirat|invalid/i.test(error) && (
          <p className="text-xs">
            <Link to="/forgot-password" className="underline font-medium">Cere un link nou</Link>
            {" "}sau, pentru o invitație, roagă administratorul să o retrimită.
          </p>
        )}
      </ErrorBox>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">Parola nouă</Label>
          <PasswordInput id="password" value={newPassword} onChange={setNewPassword} autoFocus invalid={Boolean(problem)} />
          <p className={`text-xs ${problem ? "text-red-600" : "text-muted-foreground"}`}>
            {problem || `Minimum ${PASSWORD_MIN_LENGTH} caractere. O frază lungă e mai sigură decât simboluri.`}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirmă parola</Label>
          <PasswordInput id="confirm" value={confirmPassword} onChange={setConfirmPassword} invalid={Boolean(mismatch)} />
          {mismatch && <p className="text-xs text-red-600">Parolele nu coincid.</p>}
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Se salvează…
            </>
          ) : (
            "Salvează parola"
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
