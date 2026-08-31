import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/api/client';
import {
  Building2, Copy, FileStack, Loader2, LogIn, Plus, Truck,
} from 'lucide-react';
import { friendlyErrorMessage, notifyError, notifySuccess } from '@/lib/notify';
import { APP_PROFILES, normalizeFlags, profileLabel } from '@/lib/platformFlags';
import { homePathForRole, postLoginPath } from '@/lib/roles';

/**
 * Platform companies directory + create firm (slug auto-allocated).
 */
export default function PlatformCompanies() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [enteringId, setEnteringId] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState('');
  const [createForm, setCreateForm] = useState({
    name: '',
    app_profile: 'full',
    admin_name: '',
    admin_email: '',
    lead_id: '',
  });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.platform.companies({ ensureApps: true });
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

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowCreate(true);
      setSearchParams({}, { replace: true });
    }
    const leadId = searchParams.get('lead');
    if (leadId) {
      api.platform.leads()
        .then((data) => {
          const lead = (data.items || []).find((l) => l.id === leadId);
          if (!lead) return;
          setCreateForm({
            name: lead.company_name || '',
            app_profile: lead.preferred_profile === 'documents' ? 'documents' : 'full',
            admin_name: lead.contact_name || '',
            admin_email: lead.email || '',
            lead_id: lead.id,
          });
          setShowCreate(true);
          setSearchParams({}, { replace: true });
        })
        .catch(() => {});
    }
  }, [searchParams, setSearchParams]);

  const enterCompany = async (c) => {
    setEnteringId(c.id);
    try {
      const data = await api.platform.impersonate(c.id, {
        returnTo: '/platform/companies',
      });
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

  const createCompany = async (e) => {
    e.preventDefault();
    setCreating(true);
    setLastInviteLink('');
    try {
      const body = {
        name: createForm.name,
        app_profile: createForm.app_profile,
        admin_name: createForm.admin_name,
        admin_email: createForm.admin_email,
      };
      if (createForm.lead_id) body.lead_id = createForm.lead_id;
      const data = await api.platform.createCompany(body);
      if (data.invite_link) setLastInviteLink(data.invite_link);
      notifySuccess(
        'Firmă creată',
        data.company?.slug
          ? `Slug public /${data.company.slug}`
          : (data.email_sent ? 'Invitație trimisă.' : 'Copiază linkul de invitație.'),
      );
      setShowCreate(false);
      setCreateForm({
        name: '', app_profile: 'full', admin_name: '', admin_email: '', lead_id: '',
      });
      await load();
      if (data.company?.id) {
        navigate(`/platform/companies/${data.company.id}`);
      }
    } catch (err) {
      notifyError('Creare eșuată', friendlyErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async (link) => {
    try {
      await navigator.clipboard.writeText(link);
      notifySuccess('Copiat', 'Link invitație în clipboard');
    } catch {
      notifyError('Nu am putut copia', link);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E]">Companii</h1>
          <p className="text-sm text-slate-500 mt-1">
            Fiecare firmă primește automat un slug public unic (alfanumeric, 10 caractere).
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreateForm({
              name: '', app_profile: 'full', admin_name: '', admin_email: '', lead_id: '',
            });
            setLastInviteLink('');
            setShowCreate(true);
          }}
          className="text-xs px-3 py-2 rounded-lg bg-[#0A2B4E] text-white hover:bg-[#1D4E89] inline-flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          Firmă nouă
        </button>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm px-4 py-3">{error}</div>
      )}

      {lastInviteLink && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm flex flex-wrap items-center gap-2">
          <span className="text-amber-900">Link invitație admin:</span>
          <code className="text-[11px] bg-white px-1.5 py-0.5 rounded break-all flex-1 min-w-0">{lastInviteLink}</code>
          <button
            type="button"
            onClick={() => copyLink(lastInviteLink)}
            className="text-xs px-2 py-1 rounded border border-amber-300 inline-flex items-center gap-1"
          >
            <Copy className="w-3 h-3" /> Copiază
          </button>
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={createCompany}
          className="bg-white rounded-xl border border-slate-200 p-5 space-y-3 shadow-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-[#0A2B4E]">Firmă nouă + admin</h2>
            <button type="button" onClick={() => setShowCreate(false)} className="text-xs text-slate-500 hover:underline">
              Anulează
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Slug-ul public se generează automat la salvare (nu e numele firmei). Poți să-l schimbi ulterior din Setup firmă.
          </p>
          {createForm.lead_id ? (
            <p className="text-[11px] text-slate-500">Din lead · va fi marcat convertit la salvare.</p>
          ) : null}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-slate-600 sm:col-span-2">
              Nume firmă
              <input
                required
                minLength={2}
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
              />
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Profil
              <select
                value={createForm.app_profile}
                onChange={(e) => setCreateForm((f) => ({ ...f, app_profile: e.target.value }))}
                className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
              >
                {Object.values(APP_PROFILES).map((p) => (
                  <option key={p.key} value={p.key}>{p.shortLabel}</option>
                ))}
              </select>
            </label>
            <div />
            <label className="block text-xs font-medium text-slate-600">
              Nume admin
              <input
                required
                minLength={2}
                value={createForm.admin_name}
                onChange={(e) => setCreateForm((f) => ({ ...f, admin_name: e.target.value }))}
                className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
              />
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Email admin
              <input
                required
                type="email"
                value={createForm.admin_email}
                onChange={(e) => setCreateForm((f) => ({ ...f, admin_email: e.target.value }))}
                className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="text-sm px-4 py-2 rounded-lg bg-[#0A2B4E] text-white hover:bg-[#1D4E89] disabled:opacity-60 inline-flex items-center gap-2"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Creează firma
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Se încarcă…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
          <Building2 className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          Nicio companie. Apasă „Firmă nouă” sau Sync de pe Acasă.
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
                      {[
                        c.slug ? `/${c.slug}` : null,
                        c.cui,
                        `${c.active_users ?? 0} activi`,
                        (c.invited_users ?? 0) > 0 ? `${c.invited_users} invitați` : null,
                      ].filter(Boolean).join(' · ')}
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
