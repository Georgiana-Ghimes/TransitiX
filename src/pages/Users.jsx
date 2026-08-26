/**
 * Administering the people who use the system.
 *
 * This existed only as SQL until now, which meant three things at once: only whoever had database
 * access could add a colleague, nobody could see who held which role, and an admin ended up
 * choosing somebody else's password. The screen removes all three — an invitation carries a link,
 * the person picks their own password, and every change lands on the audit trail.
 *
 * The buttons offered come from `actionsFor`, not from guesswork in the markup, so what an admin
 * can click matches what the server will accept.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, Copy, Loader2, Mail, RefreshCw, Search, ShieldCheck, UserPlus, Users as UsersIcon,
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
        Emailul nu e configurat — trimite tu linkul de invitație.
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

function InviteForm({ roles, onInvited, onLink }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'dispatcher', phone: '' });
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.users.invite(form);
      notifySuccess(
        'Invitație creată',
        res.email_sent ? `Email trimis către ${form.email}.` : 'Emailul nu e configurat — copiază linkul.'
      );
      if (res.invite_link) onLink(res.invite_link);
      setForm({ name: '', email: '', role: 'dispatcher', phone: '' });
      setOpen(false);
      onInvited();
    } catch (err) {
      notifyError(err.message || 'Invitația nu a putut fi trimisă');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm px-3 py-2 rounded-lg bg-[#1D4E89] text-white inline-flex items-center gap-2"
      >
        <UserPlus className="w-4 h-4" /> Invită coleg
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 w-full">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input
          required value={form.name} onChange={set('name')} placeholder="Nume complet"
          className="text-sm px-2 py-2 rounded-lg border border-slate-200"
        />
        <input
          required type="email" value={form.email} onChange={set('email')} placeholder="Email"
          className="text-sm px-2 py-2 rounded-lg border border-slate-200"
        />
        <input
          value={form.phone} onChange={set('phone')} placeholder="Telefon (opțional)"
          className="text-sm px-2 py-2 rounded-lg border border-slate-200"
        />
        <select value={form.role} onChange={set('role')} className="text-sm px-2 py-2 rounded-lg border border-slate-200">
          {Object.entries(roles || {}).map(([role, meta]) => (
            <option key={role} value={role}>{meta.label}</option>
          ))}
        </select>
      </div>
      <p className="text-[12px] text-slate-500">{roles?.[form.role]?.description}</p>
      <div className="flex gap-2">
        <button
          type="submit" disabled={busy}
          className="text-sm px-3 py-2 rounded-lg bg-[#1D4E89] text-white inline-flex items-center gap-2 disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
          Trimite invitația
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm px-3 py-2 text-slate-500">
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
      notifyError(err.message || 'Acțiunea nu a reușit');
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
          <p className="text-[12px] text-slate-500 truncate">
            {user.email}
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

export default function Users() {
  const { user: me } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState('');
  const [link, setLink] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.users.list());
    } catch (err) {
      notifyError(err.message || 'Lista de utilizatori nu a putut fi încărcată');
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
    <div className="p-4 md:p-6 space-y-4 max-w-5xl">
      <header className="flex flex-wrap items-center gap-3">
        <UsersIcon className="w-6 h-6 text-[#1D4E89]" />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-[#0A2B4E]">Utilizatori</h1>
          <p className="text-[12px] text-slate-500">
            Invitații, roluri și acces. Nimeni nu alege parola altcuiva; conturile se dezactivează,
            nu se șterg.
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

      <div className="flex flex-wrap items-start gap-3">
        <label className="relative flex-1 min-w-[14rem]">
          <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={term} onChange={(e) => setTerm(e.target.value)}
            placeholder="Caută după nume, email sau rol"
            className="w-full text-sm pl-8 pr-2 py-2 rounded-lg border border-slate-200"
          />
        </label>
        <InviteForm roles={data?.roles} onInvited={load} onLink={setLink} />
      </div>

      {link && <InviteLink link={link} onDone={() => setLink(null)} />}

      {data && data.admin_count === 1 && (
        <p className="text-[12px] text-slate-500 bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          Există un singur administrator activ. Cât timp e singurul, nu poate fi retrogradat sau
          dezactivat — altfel firma ar rămâne fără acces la utilizatori, tarife și jurnal.
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
