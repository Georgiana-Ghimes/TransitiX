import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import {
  Building2, Inbox, Loader2, Plus, RefreshCw, Shield, UserCog, Users,
} from 'lucide-react';
import { friendlyErrorMessage, notifyError, notifySuccess } from '@/lib/notify';

/**
 * GOD home — counters + shortcuts. Lists live on dedicated sidebar routes.
 */
export default function PlatformAdmin() {
  const [loading, setLoading] = useState(true);
  const [ensuring, setEnsuring] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState({
    companies: 0, leads_new: 0, users_active: 0, users_invited: 0,
  });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      // Ensure product apps exist (idempotent) before reading counters.
      await api.platform.companies({ ensureApps: true });
      const data = await api.platform.stats();
      setStats({
        companies: data.companies ?? 0,
        leads_new: data.leads_new ?? 0,
        users_active: data.users_active ?? 0,
        users_invited: data.users_invited ?? 0,
      });
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const syncApps = async () => {
    setEnsuring(true);
    try {
      await api.platform.ensureApps();
      await load();
      notifySuccess('Sincronizat', 'TMS Demo + RAI Documente sunt la zi.');
    } catch (err) {
      notifyError('Sincronizare eșuată', friendlyErrorMessage(err));
    } finally {
      setEnsuring(false);
    }
  };

  const cards = [
    {
      key: 'companies',
      label: 'Firme',
      value: stats.companies,
      icon: Building2,
      to: '/platform/companies',
      hint: 'Toate tenant-urile',
    },
    {
      key: 'leads',
      label: 'Lead-uri noi',
      value: stats.leads_new,
      icon: Inbox,
      to: '/platform/leads',
      hint: 'Solicitări acces',
    },
    {
      key: 'users',
      label: 'Useri activi',
      value: stats.users_active,
      icon: Users,
      to: '/platform/users',
      hint: stats.users_invited
        ? `+ ${stats.users_invited} invitați (neactivați)`
        : 'Au făcut cel puțin un login',
    },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-[#1D4E89] flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5" />
          Platformă Transitix
        </p>
        <h1 className="text-2xl font-bold text-[#0A2B4E] mt-1">Panou GOD</h1>
        <p className="text-sm text-slate-500 mt-1 max-w-xl">
          Provisionare firme pe slug public unic. Fără self-signup — lead-uri + invitații.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Se încarcă…
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {cards.map((c) => {
            const Icon = c.icon;
            return (
              <li key={c.key}>
                <Link
                  to={c.to}
                  className="block bg-white rounded-xl border border-slate-200/80 p-4 hover:border-[#0A2B4E]/40 transition-colors h-full"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{c.label}</p>
                    <Icon className="w-4 h-4 text-[#0A2B4E]/70" />
                  </div>
                  <p className="text-3xl font-bold text-[#0A2B4E] mt-2 tabular-nums">{c.value}</p>
                  <p className="text-[11px] text-slate-500 mt-1">{c.hint}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <section className="bg-white rounded-xl border border-slate-200/80 p-5">
        <h2 className="text-sm font-semibold text-[#0A2B4E] mb-3">Shortcut-uri</h2>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/platform/companies?new=1"
            className="text-xs px-3 py-2 rounded-lg bg-[#0A2B4E] text-white hover:bg-[#1D4E89] inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Firmă nouă
          </Link>
          <Link
            to="/platform/leads"
            className="text-xs px-3 py-2 rounded-lg border border-slate-200 inline-flex items-center gap-1.5 hover:bg-slate-50"
          >
            <Inbox className="w-3.5 h-3.5" />
            Solicitări
          </Link>
          <Link
            to="/platform/users"
            className="text-xs px-3 py-2 rounded-lg border border-slate-200 inline-flex items-center gap-1.5 hover:bg-slate-50"
          >
            <UserCog className="w-3.5 h-3.5" />
            Utilizatori
          </Link>
          <button
            type="button"
            onClick={syncApps}
            disabled={ensuring}
            className="text-xs px-3 py-2 rounded-lg border border-slate-200 inline-flex items-center gap-1.5 hover:bg-slate-50 disabled:opacity-60"
          >
            {ensuring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Sync app-uri demo
          </button>
        </div>
      </section>
    </div>
  );
}
