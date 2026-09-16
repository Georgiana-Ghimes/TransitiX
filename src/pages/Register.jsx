/**
 * Creating a company account.
 *
 * Three ways in: a company address, a personal one, or Google. Whatever the route, the screen
 * says out loud the two mistakes that are quiet otherwise: a personal address filed as the
 * company one, and a second company created by somebody whose colleagues already have one.
 *
 * Email sign-ups end on "check your inbox"; the account signs in only from the link.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Building2, Loader2, Lock, Mail, User, UserPlus } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AuthLayout from '@/components/AuthLayout';
import GoogleSignInButton, { OrDivider } from '@/components/GoogleSignInButton';
import {
  CheckEmailPanel, ErrorBox, NoticeList, useAuthProviders,
} from '@/components/auth/AuthNotices';
import { safeReturnTo } from '@/lib/authReturnTo';
import { postLoginPath } from '@/lib/roles';
import { friendlyErrorMessage } from '@/lib/notify';
import { cn } from '@/lib/utils';
import {
  PASSWORD_MIN_LENGTH, classifyEmail, isEmailShape, normaliseEmail, passwordProblem, signupEmailNotices,
} from '@/lib/emailKind';

const ACCOUNT_TYPES = [
  {
    id: 'institution',
    icon: Building2,
    title: 'Email de firmă',
    hint: 'ex. nume@firma.ro — colegii tăi vor fi recunoscuți după domeniu',
  },
  {
    id: 'personal',
    icon: User,
    title: 'Email personal',
    hint: 'Gmail, Yahoo, Outlook… — când firma nu are adresă proprie',
  },
];

function IconInput({ icon: Icon, invalid, ...props }) {
  return (
    <div className="relative">
      <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
      <Input
        {...props}
        aria-invalid={invalid || undefined}
        className={cn('pl-10 h-12', invalid && 'border-red-400 focus-visible:ring-red-400')}
      />
    </div>
  );
}

function FieldHint({ children, error }) {
  if (!children) return null;
  return <p className={cn('text-xs', error ? 'text-red-600' : 'text-muted-foreground')}>{children}</p>;
}

function DomainConfirm({ checked, onChange, domain }) {
  return (
    <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-amber-900 cursor-pointer">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Știu că există deja conturi pe @{domain} și vreau totuși o <strong>firmă nouă, separată</strong>.
      </span>
    </label>
  );
}

function loginLink(returnTo) {
  return `/login${returnTo !== '/' ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
}

/** Google said who the person is, but there is no company yet: ask for its name only. */
function GoogleCompanyStep({ pending, onCancel, returnTo }) {
  const [companyName, setCompanyName] = useState('');
  const [confirmDomain, setConfirmDomain] = useState(false);
  const [domainInUse, setDomainInUse] = useState(Boolean(pending.domain_in_use));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (companyName.trim().length < 2) {
      setError('Completează numele firmei.');
      return;
    }
    setLoading(true);
    try {
      const data = await api.auth.google({
        credential: pending.credential,
        company_name: companyName.trim(),
        confirm_domain: confirmDomain || undefined,
      });
      window.location.href = postLoginPath(data?.user, returnTo);
    } catch (err) {
      if (err?.data?.code === 'DOMAIN_IN_USE') setDomainInUse(true);
      setError(err?.status === 401
        ? 'Sesiunea Google a expirat. Apasă din nou „Înregistrează-te cu Google”.'
        : friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
        <p className="text-xs text-muted-foreground">Cont Google</p>
        <p className="font-medium break-all">{pending.name ? `${pending.name} · ` : ''}{pending.email}</p>
      </div>
      <NoticeList
        notices={[
          pending.personal && {
            code: 'personal', level: 'info',
            text: 'Adresă personală: firma va fi recunoscută doar după nume, nu după domeniu.',
          },
          domainInUse && {
            code: 'domain_in_use', level: 'warning',
            text: `Colegi de pe @${pending.domain} folosesc deja Transitix. Dacă sunteți aceeași firmă, cere o invitație administratorului.`,
          },
        ].filter(Boolean)}
      />
      {domainInUse && <DomainConfirm checked={confirmDomain} onChange={setConfirmDomain} domain={pending.domain} />}
      <ErrorBox message={error} />
      <div className="space-y-2">
        <Label htmlFor="g-company">Nume firmă</Label>
        <IconInput
          id="g-company" icon={Building2} autoFocus placeholder="Transport SRL"
          value={companyName} onChange={(e) => setCompanyName(e.target.value)} required
        />
      </div>
      <Button type="submit" className="w-full h-12 font-medium" disabled={loading || (domainInUse && !confirmDomain)}>
        {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Se creează contul…</> : 'Creează firma'}
      </Button>
      <button type="button" onClick={onCancel} className="w-full text-xs text-muted-foreground hover:underline">
        Folosește alt cont
      </button>
    </form>
  );
}

export default function Register() {
  const location = useLocation();
  const providers = useAuthProviders();
  const returnTo = safeReturnTo();

  const [accountType, setAccountType] = useState('institution');
  const [companyName, setCompanyName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [touched, setTouched] = useState({});
  const [check, setCheck] = useState(null);
  const [confirmDomain, setConfirmDomain] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(null);
  const [googlePending, setGooglePending] = useState(location.state?.googlePending || null);
  const [googleBusy, setGoogleBusy] = useState(false);

  const cleanEmail = normaliseEmail(email);

  // Ask the server about the address once the person pauses typing.
  useEffect(() => {
    setCheck(null);
    setConfirmDomain(false);
    if (!isEmailShape(cleanEmail)) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      api.auth.checkEmail(cleanEmail)
        .then((res) => { if (!cancelled) setCheck({ ...res, email: cleanEmail }); })
        .catch(() => {});
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [cleanEmail]);

  const currentCheck = check?.email === cleanEmail ? check : null;
  const notices = useMemo(
    () => (touched.email || currentCheck ? signupEmailNotices(cleanEmail, accountType, currentCheck) : []),
    [cleanEmail, accountType, currentCheck, touched.email],
  );
  const blocking = notices.some((n) => n.level === 'error');
  const needsDomainConfirm = Boolean(currentCheck?.domain_in_use) && accountType === 'institution';
  const pwdProblem = passwordProblem(password, { email: cleanEmail });
  const mismatch = confirmPassword && password !== confirmPassword;

  const touch = (field) => () => setTouched((t) => ({ ...t, [field]: true }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setTouched({ email: true, password: true, confirm: true, name: true, company: true });
    if (companyName.trim().length < 2) return setError('Completează numele firmei.');
    if (name.trim().length < 2) return setError('Completează numele tău.');
    if (blocking) return setError(notices.find((n) => n.level === 'error').text);
    if (pwdProblem) return setError(pwdProblem);
    if (password !== confirmPassword) return setError('Parolele nu coincid.');
    if (needsDomainConfirm && !confirmDomain) {
      return setError('Confirmă că vrei o firmă nouă sau cere o invitație colegilor.');
    }

    setLoading(true);
    try {
      const res = await api.auth.register({
        email: cleanEmail,
        password,
        name: name.trim(),
        company_name: companyName.trim(),
        account_type: accountType,
        confirm_domain: confirmDomain || undefined,
      });
      setDone(res);
    } catch (err) {
      const code = err?.data?.code;
      if (code === 'DOMAIN_IN_USE') {
        setCheck((c) => ({ ...(c || {}), email: cleanEmail, domain_in_use: true, domain: err.data.domain }));
      } else if (code === 'EMAIL_TAKEN') {
        setCheck((c) => ({ ...(c || {}), email: cleanEmail, email_taken: true }));
      }
      setError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async (credential) => {
    setError('');
    setGoogleBusy(true);
    try {
      const data = await api.auth.google({ credential });
      window.location.href = postLoginPath(data?.user, returnTo);
    } catch (err) {
      if (err?.data?.code === 'GOOGLE_NEEDS_COMPANY') {
        setGooglePending({ ...err.data, credential });
      } else {
        setError(friendlyErrorMessage(err));
      }
    } finally {
      setGoogleBusy(false);
    }
  };

  const footer = (
    <>
      Ai deja cont?{' '}
      <Link to={loginLink(returnTo)} className="text-primary font-medium hover:underline">
        Autentifică-te
      </Link>
    </>
  );

  if (!providers) {
    return (
      <AuthLayout icon={UserPlus} title="Creează cont" footer={footer}>
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      </AuthLayout>
    );
  }

  if (!providers.signup_enabled) {
    return (
      <AuthLayout icon={UserPlus} title="Înregistrare oprită" footer={footer}>
        <p className="text-sm text-center text-foreground">
          {providers.failed
            ? 'Nu am putut contacta serverul. Verifică conexiunea și reîncarcă pagina.'
            : 'Pe acest server conturile noi se creează doar prin invitație. Cere administratorului firmei tale să te invite din Setări › Utilizatori.'}
        </p>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout icon={UserPlus} title="Confirmă emailul" subtitle="Mai e un pas" footer={footer}>
        <CheckEmailPanel email={done.email} emailSent={done.email_sent} initialLink={done.verify_link} />
      </AuthLayout>
    );
  }

  if (googlePending) {
    return (
      <AuthLayout icon={UserPlus} title="Creează firma" subtitle="Ultimul pas pentru contul Google" footer={footer}>
        <GoogleCompanyStep pending={googlePending} onCancel={() => setGooglePending(null)} returnTo={returnTo} />
      </AuthLayout>
    );
  }

  const domain = classifyEmail(cleanEmail).domain;

  return (
    <AuthLayout icon={UserPlus} title="Creează cont" subtitle="Înregistrează firma pe Transitix" footer={footer}>
      {(providers.google_client_id || import.meta.env.DEV) && (
        <>
          <GoogleSignInButton
            clientId={providers.google_client_id}
            onCredential={handleGoogle}
            mode="signup"
            disabled={googleBusy}
          />
          <OrDivider />
        </>
      )}

      <ErrorBox message={error}>
        {currentCheck?.email_taken && (
          <p className="text-xs">
            <Link to={loginLink(returnTo)} className="underline font-medium">Autentifică-te</Link>
            {' sau '}
            <Link to="/forgot-password" className="underline font-medium">resetează parola</Link>.
          </p>
        )}
      </ErrorBox>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium mb-2">Cu ce adresă te înregistrezi?</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ACCOUNT_TYPES.map((t) => {
              const Icon = t.icon;
              const active = accountType === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setAccountType(t.id)}
                  className={cn(
                    'text-left rounded-xl border px-3 py-2.5 transition-colors',
                    active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/50',
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="w-4 h-4" aria-hidden="true" /> {t.title}
                  </span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5 leading-snug">{t.hint}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="company">Nume firmă</Label>
          <IconInput
            id="company" icon={Building2} placeholder="Transport SRL" autoComplete="organization"
            value={companyName} onChange={(e) => setCompanyName(e.target.value)} onBlur={touch('company')}
            invalid={touched.company && companyName.trim().length < 2}
          />
          {touched.company && companyName.trim().length < 2 && <FieldHint error>Completează numele firmei.</FieldHint>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="name">Numele tău</Label>
          <IconInput
            id="name" icon={User} placeholder="Ana Popescu" autoComplete="name"
            value={name} onChange={(e) => setName(e.target.value)} onBlur={touch('name')}
            invalid={touched.name && name.trim().length < 2}
          />
          <FieldHint>Vei fi administratorul firmei: inviți colegii din Setări › Utilizatori.</FieldHint>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">{accountType === 'institution' ? 'Email de firmă' : 'Email personal'}</Label>
          <IconInput
            id="email" type="email" icon={Mail} autoComplete="email"
            placeholder={accountType === 'institution' ? 'nume@firma.ro' : 'nume@gmail.com'}
            value={email} onChange={(e) => setEmail(e.target.value)} onBlur={touch('email')}
            invalid={blocking}
          />
          <NoticeList notices={notices} />
          {needsDomainConfirm && !currentCheck?.email_taken && (
            <DomainConfirm checked={confirmDomain} onChange={setConfirmDomain} domain={currentCheck.domain || domain} />
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Parolă</Label>
          <IconInput
            id="password" type="password" icon={Lock} autoComplete="new-password" placeholder="••••••••"
            value={password} onChange={(e) => setPassword(e.target.value)} onBlur={touch('password')}
            invalid={touched.password && Boolean(pwdProblem)}
          />
          <FieldHint error={touched.password && Boolean(pwdProblem)}>
            {touched.password && pwdProblem
              ? pwdProblem
              : `Minimum ${PASSWORD_MIN_LENGTH} caractere. O frază lungă e mai sigură decât simboluri.`}
          </FieldHint>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm">Confirmă parola</Label>
          <IconInput
            id="confirm" type="password" icon={Lock} autoComplete="new-password" placeholder="••••••••"
            value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} onBlur={touch('confirm')}
            invalid={Boolean(mismatch)}
          />
          {mismatch && <FieldHint error>Parolele nu coincid.</FieldHint>}
        </div>

        {!providers.email_configured && (
          <NoticeList notices={[{
            code: 'no_email', level: 'info',
            text: 'Serverul nu are încă email configurat: linkul de confirmare îți va fi afișat direct pe ecran.',
          }]}
          />
        )}

        <Button
          type="submit"
          className="w-full h-12 font-medium"
          disabled={loading || blocking || (needsDomainConfirm && !confirmDomain)}
        >
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Se creează contul…</> : 'Creează cont'}
        </Button>
      </form>
    </AuthLayout>
  );
}
