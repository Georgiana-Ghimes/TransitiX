import React, { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import ConfirmDialog from '@/components/ConfirmDialog';
import ModalShell from '@/components/ModalShell';
import { notifyError, notifySuccess } from '@/lib/notify';
import { AVIZ_SOURCE_OPTIONS, STATUS_LABEL, nextAvizStatusOnSave } from '@/lib/avizAnnex';
import { datePresetRange } from '@/lib/avizOps';
import {
  Archive, Camera, Check, ClipboardList, Download, Loader2,
  Mail, Trash2, Upload, X,
} from 'lucide-react';
import AvizEditModal from './avize/AvizEditModal';
import AvizFilterBar from './avize/AvizFilterBar';
import AvizLegend from './avize/AvizLegend';
import AvizReportsTab from './avize/AvizReportsTab';
import AvizTemplatesTab from './avize/AvizTemplatesTab';
import { SourceBadge } from './avize/AvizFilePreview';
import {
  AVIZ_ACTION_LEGEND,
  displayRoute,
  downloadBlob,
  emptyForm,
  inputCls,
  isLockedRai,
  labelCls,
  lowField,
} from './avize/avizeUi';

export default function AvizeReports() {
  const [tab, setTab] = useState('avize');
  const [rows, setRows] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [obsCodes, setObsCodes] = useState([]);
  const [reportData, setReportData] = useState({ by_plate: [], weekly: [], exports: [] });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [templateId, setTemplateId] = useState('');
  const [editRow, setEditRow] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deleteRow, setDeleteRow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [activePreset, setActivePreset] = useState('');
  const [editTemplate, setEditTemplate] = useState(null);
  const [deleteTemplate, setDeleteTemplate] = useState(null);
  const [filters, setFilters] = useState({ from: '', to: '', status: '', q: '' });
  const [qInput, setQInput] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [amountRule, setAmountRule] = useState('tpo');
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [trips, setTrips] = useState([]);
  const [newCode, setNewCode] = useState('');
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const loadGen = useRef(0);
  const bulkConfirmLock = useRef(false);

  const confirmableSelectedIds = rows
    .filter((r) => selected.has(r.id) && r.status !== 'confirmed')
    .map((r) => r.id);

  const load = async () => {
    const gen = ++loadGen.current;
    try {
      const [avize, tmpls, codes] = await Promise.all([
        api.avize.list(filters),
        api.avize.templates(),
        api.avize.observationCodes().catch(() => []),
      ]);
      if (gen !== loadGen.current) return;
      setRows(avize);
      setSelected((prev) => {
        const visible = new Set(avize.map((r) => r.id));
        const next = new Set([...prev].filter((id) => visible.has(id)));
        return next;
      });
      setTemplates(tmpls);
      setObsCodes(codes);
      setTemplateId((prev) => {
        if (prev && tmpls.some((t) => t.id === prev)) return prev;
        return tmpls.find((t) => t.is_default)?.id || tmpls[0]?.id || '';
      });
    } catch (e) {
      if (gen !== loadGen.current) return;
      notifyError('Nu am putut încărca avizele', e);
    } finally {
      if (gen === loadGen.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((prev) => (prev.q === qInput ? prev : { ...prev, q: qInput }));
    }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    if (!loading) setRefreshing(true);
    load();
  }, [filters.from, filters.to, filters.status, filters.q]);

  const loadReports = async () => {
    try {
      const data = await api.avize.reports({ from: filters.from, to: filters.to });
      setReportData(data);
    } catch (e) {
      notifyError('Rapoartele nu s-au încărcat', e);
    }
  };

  useEffect(() => {
    if (tab === 'rapoarte') loadReports();
  }, [tab, filters.from, filters.to]);

  const applyPreset = (preset) => {
    const range = datePresetRange(preset);
    setActivePreset(preset);
    setFilters((prev) => ({ ...prev, ...range }));
  };

  const resetAvizFilters = () => {
    setActivePreset('');
    setFilters({ from: '', to: '', status: '', q: '' });
    setQInput('');
  };

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true);
    const failed = [];
    let dup = 0;
    try {
      for (const file of files) {
        try {
          const uploaded = await api.integrations.Core.UploadFile({ file });
          const row = await api.avize.extract({
            file_url: uploaded.file_url,
            original_filename: file.name,
          });
          if (row?.duplicate_tpo) dup += 1;
        } catch (err) {
          failed.push(file.name);
          console.error('[aviz upload]', file.name, err);
        }
      }
      if (failed.length === 0) {
        notifySuccess(
          'Avize încărcate',
          dup
            ? `${files.length} fișier(e). Atenție: ${dup} TPO există deja (salvarea a rămas).`
            : `${files.length} fișier(e) procesate.`
        );
      } else if (failed.length < files.length) {
        notifyError('Unele fișiere nu s-au extras', failed.join(', '));
      } else {
        notifyError('Încărcare eșuată', failed.join(', '));
      }
      await load();
    } catch (e) {
      notifyError('Încărcare eșuată', e);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
      if (cameraRef.current) cameraRef.current.value = '';
    }
  };

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };

  const openEdit = async (row) => {
    setEditRow(row);
    setForm(emptyForm(row));
    try {
      const suggestions = await api.avize.tripSuggestions({
        date: row.data_efectuare_cursa,
        plate: row.numar_auto,
      });
      setTrips(suggestions);
    } catch {
      setTrips([]);
    }
  };

  const saveEdit = async () => {
    if (!editRow) return;
    setSaving(true);
    try {
      const payload = { ...form, status: nextAvizStatusOnSave(editRow.status) };
      if (!payload.trip_id) payload.trip_id = null;
      const saved = await api.entities.AvizDocument.update(editRow.id, payload);
      notifySuccess(
        'Aviz salvat',
        saved?.duplicate_tpo
          ? 'Atenție: există deja un aviz cu același TPO. Salvarea a rămas.'
          : 'Câmpurile au fost actualizate.'
      );
      setEditRow(null);
      await load();
    } catch (e) {
      notifyError('Salvare eșuată', e);
    } finally {
      setSaving(false);
    }
  };

  const confirmRow = async (row) => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      await api.entities.AvizDocument.update(row.id, { status: 'confirmed' });
      notifySuccess('Aviz confirmat', row.numar_tpo || row.original_filename || 'Rând marcat ca confirmat.');
      await load();
    } catch (e) {
      notifyError('Confirmare eșuată', e);
    } finally {
      setBusyId(null);
    }
  };

  const bulkConfirm = async () => {
    const ids = confirmableSelectedIds;
    if (ids.length === 0) {
      notifyError('Nimic de confirmat', 'Selectează rânduri care nu sunt încă Confirmat.');
      return;
    }
    if (bulkConfirmLock.current) return;
    bulkConfirmLock.current = true;
    setBusy(true);
    try {
      const updated = await api.avize.bulkConfirm(ids);
      notifySuccess(
        'Confirmate',
        updated.length
          ? `${updated.length} aviz(e) marcate ca confirmate.`
          : 'Rândurile selectate erau deja confirmate.'
      );
      await load();
    } catch (e) {
      notifyError('Confirmare eșuată', e);
    } finally {
      setBusy(false);
      bulkConfirmLock.current = false;
    }
  };

  const reextract = async (row) => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      await api.avize.extract({ id: row.id, file_url: row.file_url, original_filename: row.original_filename });
      notifySuccess('Re-extras', 'TPO/auto/rută din document; km, taxe și ruta de birou rămân.');
      await load();
    } catch (e) {
      notifyError('Extragere eșuată', e);
    } finally {
      setBusyId(null);
    }
  };

  const runDelete = async () => {
    if (!deleteRow) return;
    setBusy(true);
    try {
      await api.entities.AvizDocument.delete(deleteRow.id);
      notifySuccess('Aviz șters', deleteRow.original_filename || deleteRow.numar_tpo || 'Rând eliminat.');
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(deleteRow.id);
        return next;
      });
      setDeleteRow(null);
      await load();
    } catch (e) {
      notifyError('Ștergere eșuată', e);
    } finally {
      setBusy(false);
    }
  };

  const exportSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) {
      notifyError('Nimic selectat', 'Bifează cel puțin un aviz pentru export.');
      return;
    }
    if (!templateId) {
      notifyError('Fără șablon', 'Alege un șablon XLSX.');
      return;
    }
    setBusy(true);
    try {
      const { blob, filename } = await api.avize.exportXlsx({ template_id: templateId, aviz_ids: ids });
      downloadBlob(blob, filename);
      notifySuccess('Export gata', filename);
    } catch (e) {
      notifyError('Export eșuat', e);
    } finally {
      setBusy(false);
    }
  };

  const zipSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0 || !templateId) {
      notifyError('Nimic selectat', 'Bifează avize și alege șablonul.');
      return;
    }
    setBusy(true);
    try {
      const { blob, filename, missing } = await api.avize.zipExport({ template_id: templateId, aviz_ids: ids });
      downloadBlob(blob, filename);
      notifySuccess('Zip gata', missing ? `${filename} (${missing} originale lipsă de pe disk)` : filename);
    } catch (e) {
      notifyError('Zip eșuat', e);
    } finally {
      setBusy(false);
    }
  };

  const sendAnnexEmail = async () => {
    const ids = [...selected];
    if (!emailTo.trim() || ids.length === 0 || !templateId) return;
    setBusy(true);
    try {
      const result = await api.avize.emailAnnex({
        to: emailTo.trim(),
        template_id: templateId,
        aviz_ids: ids,
      });
      if (result?.content_base64) {
        const bin = Uint8Array.from(atob(result.content_base64), (c) => c.charCodeAt(0));
        downloadBlob(new Blob([bin]), result.filename || 'anexa.xlsx');
        notifySuccess('Email stub', 'Resend nu e configurat — anexa s-a descărcat.');
      } else if (result?.stub || result?.download) {
        notifySuccess('Email stub', 'Resend nu e configurat. Descarcă anexa cu Unește.');
      } else {
        notifySuccess('Email trimis', result?.filename || emailTo);
      }
      setEmailOpen(false);
    } catch (e) {
      notifyError('Email eșuat', e);
    } finally {
      setBusy(false);
    }
  };

  const draftInvoice = async () => {
    const ids = [...selected];
    if (ids.length === 0) {
      notifyError('Nimic selectat', 'Bifează avize confirmate.');
      return;
    }
    setBusy(true);
    try {
      const inv = await api.avize.draftInvoice({ aviz_ids: ids, amount_rule: amountRule });
      notifySuccess(
        'Ciornă factură',
        `${inv.series || 'TRX'}-${inv.number} — deschide Financiar. Fără e-Factura.`
      );
    } catch (e) {
      notifyError('Ciornă eșuată', e);
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async () => {
    if (!editTemplate) return;
    const name = String(editTemplate.name || '').trim();
    if (!name) {
      notifyError('Nume obligatoriu', 'Completează numele șablonului.');
      return;
    }
    if (isLockedRai(editTemplate)) {
      notifyError('Șablon blocat', 'Anexa Factura RAI nu poate fi suprascrisă.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name,
        is_default: Boolean(editTemplate.is_default),
        columns: editTemplate.columns || [],
      };
      let keepId = editTemplate.id;
      if (editTemplate.id) {
        await api.avize.updateTemplate(editTemplate.id, payload);
      } else {
        const created = await api.avize.createTemplate(payload);
        keepId = created?.id;
      }
      notifySuccess('Șablon salvat', `${name} e selectat pentru Unește. Exportă din nou ca să vezi Taxă / Tarif km.`);
      setEditTemplate(null);
      await load();
      if (keepId) setTemplateId(keepId);
    } catch (e) {
      notifyError('Salvare șablon eșuată', e);
    } finally {
      setSaving(false);
    }
  };

  const runDeleteTemplate = async () => {
    if (!deleteTemplate) return;
    setBusy(true);
    try {
      await api.avize.deleteTemplate(deleteTemplate.id);
      notifySuccess('Șablon șters', deleteTemplate.name);
      setDeleteTemplate(null);
      await load();
    } catch (e) {
      notifyError('Ștergere șablon eșuată', e);
    } finally {
      setBusy(false);
    }
  };

  const addObsCode = async () => {
    const code = newCode.trim();
    if (!code) return;
    try {
      await api.avize.createObservationCode({ code, label: code });
      setNewCode('');
      const codes = await api.avize.observationCodes();
      setObsCodes(codes);
    } catch (e) {
      notifyError('Codul nu s-a salvat', e);
    }
  };

  const newTemplate = () => {
    const base = templates[0]?.columns || AVIZ_SOURCE_OPTIONS.map((o) => ({
      key: o.value,
      header: o.label,
      source: o.value,
      default_value: '',
    }));
    setEditTemplate({
      name: 'Șablon nou',
      is_default: false,
      columns: JSON.parse(JSON.stringify(base)),
    });
  };

  const appendObs = (code) => {
    setForm((prev) => {
      const current = String(prev.observatii || '').trim();
      if (current.includes(code)) return prev;
      return { ...prev, observatii: current ? `${current} ${code}` : code };
    });
  };

  const rowLocked = (id) => uploading || busyId === id;
  const selectedIds = [...selected];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" />
      </div>
    );
  }

  const filterBar = (
    <AvizFilterBar
      filters={filters}
      setFilters={setFilters}
      qInput={qInput}
      setQInput={setQInput}
      onPreset={applyPreset}
      onReset={resetAvizFilters}
      activePreset={activePreset}
      refreshing={refreshing}
    />
  );

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">Avize / Rapoarte</h1>
          <p className="text-sm text-slate-500 mt-1">Extrage câmpuri din avize și unește-le într-o Anexă Factură XLSX</p>
        </div>
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg self-start">
          {[['avize', 'Avize'], ['sabloane', 'Șabloane'], ['rapoarte', 'Rapoarte']].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 text-sm rounded-md ${tab === id ? 'bg-white shadow text-[#0A2B4E] font-medium' : 'text-slate-500'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'avize' ? (
        <>
          <div className="flex flex-wrap items-start gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => uploadFiles(e.target.files)}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => uploadFiles(e.target.files)}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-60"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Încarcă avize
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => cameraRef.current?.click()}
              className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium border border-slate-200 bg-white rounded-lg hover:bg-slate-50 disabled:opacity-60"
            >
              <Camera className="w-4 h-4" />
              Foto
            </button>
            <div className="flex flex-col gap-1 min-w-[12rem] w-full sm:w-56 sm:flex-none">
              <select
                className={`${inputCls} h-10 py-0`}
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                aria-label="Șablon Anexa Factură"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (implicit)' : ''}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 leading-snug">
                Exportul folosește acest șablon, inclusiv Default (ex. taxă 100, tarif 20).
              </p>
            </div>
            <button
              type="button"
              disabled={selected.size === 0 || !templateId || busy}
              onClick={exportSelected}
              title={selected.size === 0 ? 'Bifează avizele din tabel, apoi apasă aici' : 'Unește rândurile selectate într-un fișier Anexa Factură'}
              className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium text-white bg-[#0A7A3E] rounded-lg hover:bg-[#096c37] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              Unește în Anexa XLSX ({selected.size})
            </button>
            <button
              type="button"
              disabled={confirmableSelectedIds.length === 0 || busy}
              onClick={bulkConfirm}
              className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium border border-emerald-200 text-emerald-800 bg-white rounded-lg hover:bg-emerald-50 disabled:opacity-40"
            >
              Confirmă selectate
            </button>
            <button
              type="button"
              disabled={selected.size === 0 || !templateId}
              onClick={() => setEmailOpen(true)}
              className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium border border-slate-200 bg-white rounded-lg hover:bg-slate-50 disabled:opacity-40"
            >
              <Mail className="w-4 h-4" /> Email
            </button>
            <button
              type="button"
              disabled={selected.size === 0 || !templateId || busy}
              onClick={zipSelected}
              className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium border border-slate-200 bg-white rounded-lg hover:bg-slate-50 disabled:opacity-40"
            >
              <Archive className="w-4 h-4" /> Zip
            </button>
            <select
              className={`${inputCls} h-10 py-0 w-full sm:w-44`}
              value={amountRule}
              onChange={(e) => setAmountRule(e.target.value)}
              aria-label="Regulă sumă ciornă"
            >
              <option value="tpo">Ciornă: valoare TPO</option>
              <option value="km_tarif">Ciornă: km × tarif</option>
            </select>
            <button
              type="button"
              disabled={selected.size === 0 || busy}
              onClick={draftInvoice}
              className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium border border-slate-200 bg-white rounded-lg hover:bg-slate-50 disabled:opacity-40"
            >
              Ciornă factură
            </button>
          </div>

          {filterBar}
          <AvizLegend title="Legendă acțiuni" items={AVIZ_ACTION_LEGEND} />

          {rows.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200/80 p-12 text-center text-slate-400 shadow-sm">
              <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Încarcă PDF-uri sau poze de aviz. OCR-ul completează tabelul; tu corectezi km, taxe și observații.</p>
            </div>
          ) : (
            <>
              <div className="lg:hidden space-y-3">
                {rows.map((row) => (
                  <div key={row.id} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4">
                    <div className="flex items-start gap-3">
                      <input type="checkbox" className="mt-1" checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)} />
                      <div className="min-w-0 flex-1">
                        <p className={`font-semibold truncate ${lowField(row, 'numar_tpo') ? 'text-amber-700' : 'text-[#0A2B4E]'}`}>
                          {row.numar_tpo || 'Fără TPO'}
                          {row.duplicate_tpo ? <span className="ml-2 text-[11px] font-normal text-amber-700">TPO duplicat</span> : null}
                        </p>
                        <p className="text-xs text-slate-500 truncate">{row.numar_document_marfa || row.original_filename}</p>
                        <p className={`text-xs mt-1 truncate ${lowField(row, 'numar_auto') ? 'text-amber-700' : 'text-slate-500'}`}>
                          {row.numar_auto || '—'} · {row.data_efectuare_cursa || '—'}
                        </p>
                        <p className={`text-xs truncate ${lowField(row, 'ruta_transport') ? 'text-amber-700' : 'text-slate-500'}`} title={displayRoute(row)}>
                          {displayRoute(row) || '—'}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          <span className="inline-block text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                            {STATUS_LABEL[row.status] || row.status}
                          </span>
                          <SourceBadge source={row.extraction_source} />
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-slate-100 text-xs">
                      <button type="button" className="text-[#1D4E89] disabled:opacity-40" disabled={rowLocked(row.id)} onClick={() => openEdit(row)}>Editează</button>
                      {row.status !== 'confirmed' && (
                        <button type="button" className="text-emerald-700 disabled:opacity-40" disabled={rowLocked(row.id)} onClick={() => confirmRow(row)}>Confirmă</button>
                      )}
                      <button type="button" className="text-slate-600 disabled:opacity-40" disabled={rowLocked(row.id)} onClick={() => reextract(row)}>
                        {busyId === row.id ? 'Re-extrag...' : 'Re-extrage'}
                      </button>
                      <button type="button" className="text-red-500 disabled:opacity-40" disabled={rowLocked(row.id)} onClick={() => setDeleteRow(row)}>Șterge</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden lg:block bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="text-sm table-fixed w-full min-w-[82rem]">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-500 text-xs">
                        <th className="px-3 py-3 w-10 overflow-hidden">
                          <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} />
                        </th>
                        <th className="text-left font-medium px-3 py-3 w-[8rem] overflow-hidden">TPO</th>
                        <th className="text-left font-medium px-3 py-3 w-[7rem] overflow-hidden">Data</th>
                        <th className="text-left font-medium px-3 py-3 w-[11rem] overflow-hidden">Auto</th>
                        <th className="text-left font-medium px-3 py-3 w-[16rem] overflow-hidden">Rută</th>
                        <th className="text-left font-medium px-3 py-3 w-[8rem] overflow-hidden">Marfă</th>
                        <th className="text-left font-medium px-3 py-3 w-[8rem] overflow-hidden">Document</th>
                        <th className="text-left font-medium px-3 py-3 w-[7rem] overflow-hidden">Sursă</th>
                        <th className="text-left font-medium px-3 py-3 w-[6.5rem] overflow-hidden">Status</th>
                        <th className="text-right font-medium px-3 py-3 w-[14rem] overflow-hidden">Acțiuni</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                          <td className="px-3 py-3 overflow-hidden">
                            <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)} />
                          </td>
                          <td className={`px-3 py-3 font-medium truncate ${lowField(row, 'numar_tpo') ? 'text-amber-700' : 'text-[#0A2B4E]'}`} title={row.numar_tpo || row.original_filename || ''}>
                            {row.numar_tpo || (
                              <span className="font-normal text-slate-400">{row.original_filename || '—'}</span>
                            )}
                            {row.duplicate_tpo ? <div className="text-[10px] font-normal text-amber-700">duplicat</div> : null}
                          </td>
                          <td className="px-3 py-3 text-slate-600 truncate">{row.data_efectuare_cursa || '—'}</td>
                          <td className={`px-3 py-3 truncate ${lowField(row, 'numar_auto') ? 'text-amber-700' : ''}`} title={row.numar_auto || ''}>{row.numar_auto || '—'}</td>
                          <td className={`px-3 py-3 truncate ${lowField(row, 'ruta_transport') ? 'text-amber-700' : ''}`} title={displayRoute(row)}>{displayRoute(row) || '—'}</td>
                          <td className="px-3 py-3 truncate" title={`${row.cantitate_marfa ?? ''} ${row.tip_marfa || ''}`.trim()}>
                            {row.cantitate_marfa ?? '—'} {row.tip_marfa || ''}
                          </td>
                          <td className="px-3 py-3 truncate" title={row.numar_document_marfa || ''}>{row.numar_document_marfa || '—'}</td>
                          <td className="px-3 py-3 overflow-hidden"><SourceBadge source={row.extraction_source} /></td>
                          <td className="px-3 py-3 text-xs truncate">{STATUS_LABEL[row.status] || row.status}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap justify-end gap-x-2 gap-y-1">
                              <button type="button" className="text-[#1D4E89] hover:underline text-xs disabled:opacity-40" disabled={rowLocked(row.id)} onClick={() => openEdit(row)}>Editează</button>
                              {row.status !== 'confirmed' && (
                                <button type="button" className="text-emerald-700 hover:underline text-xs disabled:opacity-40" disabled={rowLocked(row.id)} onClick={() => confirmRow(row)}>Confirmă</button>
                              )}
                              <button type="button" className="text-slate-600 hover:underline text-xs disabled:opacity-40" disabled={rowLocked(row.id)} onClick={() => reextract(row)}>
                                {busyId === row.id ? 'Re-extrag...' : 'Re-extrage'}
                              </button>
                              <button type="button" className="text-red-500 hover:underline text-xs disabled:opacity-40" disabled={rowLocked(row.id)} onClick={() => setDeleteRow(row)}>Șterge</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      ) : tab === 'sabloane' ? (
        <AvizTemplatesTab
          templates={templates}
          obsCodes={obsCodes}
          newCode={newCode}
          setNewCode={setNewCode}
          onNewTemplate={newTemplate}
          onEdit={(t) => setEditTemplate(t)}
          onDelete={setDeleteTemplate}
          onAddCode={addObsCode}
          onDeleteCode={(c) => api.avize.deleteObservationCode(c.id).then(() => api.avize.observationCodes().then(setObsCodes)).catch((e) => notifyError('Ștergere eșuată', e))}
        />
      ) : (
        <AvizReportsTab filterBar={filterBar} reportData={reportData} />
      )}

      {editRow && (
        <AvizEditModal
          editRow={editRow}
          form={form}
          setForm={setForm}
          trips={trips}
          obsCodes={obsCodes}
          saving={saving}
          onClose={() => setEditRow(null)}
          onSave={saveEdit}
          onAppendObs={appendObs}
        />
      )}

      {emailOpen && (
        <ModalShell onClose={() => setEmailOpen(false)} panelClassName="max-w-md" labelledBy="aviz-email-title">
          <div className="p-5">
            <h2 id="aviz-email-title" className="text-lg font-semibold text-[#0A2B4E] mb-3">Trimite anexa</h2>
            <label className={labelCls}>Email destinatar</label>
            <input className={inputCls} type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="office@firma.ro" />
            <p className="text-xs text-slate-500 mt-2">{selectedIds.length} aviz(e). Dacă Resend lipsește, anexa se descarcă.</p>
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" className="px-4 py-2 text-sm border rounded-lg" onClick={() => setEmailOpen(false)}>Anulează</button>
              <button type="button" disabled={busy || !emailTo.trim()} className="px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg disabled:opacity-60" onClick={sendAnnexEmail}>
                Trimite
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {editTemplate && (
        <ModalShell onClose={() => setEditTemplate(null)} panelClassName="max-w-3xl" labelledBy="tmpl-edit-title">
          <div className="p-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 id="tmpl-edit-title" className="text-lg font-semibold text-[#0A2B4E]">Șablon XLSX</h2>
              <button type="button" onClick={() => setEditTemplate(null)} aria-label="Închide"><X className="w-5 h-5 text-slate-500" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div>
                <label className={labelCls}>Nume</label>
                <input className={inputCls} value={editTemplate.name || ''} onChange={(e) => setEditTemplate((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 mt-6">
                <input
                  type="checkbox"
                  checked={Boolean(editTemplate.is_default)}
                  onChange={(e) => setEditTemplate((p) => ({ ...p, is_default: e.target.checked }))}
                />
                Șablon implicit
              </label>
            </div>
            <div className="space-y-2">
              {(editTemplate.columns || []).map((col, idx) => (
                <div key={`${col.key}-${idx}`} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end bg-slate-50 rounded-lg p-2">
                  <div className="sm:col-span-3">
                    <label className={labelCls}>Header</label>
                    <input
                      className={inputCls}
                      value={col.header || ''}
                      onChange={(e) => {
                        const columns = [...editTemplate.columns];
                        columns[idx] = { ...col, header: e.target.value };
                        setEditTemplate((p) => ({ ...p, columns }));
                      }}
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label className={labelCls}>Sursă</label>
                    <select
                      className={inputCls}
                      value={col.source || ''}
                      onChange={(e) => {
                        const columns = [...editTemplate.columns];
                        columns[idx] = { ...col, source: e.target.value, key: e.target.value || col.key };
                        setEditTemplate((p) => ({ ...p, columns }));
                      }}
                    >
                      <option value="">(doar default)</option>
                      {AVIZ_SOURCE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-3">
                    <label className={labelCls}>Default</label>
                    <input
                      className={inputCls}
                      value={col.default_value ?? ''}
                      onChange={(e) => {
                        const columns = [...editTemplate.columns];
                        columns[idx] = { ...col, default_value: e.target.value };
                        setEditTemplate((p) => ({ ...p, columns }));
                      }}
                    />
                  </div>
                  <div className="sm:col-span-2 flex justify-end">
                    <button
                      type="button"
                      className="text-red-500 p-2"
                      onClick={() => setEditTemplate((p) => ({ ...p, columns: p.columns.filter((_, i) => i !== idx) }))}
                      aria-label="Șterge coloana"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-3 text-sm text-[#1D4E89]"
              onClick={() => setEditTemplate((p) => ({
                ...p,
                columns: [...(p.columns || []), { key: `col_${Date.now()}`, header: 'Coloană', source: '', default_value: '' }],
              }))}
            >
              + Adaugă coloană
            </button>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="px-4 py-2 text-sm border rounded-lg" onClick={() => setEditTemplate(null)}>Anulează</button>
              <button
                type="button"
                disabled={saving}
                onClick={saveTemplate}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Salvează șablonul
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      <ConfirmDialog
        open={Boolean(deleteRow)}
        onClose={() => { if (!busy) setDeleteRow(null); }}
        onConfirm={runDelete}
        busy={busy}
        variant="danger"
        title="Șterge avizul?"
        description={`Ștergeți ${deleteRow?.numar_tpo || deleteRow?.original_filename || 'acest aviz'}?`}
        confirmLabel="Șterge"
      />
      <ConfirmDialog
        open={Boolean(deleteTemplate)}
        onClose={() => { if (!busy) setDeleteTemplate(null); }}
        onConfirm={runDeleteTemplate}
        busy={busy}
        variant="danger"
        title="Șterge șablonul?"
        description={`Ștergeți ${deleteTemplate?.name || 'acest șablon'}?`}
        confirmLabel="Șterge"
      />
    </div>
  );
}
