import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import {
  Ban, Building2, Copy, KeyRound, Loader2, RefreshCw, Search, Users,
} from 'lucide-react';
import { friendlyErrorMessage, notifyError, notifySuccess } from '@/lib/notify';

function statusMeta(u) {
  if (!u.is_active) {
    return { label: 'blocat', className: 'bg-red-50 text-red-800' };
  }
  if (u.state === 'invited') {
    return { label: 'invitat', className: 'bg-amber-50 text-amber-900' };
  }
  if (u.state === 'expired') {
    return { label: 'expirat', className: 'bg-slate-100 text-slate-600' };
  }
  return { label: 'activ', className: 'bg-emerald-50 text-emerald-800' };
}

/**
 * Cross-tenant user directory for platform GOD — grouped by company.
 */
export default function PlatformUsers() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [lastLink, setLastLink] = useState('');

  const load = async ({ query = q, company = companyId } = {}) => {
    setLoading(true);
    setError('');
    try {
      const [usersData, companiesData] = await Promise.all([
        api.platform.users({
          q: query || undefined,
          companyId: company || undefined,
        }),
        companies.length
          ? Promise.resolve({ items: companies })
          : api.platform.companies(),
      ]);
      setItems(usersData.items || []);
      if (!companies.length) setCompanies(companiesData.items || []);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load({ query: '', company: '' });
  }, []);

  const groups = useMemo(() => {
    const map = new Map();
    for (const u of items) {
      const key = u.company?.id || 'unknown';
      if (!map.has(key)) {
        map.set(key, {
          company: u.company || { id: key, name: 'Fără firmă', slug: null },
          users: [],
        });
      }
      map.get(key).users.push(u);
    }
    return Array.from(map.values());
  }, [items]);

  const onSearch = (e) => {
    e.preventDefault();
    setQ(draft);
    load({ query: draft, company: companyId });
  };

  const copyLink = async (link) => {
    try {
      await navigator.clipboard.writeText(link);
      notifySuccess('Copiat', 'Link în clipboard');
    } catch {
      notifyError('Nu am putut copia', link);
    }
  };

  const toggleBlock = async (u) => {
    setBusyId(u.id);
    try {
      const data = await api.platform.setUserActive(u.id, !u.is_active);
      notifySuccess(
        data.user?.is_active ? 'Cont reactivat' : 'Cont blocat',
        u.email,
      );
      await load();
    } catch (err) {
      notifyError('Acțiune eșuată', friendlyErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const resetPassword = async (u) => {
    setBusyId(u.id);
    setLastLink('');
    try {
      const data = await api.platform.resetUserPassword(u.id);
      if (data.invite_link) {
        setLastLink(data.invite_link);
        notifySuccess('Link reset generat', 'Copiază linkul (email stub — fără Resend).');
      } else {
        notifySuccess('Reset trimis', 'Emailul de reset a fost trimis.');
      }
      await load();
    } catch (err) {
      notifyError('Reset eșuat', friendlyErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E]">Utilizatori</h1>
          <p className="text-sm text-slate-500 mt-1">
            Conturi pe firme (grupate). Blochează / reactivează / generează link de reset parolă.
          </p>
        </div>
        <form onSubmit={onSearch} className="flex flex-wrap gap-2 w-full lg:w-auto">
          <select
            value={companyId}
            onChange={(e) => {
              const next = e.target.value;
              setCompanyId(next);
              load({ query: draft || q, company: next });
            }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 max-w-full sm:max-w-[14rem]"
          >
            <option value="">Toate firmele</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.slug ? ` (/${c.slug})` : ''}
              </option>
            ))}
          </select>
          <div className="relative flex-1 sm:w-56 min-w-[12rem]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Caută nume, email, firmă…"
              className="w-full text-sm border border-slate-200 rounded-lg pl-8 pr-3 py-2"
            />
          </div>
          <button
            type="submit"
            className="text-xs px-3 py-2 rounded-lg bg-[#0A2B4E] text-white shrink-0"
          >
            Caută
          </button>
        </form>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm px-4 py-3">{error}</div>
      )}

      {lastLink && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm flex flex-wrap items-center gap-2">
          <span className="text-amber-900 shrink-0">Link reset / invitație:</span>
          <code className="text-[11px] bg-white px-1.5 py-0.5 rounded break-all flex-1 min-w-0">{lastLink}</code>
          <button
            type="button"
            onClick={() => copyLink(lastLink)}
            className="text-xs px-2 py-1 rounded border border-amber-300 inline-flex items-center gap-1"
          >
            <Copy className="w-3 h-3" /> Copiază
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
          <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          Niciun utilizator{q || companyId ? ' pentru filtrul ăsta' : ''}.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section
              key={g.company.id}
              className="bg-white rounded-xl border border-slate-200/80 overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-4 h-4 text-[#0A2B4E] shrink-0" />
                  <div className="min-w-0">
                    <Link
                      to={`/platform/companies/${g.company.id}`}
                      className="font-semibold text-[#0A2B4E] hover:underline truncate block"
                    >
                      {g.company.name}
                    </Link>
                    <p className="text-[11px] text-slate-500 font-mono">
                      {g.company.slug ? `/${g.company.slug}` : '—'}
                      {g.company.app_profile === 'documents' ? ' · companion' : ' · TMS'}
                      {' · '}{g.users.length} conturi
                    </p>
                  </div>
                </div>
                <Link
                  to={`/platform/companies/${g.company.id}?tab=users`}
                  className="text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-white"
                >
                  Setup firmă → Utilizatori
                </Link>
              </div>

              <ul className="divide-y divide-slate-100">
                {g.users.map((u) => {
                  const st = statusMeta(u);
                  const busy = busyId === u.id;
                  return (
                    <li
                      key={u.id}
                      className="px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{u.name}</p>
                        <p className="text-xs text-slate-500">
                          {u.email} · {u.role}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${st.className}`}>
                          {st.label}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => resetPassword(u)}
                          className="text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-200 inline-flex items-center gap-1 hover:bg-slate-50 disabled:opacity-50"
                          title={u.state === 'invited' ? 'Regenerează link invitație' : 'Reset parolă'}
                        >
                          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : (u.state === 'invited' ? <RefreshCw className="w-3 h-3" /> : <KeyRound className="w-3 h-3" />)}
                          {u.state === 'invited' ? 'Re-invite' : 'Reset parolă'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => toggleBlock(u)}
                          className={`text-[11px] px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1 disabled:opacity-50 ${
                            u.is_active
                              ? 'border-red-200 text-red-800 hover:bg-red-50'
                              : 'border-emerald-200 text-emerald-800 hover:bg-emerald-50'
                          }`}
                        >
                          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                          {u.is_active ? 'Blochează' : 'Reactivează'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
