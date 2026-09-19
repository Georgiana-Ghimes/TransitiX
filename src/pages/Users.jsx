/**
 * Administering the people who use the system.
 *
 * This existed only as SQL until now, which meant three things at once: only whoever had database
 * access could add a colleague, nobody could see who held which role, and an admin ended up
 * choosing somebody else's password. The screen removes all three, an invitation carries a link,
 * the person picks their own password, and every change lands on the audit trail.
 *
 * The buttons offered come from `actionsFor`, not from guesswork in the markup, so what an admin
 * can click matches what the server will accept.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, Copy, KeyRound, Loader2, Mail, RefreshCw, Search, ShieldCheck, UserPlus, Users as UsersIcon,
} from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { notifyError, notifySuccess } from '@/lib/notify';
import {
  actionsFor,
  deactivationNotice,
  filterUsers,
  lastSeen,
  sortUsers,
  stateMeta,
  warningsFor,
} from '@/lib/usersUi';
import {
  PASSWORD_MIN_LENGTH, inviteEmailNotices, isEmailShape, passwordProblem,
} from '@/lib/emailKind';

function StateBadge({ state }) {
  const meta = stateMeta(state);
  return (
    <span title={meta.hint} className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${meta.badge}`}>
      {meta.label}
    </span>
  );
}

/**
 * The invitation link, shown when no mail provider is configured.
 *
 * Without this the account exists and nobody can reach it: the link was generated, logged on the
 * server, and lost.
 */
function InviteLink({ link, onDone }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
      <p className="text-sm text-blue-900 font-medium">
        Emailul nu a plecat (serviciul nu e configurat sau a refuzat), trimite tu linkul de invitație.
      </p>
      <p className="text-[12px] text-blue-800">
        Valabil 7 zile. Persoana își alege singură parola; tu nu o afli niciodată.
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          className="flex-1 text-[12px] px-2 py-1.5 rounded border border-blue-200 bg-white font-mono"
        />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard access can be refused; the field is selectable either way.
            }
          }}
          className="text-sm px-3 py-1.5 rounded border border-blue-200 bg-white text-blue-800 inline-flex items-center gap-1.5"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copiat' : 'Copiază'}
        </button>
        <button type="button" onClick={onDone} className="text-sm px-3 py-1.5 text-blue-700">
          Închide
        </button>
      </div>
    </div>
  );
}

/**
 * The temporary password of an account an admin just added, shown exactly once.
 *
 * The server does not keep it anywhere readable, so closing this is final; the admin can always
 * send an invitation link instead from the row.
 */
function TemporaryPassword({ email, password, onDone }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 space-y-2">
      <p className="text-sm text-violet-900 font-medium">
        Cont creat pentru {email}. Parola temporară (afișată o singură dată):
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          readOnly
          value={password}
          onFocus={(e) => e.target.select()}
          className="flex-1 min-w-[10rem] text-base tracking-wider px-2 py-1.5 rounded border border-violet-200 bg-white font-mono"
        />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(password);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard access can be refused; the field is selectable either way.
            }
          }}
          className="text-sm px-3 py-1.5 rounded border border-violet-200 bg-white text-violet-800 inline-flex items-center gap-1.5"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copiat' : 'Copiază'}
        </button>
        <button type="button" onClick={onDone} className="text-sm px-3 py-1.5 text-violet-700">
          Am transmis-o
        </button>
      </div>
      <p className="text-[12px] text-violet-800">
        Dă-o personal sau la telefon, nu pe un grup. La prima autentificare persoana e obligată să-și aleagă
        propria parolă; până atunci nu poate folosi aplicația.
      </p>
    </div>
  );
}

const EMPTY_FORM = { name: '', email: '', role: 'dispatcher', phone: '', temporary_password: '' };

/**
 * Adding a person: by invitation (the default, they choose their own password) or by hand, for
 * somebody who cannot open an email right now.
 */
function AddPersonForm({ roles, adminEmail, emailConfigured, onAdded, onLink, onTemporary }) {
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const notices = useMemo(() => inviteEmailNotices(form.email, { adminEmail }), [form.email, adminEmail]);
  const typedProblem = mode === 'manual' && form.temporary_password
    ? passwordProblem(form.temporary_password, { email: form.email })
    : null;

  const close = () => {
    setMode(null);
    setError('');
    setForm(EMPTY_FORM);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!isEmailShape(form.email)) return setError('Adresa de email nu pare validă.');
    if (typedProblem) return setError(`Parola temporară: ${typedProblem}`);
    setBusy(true);
    try {
      if (mode === 'invite') {
        const { temporary_password: _unused, ...body } = form;
        const res = await api.users.invite(body);
        if (res.email_sent) {
          notifySuccess('Invitație trimisă', `Email trimis către ${form.email}.`);
        } else {
          notifySuccess(
            'Invitație creată',
            res.email_configured
              ? 'Emailul nu a putut fi trimis acum. Copiază linkul și trimite-l tu.'
              : 'Emailul nu e configurat, copiază linkul.'
          );
          if (res.invite_link) onLink(res.invite_link);
        }
      } else {
        const res = await api.users.createManual(form);
        if (res.temporary_password) {
          onTemporary({ email: form.email, password: res.temporary_password });
        } else {
          notifySuccess('Cont creat', `Comunică-i lui ${form.name} parola temporară aleasă de tine.`);
        }
      }
      close();
      onAdded();
    } catch (err) {
      // Kept inside the form: a toast disappears while the admin is still reading which field is wrong.
      setError(err?.message || 'Operația nu a reușit.');
      notifyError(mode === 'invite' ? 'Invitația nu a putut fi trimisă' : 'Contul nu a putut fi creat', err);
    } finally {
      setBusy(false);
    }
  };

  if (!mode) {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode('invite')}
          className="text-sm px-3 py-2 rounded-lg bg-[#1D4E89] text-white inline-flex items-center gap-2"
        >
          <UserPlus className="w-4 h-4" /> Invită coleg
        </button>
        <button
          type="button"
          onClick={() => setMode('manual')}
          className="text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2"
        >
          <KeyRound className="w-4 h-4" /> Adaugă manual
        </button>
      </div>
    );
  }

  const inputCls = 'text-sm px-2 py-2 rounded-lg border border-slate-200 min-w-0';

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 w-full">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-[12px]" role="tablist">
          {[['invite', 'Invitație pe email'], ['manual', 'Cont manual']].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              onClick={() => { setMode(id); setError(''); }}
              className={`px-3 py-1.5 rounded-md ${mode === id ? 'bg-[#1D4E89] text-white' : 'text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-slate-500 flex-1 min-w-[12rem]">
          {mode === 'invite'
            ? 'Persoana primește un link valabil 7 zile și își alege singură parola. Poate intra și cu Google, dacă adresa e Gmail.'
            : 'Pentru cine nu își poate deschide emailul acum. Primește o parolă temporară, pe care trebuie s-o schimbe la prima intrare.'}
        </p>
      </div>

      {mode === 'invite' && !emailConfigured && (
        <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Serverul nu are email configurat (Resend): invitația nu pleacă automat, vei primi linkul să-l trimiți tu.
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input required value={form.name} onChange={set('name')} placeholder="Nume complet" className={inputCls} />
        <input required type="email" value={form.email} onChange={set('email')} placeholder="Email" className={inputCls} />
        <input value={form.phone} onChange={set('phone')} placeholder="Telefon (opțional)" className={inputCls} />
        <select value={form.role} onChange={set('role')} className={inputCls}>
          {Object.entries(roles || {}).map(([role, meta]) => (
            <option key={role} value={role}>{meta.label}</option>
          ))}
        </select>
      </div>
      <p className="text-[12px] text-slate-500">{roles?.[form.role]?.description}</p>

      {form.role === 'admin' && (
        <p className="text-[12px] text-amber-800 flex items-start gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Administratorul vede și schimbă tot: utilizatori, tarife, jurnalul de modificări.
        </p>
      )}

      {notices.map((n) => (
        <p key={n.code} className="text-[12px] text-amber-800 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {n.text}
        </p>
      ))}

      {mode === 'manual' && (
        <div className="space-y-1">
          <input
            type="text"
            autoComplete="off"
            value={form.temporary_password}
            onChange={set('temporary_password')}
            placeholder={`Parolă temporară (gol = generată automat, min. ${PASSWORD_MIN_LENGTH} caractere)`}
            className={`${inputCls} w-full sm:max-w-md font-mono ${typedProblem ? 'border-red-400' : ''}`}
          />
          {typedProblem && <p className="text-[12px] text-red-600">{typedProblem}</p>}
        </div>
      )}

      {error && (
        <p role="alert" className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit" disabled={busy || Boolean(typedProblem)}
          className="text-sm px-3 py-2 rounded-lg bg-[#1D4E89] text-white inline-flex items-center gap-2 disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'invite' ? <Mail className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />}
          {mode === 'invite' ? 'Trimite invitația' : 'Creează contul'}
        </button>
        <button type="button" onClick={close} className="text-sm px-3 py-2 text-slate-500">
          Renunță
        </button>
      </div>
    </form>
  );
}

function UserRow({ user, roles, drivers, adminCount, currentUserId, onChanged, onLink }) {
  const [busy, setBusy] = useState(null);
  const actions = actionsFor(user, { currentUserId, adminCount });
  const warnings = warningsFor(user, { adminCount });

  const run = async (key, fn, done) => {
    setBusy(key);
    try {
      const res = await fn();
      if (done) done(res);
      onChanged();
    } catch (err) {
      notifyError('Acțiunea nu a reușit', err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className={`border-t border-slate-100 px-4 py-3 ${user.is_active ? '' : 'bg-slate-50/60'}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-sm font-medium ${user.is_active ? 'text-[#0A2B4E]' : 'text-slate-400'}`}>
              {user.name}
            </span>
            <StateBadge state={user.is_active ? user.state : 'expired'} />
            {!user.is_active && (
              <span className="text-[11px] px-2 py-0.5 rounded-full border bg-slate-100 text-slate-500 border-slate-200">
                Dezactivat
              </span>
            )}
            {user.id === currentUserId && (
              <span className="text-[11px] text-slate-400">(tu)</span>
            )}
          </div>
          <p className="text-[12px] text-slate-500 break-words">
            {user.email}
            {user.google_linked ? ' · Google' : ''}
            {user.driver_name ? ` · profil șofer: ${user.driver_name}` : ''}
            {` · ultima autentificare: ${lastSeen(user)}`}
            {user.active_sessions > 0 ? ` · ${user.active_sessions} sesiuni` : ''}
          </p>
          {warnings.map((w) => (
            <p key={w.code} className="text-[12px] text-amber-700 mt-1 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {w.text}
            </p>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={user.role}
            disabled={!actions.canChangeRole || busy === 'role'}
            title={actions.canChangeRole ? 'Schimbă rolul' : 'Rolul nu poate fi schimbat pentru acest cont'}
            onChange={(e) => run('role', () => api.users.setRole(user.id, e.target.value))}
            className="text-[12px] px-2 py-1.5 rounded-lg border border-slate-200 disabled:opacity-50 disabled:bg-slate-50"
          >
            {Object.entries(roles || {}).map(([role, meta]) => (
              <option key={role} value={role}>{meta.label}</option>
            ))}
          </select>

          {actions.canLinkDriver && (
            <select
              value={user.driver_id || ''}
              disabled={busy === 'driver'}
              title="Profilul de șofer prin care primește curse"
              onChange={(e) => run('driver', () => api.users.linkDriver(user.id, e.target.value || null))}
              className="text-[12px] px-2 py-1.5 rounded-lg border border-slate-200 max-w-[10rem]"
            >
              <option value="">Fără profil de șofer</option>
              {user.driver_id && <option value={user.driver_id}>{user.driver_name}</option>}
              {(drivers || []).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}

          {actions.canResend && (
            <button
              type="button" disabled={busy === 'resend'}
              onClick={() => run('resend', () => api.users.resendInvite(user.id), (res) => {
                if (res.invite_link) onLink(res.invite_link);
                else notifySuccess('Invitație retrimisă', `Email trimis către ${user.email}.`);
              })}
              className="text-[12px] px-2 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              Retrimite invitația
            </button>
          )}

          {actions.canDeactivate && (
            <button
              type="button" disabled={busy === 'active'}
              onClick={() => run('active', () => api.users.setActive(user.id, false), (res) => {
                notifySuccess('Cont dezactivat', deactivationNotice(res));
              })}
              className="text-[12px] px-2 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-40"
            >
              Dezactivează
            </button>
          )}

          {actions.canActivate && (
            <button
              type="button" disabled={busy === 'active'}
              onClick={() => run('active', () => api.users.setActive(user.id, true))}
              className="text-[12px] px-2 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
            >
              Reactivează
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * The people list, used as its own page on Transitix full, and as a Setări tab on companion.
 * `embedded` drops the page chrome when the parent already provides a title.
 */
export function UsersPanel({ embedded = false } = {}) {
  const { user: me } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState('');
  const [link, setLink] = useState(null);
  const [temporary, setTemporary] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.users.list());
    } catch (err) {
      notifyError('Lista de utilizatori nu a putut fi încărcată', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(
    () => sortUsers(filterUsers(data?.users, term)),
    [data, term]
  );

  return (
    <div className={embedded ? 'space-y-4' : 'p-4 md:p-6 space-y-4 max-w-5xl'}>
      {!embedded && (
        <header className="flex flex-wrap items-center gap-3">
          <UsersIcon className="w-6 h-6 text-[#1D4E89]" />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-[#0A2B4E]">Utilizatori</h1>
            <p className="text-[12px] text-slate-500">
              Invitații, conturi manuale, roluri și acces. O parolă setată de administrator e doar
              temporară; conturile se dezactivează, nu se șterg.
            </p>
          </div>
          <button
            type="button" onClick={load} disabled={loading}
            className="text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-white inline-flex items-center gap-2 disabled:opacity-40"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Reîncarcă
          </button>
        </header>
      )}

      {embedded && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-500">
            Invitații, roluri și acces. Conturile se dezactivează, nu se șterg.
          </p>
          <button
            type="button" onClick={load} disabled={loading}
            className="text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-white inline-flex items-center gap-2 disabled:opacity-40"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Reîncarcă
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-3">
        <label className="relative flex-1 min-w-[14rem]">
          <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={term} onChange={(e) => setTerm(e.target.value)}
            placeholder="Caută după nume, email sau rol"
            className="w-full text-sm pl-8 pr-2 py-2 rounded-lg border border-slate-200"
          />
        </label>
        <AddPersonForm
          roles={data?.roles}
          adminEmail={me?.email}
          emailConfigured={data?.email_configured !== false}
          onAdded={load}
          onLink={setLink}
          onTemporary={setTemporary}
        />
      </div>

      {data && data.email_configured === false && (
        <p className="text-[12px] text-amber-800 bg-amber-50 rounded-xl border border-amber-200 px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          Emailul nu este configurat pe server (RESEND_API_KEY / EMAIL_FROM). Invitațiile și resetările de
          parolă nu pleacă automat: linkul îți apare aici și îl trimiți tu.
        </p>
      )}

      {link && <InviteLink link={link} onDone={() => setLink(null)} />}
      {temporary && (
        <TemporaryPassword
          email={temporary.email}
          password={temporary.password}
          onDone={() => setTemporary(null)}
        />
      )}

      {data && data.admin_count === 1 && (
        <p className="text-[12px] text-slate-500 bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          Există un singur administrator activ. Cât timp e singurul, nu poate fi retrogradat sau
          dezactivat, altfel firma ar rămâne fără acces la utilizatori, tarife și jurnal.
        </p>
      )}

      {loading && !data ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Se încarcă…
        </div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-500 bg-white rounded-xl border border-slate-200 px-4 py-10 text-center">
          Niciun utilizator pentru căutarea asta.
        </p>
      ) : (
        <ul className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {shown.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              roles={data.roles}
              drivers={data.unlinked_drivers}
              adminCount={data.admin_count}
              currentUserId={me?.id}
              onChanged={load}
              onLink={setLink}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Users() {
  return <UsersPanel />;
}
