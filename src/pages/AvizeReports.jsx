import React, { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import ConfirmDialog from '@/components/ConfirmDialog';
import ModalShell from '@/components/ModalShell';
import { notifyError, notifySuccess } from '@/lib/notify';
import { AVIZ_FORM_FIELDS, AVIZ_SOURCE_OPTIONS, STATUS_LABEL, nextAvizStatusOnSave } from '@/lib/avizAnnex';
import { datePresetRange, previewKind } from '@/lib/avizOps';
import { fetchUploadBlob } from '@/lib/uploadUrl';
import {
  Archive, Camera, Check, ClipboardList, Download, FileSpreadsheet, HelpCircle, Loader2,
  Mail, Pencil, Plus, Trash2, Upload, X,
} from 'lucide-react';

function LegendPanel({ title, items }) {
  return (
    <details className="bg-sky-50/80 rounded-xl border border-sky-100 group" open>
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[#0A2B4E] flex items-center justify-between gap-2 list-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 min-w-0">
          <HelpCircle className="w-4 h-4 text-sky-700 shrink-0" />
          <span className="truncate">{title}</span>
        </span>
        <span className="text-xs font-normal text-sky-800/70 shrink-0 group-open:hidden">Arată</span>
        <span className="text-xs font-normal text-sky-800/70 shrink-0 hidden group-open:inline">Ascunde</span>
      </summary>
      <dl className="grid gap-3 sm:grid-cols-2 px-4 pb-4 pt-1 border-t border-sky-100/80">
        {items.map((item) => (
          <div key={item.name} className="min-w-0">
            <dt className="text-xs font-semibold text-[#0A2B4E]">{item.name}</dt>
            <dd className="text-xs text-slate-600 mt-0.5 leading-relaxed">{item.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

const AVIZ_ACTION_LEGEND = [
  {
    name: 'Încarcă avize / Foto',
    text: 'Adaugă PDF-ul sau poza avizului. Sistemul citește TPO, dată, auto, rută, cantitate. Km, taxe, valoare TPO și observații se completează manual.',
  },
  {
    name: 'Editează',
    text: 'Corectează extracția sau completează câmpurile care nu sunt pe aviz (km, tarif, taxe, observații). Salvarea rămâne după refresh, inclusiv dată, auto, rută și document. Folosește Re-extrage doar dacă vrei din nou valorile din PDF.',
  },
  {
    name: 'Confirmă',
    text: 'Marchează rândul ca verificat (status Confirmat). Nu blochează exportul — poți uni și rânduri neverificate, dar Confirmă e semnul că datele sunt gata de factură.',
  },
  {
    name: 'Re-extrage',
    text: 'Citește din nou fișierul și rescrie TPO, dată, auto, rută, cantitate, document din PDF. Km, taxe, valoare TPO, observațiile și ruta de birou rămân. Folosește-l doar dacă vrei valorile din aviz, nu cele din Editează.',
  },
  {
    name: 'Șterge',
    text: 'Scoate avizul din listă. Folosește-l pentru dubluri, teste sau documente încărcate greșit. Nu se poate anula.',
  },
  {
    name: 'Unește în Anexa XLSX',
    text: 'Bifează rândurile, alege șablonul din lista de lângă buton (nu e de ajuns să-l salvezi în tab-ul Șabloane), apoi descarcă. Valorile Default din șablon (ex. Taxă 100, Tarif km 20) se scriu în Excel când pe aviz câmpul e gol sau 0.',
  },
];

const TEMPLATE_ACTION_LEGEND = [
  {
    name: 'Cum se aplică',
    text: 'Șablonul selectat în tab-ul Avize (lista de lângă Unește) este cel folosit la export. „Implicit” este preselectat la deschiderea paginii. Anexa Factura RAI nu se poate suprascrie — duplică-l ca șablon nou.',
  },
  {
    name: 'Șablon nou / Editează',
    text: 'Definește coloanele XLSX: antetul din Excel, sursa (câmp din aviz) și Default dacă sursa e goală sau 0 (taxă, tarif, km). Nu trebuie să păstrezi toate cele 14 coloane — exportul folosește exact ce salvezi. Apoi selectează șablonul în tab-ul Avize înainte de Unește.',
  },
  {
    name: 'Șterge șablon',
    text: 'Elimină doar șablonul, nu avizele. Păstrează Anexa Factura RAI dacă vrei exportul standard pe 14 coloane.',
  },
];

const SOURCE_LABEL = {
  'pdf-text': 'Text PDF',
  vision: 'Vision',
  stub: 'Stub',
};

const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89] transition-colors';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';

function isLockedRai(t) {
  return Boolean(t?.is_default) && String(t?.name || '').trim() === 'Anexa Factura RAI';
}

function emptyForm(row = {}) {
  const form = {};
  for (const f of AVIZ_FORM_FIELDS) {
    form[f.key] = row[f.key] ?? '';
  }
  form.ruta_display = row.ruta_display ?? '';
  form.trip_id = row.trip_id ?? '';
  return form;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function SourceBadge({ source }) {
  const key = source || 'stub';
  const tone = key === 'pdf-text'
    ? 'bg-sky-50 text-sky-800'
    : key === 'vision'
      ? 'bg-violet-50 text-violet-800'
      : 'bg-amber-50 text-amber-800';
  return (
    <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full ${tone}`}>
      {SOURCE_LABEL[key] || key}
    </span>
  );
}

function AvizFilePreview({ fileUrl }) {
  const [src, setSrc] = useState('');
  const kind = previewKind(fileUrl);

  useEffect(() => {
    let objectUrl = '';
    let cancelled = false;
    (async () => {
      const blob = await fetchUploadBlob(fileUrl);
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileUrl]);

  if (!src) {
    return <p className="text-xs text-slate-500 p-4">Se încarcă preview…</p>;
  }
  if (kind === 'pdf') {
    return <iframe title="Previzualizare aviz" className="w-full h-[320px]" src={src} />;
  }
  if (kind === 'image') {
    return <img alt="Aviz" className="w-full max-h-[320px] object-contain" src={src} />;
  }
  return <p className="text-xs text-slate-500 p-4">Nu există preview pentru acest fișier.</p>;
}

function displayRoute(row) {
  return String(row?.ruta_display || '').trim() || row?.ruta_transport || '';
}

function lowField(row, key) {
  return row?.field_confidence?.[key] === 'low';
}

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
    setFilters((prev) => ({ ...prev, ...range }));
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
    const ids = [...selected];
    if (ids.length === 0) {
      notifyError('Nimic selectat', 'Bifează avizele de confirmat.');
      return;
    }
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
    try {
      const { blob, filename } = await api.avize.exportXlsx({ template_id: templateId, aviz_ids: ids });
      downloadBlob(blob, filename);
      notifySuccess('Export gata', filename);
    } catch (e) {
      notifyError('Export eșuat', e);
    }
  };

  const zipSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0 || !templateId) {
      notifyError('Nimic selectat', 'Bifează avize și alege șablonul.');
      return;
    }
    try {
      const { blob, filename, missing } = await api.avize.zipExport({ template_id: templateId, aviz_ids: ids });
      downloadBlob(blob, filename);
      notifySuccess('Zip gata', missing ? `${filename} (${missing} originale lipsă de pe disk)` : filename);
    } catch (e) {
      notifyError('Zip eșuat', e);
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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 bg-white rounded-xl border border-slate-200/80 p-3">
      <div className="flex flex-wrap gap-1 lg:col-span-6">
        {[['today', 'Azi'], ['week', 'Săptămâna asta'], ['month', 'Luna asta']].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => applyPreset(id)}
            className="px-2.5 py-1 text-xs rounded-full border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => { setFilters({ from: '', to: '', status: '', q: '' }); setQInput(''); }}
          className="px-2.5 py-1 text-xs rounded-full text-slate-500 hover:underline"
        >
          Resetează
        </button>
        {refreshing && <span className="text-xs text-slate-500 self-center">Se actualizează lista…</span>}
      </div>
      <div>
        <label className={labelCls}>De la</label>
        <input className={inputCls} type="date" value={filters.from} onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))} />
      </div>
      <div>
        <label className={labelCls}>Până la</label>
        <input className={inputCls} type="date" value={filters.to} onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))} />
      </div>
      <div>
        <label className={labelCls}>Status</label>
        <select className={inputCls} value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
          <option value="">Toate</option>
          <option value="uploaded">Încărcat</option>
          <option value="extracted">Extras</option>
          <option value="confirmed">Confirmat</option>
        </select>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <label className={labelCls}>Caută TPO / auto / document / fișier</label>
        <input
          className={inputCls}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="TPO-00…"
        />
      </div>
    </div>
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
              disabled={selected.size === 0 || !templateId}
              onClick={exportSelected}
              title={selected.size === 0 ? 'Bifează avizele din tabel, apoi apasă aici' : 'Unește rândurile selectate într-un fișier Anexa Factură'}
              className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium text-white bg-[#0A7A3E] rounded-lg hover:bg-[#096c37] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              Unește în Anexa XLSX ({selected.size})
            </button>
            <button
              type="button"
              disabled={selected.size === 0 || busy}
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
              disabled={selected.size === 0 || !templateId}
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
          <LegendPanel title="Legendă acțiuni" items={AVIZ_ACTION_LEGEND} />

          {rows.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200/80 p-12 text-center text-slate-400 shadow-sm">
              <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Încarcă PDF-uri sau poze de aviz. OCR-ul completează tabelul; tu corectezi km, taxe și observații.</p>
            </div>
          ) : (
            <>
              <div className="md:hidden space-y-3">
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

              <div className="hidden md:block bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm table-fixed min-w-[860px]">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-500 text-xs">
                        <th className="px-3 py-3 w-10">
                          <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} />
                        </th>
                        <th className="text-left font-medium px-3 py-3 w-[9rem]">TPO</th>
                        <th className="text-left font-medium px-3 py-3 w-[7rem]">Data</th>
                        <th className="text-left font-medium px-3 py-3 w-[11rem]">Auto</th>
                        <th className="text-left font-medium px-3 py-3">Rută</th>
                        <th className="text-left font-medium px-3 py-3 w-[8rem]">Marfă</th>
                        <th className="text-left font-medium px-3 py-3 w-[8rem]">Document</th>
                        <th className="text-left font-medium px-3 py-3 w-[7rem]">Sursă</th>
                        <th className="text-left font-medium px-3 py-3 w-[6rem]">Status</th>
                        <th className="text-right font-medium px-3 py-3 w-[11rem]">Acțiuni</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                          <td className="px-3 py-3">
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
                          <td className="px-3 py-3"><SourceBadge source={row.extraction_source} /></td>
                          <td className="px-3 py-3 text-xs truncate">{STATUS_LABEL[row.status] || row.status}</td>
                          <td className="px-3 py-3 text-right whitespace-nowrap">
                            <button type="button" className="text-[#1D4E89] hover:underline text-xs disabled:opacity-40" disabled={rowLocked(row.id)} onClick={() => openEdit(row)}>Editează</button>
                            {row.status !== 'confirmed' && (
                              <button type="button" className="text-emerald-700 hover:underline text-xs ml-2 disabled:opacity-40" disabled={rowLocked(row.id)} onClick={() => confirmRow(row)}>Confirmă</button>
                            )}
                            <button type="button" className="text-slate-600 hover:underline text-xs ml-2 disabled:opacity-40" disabled={rowLocked(row.id)} onClick={() => reextract(row)}>
                              {busyId === row.id ? 'Re-extrag...' : 'Re-extrage'}
                            </button>
                            <button type="button" className="text-red-500 hover:underline text-xs ml-2 disabled:opacity-40" disabled={rowLocked(row.id)} onClick={() => setDeleteRow(row)}>Șterge</button>
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
        <div className="space-y-4">
          <LegendPanel title="Legendă șabloane" items={TEMPLATE_ACTION_LEGEND} />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={newTemplate}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89]"
            >
              <Plus className="w-4 h-4" /> Șablon nou
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((t) => (
              <div key={t.id} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[#0A2B4E]">{t.name}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {Array.isArray(t.columns) ? t.columns.length : 0} coloane
                      {t.is_default ? ' · implicit' : ''}
                      {isLockedRai(t) ? ' · blocat' : ''}
                    </p>
                  </div>
                  <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
                </div>
                <div className="flex gap-3 mt-4 text-xs">
                  {isLockedRai(t) ? (
                    <span className="text-slate-400">Nu se poate modifica</span>
                  ) : (
                    <>
                      <button type="button" className="text-[#1D4E89]" onClick={() => setEditTemplate({ ...t, columns: t.columns || [] })}>Editează</button>
                      <button type="button" className="text-red-500" onClick={() => setDeleteTemplate(t)}>Șterge</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-slate-200/80 p-4">
            <p className="text-sm font-medium text-[#0A2B4E] mb-2">Coduri observații</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {obsCodes.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-100">
                  {c.code}
                  <button type="button" className="text-red-500" onClick={() => api.avize.deleteObservationCode(c.id).then(() => api.avize.observationCodes().then(setObsCodes)).catch((e) => notifyError('Ștergere eșuată', e))} aria-label={`Șterge ${c.code}`}>×</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input className={inputCls} value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="ex. Z:B*" />
              <button type="button" className="px-3 py-2 text-sm border rounded-lg" onClick={addObsCode}>Adaugă</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {filterBar}
          <p className="text-xs text-slate-500">
            Rapoartele nu modifică șablonul Anexa Factura RAI. Unește rămâne pe tab-ul Avize.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="bg-white rounded-xl border border-slate-200/80 p-4 overflow-x-auto">
              <h2 className="text-sm font-semibold text-[#0A2B4E] mb-3">Km / avize pe număr auto</h2>
              <table className="w-full text-sm min-w-[280px]">
                <thead>
                  <tr className="text-xs text-slate-500 border-b">
                    <th className="text-left py-2">Auto</th>
                    <th className="text-right py-2">Avize</th>
                    <th className="text-right py-2">Km</th>
                  </tr>
                </thead>
                <tbody>
                  {(reportData.by_plate || []).length === 0 ? (
                    <tr><td colSpan={3} className="py-3 text-slate-400 text-sm">Niciun aviz în interval.</td></tr>
                  ) : (reportData.by_plate || []).map((row) => (
                    <tr key={row.plate} className="border-b border-slate-50">
                      <td className="py-2">{row.plate}</td>
                      <td className="py-2 text-right">{row.count}</td>
                      <td className="py-2 text-right">{row.km}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bg-white rounded-xl border border-slate-200/80 p-4 overflow-x-auto">
              <h2 className="text-sm font-semibold text-[#0A2B4E] mb-3">Avize pe săptămână</h2>
              <table className="w-full text-sm min-w-[280px]">
                <thead>
                  <tr className="text-xs text-slate-500 border-b">
                    <th className="text-left py-2">Săptămână</th>
                    <th className="text-right py-2">Total</th>
                    <th className="text-right py-2">Confirmate</th>
                  </tr>
                </thead>
                <tbody>
                  {(reportData.weekly || []).length === 0 ? (
                    <tr><td colSpan={3} className="py-3 text-slate-400 text-sm">Nicio săptămână în interval.</td></tr>
                  ) : (reportData.weekly || []).map((row) => (
                    <tr key={row.week_start} className="border-b border-slate-50">
                      <td className="py-2">{String(row.week_start).slice(0, 10)}</td>
                      <td className="py-2 text-right">{row.count}</td>
                      <td className="py-2 text-right">{row.confirmed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200/80 p-4 overflow-x-auto">
            <h2 className="text-sm font-semibold text-[#0A2B4E] mb-3">Istoric export</h2>
            <table className="w-full text-sm min-w-[360px]">
              <thead>
                <tr className="text-xs text-slate-500 border-b">
                  <th className="text-left py-2">Când</th>
                  <th className="text-left py-2">Tip</th>
                  <th className="text-left py-2">Fișier</th>
                  <th className="text-right py-2">Avize</th>
                </tr>
              </thead>
                <tbody>
                  {(reportData.exports || []).length === 0 ? (
                    <tr><td colSpan={4} className="py-3 text-slate-400 text-sm">Niciun export încă.</td></tr>
                  ) : (reportData.exports || []).map((row) => (
                    <tr key={row.id} className="border-b border-slate-50">
                      <td className="py-2">{String(row.created_at || '').slice(0, 16).replace('T', ' ')}</td>
                      <td className="py-2">{row.kind}</td>
                      <td className="py-2 truncate">{row.filename || '—'}</td>
                      <td className="py-2 text-right">{row.aviz_count ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
            </table>
          </div>
        </div>
      )}

      {editRow && (
        <ModalShell onClose={() => setEditRow(null)} panelClassName="max-w-5xl" labelledBy="aviz-edit-title">
          <div className="p-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 id="aviz-edit-title" className="text-lg font-semibold text-[#0A2B4E]">Editează aviz</h2>
              <button type="button" onClick={() => setEditRow(null)} aria-label="Închide"><X className="w-5 h-5 text-slate-500" /></button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50 min-h-[220px]">
                <AvizFilePreview fileUrl={editRow.file_url} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {AVIZ_FORM_FIELDS.map((f) => (
                  <div key={f.key} className={f.key === 'ruta_transport' || f.key === 'observatii' ? 'sm:col-span-2' : ''}>
                    <label className={labelCls}>{f.label}{lowField(editRow, f.key) ? ' · verifică (parser nesigur)' : ''}</label>
                    <input
                      className={`${inputCls} ${lowField(editRow, f.key) ? 'border-amber-300' : ''}`}
                      type={f.type || 'text'}
                      step={f.step}
                      value={form[f.key] ?? ''}
                      onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    />
                  </div>
                ))}
                <div className="sm:col-span-2">
                  <label className={labelCls}>Rută birou (nu merge în Excel)</label>
                  <input className={inputCls} value={form.ruta_display ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, ruta_display: e.target.value }))} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Cursă (opțional)</label>
                  <select className={inputCls} value={form.trip_id || ''} onChange={(e) => setForm((prev) => ({ ...prev, trip_id: e.target.value }))}>
                    <option value="">Fără cursă</option>
                    {trips.map((t) => (
                      <option key={t.id} value={t.id}>{t.cmr_number} · {t.vehicle_plate || '—'} · {t.loading_date || ''}</option>
                    ))}
                  </select>
                  {trips.length === 0 && (
                    <p className="text-[11px] text-slate-500 mt-1">Nicio cursă pe auto + zi. Poți salva fără cursă.</p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs text-slate-500 mb-1">Coduri observații (textul rămâne editabil)</p>
                  <div className="flex flex-wrap gap-1">
                    {obsCodes.map((c) => (
                      <button key={c.id} type="button" className="text-xs px-2 py-1 rounded-full border border-slate-200 hover:bg-slate-50" onClick={() => appendObs(c.code)}>
                        {c.code}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="px-4 py-2 text-sm border rounded-lg" onClick={() => setEditRow(null)}>Anulează</button>
              <button
                type="button"
                disabled={saving}
                onClick={saveEdit}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
                Salvează
              </button>
            </div>
          </div>
        </ModalShell>
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
