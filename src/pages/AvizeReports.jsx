import React, { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import ConfirmDialog from '@/components/ConfirmDialog';
import ModalShell from '@/components/ModalShell';
import { notifyError, notifySuccess } from '@/lib/notify';
import { AVIZ_FORM_FIELDS, AVIZ_SOURCE_OPTIONS, STATUS_LABEL } from '@/lib/avizAnnex';
import {
  Camera, Check, ClipboardList, Download, FileSpreadsheet, HelpCircle, Loader2,
  Pencil, Plus, Trash2, Upload, X,
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
    text: 'Citește din nou fișierul și rescrie TPO, dată, auto, rută, cantitate, document din PDF. Folosește-l doar dacă vrei valorile din aviz, nu cele din Editează. Completează km/taxe după.',
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
    text: 'Șablonul selectat în tab-ul Avize (lista de lângă Unește) este cel folosit la export. „Implicit” este preselectat la deschiderea paginii.',
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

const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89] transition-colors';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';

function emptyForm(row = {}) {
  const form = {};
  for (const f of AVIZ_FORM_FIELDS) {
    form[f.key] = row[f.key] ?? (f.type === 'number' ? '' : '');
  }
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

export default function AvizeReports() {
  const [tab, setTab] = useState('avize');
  const [rows, setRows] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [templateId, setTemplateId] = useState('');
  const [editRow, setEditRow] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deleteRow, setDeleteRow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editTemplate, setEditTemplate] = useState(null);
  const [deleteTemplate, setDeleteTemplate] = useState(null);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);

  const load = async () => {
    try {
      const [avize, tmpls] = await Promise.all([
        api.entities.AvizDocument.list('-created_date', 200),
        api.avize.templates(),
      ]);
      setRows(avize);
      setTemplates(tmpls);
      setTemplateId((prev) => {
        if (prev && tmpls.some((t) => t.id === prev)) return prev;
        return tmpls.find((t) => t.is_default)?.id || tmpls[0]?.id || '';
      });
    } catch (e) {
      notifyError('Nu am putut încărca avizele', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true);
    const failed = [];
    try {
      for (const file of files) {
        try {
          const uploaded = await api.integrations.Core.UploadFile({ file });
          await api.avize.extract({
            file_url: uploaded.file_url,
            original_filename: file.name,
          });
        } catch (err) {
          failed.push(file.name);
          console.error('[aviz upload]', file.name, err);
        }
      }
      if (failed.length === 0) {
        notifySuccess('Avize încărcate', `${files.length} fișier(e) procesate.`);
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

  const openEdit = (row) => {
    setEditRow(row);
    setForm(emptyForm(row));
  };

  const saveEdit = async () => {
    if (!editRow) return;
    setSaving(true);
    try {
      const payload = { ...form, status: editRow.status === 'uploaded' ? 'extracted' : editRow.status };
      await api.entities.AvizDocument.update(editRow.id, payload);
      notifySuccess('Aviz salvat', 'Câmpurile au fost actualizate.');
      setEditRow(null);
      await load();
    } catch (e) {
      notifyError('Salvare eșuată', e);
    } finally {
      setSaving(false);
    }
  };

  const confirmRow = async (row) => {
    try {
      await api.entities.AvizDocument.update(row.id, { status: 'confirmed' });
      notifySuccess('Aviz confirmat', row.numar_tpo || row.original_filename || 'Rând marcat ca confirmat.');
      await load();
    } catch (e) {
      notifyError('Confirmare eșuată', e);
    }
  };

  const reextract = async (row) => {
    try {
      await api.avize.extract({ id: row.id, file_url: row.file_url, original_filename: row.original_filename });
      notifySuccess('Re-extras', 'Câmpurile au fost reîncărcate din document.');
      await load();
    } catch (e) {
      notifyError('Extragere eșuată', e);
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

  const saveTemplate = async () => {
    if (!editTemplate) return;
    const name = String(editTemplate.name || '').trim();
    if (!name) {
      notifyError('Nume obligatoriu', 'Completează numele șablonului.');
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

  const newTemplate = () => {
    const base = templates[0]?.columns || AVIZ_SOURCE_OPTIONS.map((o, i) => ({
      key: o.value,
      header: o.label,
      source: o.value,
      default_value: i === 0 ? '' : '',
    }));
    setEditTemplate({
      name: 'Șablon nou',
      is_default: false,
      columns: JSON.parse(JSON.stringify(base)),
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">Avize / Rapoarte</h1>
          <p className="text-sm text-slate-500 mt-1">Extrage câmpuri din avize și unește-le într-o Anexă Factură XLSX</p>
        </div>
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg self-start">
          {['avize', 'sabloane'].map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 text-sm rounded-md ${tab === id ? 'bg-white shadow text-[#0A2B4E] font-medium' : 'text-slate-500'}`}
            >
              {id === 'avize' ? 'Avize' : 'Șabloane'}
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
          </div>

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
                        <p className="font-semibold text-[#0A2B4E] truncate">{row.numar_tpo || 'Fără TPO'}</p>
                        <p className="text-xs text-slate-500 truncate">{row.numar_document_marfa || row.original_filename}</p>
                        <p className="text-xs text-slate-500 mt-1 truncate" title={[row.numar_auto, row.data_efectuare_cursa].filter(Boolean).join(' · ')}>
                          {row.numar_auto || '—'} · {row.data_efectuare_cursa || '—'}
                        </p>
                        <span className="inline-block mt-2 text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          {STATUS_LABEL[row.status] || row.status}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-slate-100 text-xs">
                      <button type="button" className="text-[#1D4E89]" title="Corectează câmpurile sau completează km / taxe" onClick={() => openEdit(row)}>Editează</button>
                      {row.status !== 'confirmed' && (
                        <button type="button" className="text-emerald-700" title="Marchează rândul ca verificat" onClick={() => confirmRow(row)}>Confirmă</button>
                      )}
                      <button type="button" className="text-slate-600" title="Citește din nou PDF-ul; suprascrie TPO, auto, rută" onClick={() => reextract(row)}>Re-extrage</button>
                      <button type="button" className="text-red-500" title="Scoate avizul din listă" onClick={() => setDeleteRow(row)}>Șterge</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm table-fixed min-w-[720px]">
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
                          <td className="px-3 py-3 font-medium text-[#0A2B4E] truncate" title={row.numar_tpo || row.original_filename || ''}>
                            {row.numar_tpo || (
                              <span className="font-normal text-slate-400">{row.original_filename || '—'}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-slate-600 truncate">{row.data_efectuare_cursa || '—'}</td>
                          <td className="px-3 py-3 truncate" title={row.numar_auto || ''}>{row.numar_auto || '—'}</td>
                          <td className="px-3 py-3 truncate" title={row.ruta_transport || ''}>{row.ruta_transport || '—'}</td>
                          <td className="px-3 py-3 truncate" title={`${row.cantitate_marfa ?? ''} ${row.tip_marfa || ''}`.trim()}>
                            {row.cantitate_marfa ?? '—'} {row.tip_marfa || ''}
                          </td>
                          <td className="px-3 py-3 truncate" title={row.numar_document_marfa || ''}>{row.numar_document_marfa || '—'}</td>
                          <td className="px-3 py-3 text-xs truncate">{STATUS_LABEL[row.status] || row.status}</td>
                          <td className="px-3 py-3 text-right whitespace-nowrap">
                            <button type="button" className="text-[#1D4E89] hover:underline text-xs" title="Corectează câmpurile sau completează km / taxe" onClick={() => openEdit(row)}>Editează</button>
                            {row.status !== 'confirmed' && (
                              <button type="button" className="text-emerald-700 hover:underline text-xs ml-2" title="Marchează rândul ca verificat" onClick={() => confirmRow(row)}>Confirmă</button>
                            )}
                            <button type="button" className="text-slate-600 hover:underline text-xs ml-2" title="Citește din nou PDF-ul; suprascrie TPO, auto, rută" onClick={() => reextract(row)}>Re-extrage</button>
                            <button type="button" className="text-red-500 hover:underline text-xs ml-2" title="Scoate avizul din listă" onClick={() => setDeleteRow(row)}>Șterge</button>
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
      ) : (
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
                    </p>
                  </div>
                  <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
                </div>
                <div className="flex gap-3 mt-4 text-xs">
                  <button type="button" className="text-[#1D4E89]" onClick={() => setEditTemplate({ ...t, columns: t.columns || [] })}>Editează</button>
                  <button type="button" className="text-red-500" onClick={() => setDeleteTemplate(t)}>Șterge</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {editRow && (
        <ModalShell onClose={() => setEditRow(null)} panelClassName="max-w-3xl" labelledBy="aviz-edit-title">
          <div className="p-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 id="aviz-edit-title" className="text-lg font-semibold text-[#0A2B4E]">Editează aviz</h2>
              <button type="button" onClick={() => setEditRow(null)} aria-label="Închide"><X className="w-5 h-5 text-slate-500" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {AVIZ_FORM_FIELDS.map((f) => (
                <div key={f.key} className={f.key === 'ruta_transport' || f.key === 'observatii' ? 'sm:col-span-2' : ''}>
                  <label className={labelCls}>{f.label}</label>
                  <input
                    className={inputCls}
                    type={f.type || 'text'}
                    step={f.step}
                    value={form[f.key] ?? ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
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
