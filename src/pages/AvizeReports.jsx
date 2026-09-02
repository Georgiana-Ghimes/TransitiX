import React, { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import ConfirmDialog from '@/components/ConfirmDialog';
import ModalShell from '@/components/ModalShell';
import { notifyError, notifySuccess } from '@/lib/notify';
import { AVIZ_SOURCE_OPTIONS, STATUS_LABEL, nextAvizStatusOnSave } from '@/lib/avizAnnex';
import { datePresetRange, avizIncarcareDate, avizMatchesListFilters, filtersToRevealUploads } from '@/lib/avizOps';
import { findBlurriest } from '@/lib/imageQuality';
import {
  Archive, Camera, Check, ClipboardList, Download, Loader2,
  Mail, Trash2, Upload, X,
} from 'lucide-react';
import AvizEditModal from './avize/AvizEditModal';
import AvizFilterBar from './avize/AvizFilterBar';
import AvizLegend from './avize/AvizLegend';
import AvizReportsTab from './avize/AvizReportsTab';
import AvizTemplatesTab from './avize/AvizTemplatesTab';
import { DriverUploadBadge, NeedsReviewBadge, SourceBadge } from './avize/AvizFilePreview';
import {
  AVIZ_ACTION_LEGEND,
  columnCountOf,
  displayRoute,
  downloadBlob,
  emptyForm,
  formatIncarcareLabel,
  hasManualAvizEdits,
  inputCls,
  manualAvizEditLabels,
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
  const [confirmDuplicate, setConfirmDuplicate] = useState(null);
  const [confirmReextract, setConfirmReextract] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [activePreset, setActivePreset] = useState('');
  const [editTemplate, setEditTemplate] = useState(null);
  const [deleteTemplate, setDeleteTemplate] = useState(null);
  const [filters, setFilters] = useState({
    from: '', to: '', status: '', q: '', uploaded_from: '', date_field: 'cursa',
  });
  const [qInput, setQInput] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [trips, setTrips] = useState([]);
  const [newCode, setNewCode] = useState('');
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const loadGen = useRef(0);
  const bulkConfirmLock = useRef(false);

  const [ocrDown, setOcrDown] = useState(false);

  const confirmableSelectedIds = rows
    .filter((r) => selected.has(r.id) && r.status !== 'confirmed')
    .map((r) => r.id);

  const selectedTemplate = templates.find((t) => t.id === templateId) || null;

  // With no fallback provider, a stopped sidecar means uploads land with no OCR and nothing
  // on screen would say why.
  useEffect(() => {
    api.system.health()
      .then((h) => setOcrDown(h?.capabilities?.ocr === 'paddle-down'))
      .catch(() => setOcrDown(false));
  }, []);

  const load = async (filterOverride) => {
    const activeFilters = filterOverride ?? filters;
    const gen = ++loadGen.current;
    try {
      const [avize, tmpls, codes] = await Promise.all([
        api.avize.list(activeFilters),
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
  }, [filters.from, filters.to, filters.status, filters.q, filters.uploaded_from, filters.date_field]);

  /**
   * Notifications already poll every 15s while the office tab is open. The avize table used to
   * refresh only while a row said `uploaded`, so a finished driver upload (or a new one) stayed
   * invisible until a manual refresh. Same rule as the bell: poll while this page is open and
   * the browser tab is visible; stay quiet when the tab is hidden.
   */
  useEffect(() => {
    if (tab !== 'avize') return undefined;

    const tick = async () => {
      if (document.hidden || uploading || busyId) return;
      const gen = ++loadGen.current;
      try {
        const avize = await api.avize.list(filters);
        if (gen !== loadGen.current) return;
        setRows(avize);
        setSelected((prev) => {
          const visible = new Set(avize.map((r) => r.id));
          return new Set([...prev].filter((id) => visible.has(id)));
        });
      } catch {
        // Background refresh must not toast over the operator.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };

    const timer = setInterval(tick, 15_000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [
    tab,
    uploading,
    busyId,
    filters.from,
    filters.to,
    filters.status,
    filters.q,
    filters.uploaded_from,
    filters.date_field,
  ]);

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
    setFilters({ from: '', to: '', status: '', q: '', uploaded_from: '', date_field: 'cursa' });
    setQInput('');
  };

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true);
    const failed = [];
    let dup = 0;
    let pending = 0;
    const uploadedRows = [];
    let listFilters = filters;
    try {
      // Photos taken at a desk blur too. Unlike the cab, a batch of scans is not interrupted for
      // it — the operator is told which file may not read and the upload carries on.
      const worst = await findBlurriest(files).catch(() => null);
      if (worst) {
        notifyError(
          'O poză pare mișcată',
          `„${worst.file.name}" iese neclară — s-ar putea să nu se extragă nimic din ea. Restul se încarcă normal.`
        );
      }
      for (const file of files) {
        try {
          const uploaded = await api.integrations.Core.UploadFile({ file });
          const row = await api.avize.extract({
            file_url: uploaded.file_url,
            original_filename: file.name,
          });
          uploadedRows.push(row);
          if (row?.duplicate_tpo) dup += 1;
          if (row?.extraction_pending) pending += 1;
        } catch (err) {
          failed.push(file.name);
          console.error('[aviz upload]', file.name, err);
        }
      }
      let filterNote = '';
      if (uploadedRows.length > 0) {
        listFilters = filters;
        const hidden = uploadedRows.filter((r) => r?.id && !avizMatchesListFilters(r, listFilters));
        if (hidden.length > 0) {
          const reveal = filtersToRevealUploads(uploadedRows);
          const hiddenByDate = hidden.some((row) => !avizMatchesListFilters(row, {
            ...listFilters,
            status: '',
            q: '',
            uploaded_from: '',
          }));
          if (hiddenByDate && reveal) {
            listFilters = { ...listFilters, ...reveal };
            setActivePreset('');
            setFilters(listFilters);
            filterNote = ' Lista s-a ajustat la data încărcării ca să vezi avizele noi.';
          }
          const stillHidden = uploadedRows.filter((r) => r?.id && !avizMatchesListFilters(r, listFilters));
          if (stillHidden.length > 0) {
            notifyError(
              'Aviz ascuns de filtru',
              `${stillHidden.length} aviz(e) încărcat(e) nu apar în listă din cauza filtrelor active `
              + '(status, proveniență sau căutare). Resetează filtrele sau ajustează-le.'
            );
          }
        }
      }
      if (failed.length === 0) {
        const pendingNote = pending
          ? ` ${pending} document(e) — OCR-ul rulează în fundal; statusul se actualizează singur.`
          : '';
        notifySuccess(
          'Avize încărcate',
          dup
            ? `${files.length} fișier(e). Atenție: ${dup} TPO există deja (salvarea a rămas).${pendingNote}${filterNote}`
            : `${files.length} fișier(e) procesate.${pendingNote}${filterNote}`
        );
      } else if (failed.length < files.length) {
        notifyError('Unele fișiere nu s-au extras', failed.join(', '));
      } else {
        notifyError('Încărcare eșuată', failed.join(', '));
        return;
      }
      await load(listFilters);
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

  const confirmRow = (row) => {
    if (row.duplicate_tpo) {
      setConfirmDuplicate({ mode: 'single', row });
      return;
    }
    runConfirmRow(row);
  };

  const runConfirmRow = async (row) => {
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

  const bulkConfirm = () => {
    const ids = confirmableSelectedIds;
    if (ids.length === 0) {
      notifyError('Nimic de confirmat', 'Selectează rânduri care nu sunt încă Confirmat.');
      return;
    }
    const dupCount = rows.filter((r) => ids.includes(r.id) && r.duplicate_tpo).length;
    if (dupCount > 0) {
      setConfirmDuplicate({ mode: 'bulk', ids, dupCount });
      return;
    }
    runBulkConfirm(ids);
  };

  const runBulkConfirm = async (ids) => {
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

  const runDuplicateConfirm = async () => {
    if (!confirmDuplicate) return;
    const pending = confirmDuplicate;
    setConfirmDuplicate(null);
    if (pending.mode === 'single') {
      await runConfirmRow(pending.row);
    } else {
      await runBulkConfirm(pending.ids);
    }
  };

  const requestReextract = (row) => {
    if (hasManualAvizEdits(row)) {
      setConfirmReextract(row);
      return;
    }
    reextract(row);
  };

  const runReextractConfirm = async () => {
    if (!confirmReextract) return;
    const row = confirmReextract;
    setConfirmReextract(null);
    await reextract(row);
  };

  const reextract = async (row) => {
    if (busyId) return;
    setBusyId(row.id);
    // Immediate feedback — don't wait for the round-trip to flip status.
    setRows((prev) => prev.map((r) => (
      r.id === row.id ? { ...r, status: 'uploaded' } : r
    )));
    try {
      const result = await api.avize.extract({
        id: row.id, file_url: row.file_url, original_filename: row.original_filename,
      });
      if (result?.extraction_pending) {
        notifySuccess(
          'Extragere pornită',
          result.pages > 1
            ? `Documentul are ${result.pages} pagini — OCR-ul rulează în fundal. Lista se actualizează singură.`
            : 'OCR-ul rulează în fundal. Rândul rămâne pe „Se procesează…” până termină.'
        );
      } else if (!String(result?.numar_tpo || '').trim()) {
        notifyError(
          'OCR fără TPO',
          'Extragerea s-a terminat, dar nu am găsit număr TPO. Deschide Editează sau încearcă o poză mai clară.'
        );
      } else {
        notifySuccess(
          'Re-extras',
          `${result.numar_tpo} — TPO/auto/rută din document; km, taxe și ruta de birou rămân.`
        );
      }
      await load();
    } catch (e) {
      notifyError('Extragere eșuată', e);
      await load();
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
      const dupCount = rows.filter((r) => ids.includes(r.id) && r.duplicate_tpo).length;
      const { blob, filename } = await api.avize.exportXlsx({ template_id: templateId, aviz_ids: ids });
      downloadBlob(blob, filename);
      // Naming the template here is the only place the operator can tell which layout landed
      // in the file — the filename alone reads the same for every export of the day.
      notifySuccess(
        'Export gata',
        `${filename} — șablon ${selectedTemplate?.name || 'selectat'}, `
        + `${columnCountOf(selectedTemplate)} coloane.`
      );
      if (dupCount > 0) {
        notifyError(
          'Atenție la export',
          dupCount === 1
            ? 'Un aviz marcat „duplicat” a fost inclus. Verifică dacă nu e o încărcare dublă.'
            : `${dupCount} avize marcate „duplicat” au fost incluse. Verifică dacă nu sunt încărcări duble.`
        );
      }
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
      if (result?.email_sent === false || result?.stub || result?.download) {
        if (result?.content_base64) {
          const bin = Uint8Array.from(atob(result.content_base64), (c) => c.charCodeAt(0));
          downloadBlob(new Blob([bin]), result.filename || 'anexa.xlsx');
        }
        notifyError(
          'Email netrimis',
          result?.message
            || 'Resend nu este configurat — emailul nu a fost trimis. Descarcă anexa cu „Unește în Anexa XLSX”.'
        );
      } else {
        notifySuccess('Email trimis', result?.filename || emailTo);
        setEmailOpen(false);
      }
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
      const inv = await api.avize.draftInvoice({ aviz_ids: ids });
      // The lines come from the pricing engine, so the count is worth saying: it tells the
      // operator the invoice is itemised, not a single re-derived figure.
      notifySuccess(
        'Ciornă factură',
        `${inv.series || 'TRX'}-${inv.number} — ${inv.lines?.length ?? 0} linii din TPO. `
        + 'Deschide Financiar. Fără e-Factura.'
      );
      for (const warning of inv.warnings ?? []) {
        notifyError('Atenție la ciornă', warning.message);
      }
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
    const columns = editTemplate.columns || [];
    if (columns.length === 0) {
      notifyError('Fără coloane', 'Adaugă cel puțin o coloană — altfel exportul nu ar avea ce scrie.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name,
        is_default: Boolean(editTemplate.is_default),
        columns,
      };
      let keepId = editTemplate.id;
      if (editTemplate.id) {
        await api.avize.updateTemplate(editTemplate.id, payload);
      } else {
        const created = await api.avize.createTemplate(payload);
        keepId = created?.id;
      }
      setEditTemplate(null);
      await load();
      // Only claim the template is active once the id actually landed in state; the old message
      // said "e selectat" unconditionally, which is how an export could silently use another one.
      if (keepId) {
        setTemplateId(keepId);
        notifySuccess('Șablon salvat', `${name} — ${columns.length} coloane, folosit la următorul export.`);
      } else {
        notifySuccess('Șablon salvat', `${name} — ${columns.length} coloane. Alege-l cu „Folosește la export”.`);
      }
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

  const useTemplateForExport = (id) => {
    const chosen = templates.find((t) => t.id === id);
    if (!chosen) return;
    setTemplateId(id);
    notifySuccess('Șablon activ', `${chosen.name} — ${columnCountOf(chosen)} coloane la următorul export.`);
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

  const ocrBanner = ocrDown ? (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      Serviciul OCR nu răspunde. Documentele se încarcă în continuare, dar ajung fără câmpuri
      completate — pornește sidecar-ul PaddleOCR și apasă „Re-extrage".
    </div>
  ) : null;

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
                {selectedTemplate
                  ? `Exportă ${columnCountOf(selectedTemplate)} coloane, cu valorile Default din șablon.`
                  : 'Exportul folosește acest șablon, inclusiv Default (ex. taxă 100, tarif 20).'}
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
            <button
              type="button"
              disabled={selected.size === 0 || busy}
              onClick={draftInvoice}
              className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium border border-slate-200 bg-white rounded-lg hover:bg-slate-50 disabled:opacity-40"
            >
              Ciornă factură
            </button>
          </div>

          {ocrBanner}
          {filterBar}
          <AvizLegend title="Legendă acțiuni" items={AVIZ_ACTION_LEGEND} />

          {rows.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200/80 p-12 text-center text-slate-400 shadow-sm">
              <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Încarcă PDF-uri sau poze de aviz. OCR-ul completează tabelul; tu corectezi km, taxe și observații.</p>
            </div>
          ) : (
            <>
              <div className="xl:hidden space-y-3">
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className={`bg-white rounded-xl border shadow-sm p-4 relative ${
                      busyId === row.id
                        ? 'border-sky-300 ring-1 ring-sky-200'
                        : 'border-slate-200/80'
                    }`}
                  >
                    {busyId === row.id ? (
                      <div className="absolute inset-0 z-10 rounded-xl bg-white/70 flex items-center justify-center gap-2 text-sm text-sky-800">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Se re-extrage…
                      </div>
                    ) : null}
                    <div className="flex items-start gap-3">
                      <input type="checkbox" className="mt-1" checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)} disabled={busyId === row.id} />
                      <div className="min-w-0 flex-1">
                        <p className={`font-semibold truncate ${lowField(row, 'numar_tpo') ? 'text-amber-700' : 'text-[#0A2B4E]'}`}>
                          {row.numar_tpo || 'Fără TPO'}
                          {row.duplicate_tpo ? <span className="ml-2 text-[11px] font-normal text-amber-700">TPO duplicat</span> : null}
                        </p>
                        <p className="text-xs text-slate-500 truncate">{row.numar_document_marfa || row.original_filename}</p>
                        <p className={`text-xs mt-1 truncate ${lowField(row, 'numar_auto') ? 'text-amber-700' : 'text-slate-500'}`}>
                          {row.numar_auto || '—'} · {row.data_efectuare_cursa || '—'}
                        </p>
                        <p className={`text-xs mt-1 truncate ${lowField(row, 'ruta_transport') ? 'text-amber-700' : 'text-slate-500'}`} title={displayRoute(row)}>
                          {displayRoute(row) || '—'}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-1 truncate" title={formatIncarcareLabel(row, avizIncarcareDate)}>
                          {formatIncarcareLabel(row, avizIncarcareDate)}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${
                            row.status === 'uploaded' || busyId === row.id
                              ? 'bg-sky-50 text-sky-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}>
                            {row.status === 'uploaded' || busyId === row.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                            {busyId === row.id ? 'Se re-extrage…' : (STATUS_LABEL[row.status] || row.status)}
                          </span>
                          <SourceBadge source={row.extraction_source} />
                          <DriverUploadBadge uploadedFrom={row.uploaded_from} />
                          <NeedsReviewBadge needsReview={row.needs_review} />
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-slate-100 text-xs">
                      <button type="button" className="text-[#1D4E89] disabled:opacity-40" disabled={rowLocked(row.id)} onClick={() => openEdit(row)}>Editează</button>
                      {row.status !== 'confirmed' && (
                        <button type="button" className="text-emerald-700 disabled:opacity-40" disabled={rowLocked(row.id)} onClick={() => confirmRow(row)}>Confirmă</button>
                      )}
                      <button type="button" className="text-slate-600 disabled:opacity-40 inline-flex items-center gap-1" disabled={rowLocked(row.id)} onClick={() => requestReextract(row)}>
                        {busyId === row.id ? <><Loader2 className="w-3 h-3 animate-spin" /> Re-extrag…</> : 'Re-extrage'}
                      </button>
                      <button type="button" className="text-red-500 disabled:opacity-40" disabled={rowLocked(row.id)} onClick={() => setDeleteRow(row)}>Șterge</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden xl:block bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
                <p className="px-4 py-2 text-[11px] text-slate-500 border-b border-slate-100 xl:block 2xl:hidden">
                  Marfă și Document apar pe ecrane late (≥1536px). Pe laptop derulează ușor spre dreapta dacă e nevoie — coloana Acțiuni rămâne fixă.
                </p>
                <div className="overflow-x-auto">
                  <table className="text-sm w-full">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-500 text-xs">
                        <th className="px-2 py-2.5 w-9">
                          <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} />
                        </th>
                        <th className="text-left font-medium px-2 py-2.5 min-w-[6.5rem]">TPO</th>
                        <th className="text-left font-medium px-2 py-2.5 w-[5.5rem]">Data</th>
                        <th className="text-left font-medium px-2 py-2.5 min-w-[5.5rem] max-w-[8rem]">Auto</th>
                        <th className="text-left font-medium px-2 py-2.5 min-w-[8rem]">Rută</th>
                        <th className="text-left font-medium px-2 py-2.5 min-w-[5rem] hidden 2xl:table-cell">Marfă</th>
                        <th className="text-left font-medium px-2 py-2.5 min-w-[5rem] hidden 2xl:table-cell">Document</th>
                        <th className="text-left font-medium px-2 py-2.5 min-w-[6.5rem]">Stare</th>
                        <th className="text-left font-medium px-2 py-2.5 min-w-[7.5rem]">Încărcare</th>
                        <th className="text-right font-medium px-2 py-2.5 min-w-[9.5rem] sticky right-0 z-10 bg-white shadow-[-8px_0_12px_-8px_rgba(15,23,42,0.08)]">
                          Acțiuni
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.id}
                          className={`group border-b border-slate-50 ${
                            busyId === row.id ? 'bg-sky-50/80' : 'hover:bg-slate-50/50'
                          }`}
                        >
                          <td className="px-2 py-2.5">
                            <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)} disabled={busyId === row.id} />
                          </td>
                          <td className={`px-2 py-2.5 font-medium truncate max-w-[9rem] ${lowField(row, 'numar_tpo') ? 'text-amber-700' : 'text-[#0A2B4E]'}`} title={row.numar_tpo || row.original_filename || ''}>
                            {busyId === row.id ? (
                              <span className="inline-flex items-center gap-1.5 font-normal text-sky-800">
                                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                Se re-extrage…
                              </span>
                            ) : row.numar_tpo ? (
                              row.numar_tpo
                            ) : (
                              <span className="font-normal text-slate-400">{row.original_filename || '—'}</span>
                            )}
                            {row.duplicate_tpo && busyId !== row.id ? <div className="text-[10px] font-normal text-amber-700">duplicat</div> : null}
                          </td>
                          <td className="px-2 py-2.5 text-slate-600 truncate whitespace-nowrap">{row.data_efectuare_cursa || '—'}</td>
                          <td className={`px-2 py-2.5 truncate max-w-[8rem] ${lowField(row, 'numar_auto') ? 'text-amber-700' : ''}`} title={row.numar_auto || ''}>{row.numar_auto || '—'}</td>
                          <td className={`px-2 py-2.5 truncate max-w-[12rem] ${lowField(row, 'ruta_transport') ? 'text-amber-700' : ''}`} title={displayRoute(row)}>{displayRoute(row) || '—'}</td>
                          <td className="px-2 py-2.5 truncate max-w-[7rem] hidden 2xl:table-cell" title={`${row.cantitate_marfa ?? ''} ${row.tip_marfa || ''}`.trim()}>
                            {row.cantitate_marfa ?? '—'} {row.tip_marfa || ''}
                          </td>
                          <td className="px-2 py-2.5 truncate max-w-[7rem] hidden 2xl:table-cell" title={row.numar_document_marfa || ''}>{row.numar_document_marfa || '—'}</td>
                          <td className="px-2 py-2.5">
                            <div className="space-y-1">
                              <span className={`inline-flex items-center gap-1 text-xs truncate ${
                                row.status === 'uploaded' || busyId === row.id ? 'text-sky-800' : 'text-slate-700'
                              }`}>
                                {row.status === 'uploaded' || busyId === row.id ? <Loader2 className="w-3 h-3 animate-spin shrink-0" /> : null}
                                {busyId === row.id ? 'Se re-extrage…' : (STATUS_LABEL[row.status] || row.status)}
                              </span>
                              <div className="flex flex-wrap gap-1">
                                <SourceBadge source={row.extraction_source} />
                                <DriverUploadBadge uploadedFrom={row.uploaded_from} />
                                <NeedsReviewBadge needsReview={row.needs_review} />
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2.5 text-xs text-slate-600 whitespace-nowrap" title={formatIncarcareLabel(row, avizIncarcareDate)}>
                            {formatIncarcareLabel(row, avizIncarcareDate)}
                          </td>
                          <td className={`px-2 py-2.5 sticky right-0 z-10 shadow-[-8px_0_12px_-8px_rgba(15,23,42,0.08)] ${
                            busyId === row.id ? 'bg-sky-50/80' : 'bg-white group-hover:bg-slate-50/50'
                          }`}>
                            <div className="flex flex-col items-end gap-0.5">
                              <button type="button" className="text-[#1D4E89] hover:underline text-xs disabled:opacity-40" disabled={rowLocked(row.id)} onClick={() => openEdit(row)}>Editează</button>
                              {row.status !== 'confirmed' && (
                                <button type="button" className="text-emerald-700 hover:underline text-xs disabled:opacity-40" disabled={rowLocked(row.id)} onClick={() => confirmRow(row)}>Confirmă</button>
                              )}
                              <button type="button" className="text-slate-600 hover:underline text-xs disabled:opacity-40 inline-flex items-center gap-1" disabled={rowLocked(row.id)} onClick={() => requestReextract(row)}>
                                {busyId === row.id ? <><Loader2 className="w-3 h-3 animate-spin" /> Re-extrag…</> : 'Re-extrage'}
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
          activeTemplateId={templateId}
          onUseForExport={useTemplateForExport}
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
        open={Boolean(confirmReextract)}
        onClose={() => { if (!busyId) setConfirmReextract(null); }}
        onConfirm={runReextractConfirm}
        busy={Boolean(busyId)}
        variant="warning"
        title="Re-extrage peste editări?"
        description={
          `„${confirmReextract?.numar_tpo || confirmReextract?.original_filename || 'Acest aviz'}” `
          + `are valori diferite de ultima extragere: ${manualAvizEditLabels(confirmReextract).join(', ')}. `
          + 'Re-extragerea le rescrie din fișier; km, taxe, valoare TPO, observațiile și ruta de birou rămân. '
          + 'Continui?'
        }
        confirmLabel="Re-extrage oricum"
      />
      <ConfirmDialog
        open={Boolean(confirmDuplicate)}
        onClose={() => { if (!busy && !busyId) setConfirmDuplicate(null); }}
        onConfirm={runDuplicateConfirm}
        busy={busy || Boolean(busyId)}
        variant="warning"
        title="TPO duplicat"
        description={
          confirmDuplicate?.mode === 'bulk'
            ? `${confirmDuplicate.dupCount} din rândurile selectate au același TPO ca alt document. `
              + 'Dacă sunt încărcări greșite, folosește Șterge înainte de confirmare. Confirmi oricum?'
            : `„${confirmDuplicate?.row?.numar_tpo || confirmDuplicate?.row?.original_filename || 'Acest aviz'}” `
              + 'are același TPO ca alt rând. Dacă e o încărcare greșită, folosește Șterge. Confirmi oricum?'
        }
        confirmLabel="Confirmă oricum"
      />
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
