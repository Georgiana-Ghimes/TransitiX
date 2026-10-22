import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/api/client';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Loader2, MapPin, Plus, Route as RouteIcon, Search } from 'lucide-react';
import { friendlyErrorMessage, notifyError, notifySuccess } from '@/lib/notify';
import {
  LEARNED_SOURCE_LABEL,
  LEARNED_TRUST_LABEL,
  learnedRoleLabel,
  learnedTrustClass,
  mergePrompt,
  mergedVariantsLabel,
} from '@/lib/platformLearnedUi';

/**
 * GOD: what each company's avize have taught the extractor (#112).
 *
 *   Adrese învățate — Expeditor depots and customer delivery sites, filled in when the street is
 *                     unreadable on a page.
 *   Reguli rută     — whole routes learned from an office correction (routeLearn).
 *
 * Both can be wrong; this is where they are confirmed, corrected or switched off.
 */

const TABS = [
  { key: 'addresses', label: 'Adrese învățate', icon: MapPin },
  { key: 'rules', label: 'Reguli rută', icon: RouteIcon },
];

function formatDay(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ro-RO');
}

const inputCls = 'text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white';
const btnCls = 'text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50';
const primaryCls = 'text-[11px] px-2.5 py-1.5 rounded-lg bg-[#0A2B4E] text-white disabled:opacity-50';

function AddressRow({ item, onPatch, busy }) {
  const [editing, setEditing] = useState(false);
  const [display, setDisplay] = useState(item.display);
  const [postcode, setPostcode] = useState(item.postcode);

  useEffect(() => {
    setDisplay(item.display);
    setPostcode(item.postcode);
  }, [item.display, item.postcode]);

  const save = async () => {
    const body = {};
    if (display.trim() !== item.display) body.display = display.trim();
    if (postcode.trim() !== item.postcode) body.postcode = postcode.trim();
    if (!Object.keys(body).length) { setEditing(false); return; }
    const ok = await onPatch(item, body, 'Adresa a fost corectată');
    if (ok) setEditing(false);
  };

  return (
    <li className="bg-white rounded-xl border border-slate-200/80 px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex flex-wrap gap-2">
              <input
                className={`${inputCls} flex-1 min-w-[16rem]`}
                value={display}
                onChange={(e) => setDisplay(e.target.value)}
                aria-label="Adresa ca în Rută"
              />
              <input
                className={`${inputCls} w-28`}
                value={postcode}
                inputMode="numeric"
                onChange={(e) => setPostcode(e.target.value)}
                aria-label="Cod poștal"
              />
            </div>
          ) : (
            <p className="text-sm font-medium text-[#0A2B4E] break-words">{item.display}</p>
          )}
          <p className="text-xs text-slate-500 mt-1">
            CP {item.postcode}
            {item.locality ? ` · ${item.locality}` : ''}
            {' · '}
            {item.company_name}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            Citită curat pe {item.seen_count} {item.seen_count === 1 ? 'aviz' : 'avize'}
            {' · '}
            folosită de {item.used_count} {item.used_count === 1 ? 'dată' : 'ori'}
            {' · '}
            ultima dată {formatDay(item.last_used_at || item.last_seen_at)}
            {item.source_document_name ? ` · sursă: ${item.source_document_name}` : ''}
            {item.updated_by_email ? ` · modificată de ${item.updated_by_email}` : ''}
          </p>
          {mergedVariantsLabel(item.merged_variants) ? (
            <p className="text-[11px] text-slate-400 mt-1 break-words">{mergedVariantsLabel(item.merged_variants)}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded-full ${
              item.role === 'delivery' ? 'bg-sky-50 text-sky-700' : 'bg-indigo-50 text-indigo-700'
            }`}
          >
            {learnedRoleLabel(item.role)}
          </span>
          <span className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded-full ${learnedTrustClass(item.trust)}`}>
            {LEARNED_TRUST_LABEL[item.trust] || item.trust}
          </span>
          <span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded-full bg-slate-100 text-slate-600">
            {LEARNED_SOURCE_LABEL[item.source] || item.source}
          </span>
          {item.verified ? (
            <span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">
              confirmată
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {editing ? (
          <>
            <button type="button" className={primaryCls} disabled={busy} onClick={save}>Salvează</button>
            <button
              type="button"
              className={btnCls}
              disabled={busy}
              onClick={() => { setEditing(false); setDisplay(item.display); setPostcode(item.postcode); }}
            >
              Anulează
            </button>
          </>
        ) : (
          <>
            {!item.verified && !item.disabled ? (
              <button
                type="button"
                className={primaryCls}
                disabled={busy}
                onClick={() => onPatch(item, { verified: true }, 'Adresa a fost confirmată')}
              >
                Confirmă
              </button>
            ) : null}
            <button type="button" className={btnCls} disabled={busy} onClick={() => setEditing(true)}>
              Editează
            </button>
            {item.disabled ? (
              <button
                type="button"
                className={btnCls}
                disabled={busy}
                onClick={() => onPatch(item, { disabled: false }, 'Adresa a fost reactivată')}
              >
                Reactivează
              </button>
            ) : (
              <button
                type="button"
                className={`${btnCls} text-red-700`}
                disabled={busy}
                onClick={() => onPatch(item, { disabled: true }, 'Adresa a fost dezactivată')}
              >
                Dezactivează
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

function AddAddressForm({ companies, defaultCompanyId, onCreated }) {
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState(defaultCompanyId || '');
  const [role, setRole] = useState('origin');
  const [postcode, setPostcode] = useState('');
  const [display, setDisplay] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (defaultCompanyId) setCompanyId(defaultCompanyId); }, [defaultCompanyId]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.platform.createLearnedAddress({ company_id: companyId, role, postcode, display });
      notifySuccess('Adresă adăugată', display);
      setPostcode('');
      setDisplay('');
      setOpen(false);
      onCreated();
    } catch (err) {
      notifyError('Nu am putut adăuga adresa', friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className={`${btnCls} inline-flex items-center gap-1`} onClick={() => setOpen(true)}>
        <Plus className="w-3.5 h-3.5" /> Adaugă adresă
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200/80 px-4 py-3 space-y-2">
      <p className="text-xs text-slate-500">
        Adresa intră direct ca de încredere. Scrie-o exact cum trebuie să apară în Rută.
      </p>
      <div className="flex flex-wrap gap-2">
        <select className={inputCls} value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>
          <option value="">Alege firma</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Tip adresă">
          <option value="origin">Expeditor</option>
          <option value="delivery">Livrare</option>
        </select>
        <input
          className={`${inputCls} w-28`}
          placeholder="Cod poștal"
          inputMode="numeric"
          value={postcode}
          onChange={(e) => setPostcode(e.target.value)}
          required
        />
        <input
          className={`${inputCls} flex-1 min-w-[16rem]`}
          placeholder={role === 'delivery' ? 'Calea Giulesti nr. 1-3, Bucuresti' : 'Str. Republicii nr. 1F, Bolintin-Deal'}
          value={display}
          onChange={(e) => setDisplay(e.target.value)}
          required
        />
      </div>
      <div className="flex gap-1.5">
        <button type="submit" className={primaryCls} disabled={busy}>Adaugă</button>
        <button type="button" className={btnCls} disabled={busy} onClick={() => setOpen(false)}>Anulează</button>
      </div>
    </form>
  );
}

function RuleRow({ item, onDelete }) {
  const tokens = Array.isArray(item.match_tokens) ? item.match_tokens : [];
  return (
    <li className="bg-white rounded-xl border border-slate-200/80 px-4 py-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[#0A2B4E] break-words">{item.ruta_transport}</p>
        <p className="text-xs text-slate-500 mt-1">
          {item.company_name}
          {' · '}
          aplicată de {item.hits} {item.hits === 1 ? 'dată' : 'ori'}
          {' · '}
          actualizată {formatDay(item.updated_at)}
          {item.source_document_name ? ` · sursă: ${item.source_document_name}` : ''}
        </p>
        {tokens.length ? (
          <div className="flex flex-wrap gap-1 mt-2">
            {tokens.map((t) => (
              <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">{t}</span>
            ))}
          </div>
        ) : null}
      </div>
      <button type="button" className={`${btnCls} text-red-700`} onClick={() => onDelete(item)}>
        Șterge
      </button>
    </li>
  );
}

export default function PlatformLearned() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'rules' ? 'rules' : 'addresses';
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState(searchParams.get('company') || '');
  const [role, setRole] = useState(searchParams.get('role') || '');
  const [state, setState] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [deleting, setDeleting] = useState(null);
  // { source, target } when an edit lands on an address that already exists.
  const [merging, setMerging] = useState(null);

  useEffect(() => {
    api.platform.companies().then((d) => setCompanies(d.items || [])).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = tab === 'rules'
        ? await api.platform.routeRules({ companyId: companyId || undefined })
        : await api.platform.learnedAddresses({
          companyId: companyId || undefined,
          role: role || undefined,
          state: state || undefined,
          q: q.trim() || undefined,
        });
      setItems(data.items || []);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [tab, companyId, role, state, q]);

  const setTab = (key) => {
    const next = new URLSearchParams(searchParams);
    if (key === 'rules') next.set('tab', 'rules'); else next.delete('tab');
    setSearchParams(next, { replace: true });
  };

  const patchAddress = async (item, body, message) => {
    setBusyId(item.id);
    try {
      const updated = await api.platform.patchLearnedAddress(item.id, body);
      setItems((prev) => prev.map((x) => (x.id === item.id ? updated : x)));
      notifySuccess(message, updated.display);
      return true;
    } catch (err) {
      if (err?.status === 409 && err?.data?.code === 'ADDRESS_EXISTS' && err.data.existing) {
        setMerging({ source: item, target: err.data.existing });
        return false;
      }
      notifyError('Modificare eșuată', friendlyErrorMessage(err));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const mergeAddress = async () => {
    if (!merging) return;
    const { source, target } = merging;
    setBusyId(source.id);
    try {
      const res = await api.platform.mergeLearnedAddress(source.id, target.id);
      setItems((prev) => {
        const rest = prev.filter((x) => x.id !== source.id);
        return rest.some((x) => x.id === target.id)
          ? rest.map((x) => (x.id === target.id ? res.address : x))
          : [...rest, res.address];
      });
      notifySuccess('Adrese unite', res.address?.display || target.display);
      setMerging(null);
    } catch (err) {
      notifyError('Unirea a eșuat', friendlyErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const deleteRule = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      await api.platform.deleteRouteRule(deleting.id);
      setItems((prev) => prev.filter((x) => x.id !== deleting.id));
      notifySuccess('Regula a fost ștearsă', deleting.ruta_transport);
      setDeleting(null);
    } catch (err) {
      notifyError('Ștergere eșuată', friendlyErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const counts = useMemo(() => {
    const c = { trusted: 0, candidate: 0, disabled: 0 };
    if (tab === 'addresses') for (const i of items) c[i.trust] = (c[i.trust] || 0) + 1;
    return c;
  }, [items, tab]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-[#0A2B4E]">Date învățate din avize</h1>
        <p className="text-sm text-slate-500">
          {tab === 'addresses'
            ? 'Adresele de expeditor și de livrare completate când strada nu se citește pe aviz. O adresă devine de încredere după 2 avize citite curat, o corectură din birou sau confirmarea ta.'
            : 'Rute întregi învățate din corecturile din Editează. O regulă greșită rescrie ruta pe toate avizele care se potrivesc — ștergerea ei e soluția.'}
        </p>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 text-sm px-3 py-2 -mb-px border-b-2 ${
              tab === key ? 'border-[#0A2B4E] text-[#0A2B4E] font-medium' : 'border-transparent text-slate-500'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className={inputCls} value={companyId} onChange={(e) => setCompanyId(e.target.value)} aria-label="Firmă">
          <option value="">Toate firmele</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {tab === 'addresses' ? (
          <>
            <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Tip adresă">
              <option value="">Expeditor și livrare</option>
              <option value="origin">Expeditor</option>
              <option value="delivery">Livrare</option>
            </select>
            <select className={inputCls} value={state} onChange={(e) => setState(e.target.value)} aria-label="Stare">
              <option value="">Toate stările</option>
              <option value="trusted">De încredere</option>
              <option value="candidate">Candidate</option>
              <option value="disabled">Dezactivate</option>
            </select>
            <label className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className={`${inputCls} pl-8 w-56`}
                placeholder="Caută adresă, CP, localitate"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <div className="ml-auto">
              <AddAddressForm companies={companies} defaultCompanyId={companyId} onCreated={load} />
            </div>
          </>
        ) : null}
      </div>

      {tab === 'addresses' && !loading && items.length ? (
        <p className="text-xs text-slate-500">
          {counts.trusted} de încredere · {counts.candidate} candidate · {counts.disabled} dezactivate
        </p>
      ) : null}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
          {tab === 'addresses'
            ? 'Nicio adresă învățată încă. Apar după extragerea avizelor cu expeditorul citit curat.'
            : 'Nicio regulă de rută. Apar când biroul corectează Ruta în Editează.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {tab === 'addresses'
            ? items.map((item) => (
              <AddressRow key={item.id} item={item} onPatch={patchAddress} busy={busyId === item.id} />
            ))
            : items.map((item) => <RuleRow key={item.id} item={item} onDelete={setDeleting} />)}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => { if (!busyId) setDeleting(null); }}
        onConfirm={deleteRule}
        busy={Boolean(busyId)}
        title="Ștergi regula de rută?"
        description={`„${deleting?.ruta_transport || ''}” nu va mai fi aplicată pe avizele ${deleting?.company_name || ''}. Avizele deja confirmate nu se schimbă.`}
        confirmLabel="Șterge regula"
      />

      <ConfirmDialog
        open={Boolean(merging)}
        onClose={() => { if (!busyId) setMerging(null); }}
        onConfirm={mergeAddress}
        busy={Boolean(busyId)}
        variant="warning"
        title={merging ? mergePrompt(merging.source, merging.target).title : ''}
        description={merging ? mergePrompt(merging.source, merging.target).description : ''}
        confirmLabel="Unește"
      />
    </div>
  );
}
