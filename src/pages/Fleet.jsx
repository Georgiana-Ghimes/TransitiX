/**
 * Autoturisme: the plates the documents flow has seen, and the one figure it needs from each.
 *
 * The Bucharest zone fee is charged on MTMA, which is a fact about the lorry and not about the
 * trip. An aviz only carries the plate, so until this screen existed the figure had nowhere to
 * live and the operator typed the fee by hand into "Taxe suplimentare" every time.
 *
 * Rows the OCR opened on its own are marked as such. A misread plate produces a lorry that
 * never existed, and presenting it as fleet somebody entered would leave an alert nobody can
 * explain or clear. Șterge removes the row from the database; the same plate on a later aviz
 * opens a fresh record through the OCR path.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2, Truck, Plus, Check, TriangleAlert, ScanLine, Trash2, Search, Pencil, X,
} from 'lucide-react';
import { api } from '@/api/client';
import ConfirmDialog from '@/components/ConfirmDialog';
import { notifyError, notifySuccess } from '@/lib/notify';
import {
  asFleetPage,
  canonicalPlateClient,
  FLEET_PAGE_SIZES,
  mmaLabel,
  parseMmaKg,
  readFleetPageSize,
  sanitizeMmaInput,
  writeFleetPageSize,
} from '@/lib/fleetUi';
import { itpExpired } from '@/lib/fleetItpUi';

const cardCls = 'bg-white rounded-xl border border-slate-200/80 shadow-sm';
const inputCls = 'w-full h-10 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4E89]/30';

export default function Fleet() {
  const [vehicles, setVehicles] = useState([]);
  const [total, setTotal] = useState(0);
  const [missingMma, setMissingMma] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(readFleetPageSize);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [newPlate, setNewPlate] = useState('');
  const [newMma, setNewMma] = useState('');
  const [saving, setSaving] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  /** True after „Selectează toate”: bulk delete removes every row matching the current search. */
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [deleteOne, setDeleteOne] = useState(null);
  const [deleteBulkOpen, setDeleteBulkOpen] = useState(false);
  const [deleteBulkCount, setDeleteBulkCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const loadGen = useRef(0);
  const bulkDeleteLock = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ((prev) => (prev === filter ? prev : filter));
    }, 300);
    return () => clearTimeout(t);
  }, [filter]);

  useEffect(() => {
    setPage(0);
    setSelected(new Set());
    setSelectAllMatching(false);
  }, [q]);

  useEffect(() => {
    load();
  }, [q, page, pageSize]);

  const load = async ({ pageOverride, qOverride } = {}) => {
    const activePage = pageOverride ?? page;
    const activeQ = qOverride ?? q;
    const gen = ++loadGen.current;
    setLoading(true);
    try {
      const offset = activePage * pageSize;
      const pageData = asFleetPage(await api.fleet.list({
        q: activeQ, limit: pageSize, offset,
      }));
      if (gen !== loadGen.current) return;
      setVehicles(pageData.items);
      setTotal(pageData.total);
      setMissingMma(pageData.missing_mma);
      if (pageData.items.length === 0 && pageData.total > 0 && offset >= pageData.total) {
        setPage(Math.max(0, Math.ceil(pageData.total / pageSize) - 1));
      }
    } catch (err) {
      if (gen !== loadGen.current) return;
      notifyError('Lista de vehicule nu a putut fi încărcată', err);
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  };

  const saveMma = async (vehicle, raw) => {
    const kg = parseMmaKg(raw);
    if (raw.trim() !== '' && kg == null) {
      notifyError('MTMA invalid', 'Scrie MTMA în kilograme, de exemplu 40000.');
      return false;
    }
    setSaving(vehicle.id);
    try {
      // Saving the figure is also the confirmation: somebody looked at this plate and accepted
      // it, so it stops being an unreviewed OCR guess.
      await api.entities.Vehicle.update(vehicle.id, { mma_kg: kg, added_by_ocr: false });
      notifySuccess(`${vehicle.plate} actualizat`, kg == null ? 'MTMA șters.' : `MTMA ${mmaLabel(kg)}.`);
      await load();
      return true;
    } catch (err) {
      notifyError('Salvarea a eșuat', err);
      return false;
    } finally {
      setSaving(null);
    }
  };

  const addVehicle = async (e) => {
    e?.preventDefault();
    const plate = canonicalPlateClient(newPlate);
    if (!plate) {
      notifyError('Număr invalid', 'Scrie un număr de înmatriculare, de exemplu B 112 VFM.');
      return;
    }
    const kg = parseMmaKg(newMma);
    setSaving('new');
    try {
      await api.entities.Vehicle.create({ plate, mma_kg: kg, is_active: true });
      notifySuccess(`${plate} adăugat`, kg == null ? 'Completează MTMA când îl afli.' : `MTMA ${mmaLabel(kg)}.`);
      setNewPlate('');
      setNewMma('');
      setAdding(false);
      setPage(0);
      await load({ pageOverride: 0 });
    } catch (err) {
      notifyError('Adăugarea a eșuat', err);
    } finally {
      setSaving(null);
    }
  };

  const runDeleteOne = async () => {
    if (!deleteOne) return;
    setBusy(true);
    setSaving(deleteOne.id);
    try {
      // Hard delete: the row leaves the DB. Avize that named this plate keep their text;
      // references on trips/GPS become NULL. A later OCR of the same plate opens a fresh
      // record - that is what "Șterge, apoi reapare pe un aviz nou" has to mean.
      await api.entities.Vehicle.delete(deleteOne.id);
      notifySuccess(`${deleteOne.plate} șters`, 'Dacă apare pe un aviz nou, se adaugă din nou aici.');
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(deleteOne.id);
        return next;
      });
      setDeleteOne(null);
      await load();
    } catch (err) {
      notifyError('Ștergerea a eșuat', err);
    } finally {
      setBusy(false);
      setSaving(null);
    }
  };

  const runBulkDelete = async () => {
    if (!selectAllMatching && selected.size === 0) {
      notifyError('Nimic selectat', 'Bifează cel puțin un autoturism.');
      return;
    }
    if (bulkDeleteLock.current) return;
    bulkDeleteLock.current = true;
    setBusy(true);
    try {
      const result = selectAllMatching
        ? await api.fleet.bulkDelete({ all_matching: true, q })
        : await api.fleet.bulkDelete({ ids: [...selected] });
      const n = Number(result?.deleted) || 0;
      notifySuccess(
        'Autoturisme șterse',
        n === 1
          ? '1 mașină eliminată. Dacă apare pe un aviz nou, se adaugă din nou aici.'
          : `${n} mașini eliminate. Dacă apar pe un aviz nou, se adaugă din nou aici.`
      );
      setSelected(new Set());
      setSelectAllMatching(false);
      setDeleteBulkOpen(false);
      setPage(0);
      await load({ pageOverride: 0 });
    } catch (err) {
      notifyError('Ștergerea a eșuat', err);
    } finally {
      setBusy(false);
      bulkDeleteLock.current = false;
    }
  };

  const toggleSelect = (id) => {
    if (selectAllMatching) {
      // Leaving „toate”: keep every other id, drop only this row.
      setSelectAllMatching(false);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = total > 0 && (selectAllMatching || selected.size === total);

  const toggleAll = async () => {
    if (allSelected) {
      setSelected(new Set());
      setSelectAllMatching(false);
      return;
    }
    setSelectingAll(true);
    try {
      const res = await api.fleet.ids({ q });
      const ids = Array.isArray(res?.ids) ? res.ids : [];
      setSelected(new Set(ids));
      setSelectAllMatching(true);
    } catch (err) {
      notifyError('Nu am putut selecta toate', err);
    } finally {
      setSelectingAll(false);
    }
  };

  const changePageSize = (n) => {
    const size = Number(n);
    if (!FLEET_PAGE_SIZES.includes(size)) return;
    writeFleetPageSize(size);
    setPageSize(size);
    setPage(0);
  };

  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1);
  const rangeFrom = total === 0 ? 0 : page * pageSize + 1;
  const rangeTo = Math.min(total, (page + 1) * pageSize);

  if (loading && vehicles.length === 0) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0A2B4E]">Autoturisme</h1>
          <p className="text-sm text-slate-500">
            Numerele văzute pe avize. MTMA din talon se scrie o dată pe mașină și se folosește
            la taxa de zonă București.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium bg-[#0A2B4E] text-white rounded-lg hover:bg-[#123f6d]"
        >
          <Plus className="w-4 h-4" /> Adaugă mașină
        </button>
      </div>

      {missingMma > 0 ? (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 flex items-start gap-2">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            <strong>{missingMma === 1 ? 'O mașină nu are MTMA' : `${missingMma} mașini nu au MTMA`}</strong>
            {' - '}
            fără MTMA din talon nu se poate calcula taxa de zonă pentru cursele lor.
          </span>
        </div>
      ) : null}

      {adding ? (
        <form onSubmit={addVehicle} className={`${cardCls} p-3 flex flex-wrap gap-2 items-start`}>
          <div className="w-44">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Număr</label>
            <input
              className={inputCls}
              value={newPlate}
              onChange={(e) => setNewPlate(e.target.value)}
              placeholder="B 112 VFM"
              autoFocus
            />
          </div>
          <div className="w-56">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              MTMA (kg)
            </label>
            <input
              className={inputCls}
              value={newMma}
              onChange={(e) => setNewMma(sanitizeMmaInput(e.target.value))}
              inputMode="numeric"
              pattern="[0-9 .,]*"
              placeholder="40000"
            />
          </div>
          <div className="pt-[22px] flex gap-2">
            <button type="submit" disabled={saving === 'new'}
              className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium bg-[#0A2B4E] text-white rounded-lg hover:bg-[#123f6d] disabled:opacity-40">
              {saving === 'new' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Salvează
            </button>
            <button type="button" onClick={() => setAdding(false)}
              className="h-10 px-4 text-sm border border-slate-200 rounded-lg hover:bg-slate-50">
              Renunță
            </button>
          </div>
          <p className="w-full text-[11px] text-slate-400">
            MTMA este masa totală maximă autorizată din certificatul de înmatriculare, rubrica
            F.3 pentru ansamblu. Nu este sarcina utilă și nu este greutatea mărfii de pe aviz.
          </p>
        </form>
      ) : null}

      <div className={`${cardCls} p-3`}>
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            className={`${inputCls} pl-9`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Caută după număr"
          />
        </div>
      </div>

      {vehicles.length === 0 ? (
        <div className={`${cardCls} p-12 text-center text-slate-400`}>
          <Truck className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">
            {q.trim()
              ? 'Niciun număr nu se potrivește.'
              : 'Încă nicio mașină. Se adaugă singure când OCR-ul citește un număr de pe un aviz, sau le poți introduce tu.'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 px-1">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                disabled={busy || selectingAll || total === 0}
                title="Selectează toate mașinile din listă (toate paginile)"
              />
              {selectingAll ? 'Se selectează…' : 'Selectează toate'}
              {allSelected ? (
                <span className="text-xs text-slate-500 font-normal">({total})</span>
              ) : null}
            </label>
            <button
              type="button"
              disabled={(!selectAllMatching && selected.size === 0) || busy}
              onClick={() => {
                setDeleteBulkCount(selectAllMatching ? total : selected.size);
                setDeleteBulkOpen(true);
              }}
              title={
                (!selectAllMatching && selected.size === 0)
                  ? 'Bifează mașinile, apoi apasă aici'
                  : 'Șterge definitiv selecția'
              }
              className="inline-flex h-9 items-center gap-2 px-3 text-sm font-medium border border-red-200 text-red-700 bg-white rounded-lg hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" />
              Șterge selectate ({selectAllMatching ? total : selected.size})
            </button>
          </div>

          <div className="space-y-2">
            {vehicles.map((vehicle) => (
              <VehicleRow
                key={vehicle.id}
                vehicle={vehicle}
                selected={selectAllMatching || selected.has(vehicle.id)}
                onToggleSelect={() => toggleSelect(vehicle.id)}
                busy={saving === vehicle.id || busy}
                onSave={(raw) => saveMma(vehicle, raw)}
                onRemove={() => setDeleteOne(vehicle)}
              />
            ))}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-1 py-1">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <label className="inline-flex items-center gap-2">
                <span className="text-slate-500">Afișează</span>
                <select
                  value={pageSize}
                  onChange={(e) => changePageSize(e.target.value)}
                  className="h-9 px-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-[#1D4E89]"
                  aria-label="Număr de autoturisme pe pagină"
                >
                  {FLEET_PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <span className="text-slate-500">pe pagină</span>
              </label>
              <span className="text-slate-400 hidden sm:inline">·</span>
              <span className="tabular-nums text-slate-600">
                {total === 0 ? '0 mașini' : `${rangeFrom}–${rangeTo} din ${total}`}
              </span>
              {(selectAllMatching || selected.size > 0) ? (
                <span className="text-xs text-slate-500">
                  ({selectAllMatching ? total : selected.size} selectate
                  {!selectAllMatching && selected.size > vehicles.length ? ', pe mai multe pagini' : ''})
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 0 || busy || loading}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="inline-flex h-9 items-center px-3 text-sm font-medium border border-slate-200 bg-white rounded-lg hover:bg-slate-50 disabled:opacity-40"
              >
                Înapoi
              </button>
              <span className="text-sm tabular-nums text-slate-600 min-w-[5.5rem] text-center">
                {Math.min(page + 1, pageCount)} / {pageCount}
              </span>
              <button
                type="button"
                disabled={page + 1 >= pageCount || busy || loading}
                onClick={() => setPage((p) => p + 1)}
                className="inline-flex h-9 items-center px-3 text-sm font-medium border border-slate-200 bg-white rounded-lg hover:bg-slate-50 disabled:opacity-40"
              >
                Înainte
              </button>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={Boolean(deleteOne)}
        onClose={() => { if (!busy) setDeleteOne(null); }}
        onConfirm={runDeleteOne}
        busy={busy}
        variant="danger"
        title="Șterge autoturismul?"
        description={`Ștergeți definitiv ${deleteOne?.plate || 'această mașină'}? Dacă apare pe un aviz nou, se adaugă din nou aici.`}
        confirmLabel="Șterge"
      />
      <ConfirmDialog
        open={deleteBulkOpen}
        onClose={() => { if (!busy) setDeleteBulkOpen(false); }}
        onConfirm={runBulkDelete}
        busy={busy}
        variant="danger"
        title="Șterge autoturismele selectate?"
        description={
          deleteBulkCount === 1
            ? 'Ștergeți 1 mașină selectată? Acțiunea nu se poate anula.'
            : `Ștergeți ${deleteBulkCount} mașini selectate? Acțiunea nu se poate anula.`
        }
        confirmLabel={deleteBulkCount === 1 ? 'Șterge' : `Șterge ${deleteBulkCount}`}
      />
    </div>
  );
}

/**
 * One lorry, with its MTMA locked once it has one.
 *
 * The figure is entered once and then read for years. Leaving it in an open box means a stray
 * keystroke on a list somebody is scrolling can change which PMB bracket every future trip is
 * charged at, and nothing on the screen would look wrong afterwards. Editing is deliberate:
 * the pencil unlocks it, Escape puts it back.
 */
function VehicleRow({ vehicle, selected, onToggleSelect, busy, onSave, onRemove }) {
  const stored = vehicle.mma_kg == null ? '' : String(Math.round(Number(vehicle.mma_kg)));
  const missing = vehicle.mma_kg == null;
  // A lorry with no mass yet is the thing this screen exists for, so that one starts open.
  const [editing, setEditing] = useState(missing);
  const [value, setValue] = useState(stored);
  const dirty = value.trim() !== stored;

  // After Salvează the parent reloads the row; without this, `editing` stays true and the
  // box never greys out until a full page refresh.
  useEffect(() => {
    setValue(stored);
    setEditing(missing);
  }, [vehicle.id, stored, missing]);

  const cancel = () => {
    setValue(stored);
    setEditing(false);
  };

  const commit = async () => {
    const ok = await onSave(value);
    if (ok === false) return;
    const kg = parseMmaKg(value);
    if (kg == null) {
      setValue('');
      setEditing(true);
    } else {
      setValue(String(kg));
      setEditing(false);
    }
  };

  return (
    <div className={`${cardCls} p-3 flex flex-wrap items-center gap-x-4 gap-y-2 ${missing ? 'ring-1 ring-amber-200' : ''}`}>
      <input
        type="checkbox"
        className="shrink-0"
        checked={selected}
        onChange={onToggleSelect}
        disabled={busy}
        aria-label={`Selectează ${vehicle.plate || 'mașina'}`}
      />
      <span className="font-mono text-sm font-semibold text-slate-800 w-36">{vehicle.plate}</span>

      {vehicle.brand || vehicle.model ? (
        <span className="text-xs text-slate-500">{[vehicle.brand, vehicle.model].filter(Boolean).join(' ')}</span>
      ) : null}

      {vehicle.added_by_ocr ? (
        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-800">
          <ScanLine className="w-3 h-3" /> din OCR, neverificat
        </span>
      ) : null}

      {itpExpired(vehicle.itp_expiry) ? (
        <Link
          to="/fleet/itp"
          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-800 border border-red-200 hover:bg-red-100"
          title="Deschide board-ul ITP"
        >
          ITP expirat
        </Link>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        <label className="text-[11px] text-slate-500 whitespace-nowrap">MTMA (kg)</label>
        <input
          className={`w-28 h-9 px-2 text-sm text-right border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4E89]/30 ${
            editing
              ? 'border-slate-200 bg-white text-slate-800'
              : 'border-transparent bg-slate-50 text-slate-500 cursor-default'
          }`}
          value={value}
          onChange={(e) => setValue(sanitizeMmaInput(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel();
            if (e.key === 'Enter' && dirty) commit();
          }}
          readOnly={!editing}
          inputMode="numeric"
          pattern="[0-9 .,]*"
          placeholder="-"
        />

        {editing ? (
          <>
            <button
              type="button"
              onClick={commit}
              disabled={busy || !dirty}
              className="inline-flex h-9 items-center gap-1.5 px-3 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Salvează
            </button>
            {missing ? null : (
              <button type="button" onClick={cancel} disabled={busy} title="Renunță"
                className="p-2 text-slate-400 hover:text-slate-700 disabled:opacity-40">
                <X className="w-4 h-4" />
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={busy}
            title="Editează MTMA"
            className="p-2 text-slate-400 hover:text-[#1D4E89] disabled:opacity-40"
          >
            <Pencil className="w-4 h-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          title="Scoate din listă"
          className="p-2 text-slate-400 hover:text-rose-700 disabled:opacity-40"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {missing ? (
        <p className="w-full text-[11px] text-amber-700 pl-6">
          Fără MTMA nu se poate alege tranșa PMB pentru cursele acestei mașini.
        </p>
      ) : null}
    </div>
  );
}
