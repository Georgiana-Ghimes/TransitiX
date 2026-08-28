import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck, Download, FileSpreadsheet, History, Layers, Loader2, RefreshCw, Search,
  Sparkles, TriangleAlert,
} from 'lucide-react';
import { api } from '@/api/client';
import { notifyError, notifySuccess } from '@/lib/notify';
import {
  EMPTY_FILTERS,
  cleanFilters,
  driftSummary,
  formatCell,
  formatDateTime,
  hasCriteria,
  saveBlob,
  totalIsPartial,
  totalsRow,
  warningHint,
  warningLabel,
} from '@/lib/reportsUi';

const STATUS_OPTIONS = [
  { value: '', label: 'Orice status' },
  { value: 'confirmed', label: 'Doar confirmate' },
  { value: 'extracted', label: 'Extrase, neconfirmate' },
  { value: 'uploaded', label: 'Doar încărcate' },
];

function Field({ label, children, hint }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-600 font-medium">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-slate-400">{hint}</span> : null}
    </label>
  );
}

const inputClass = 'border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none '
  + 'focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400';

function WarningCard({ warning }) {
  const hint = warningHint(warning.code);
  return (
    <div className="flex gap-2 items-start rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <TriangleAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
      <div className="text-sm">
        <span className="font-medium text-amber-900">{warningLabel(warning.code)}</span>
        <span className="text-amber-800"> — {warning.count} document{warning.count === 1 ? '' : 'e'}</span>
        {hint ? <p className="text-[12px] text-amber-700 mt-0.5">{hint}</p> : null}
      </div>
    </div>
  );
}

function PreviewTable({ preview }) {
  const totals = useMemo(
    () => (preview ? totalsRow(preview.columns, preview.totals) : null),
    [preview]
  );
  if (!preview) return null;
  if (preview.row_count === 0) {
    return (
      <div className="p-8 text-center text-slate-500 text-sm">
        Selecția nu conține niciun document.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 sticky top-0">
          <tr>
            {preview.columns.map((col) => (
              <th
                key={col.key}
                className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap border-b border-slate-200 ${col.numeric ? 'text-right' : 'text-left'}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, idx) => (
            <tr key={preview.documents[idx]?.id ?? idx} className="border-b border-slate-100 hover:bg-slate-50">
              {preview.columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-3 py-1.5 whitespace-nowrap ${col.numeric ? 'text-right tabular-nums' : 'text-left'} ${row[col.key] === '' ? 'text-slate-300' : 'text-slate-700'}`}
                >
                  {formatCell(row[col.key], col) || '—'}
                </td>
              ))}
            </tr>
          ))}
          {totals ? (
            <tr className="bg-slate-100 font-semibold">
              {preview.columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-3 py-2 whitespace-nowrap ${col.numeric ? 'text-right tabular-nums' : 'text-left'}`}
                  title={totalIsPartial(preview.totals, col.key)
                    ? `${preview.totals[col.key].missing} rânduri fără valoare nu sunt incluse`
                    : undefined}
                >
                  {totals.cells[col.key]}
                  {totalIsPartial(preview.totals, col.key)
                    ? <span className="text-amber-600 ml-1">*</span>
                    : null}
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function ExportHistory({ rows, onRedownload, onInspect, busyId, detail }) {
  if (!rows.length) {
    return <p className="text-sm text-slate-500 p-4">Niciun raport generat încă.</p>;
  }
  return (
    <div className="divide-y divide-slate-100">
      {rows.map((row) => {
        const open = detail?.export?.id === row.id;
        const drift = open ? driftSummary(detail.drift) : null;
        return (
          <div key={row.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="font-medium text-slate-800 text-sm">{row.template_name || 'Șablon șters'}</span>
              <span className="text-xs text-slate-500">{formatDateTime(row.created_at)}</span>
              <span className="text-xs text-slate-500">{row.row_count ?? row.aviz_count} rânduri</span>
              <span className="text-xs text-slate-400">{row.selection}</span>
              {row.user_email ? <span className="text-xs text-slate-400">· {row.user_name || row.user_email}</span> : null}
              {!row.reproducible ? (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  fără conținut salvat
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onInspect(open ? null : row.id)}
                  className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  {open ? 'Ascunde' : 'Detalii'}
                </button>
                <button
                  type="button"
                  disabled={!row.reproducible || busyId === row.id}
                  onClick={() => onRedownload(row)}
                  className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                  title={row.reproducible
                    ? 'Descarcă exact fișierul trimis atunci'
                    : 'Export mai vechi decât salvarea conținutului'}
                >
                  {busyId === row.id
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Download className="w-3 h-3" />}
                  Re-descarcă
                </button>
              </div>
            </div>
            {row.note ? <p className="text-xs text-slate-500 mt-1 ml-7">„{row.note}”</p> : null}
            {open ? (
              <div className="mt-2 ml-7 text-xs">
                <p className={drift.tone === 'ok' ? 'text-emerald-700' : 'text-amber-700'}>
                  {drift.text}
                </p>
                <p className="text-slate-500 mt-1">
                  {detail.rows.length} rânduri salvate ·{' '}
                  {detail.export.columns.map((c) => c.header).join(', ')}
                </p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function Reports() {
  const [templates, setTemplates] = useState([]);
  const [presets, setPresets] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [note, setNote] = useState('');
  const [history, setHistory] = useState([]);
  const [detail, setDetail] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [creatingPreset, setCreatingPreset] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [stamping, setStamping] = useState(false);

  const loadTemplates = useCallback(async () => {
    const list = await api.avize.templates();
    setTemplates(list);
    setTemplateId((current) => current || list[0]?.id || '');
  }, []);

  const loadHistory = useCallback(async () => {
    const res = await api.reports.exports({ limit: 20 });
    setHistory(res.exports);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadTemplates();
        const [presetRes] = await Promise.all([api.reports.presets(), loadHistory()]);
        setPresets(presetRes.presets);
      } catch (err) {
        notifyError('Nu am putut încărca ecranul de rapoarte', err);
      }
    })();
  }, [loadTemplates, loadHistory]);

  const ready = Boolean(templateId) && hasCriteria(filters);

  const runPreview = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      setPreview(await api.reports.preview({ template_id: templateId, filters: cleanFilters(filters) }));
    } catch (err) {
      setPreview(null);
      notifyError('Previzualizarea a eșuat', err);
    } finally {
      setLoading(false);
    }
  }, [ready, templateId, filters]);

  // The preview is the thing an operator reads before committing, so it must follow the
  // criteria rather than wait for a button they might not press.
  useEffect(() => {
    if (!ready) { setPreview(null); return undefined; }
    const timer = setTimeout(runPreview, 350);
    return () => clearTimeout(timer);
  }, [ready, runPreview]);

  async function handleExport() {
    setExporting(true);
    try {
      const { blob, filename } = await api.reports.export({
        template_id: templateId, filters: cleanFilters(filters), note: note || undefined,
      });
      saveBlob(blob, filename);
      notifySuccess(`Raport generat: ${filename}`);
      await loadHistory();
    } catch (err) {
      notifyError('Exportul a eșuat', err);
    } finally {
      setExporting(false);
    }
  }

  async function handleRedownload(row) {
    setBusyId(row.id);
    try {
      const { blob, filename } = await api.reports.redownload(row.id);
      saveBlob(blob, filename);
    } catch (err) {
      notifyError('Re-descărcarea a eșuat', err);
    } finally {
      setBusyId(null);
    }
  }

  async function handleInspect(id) {
    if (!id) { setDetail(null); return; }
    try {
      setDetail(await api.reports.exportDetail(id));
    } catch (err) {
      notifyError('Detaliile nu au putut fi citite', err);
    }
  }

  /**
   * Stamps one billing date across the whole selection.
   *
   * An annex is invoiced on a single date; typing it onto eighty documents by hand is how the
   * column ends up half empty. The trip date is deliberately left alone — the tariff is read as
   * of the day the trip ran.
   */
  async function handleInvoiceDate() {
    setStamping(true);
    try {
      const res = await api.reports.setInvoiceDate({
        filters: cleanFilters(filters),
        data_facturare: invoiceDate || null,
      });
      notifySuccess(
        invoiceDate ? `Dată de facturare pusă pe ${res.updated} documente` : `Dată ștearsă de pe ${res.updated} documente`
      );
      await runPreview();
    } catch (err) {
      notifyError('Data de facturare nu a putut fi salvată', err);
    } finally {
      setStamping(false);
    }
  }

  async function handleCreatePreset(presetId) {
    setCreatingPreset(presetId);
    try {
      const created = await api.reports.createFromPreset({ preset_id: presetId });
      await loadTemplates();
      setTemplateId(created.id);
      notifySuccess(`Șablon creat: ${created.name}`);
    } catch (err) {
      notifyError('Șablonul nu a putut fi creat', err);
    } finally {
      setCreatingPreset('');
    }
  }

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const usedPresets = new Set(templates.map((t) => t.preset_id).filter(Boolean));

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <header>
        <h1 className="text-xl font-semibold text-slate-800">Rapoarte</h1>
        <p className="text-sm text-slate-500">
          Alege documentele, verifică ce va conține foaia, apoi exportă. Fiecare export rămâne în
          istoric cu conținutul lui, ca să poată fi trimis din nou identic.
        </p>
      </header>

      <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Șablon">
            <select className={inputClass} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.length === 0 ? <option value="">Niciun șablon</option> : null}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
          <Field label="De la data cursei">
            <input type="date" className={inputClass} value={filters.from} onChange={set('from')} />
          </Field>
          <Field label="Până la data cursei">
            <input type="date" className={inputClass} value={filters.to} onChange={set('to')} />
          </Field>
          <Field label="Status document">
            <select className={inputClass} value={filters.status} onChange={set('status')}>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Număr auto">
            <input className={inputClass} placeholder="B 123 ABC" value={filters.plate} onChange={set('plate')} />
          </Field>
          <Field label="Caută" hint="TPO, număr aviz, rută sau nume de fișier">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className={`${inputClass} pl-8 w-full`} value={filters.q} onChange={set('q')} />
            </div>
          </Field>
          <Field label="Lot de documente" hint="Id-ul lotului încărcat în ecranul Documente">
            <input className={inputClass} value={filters.batch_id} onChange={set('batch_id')} />
          </Field>
          <label className="flex items-center gap-2 text-sm self-end pb-2">
            <input type="checkbox" checked={filters.with_weight} onChange={set('with_weight')} />
            <span className="text-slate-600">Doar documentele cu greutate cântărită</span>
          </label>
        </div>

        {!ready ? (
          <p className="text-sm text-slate-500">
            Alege un șablon și cel puțin un criteriu. Fără criterii raportul ar cuprinde toată arhiva.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-slate-100">
            <Field label="Dată facturare pentru toată selecția" hint="Nu schimbă data cursei — tariful se citește tot după ziua în care s-a rulat cursa.">
              <input
                type="date"
                className={inputClass}
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </Field>
            <button
              type="button"
              onClick={handleInvoiceDate}
              disabled={stamping || !preview?.row_count}
              className="text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 inline-flex items-center gap-1 mb-[2px]"
            >
              {stamping ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}
              Aplică pe {preview?.row_count ?? 0} documente
            </button>
          </div>
        )}

        {presets.length ? (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
            <Sparkles className="w-4 h-4 text-slate-400" />
            <span className="text-xs text-slate-500">Șabloane gata făcute:</span>
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={usedPresets.has(p.id) || creatingPreset === p.id}
                onClick={() => handleCreatePreset(p.id)}
                title={usedPresets.has(p.id) ? 'Există deja în listă' : p.description}
                className="text-xs px-2 py-1 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {p.name} ({p.column_count})
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {preview?.warnings?.length ? (
        <section className="space-y-2">
          {preview.warnings.map((w) => <WarningCard key={w.code} warning={w} />)}
        </section>
      ) : null}

      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200">
          <Layers className="w-4 h-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">
            Previzualizare {preview ? `— ${preview.row_count} rânduri` : ''}
          </h2>
          {preview?.selection?.description ? (
            <span className="text-xs text-slate-500">{preview.selection.description}</span>
          ) : null}
          {loading ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : null}
          <div className="ml-auto flex items-center gap-2">
            <input
              className={`${inputClass} w-56`}
              placeholder="Notă pentru istoric (opțional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              type="button"
              onClick={runPreview}
              disabled={!ready || loading}
              className="text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 inline-flex items-center gap-1"
            >
              <RefreshCw className="w-4 h-4" /> Reîmprospătează
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!ready || exporting || !preview?.row_count}
              className="text-sm px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 inline-flex items-center gap-1"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Exportă Excel
            </button>
          </div>
        </div>
        {preview ? <PreviewTable preview={preview} /> : (
          <p className="p-8 text-center text-sm text-slate-400">
            Previzualizarea apare după ce alegi criteriile.
          </p>
        )}
        {preview && Object.values(preview.totals ?? {}).some((t) => t.missing > 0) ? (
          <p className="px-4 py-2 text-[11px] text-amber-700 bg-amber-50 border-t border-amber-100">
            * Totalul nu include rândurile fără valoare pe acea coloană.
          </p>
        ) : null}
      </section>

      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
          <History className="w-4 h-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">Istoric exporturi</h2>
          <button
            type="button"
            onClick={loadHistory}
            className="ml-auto text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Reîncarcă
          </button>
        </div>
        <ExportHistory
          rows={history}
          detail={detail}
          busyId={busyId}
          onRedownload={handleRedownload}
          onInspect={handleInspect}
        />
      </section>
    </div>
  );
}
