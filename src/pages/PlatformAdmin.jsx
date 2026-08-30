import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { Building2, FileStack, Loader2, LogIn, Shield, Truck } from 'lucide-react';
import { friendlyErrorMessage, notifyError, notifySuccess } from '@/lib/notify';
import { APP_PROFILES, normalizeFlags, profileLabel } from '@/lib/platformFlags';
import { homePathForRole, postLoginPath } from '@/lib/roles';

/**
 * Platform home — the two product apps as companies, with links into setup.
 */
export default function PlatformAdmin() {
  const [loading, setLoading] = useState(true);
  const [ensuring, setEnsuring] = useState(false);
  const [enteringId, setEnteringId] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');

  const load = async ({ ensure = false } = {}) => {
    setLoading(true);
    setError('');
    try {
      const data = ensure
        ? await api.platform.ensureApps()
        : await api.platform.companies({ ensureApps: true });
      setItems(data.items || []);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const refreshApps = async () => {
    setEnsuring(true);
    try {
      await load({ ensure: true });
      notifySuccess('Aplicații sincronizate', 'TMS full + companion documente sunt în listă.');
    } catch (err) {
      notifyError('Sincronizare eșuată', friendlyErrorMessage(err));
    } finally {
      setEnsuring(false);
    }
  };

  const enterCompany = async (c) => {
    setEnteringId(c.id);
    try {
      const data = await api.platform.impersonate(c.id);
      const flags = normalizeFlags(c.feature_flags);
      const fakeUser = {
        role: data.as_user?.role || 'admin',
        company: {
          slug: data.company?.slug || c.slug,
          feature_flags: flags,
        },
      };
      window.location.href = postLoginPath(fakeUser, homePathForRole(fakeUser));
    } catch (err) {
      notifyError('Nu pot intra în firmă', friendlyErrorMessage(err));
      setEnteringId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#1D4E89] flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            Platformă Transitix
          </p>
          <h1 className="text-2xl font-bold text-[#0A2B4E] mt-1">Aplicații & companii</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-xl">
            Fiecare firmă are slug public pe același host (ex. /txdemo7k2m). Intră prin impersonare admin — fără switch între porturi.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshApps}
          disabled={ensuring}
          className="text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-60"
        >
          {ensuring ? 'Sincronizez…' : 'Sincronizează cele 2 app-uri'}
        </button>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Se încarcă…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
          <Building2 className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          Nicio companie. Apasă „Sincronizează cele 2 app-uri”.
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((c) => {
            const flags = normalizeFlags(c.feature_flags);
            const meta = APP_PROFILES[flags.app_profile] || APP_PROFILES.full;
            const Icon = flags.app_profile === 'documents' ? FileStack : Truck;
            return (
              <li key={c.id} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5 flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#0A2B4E]/10 text-[#0A2B4E] flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {profileLabel(flags)}
                    </p>
                    <h2 className="font-semibold text-[#0A2B4E] truncate">{c.name}</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {[c.slug ? `/${c.slug}` : null, c.cui, `${c.active_users ?? 0} useri`].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{meta.description}</p>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Link
                    to={`/platform/companies/${c.id}`}
                    className="text-xs px-3 py-2 rounded-lg bg-[#0A2B4E] text-white hover:bg-[#1D4E89]"
                  >
                    Setup firmă
                  </Link>
                  <button
                    type="button"
                    onClick={() => enterCompany(c)}
                    disabled={!c.slug || enteringId === c.id}
                    className="text-xs px-3 py-2 rounded-lg border border-slate-200 inline-flex items-center gap-1.5 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {enteringId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogIn className="w-3 h-3" />}
                    Intră în firmă
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
