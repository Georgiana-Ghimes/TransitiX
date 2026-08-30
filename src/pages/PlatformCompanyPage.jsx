import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/api/client';
import {
  ArrowLeft, Loader2, Settings2, ToggleLeft, Building2, LogIn,
} from 'lucide-react';
import { friendlyErrorMessage, notifyError, notifySuccess } from '@/lib/notify';
import { APP_PROFILES, MODULE_FLAGS, normalizeFlags } from '@/lib/platformFlags';
import { demoAccountsForAppKey } from '@/lib/demoTenantAccounts';
import { homePathForRole, postLoginPath } from '@/lib/roles';

const TABS = [
  { id: 'overview', label: 'Prezentare', icon: Building2 },
  { id: 'modules', label: 'Module', icon: ToggleLeft },
  { id: 'access', label: 'Acces portal', icon: Settings2 },
];

export default function PlatformCompanyPage() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState('');
  const [company, setCompany] = useState(null);
  const [tab, setTab] = useState('overview');
  const [form, setForm] = useState({ name: '', cui: '', email: '', phone: '', address: '' });
  const [flags, setFlags] = useState(() => normalizeFlags({}));

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const row = await api.platform.company(id);
      setCompany(row);
      setForm({
        name: row.name || '',
        cui: row.cui || '',
        email: row.email || '',
        phone: row.phone || '',
        address: row.address || '',
      });
      setFlags(normalizeFlags(row.feature_flags));
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  const modulesForProfile = useMemo(() => MODULE_FLAGS, []);

  const enterCompany = async () => {
    setEntering(true);
    try {
      const data = await api.platform.impersonate(id);
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
    setSaving(true);
    try {
      const updated = await api.platform.patchCompany(id, {
        ...form,
        feature_flags: flags,
      });
      setCompany(updated);
      setFlags(normalizeFlags(updated.feature_flags));
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
            {APP_PROFILES[flags.app_profile]?.label || 'App'} · {company.active_users ?? 0} useri activi
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
            disabled={saving}
            className="text-xs px-3 py-2 rounded-lg bg-[#0A2B4E] text-white hover:bg-[#1D4E89] disabled:opacity-60"
          >
            {saving ? 'Salvez…' : 'Salvează'}
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm inline-flex items-center gap-1.5 border-b-2 -mb-px ${
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

      {tab === 'access' && (
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
            <p className="text-xs font-medium text-slate-600">Cale publică (același host)</p>
            <p className="font-mono text-sm text-[#0A2B4E]">{publicPath || '— lipsește slug'}</p>
            <p className="text-[11px] text-slate-500">
              Exemplu: <code className="bg-white px-1 rounded">http://72.22.116.17:5174{publicPath || '/slug'}/avize</code>
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
