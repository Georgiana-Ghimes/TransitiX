/**
 * Replacing a temporary password.
 *
 * An admin who adds somebody by hand knows the first password. Until it is replaced the server
 * refuses every call outside /api/auth, and `ProtectedRoute` sends the person here.
 */
import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { KeyRound, Loader2, Lock } from 'lucide-react';
import { api } from '@/api/client';
import AuthLayout from '@/components/AuthLayout';
import { ErrorBox } from '@/components/auth/AuthNotices';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/AuthContext';
import { safeReturnTo } from '@/lib/authReturnTo';
import { PASSWORD_MIN_LENGTH, passwordProblem } from '@/lib/emailKind';
import { friendlyErrorMessage } from '@/lib/notify';
import { postLoginPath } from '@/lib/roles';

function PasswordField({ id, label, value, onChange, autoComplete, autoFocus, hint, invalid }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <Input
          id={id} type="password" className={`pl-10 h-12 ${invalid ? 'border-red-400' : ''}`}
          value={value} onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete} autoFocus={autoFocus} aria-invalid={invalid || undefined}
        />
      </div>
      {hint && <p className={`text-xs ${invalid ? 'text-red-600' : 'text-muted-foreground'}`}>{hint}</p>}
    </div>
  );
}

export default function ChangePassword() {
  const { user, isAuthenticated, isLoadingAuth, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const forced = Boolean(user?.must_change_password);

  if (!isLoadingAuth && !isAuthenticated) return <Navigate to="/login" replace />;

  const problem = next ? passwordProblem(next, { email: user?.email }) : null;
  const mismatch = confirm && next !== confirm;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const p = passwordProblem(next, { email: user?.email });
    if (p) return setError(p);
    if (next !== confirm) return setError('Parolele noi nu coincid.');
    if (next === current) return setError('Parola nouă trebuie să fie diferită de cea actuală.');
    setLoading(true);
    try {
      const data = await api.auth.changePassword({ current_password: current, new_password: next });
      window.location.href = postLoginPath(data.user, safeReturnTo());
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      icon={KeyRound}
      title={forced ? 'Alege-ți parola' : 'Schimbă parola'}
      subtitle={forced
        ? 'Contul a fost creat de administrator cu o parolă temporară'
        : 'Celelalte sesiuni vor fi închise'}
      footer={(
        <button type="button" onClick={() => logout(true)} className="text-primary font-medium hover:underline">
          Deconectează-te
        </button>
      )}
    >
      {forced && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Parola primită de la administrator e cunoscută și de el. Până nu alegi una proprie, aplicația rămâne blocată.
        </p>
      )}
      <ErrorBox message={error} />
      <form onSubmit={submit} className="space-y-4">
        <PasswordField
          id="current" label={forced ? 'Parola temporară' : 'Parola actuală'} value={current}
          onChange={setCurrent} autoComplete="current-password" autoFocus
        />
        <PasswordField
          id="new" label="Parola nouă" value={next} onChange={setNext} autoComplete="new-password"
          invalid={Boolean(problem)}
          hint={problem || `Minimum ${PASSWORD_MIN_LENGTH} caractere.`}
        />
        <PasswordField
          id="confirm" label="Confirmă parola nouă" value={confirm} onChange={setConfirm}
          autoComplete="new-password" invalid={Boolean(mismatch)}
          hint={mismatch ? 'Parolele nu coincid.' : null}
        />
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading || !current || !next || !confirm}>
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Se salvează…</> : 'Salvează parola'}
        </Button>
      </form>
    </AuthLayout>
  );
}
