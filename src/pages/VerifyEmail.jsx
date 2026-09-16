/**
 * The page the verification email links to. Confirms the address and signs the person in.
 *
 * The request runs once per token: React's development double-mount would otherwise spend the
 * link on the first call and report the second as "already used".
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2, MailCheck } from 'lucide-react';
import { api } from '@/api/client';
import AuthLayout from '@/components/AuthLayout';
import { Button } from '@/components/ui/button';
import { postLoginPath } from '@/lib/roles';
import { friendlyErrorMessage } from '@/lib/notify';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState(token ? 'working' : 'missing');
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);
  const started = useRef(null);

  useEffect(() => {
    if (!token || started.current === token) return;
    started.current = token;
    api.auth.verifyEmail(token)
      .then((data) => {
        setUser(data.user);
        setState('done');
        setTimeout(() => { window.location.href = postLoginPath(data.user, '/'); }, 1500);
      })
      .catch((err) => {
        setError(friendlyErrorMessage(err));
        setState('failed');
      });
  }, [token]);

  if (state === 'working') {
    return (
      <AuthLayout icon={MailCheck} title="Confirmăm adresa…">
        <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      </AuthLayout>
    );
  }

  if (state === 'done') {
    return (
      <AuthLayout icon={CheckCircle2} title="Email confirmat" subtitle="Contul tău e activ">
        <div className="space-y-4 text-center">
          <p className="text-sm">Bine ai venit{user?.name ? `, ${user.name}` : ''}! Te ducem în aplicație…</p>
          <Button className="w-full" onClick={() => { window.location.href = postLoginPath(user, '/'); }}>
            Continuă
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={AlertTriangle}
      title={state === 'missing' ? 'Link incomplet' : 'Linkul nu mai e valabil'}
      footer={<Link to="/login" className="text-primary font-medium hover:underline">Înapoi la autentificare</Link>}
    >
      <div className="space-y-3 text-sm text-center">
        <p>
          {state === 'missing'
            ? 'Linkul folosit nu conține codul de confirmare. Deschide-l direct din email, fără să-l modifici.'
            : error}
        </p>
        <p className="text-xs text-muted-foreground">
          Dacă ai confirmat deja, te poți autentifica. Altfel, încearcă să te autentifici și vei putea cere un link nou.
        </p>
      </div>
    </AuthLayout>
  );
}
