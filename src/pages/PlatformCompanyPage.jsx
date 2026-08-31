import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/api/client';
import {
  ArrowLeft, Ban, Copy, KeyRound, Loader2, Settings2, ToggleLeft, Building2, LogIn, RefreshCw, Users,
} from 'lucide-react';
import { friendlyErrorMessage, notifyError, notifySuccess } from '@/lib/notify';
import { APP_PROFILES, MODULE_FLAGS, normalizeFlags } from '@/lib/platformFlags';
import { demoAccountsForAppKey } from '@/lib/demoTenantAccounts';
import { homePathForRole, postLoginPath } from '@/lib/roles';

const TABS = [
  { id: 'overview', label: 'Prezentare', icon: Building2 },
  { id: 'modules', label: 'Module', icon: ToggleLeft },
  { id: 'users', label: 'Utilizatori', icon: Users },
  { id: 'access', label: 'Acces portal', icon: Settings2 },
];

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'dispatcher', label: 'Dispecer' },
  { value: 'finance', label: 'Financiar' },
  { value: 'driver', label: 'Șofer' },
];

function tabFromSearch(params) {
  const t = params.get('tab');
  return TABS.some((x) => x.id === t) ? t : 'overview';
}

export default function PlatformCompanyPage() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState('');
  const [company, setCompany] = useState(null);
  const [tab, setTab] = useState(() => tabFromSearch(searchParams));
  const [form, setForm] = useState({ name: '', cui: '', email: '', phone: '', address: '', slug: '' });
  const [flags, setFlags] = useState(() => normalizeFlags({}));
  const [baseline, setBaseline] = useState(null);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'admin', phone: '' });
  const [inviteLink, setInviteLink] = useState('');
  const [userBusyId, setUserBusyId] = useState(null);

  const selectTab = (next) => {
    setTab(next);
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'overview') nextParams.delete('tab');
    else nextParams.set('tab', next);
    setSearchParams(nextParams, { replace: true });
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const row = await api.platform.company(id);
      setCompany(row);
      const nextForm = {
        name: row.name || '',
        cui: row.cui || '',
        email: row.email || '',
        phone: row.phone || '',
        address: row.address || '',
        slug: row.slug || '',
      };
      const nextFlags = normalizeFlags(row.feature_flags);
      setForm(nextForm);
      setFlags(nextFlags);
      setBaseline({
        form: nextForm,
        flags: JSON.stringify(nextFlags),
      });
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    setUsersLoading(true);
    try {
      const data = await api.platform.companyUsers(id);
      setUsers(data.items || []);
    } catch (err) {
      notifyError('Utilizatori', friendlyErrorMessage(err));
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    setTab(tabFromSearch(searchParams));
  }, [searchParams]);

  useEffect(() => {
    if (tab === 'users') loadUsers();
  }, [tab, id]);

  const modulesForProfile = useMemo(() => MODULE_FLAGS, []);

  const dirty = useMemo(() => {
    if (!baseline) return false;
    const formDirty = ['name', 'cui', 'email', 'phone', 'address', 'slug'].some(
      (k) => String(form[k] || '') !== String(baseline.form[k] || ''),
    );
    const flagsDirty = JSON.stringify(flags) !== baseline.flags;
    return formDirty || flagsDirty;
  }, [baseline, form, flags]);

  const enterCompany = async () => {
    setEntering(true);
    try {
      const returnTo = `/platform/companies/${id}${tab !== 'overview' ? `?tab=${tab}` : ''}`;
      const data = await api.platform.impersonate(id, { returnTo });
      const slug = data.company?.slug || company?.slug;
      const fakeUser = {
        role: data.as_user?.role || 'admin',
        company: {
          slug,
          feature_flags: flags,
        },
      };
      window.location.href = postLoginPath(fakeUser, homePathForRole(fakeUser));
    } catch (err) {
      notifyError('Nu pot intra în firmă', friendlyErrorMessage(err));
      setEntering(false);
    }
  };

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        cui: form.cui,
        email: form.email,
        phone: form.phone,
        address: form.address,
        feature_flags: flags,
      };
      if (form.slug !== baseline?.form?.slug) {
        payload.slug = form.slug;
      }
      const updated = await api.platform.patchCompany(id, payload);
      setCompany(updated);
      const nextForm = {
        name: updated.name || '',
        cui: updated.cui || '',
        email: updated.email || '',
        phone: updated.phone || '',
        address: updated.address || '',
        slug: updated.slug || '',
      };
      const nextFlags = normalizeFlags(updated.feature_flags);
      setForm(nextForm);
      setFlags(nextFlags);
      setBaseline({ form: nextForm, flags: JSON.stringify(nextFlags) });
      notifySuccess('Salvat', updated.name);
    } catch (err) {
      notifyError('Salvare eșuată', friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const setProfile = (profileKey) => {
    const meta = APP_PROFILES[profileKey];
    setFlags((prev) => normalizeFlags({
      ...prev,
      app_profile: profileKey,
      app_key: meta.appKey,
      portal_url: prev.portal_url || meta.defaultPortalUrl,
    }, profileKey));
  };

  const saveModulesNow = async (nextFlags) => {
    setSaving(true);
    try {
      const updated = await api.platform.patchCompany(id, {
        feature_flags: nextFlags,
      });
      setCompany(updated);
      setFlags(normalizeFlags(updated.feature_flags));
      notifySuccess('Module salvate', 'Scrise pe companies.feature_flags');
    } catch (err) {
      notifyError('Salvare eșuată', friendlyErrorMessage(err));
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggleModuleAndSave = (key) => {
    setFlags((prev) => {
      const next = {
        ...prev,
        modules: { ...prev.modules, [key]: !prev.modules[key] },
      };
      void saveModulesNow(next);
      return next;
    });
  };

  const inviteUser = async (e) => {
    e.preventDefault();
    setInviting(true);
    setInviteLink('');
    try {
      const data = await api.platform.inviteCompanyUser(id, inviteForm);
      if (data.invite_link) setInviteLink(data.invite_link);
      notifySuccess(
        'Invitație creată',
        data.email_sent ? 'Email trimis.' : 'Copiază linkul (fără Resend).',
      );
      setInviteForm({ name: '', email: '', role: 'admin', phone: '' });
      await loadUsers();
      await load();
    } catch (err) {
      notifyError('Invitație eșuată', friendlyErrorMessage(err));
    } finally {
      setInviting(false);
    }
  };

  const copyLink = async (link) => {
    try {
      await navigator.clipboard.writeText(link);
      notifySuccess('Copiat', 'Link în clipboard');
    } catch {
      notifyError('Nu am putut copia', link);
    }
  };

  const toggleUserBlock = async (u) => {
    setUserBusyId(u.id);
    try {
      await api.platform.setUserActive(u.id, !u.is_active);
      notifySuccess(u.is_active ? 'Cont blocat' : 'Cont reactivat', u.email);
      await loadUsers();
      await load();
    } catch (err) {
      notifyError('Acțiune eșuată', friendlyErrorMessage(err));
    } finally {
      setUserBusyId(null);
    }
  };

  const resetUserPassword = async (u) => {
    setUserBusyId(u.id);
    try {
      const data = await api.platform.resetUserPassword(u.id);
      if (data.invite_link) {
        setInviteLink(data.invite_link);
        notifySuccess('Link generat', 'Copiază linkul de mai jos (stub email).');
      } else {
        notifySuccess('Email trimis', u.email);
      }
      await loadUsers();
    } catch (err) {
      notifyError('Reset eșuat', friendlyErrorMessage(err));
    } finally {
      setUserBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm py-16 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        Se încarcă firma…
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center space-y-3">
        <p className="text-sm text-red-700">{error || 'Firma nu a fost găsită'}</p>
        <Link to="/platform" className="text-sm text-[#1D4E89] hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Înapoi
        </Link>
      </div>
    );
  }

  const publicPath = company.slug ? `/${company.slug}` : (flags.portal_url || '');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/platform" className="text-xs text-[#1D4E89] hover:underline inline-flex items-center gap-1 mb-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Toate aplicațiile
          </Link>
          <h1 className="text-2xl font-bold text-[#0A2B4E]">{company.name}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {APP_PROFILES[flags.app_profile]?.label || 'App'}
            {' · '}{company.active_users ?? 0} activi
            {(company.invited_users ?? 0) > 0 ? ` · ${company.invited_users} invitați` : ''}
            {company.slug ? (
              <> · <code className="text-[11px] bg-slate-100 px-1 rounded">/{company.slug}</code></>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={enterCompany}
            disabled={entering || !company.slug}
            className="text-xs px-3 py-2 rounded-lg border border-[#0A2B4E] text-[#0A2B4E] inline-flex items-center gap-1.5 hover:bg-[#0A2B4E]/5 disabled:opacity-60"
          >
            {entering ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogIn className="w-3 h-3" />}
            Intră în firmă
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="text-xs px-3 py-2 rounded-lg bg-[#0A2B4E] text-white hover:bg-[#1D4E89] disabled:opacity-60"
          >
            {saving ? 'Salvez…' : dirty ? 'Salvează' : 'Salvat'}
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTab(t.id)}
              className={`px-3 py-2 text-sm inline-flex items-center gap-1.5 border-b-2 -mb-px shrink-0 ${
                active
                  ? 'border-[#0A2B4E] text-[#0A2B4E] font-medium'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && (
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4">
          <div>
            <p className="text-xs font-medium text-slate-600 mb-2">Tip aplicație</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.values(APP_PROFILES).map((p) => {
                const active = flags.app_profile === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setProfile(p.key)}
                    className={`text-left rounded-lg border p-3 transition-colors ${
                      active ? 'border-[#0A2B4E] bg-[#0A2B4E]/5' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <p className="text-sm font-medium text-[#0A2B4E]">{p.shortLabel}</p>
                    <p className="text-xs text-slate-500 mt-1">{p.description}</p>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              ['name', 'Denumire'],
              ['cui', 'CUI'],
              ['email', 'Email'],
              ['phone', 'Telefon'],
            ].map(([key, label]) => (
              <label key={key} className="block text-xs font-medium text-slate-600">
                {label}
                <input
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#1D4E89]"
                />
              </label>
            ))}
            <label className="block text-xs font-medium text-slate-600">
              Slug public (URL)
              <input
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))}
                className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-[#1D4E89]"
                placeholder="8–24 a-z0-9"
                pattern="[a-z0-9]{8,24}"
                title="8–24 caractere alfanumerice"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Path: /{form.slug || '…'} — generat automat la creare; schimbă doar dacă e nevoie.
              </span>
            </label>
            <label className="block text-xs font-medium text-slate-600 sm:col-span-2">
              Adresă
              <input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#1D4E89]"
              />
            </label>
          </div>
        </div>
      )}

      {tab === 'modules' && (
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-2">
          <p className="text-sm text-slate-500 mb-3">
            Catalogul complet TMS. Valorile se scriu pe firmă în Postgres (
            <code className="text-[11px] bg-slate-100 px-1 rounded">companies.feature_flags.modules</code>
            ). Pe tenant, modulele on apar în meniu după refresh / re-login.
          </p>
          {modulesForProfile.map((m) => {
            const on = flags.modules[m.key] !== false;
            const atypical = flags.app_profile === 'documents' && !m.defaultOn.includes('documents') && on;
            return (
            <label
              key={m.key}
              className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-100 cursor-pointer"
            >
              <span className="text-sm text-slate-700">
                {m.label}
                {atypical ? (
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-700">extra</span>
                ) : null}
              </span>
              <input
                type="checkbox"
                checked={on}
                disabled={saving}
                onChange={() => toggleModuleAndSave(m.key)}
                className="w-4 h-4 accent-[#0A2B4E]"
              />
            </label>
            );
          })}
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-4">
          <form
            onSubmit={inviteUser}
            className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-3"
          >
            <h3 className="text-sm font-semibold text-[#0A2B4E]">Invită utilizator</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-slate-600">
                Nume
                <input
                  required
                  minLength={2}
                  value={inviteForm.name}
                  onChange={(e) => setInviteForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Email
                <input
                  required
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                  className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Rol
                <select
                  value={inviteForm.role}
                  onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value }))}
                  className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Telefon (opțional)
                <input
                  value={inviteForm.phone}
                  onChange={(e) => setInviteForm((f) => ({ ...f, phone: e.target.value }))}
                  className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={inviting}
              className="text-sm px-4 py-2 rounded-lg bg-[#0A2B4E] text-white disabled:opacity-60 inline-flex items-center gap-2"
            >
              {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Trimite invitație
            </button>
            {inviteLink ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs flex flex-wrap items-center gap-2">
                <code className="break-all flex-1 min-w-0">{inviteLink}</code>
                <button
                  type="button"
                  onClick={() => copyLink(inviteLink)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-300"
                >
                  <Copy className="w-3 h-3" /> Copiază
                </button>
              </div>
            ) : null}
          </form>

          <div className="bg-white rounded-xl border border-slate-200/80 p-5">
            <h3 className="text-sm font-semibold text-[#0A2B4E] mb-3">Conturi pe firmă</h3>
            {usersLoading ? (
              <div className="flex items-center gap-2 text-slate-500 text-sm py-6 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : users.length === 0 ? (
              <p className="text-sm text-slate-500">Niciun utilizator.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {users.map((u) => {
                  const busy = userBusyId === u.id;
                  const label = !u.is_active
                    ? 'blocat'
                    : (u.state === 'invited' ? 'invitat' : (u.state === 'expired' ? 'expirat' : 'activ'));
                  const badge = !u.is_active
                    ? 'bg-red-50 text-red-800'
                    : u.state === 'invited'
                      ? 'bg-amber-50 text-amber-900'
                      : 'bg-emerald-50 text-emerald-800';
                  return (
                  <li key={u.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-800">{u.name}</p>
                      <p className="text-xs text-slate-500">{u.email} · {u.role}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${badge}`}>
                        {label}
                      </span>
                      <button
                        type="button"
                        disabled={busy || !u.is_active}
                        onClick={() => resetUserPassword(u)}
                        className="text-[11px] px-2 py-1 rounded border border-slate-200 inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : (u.state === 'invited' ? <RefreshCw className="w-3 h-3" /> : <KeyRound className="w-3 h-3" />)}
                        {u.state === 'invited' ? 'Re-invite' : 'Reset'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggleUserBlock(u)}
                        className={`text-[11px] px-2 py-1 rounded border inline-flex items-center gap-1 disabled:opacity-50 ${
                          u.is_active ? 'border-red-200 text-red-800' : 'border-emerald-200 text-emerald-800'
                        }`}
                      >
                        <Ban className="w-3 h-3" />
                        {u.is_active ? 'Blochează' : 'Reactivează'}
                      </button>
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === 'access' && (
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
            <p className="text-xs font-medium text-slate-600">Cale publică (același host)</p>
            <p className="font-mono text-sm text-[#0A2B4E]">{publicPath || '— lipsește slug'}</p>
            <p className="text-[11px] text-slate-500">
              Exemplu: <code className="bg-white px-1 rounded">http://127.0.0.1:5173{publicPath || '/slug'}/avize</code>
            </p>
          </div>
          <button
            type="button"
            onClick={enterCompany}
            disabled={entering || !company.slug}
            className="text-sm px-4 py-2 rounded-lg bg-[#0A2B4E] text-white inline-flex items-center gap-2 hover:bg-[#1D4E89] disabled:opacity-60"
          >
            {entering ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            Intră ca admin (impersonare)
          </button>
          <p className="text-xs text-slate-500">
            GOD rămâne pe /platform; „Intră în firmă” preia sesiunea adminului firmei. Bannerul „Ieși din firmă” revine la platformă.
          </p>

          {(() => {
            const demo = demoAccountsForAppKey(flags.app_key);
            if (!demo) return null;
            return (
              <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 space-y-2">
                <p className="text-xs font-semibold text-amber-900">Conturi demo (QA)</p>
                <p className="text-[11px] text-amber-800/90">
                  Login direct pe <code className="bg-amber-100 px-1 rounded">{publicPath || '/…'}</code> — emailuri unice pe platformă.
                </p>
                <ul className="text-xs text-amber-950 space-y-1 font-mono">
                  <li>{demo.admin.label}: {demo.admin.email} / {demo.admin.password}</li>
                  <li>{demo.driver.label}: {demo.driver.email} / {demo.driver.password}</li>
                </ul>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
