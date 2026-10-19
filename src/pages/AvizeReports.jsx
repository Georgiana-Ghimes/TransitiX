import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import ConfirmDialog from '@/components/ConfirmDialog';
import ModalShell from '@/components/ModalShell';
import { notifyError, notifySuccess } from '@/lib/notify';
import { isDocumentsProfile } from '@/lib/appProfile';
import { validateObservationCodeInput } from '@/lib/observationCodes';
import { AVIZ_SOURCE_OPTIONS, STATUS_LABEL, nextAvizStatusOnSave } from '@/lib/avizAnnex';
import { datePresetRange, avizIncarcareDate, avizMatchesListFilters, filtersToRevealUploads } from '@/lib/avizOps';
import { formatDate } from '@/lib/utils';
import { findBlurriest } from '@/lib/imageQuality';
import { prepareImagesForUpload } from '@/lib/imagePreprocess';
import {
  Camera, Check, ClipboardList, Download, Loader2,
  Trash2, Upload, X,
} from 'lucide-react';
import AvizEditModal from './avize/AvizEditModal';
import AvizForceGateModal from './avize/AvizForceGateModal';
import AvizReviewDrawer from './avize/AvizReviewDrawer';
import AvizFilterBar from './avize/AvizFilterBar';
import AvizLegend from './avize/AvizLegend';
import AvizReportsTab from './avize/AvizReportsTab';
import AvizRowActions from './avize/AvizRowActions';
import AvizTemplatesTab from './avize/AvizTemplatesTab';
import { DriverUploadBadge, NeedsReviewBadge, SourceBadge } from './avize/AvizFilePreview';
import {
  AVIZ_ACTION_LEGEND,
  AVIZ_PAGE_SIZES,
  AVIZ_STATUS_DOT_LEGEND,
  AVIZ_STATUS_DOT_ONELINER,
  annexReviewBlockedRows,
  asAvizPage,
  columnCountOf,
  confirmBlockedRows,
  displayRoute,
  downloadBlob,
  formatIncarcareLabel,
  hasManualAvizEdits,
  inputCls,
  isLearnedRoute,
  manualAvizEditLabels,
  isLockedRai,
  labelCls,
  lowField,
  LOW_FIELD_TEXT_CLS,
  readAvizPageSize,
  requiresAnnexReviewGate,
  rowsMissingTpo,
  rowsNeedingCarouselEdit,
  rowsNeedingOcrVerify,
  sortAvizeByUploadAsc,
  unackedLowOcrFields,
  waitForAvizExtractSettled,
  writeAvizPageSize,
} from './avize/avizeUi';
import {
  DEFAULT_NEW_TEMPLATE_NAME,
  nextUnusedTemplateName,
} from '@/lib/templateName';

/** Încărcare label: Bucharest calendar day as DD.MM.YYYY (same as Editează). */
function formatAvizIncarcare(createdAt) {
  return formatDate(avizIncarcareDate({ created_at: createdAt }));
}

export default function AvizeReports() {
  const [tab, setTab] = useState('avize');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(readAvizPageSize);
  const [templates, setTemplates] = useState([]);
  const [obsCodes, setObsCodes] = useState([]);
  const [reportData, setReportData] = useState({ by_plate: [], weekly: [], exports: [] });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [templateId, setTemplateId] = useState('');
  const [editRow, setEditRow] = useState(null);
  /** Bumps when Re-extrage should re-seed the Editează draft (not on list poll). */
  const [editFormRevision, setEditFormRevision] = useState(0);
  const [reviewId, setReviewId] = useState(null);
  /** Bumps Verifică drawer after Re-extrage settles. */
  const [reviewReloadKey, setReviewReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [deleteRow, setDeleteRow] = useState(null);
  const [deleteBulkOpen, setDeleteBulkOpen] = useState(false);
  const [deleteBulkCount, setDeleteBulkCount] = useState(0);
  const [confirmDuplicate, setConfirmDuplicate] = useState(null);
  const [confirmReextract, setConfirmReextract] = useState(null);
  /** { mode: 'confirm-single'|'confirm-bulk'|'export', ids, row?, queue } */
  const [forceGate, setForceGate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busyId, setBusyId] = useState(null);
  /** Sync guard: React `busy` re-renders too late for a double-click on Unește. */
  const exportLockRef = useRef(false);
  const [activePreset, setActivePreset] = useState('');
  const [editTemplate, setEditTemplate] = useState(null);
  const [deleteTemplate, setDeleteTemplate] = useState(null);
  const [filters, setFilters] = useState({
    // Upload day, not trip day: a manual/photo from the cab often carries an older cursă date
    // and would vanish under „Săptămâna asta” pe data cursei.
    from: '', to: '', status: '', q: '', uploaded_from: '', date_field: 'incarcare',
  });
  const [qInput, setQInput] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [hiddenByFilters, setHiddenByFilters] = useState(0);
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const loadGen = useRef(0);
  const bulkConfirmLock = useRef(false);
  const bulkDeleteLock = useRef(false);
  /** Skip background list poll while a modal holds typed draft / PDF preview. */
  const modalOpenRef = useRef(false);
  modalOpenRef.current = Boolean(editRow) || Boolean(reviewId) || Boolean(forceGate);

  const [ocrDown, setOcrDown] = useState(false);

  const confirmableSelectedIds = rows
    .filter((r) => selected.has(r.id) && r.status !== 'confirmed')
    .map((r) => r.id);

  const selectedTemplate = templates.find((t) => t.id === templateId) || null;

  // Re-check while this page is open - a recovered Mistral key should clear the banner.
  // clear the banner without a full reload.
  useEffect(() => {
    let cancelled = false;
    const probe = () => {
      api.system.health()
        .then((h) => {
          const cap = h?.capabilities?.ocr;
          if (!cancelled) setOcrDown(cap === 'mistral-down');
        })
        .catch(() => { if (!cancelled) setOcrDown(false); });
    };
    probe();
    const timer = setInterval(probe, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const load = async (filterOverride, pageOverride) => {
    const activeFilters = filterOverride ?? filters;
    const activePage = pageOverride ?? page;
    const offset = activePage * pageSize;
    const gen = ++loadGen.current;
    try {
      const [avizeRes, tmpls, codes] = await Promise.all([
        api.avize.list({ ...activeFilters, limit: pageSize, offset }),
        api.avize.templates(),
        api.avize.observationCodes().catch(() => []),
      ]);
      if (gen !== loadGen.current) return;
      const pageData = asAvizPage(avizeRes);
      setRows(pageData.items);
      setTotal(pageData.total);
      // Delete-on-last-page (or a stale offset): step onto the last page that still has rows.
      if (pageData.items.length === 0 && pageData.total > 0 && offset >= pageData.total) {
        setPage(Math.max(0, Math.ceil(pageData.total / pageSize) - 1));
        return;
      }
      setTemplates(tmpls);
      setObsCodes(codes);
      setTemplateId((prev) => {
        if (prev && tmpls.some((t) => t.id === prev)) return prev;
        return tmpls.find((t) => t.is_default)?.id || tmpls[0]?.id || '';
      });

      // Empty page with active filters: check whether the company actually has rows.
      const filtersActive = Boolean(
        activeFilters.from || activeFilters.to || activeFilters.status
        || activeFilters.q || activeFilters.uploaded_from
      );
      if (pageData.total === 0 && filtersActive) {
        try {
          const all = asAvizPage(await api.avize.list({
            date_field: 'incarcare', limit: 1, offset: 0,
          }));
          if (gen !== loadGen.current) return;
          setHiddenByFilters(all.total);
        } catch {
          setHiddenByFilters(0);
        }
      } else {
        setHiddenByFilters(0);
      }
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

  // New filters → first page + clear cross-page selection (stale IDs would export the wrong set).
  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [filters.from, filters.to, filters.status, filters.q, filters.uploaded_from, filters.date_field]);

  useEffect(() => {
    if (!loading) setRefreshing(true);
    load();
  }, [
    filters.from, filters.to, filters.status, filters.q, filters.uploaded_from, filters.date_field,
    page, pageSize,
  ]);

  /**
   * Notifications already poll every 15s while the office tab is open. The avize table used to
   * refresh only while a row said `uploaded`, so a finished driver upload (or a new one) stayed
   * invisible until a manual refresh. Same rule as the bell: poll while this page is open and
   * the browser tab is visible; stay quiet when the tab is hidden.
   */
  useEffect(() => {
    if (tab !== 'avize') return undefined;

    const tick = async () => {
      if (document.hidden || uploading || busyId || modalOpenRef.current) return;
      const gen = ++loadGen.current;
      try {
        const pageData = asAvizPage(await api.avize.list({
          ...filters, limit: pageSize, offset: page * pageSize,
        }));
        if (gen !== loadGen.current) return;
        setRows(pageData.items);
        setTotal(pageData.total);
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
    page,
    pageSize,
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
    setFilters((prev) => ({ ...prev, ...range, date_field: 'incarcare' }));
  };

  const resetAvizFilters = () => {
    setActivePreset('');
    setFilters({ from: '', to: '', status: '', q: '', uploaded_from: '', date_field: 'incarcare' });
    setQInput('');
    setHiddenByFilters(0);
  };

  const uploadFiles = async (fileList) => {
    const picked = Array.from(fileList || []);
    if (picked.length === 0) return;
    setUploading(true);
    const failed = [];
    let dup = 0;
    let pending = 0;
    const uploadedRows = [];
    let listFilters = filters;
    try {
      // Orientation, size and contrast are settled here, before anything is measured or
      // sent. Landscape phone/WhatsApp shots are turned to portrait (EXIF bake + 90° CW).
      // Best-effort: a file that cannot be prepared goes as it was picked.
      const files = await prepareImagesForUpload(picked, { preferPortrait: true });
      // Photos taken at a desk blur too. Unlike the cab, a batch of scans is not interrupted for
      // it, the operator is told which file may not read and the upload carries on.
      const worst = await findBlurriest(files).catch(() => null);
      if (worst) {
        notifyError(
          'O poză pare mișcată',
          `„${worst.file.name}" iese neclară, s-ar putea să nu se extragă nimic din ea. Restul se încarcă normal.`
        );
      }
      let splitPagesTotal = 0;
      for (const file of files) {
        try {
          const uploaded = await api.integrations.Core.UploadFile({ file });
          const row = await api.avize.extract({
            file_url: uploaded.file_url,
            original_filename: file.name,
          });
          const parts = Array.isArray(row?.documents) && row.documents.length > 1
            ? row.documents
            : [row];
          for (const part of parts) {
            if (!part?.id) continue;
            uploadedRows.push(part);
            if (part?.duplicate_tpo) dup += 1;
            if (part?.extraction_pending) pending += 1;
          }
          if (Number(row?.split_pages) > 1) {
            splitPagesTotal += Number(row.split_pages);
          }
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
          ? ` ${pending} document(e), OCR-ul rulează în fundal; statusul se actualizează singur.`
          : '';
        const splitNote = splitPagesTotal > 1
          ? ` PDF despărțit în ${splitPagesTotal} avize (TRO/PSL distincte).`
          : '';
        const countLabel = uploadedRows.length !== files.length
          ? `${files.length} fișier(e) → ${uploadedRows.length} aviz(e).`
          : `${files.length} fișier(e) procesate.`;
        notifySuccess(
          'Avize încărcate',
          dup
            ? `${countLabel} Atenție: ${dup} TPO există deja (salvarea a rămas).${splitNote}${pendingNote}${filterNote}`
            : `${countLabel}${splitNote}${pendingNote}${filterNote}`
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

  const allPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const r of rows) next.delete(r.id);
      } else {
        for (const r of rows) next.add(r.id);
      }
      return next;
    });
  };

  const changePageSize = (n) => {
    const size = Number(n);
    if (!AVIZ_PAGE_SIZES.includes(size)) return;
    writeAvizPageSize(size);
    setPageSize(size);
    setPage(0);
  };

  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1);
  const rangeFrom = total === 0 ? 0 : page * pageSize + 1;
  const rangeTo = Math.min(total, (page + 1) * pageSize);

  const openEdit = (row) => {
    setEditFormRevision(0);
    setEditRow(row);
  };

  const closeEditModal = useCallback(() => setEditRow(null), []);
  const closeReviewDrawer = useCallback(() => setReviewId(null), []);
  const loadRef = useRef(load);
  loadRef.current = load;
  /** Patch one row in place — never reload the page list (that used to reshuffle ties). */
  const patchAvizRow = useCallback((id, patch) => {
    if (!id || !patch) return;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const refreshAfterReview = useCallback(async () => {
    const id = reviewId;
    if (!id) {
      void loadRef.current();
      return;
    }
    try {
      const row = await api.entities.AvizDocument.get(id);
      patchAvizRow(id, row);
    } catch {
      void loadRef.current();
    }
  }, [reviewId, patchAvizRow]);

  const saveEdit = useCallback(async (form) => {
    if (!editRow) return;
    setSaving(true);
    try {
      const { zone_tax_breakdown: zoneTaxBreakdown, goods_doc_only: _gdo, ...fields } = form || {};
      const prevEd = (editRow.extracted_data && typeof editRow.extracted_data === 'object')
        ? editRow.extracted_data
        : {};
      const payload = {
        ...fields,
        status: nextAvizStatusOnSave(editRow.status),
        extracted_data: {
          ...prevEd,
          zone_tax_breakdown: zoneTaxBreakdown ? String(zoneTaxBreakdown) : null,
        },
      };
      if (!payload.trip_id) payload.trip_id = null;
      const saved = await api.entities.AvizDocument.update(editRow.id, payload);
      notifySuccess(
        'Aviz salvat',
        saved?.duplicate_tpo
          ? 'Atenție: același transport există deja pe alt rând. Salvarea a rămas.'
          : 'Câmpurile au fost actualizate.'
      );
      patchAvizRow(editRow.id, saved || payload);
      setEditRow(null);
    } catch (e) {
      notifyError('Salvare eșuată', e);
    } finally {
      setSaving(false);
    }
  }, [editRow, patchAvizRow]);

  const saveForceGateItem = useCallback(async (row, form) => {
    if (!row?.id) return;
    const goodsDocOnly = Boolean(form?.goods_doc_only);
    const hadUnackedOcr = unackedLowOcrFields({
      ...row,
      goods_doc_only: goodsDocOnly,
    }).length > 0;
    const { goods_doc_only: _flag, ...formFields } = form || {};
    const prevEd = (row.extracted_data && typeof row.extracted_data === 'object')
      ? row.extracted_data
      : {};
    const payload = {
      ...formFields,
      status: nextAvizStatusOnSave(row.status),
      extracted_data: {
        ...prevEd,
        goods_doc_only: goodsDocOnly,
      },
    };
    if (goodsDocOnly) payload.numar_tpo = '';
    if (!payload.trip_id) payload.trip_id = null;
    let saved = null;
    try {
      saved = await api.entities.AvizDocument.update(row.id, payload);
    } catch (e) {
      // No field delta: still allow Salvează to unlock OCR-nesigur via approve-review.
      if (!hadUnackedOcr) throw e;
      const msg = String(e?.message || e?.data?.message || '');
      if (!/nu ai modificat|niciun câmp/i.test(msg) && e?.status !== 400) throw e;
    }
    if (hadUnackedOcr) {
      const approved = await api.documents.approveReview(row.id);
      saved = { ...(saved || {}), ...(approved?.document || {}), needs_review: false };
    }
    notifySuccess(
      hadUnackedOcr ? 'Verificat pe document' : 'Aviz salvat',
      row.numar_tpo || form?.numar_document_marfa || row.original_filename || 'Câmpuri actualizate.',
    );
    // Keep modal open and preserve queue order/ids so the carousel can advance without
    // snapping back to the first item (do not rebuild queue from a filtered list here).
    setForceGate((prev) => {
      if (!prev) return prev;
      const patch = {
        ...payload,
        ...(saved || {}),
        file_url: row.file_url || saved?.file_url,
        goods_doc_only: goodsDocOnly,
        extracted_data: {
          ...prevEd,
          ...(saved?.extracted_data || {}),
          goods_doc_only: goodsDocOnly,
        },
        // Clear local low flags so ocrBlocksForce drops without waiting for list reload.
        field_confidence: {
          ...(row.field_confidence || {}),
          ...(saved?.field_confidence || {}),
          numar_tpo: 'ok',
          numar_auto: 'ok',
          ruta_transport: 'ok',
        },
        corrected_fields: [
          ...new Set([
            ...(Array.isArray(row.corrected_fields) ? row.corrected_fields : []),
            ...(Array.isArray(saved?.corrected_fields) ? saved.corrected_fields : []),
            'numar_tpo', 'numar_auto', 'ruta_transport',
          ]),
        ],
        needs_review: false,
      };
      const nextQueue = (prev.queue || []).map((r) => (
        r.id === row.id ? { ...r, ...patch } : r
      ));
      const nextPeers = Array.isArray(prev.peerRows)
        ? prev.peerRows.map((r) => (r.id === row.id ? { ...r, ...patch } : r))
        : prev.peerRows;
      return { ...prev, queue: nextQueue, peerRows: nextPeers };
    });
    // Same row stays at the same index in the main list (no full reload / reshuffle).
    setRows((prev) => prev.map((r) => {
      if (r.id !== row.id) return r;
      return {
        ...r,
        ...payload,
        ...(saved || {}),
        file_url: row.file_url || saved?.file_url,
        goods_doc_only: goodsDocOnly,
        needs_review: false,
      };
    }));
  }, []);

  const forceGatePeers = useCallback((ids) => {
    const idSet = new Set(ids || []);
    return sortAvizeByUploadAsc((rows || []).filter((r) => idSet.has(r.id)));
  }, [rows]);

  const mergeTpoPreviewEnabled = Boolean(selectedTemplate?.options?.merge_tpo_cells);

  const confirmRow = (row) => {
    if (row.duplicate_tpo) {
      setConfirmDuplicate({ mode: 'single', row });
      return;
    }
    const editQueue = rowsNeedingCarouselEdit([row]);
    if (requiresAnnexReviewGate(row) || editQueue.length > 0) {
      setForceGate({
        mode: 'confirm-single',
        ids: [row.id],
        row,
        // Gaps + unacked OCR-low TPO/auto/rută.
        queue: editQueue,
        peerRows: forceGatePeers([row.id]),
        mergeTpoPreview: mergeTpoPreviewEnabled,
        mergeTpoRequired: mergeTpoPreviewEnabled,
      });
      return;
    }
    runConfirmRow(row);
  };

  const runConfirmRow = async (row, { force = false } = {}) => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      await api.avize.confirm(row.id, force
        ? { force: true, force_reason: 'operator_bulk_confirm_empty_fields' }
        : {});
      notifySuccess('Aviz confirmat', row.numar_tpo || row.original_filename || 'Rând marcat ca confirmat.');
      setForceGate(null);
      await load();
    } catch (e) {
      const code = e?.data?.code;
      if (e?.status === 409 || code === 'NEEDS_REVIEW' || code === 'OCR_VERIFY_REQUIRED') {
        setForceGate({
          mode: 'confirm-single',
          ids: [row.id],
          row,
          queue: rowsNeedingCarouselEdit([row]),
          peerRows: forceGatePeers([row.id]),
          mergeTpoPreview: mergeTpoPreviewEnabled,
          mergeTpoRequired: mergeTpoPreviewEnabled,
        });
      } else {
        notifyError('Confirmare eșuată', e);
      }
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
    const blocked = confirmBlockedRows(rows, ids);
    const ocrQueue = rowsNeedingCarouselEdit(
      blocked.length ? blocked : rows.filter((r) => ids.includes(r.id)),
    );
    if (blocked.length || ocrQueue.length) {
      setForceGate({
        mode: 'confirm-bulk',
        ids,
        queue: ocrQueue,
        peerRows: forceGatePeers(ids),
        mergeTpoPreview: mergeTpoPreviewEnabled,
        mergeTpoRequired: mergeTpoPreviewEnabled,
      });
      return;
    }
    runBulkConfirm(ids);
  };

  const runBulkConfirm = async (ids, { force = false } = {}) => {
    if (bulkConfirmLock.current) return;
    bulkConfirmLock.current = true;
    setBusy(true);
    try {
      const updated = await api.avize.bulkConfirm(ids, force
        ? { force: true, force_reason: 'operator_bulk_confirm_empty_fields' }
        : {});
      notifySuccess(
        'Confirmate',
        updated.length
          ? `${updated.length} aviz(e) marcate ca confirmate.`
          : 'Rândurile selectate erau deja confirmate.'
      );
      setForceGate(null);
      await load();
    } catch (e) {
      const code = e?.data?.code;
      if (e?.status === 409 || code === 'NEEDS_REVIEW' || code === 'OCR_VERIFY_REQUIRED') {
        const blockedIds = (e?.data?.blocked || []).map((b) => b.id);
        const fromIds = blockedIds.length ? blockedIds : ids;
        const blocked = code === 'OCR_VERIFY_REQUIRED'
          ? rowsNeedingOcrVerify(rows, fromIds)
          : confirmBlockedRows(rows, fromIds);
        setForceGate({
          mode: 'confirm-bulk',
          ids,
          queue: rowsNeedingCarouselEdit(blocked.length ? blocked : rows.filter((r) => fromIds.includes(r.id))),
          peerRows: forceGatePeers(ids),
          mergeTpoPreview: mergeTpoPreviewEnabled,
          mergeTpoRequired: mergeTpoPreviewEnabled,
        });
      } else {
        notifyError('Confirmare eșuată', e);
      }
    } finally {
      setBusy(false);
      bulkConfirmLock.current = false;
    }
  };

  const exportSelected = () => {
    if (busy || exporting || exportLockRef.current || confirmDuplicate || forceGate) return;
    const ids = [...selected];
    if (ids.length === 0) {
      notifyError('Nimic selectat', 'Bifează cel puțin un aviz pentru export.');
      return;
    }
    if (!templateId) {
      notifyError('Fără șablon', 'Alege un șablon XLSX.');
      return;
    }
    const blocked = sortAvizeByUploadAsc(annexReviewBlockedRows(rows, ids));
    const missingTpo = mergeTpoPreviewEnabled ? rowsMissingTpo(rows, ids) : [];
    const ocrLow = rowsNeedingOcrVerify(rows, ids);
    if (blocked.length || missingTpo.length || ocrLow.length) {
      const byId = new Map();
      for (const r of [...blocked, ...missingTpo, ...ocrLow]) byId.set(r.id, r);
      const combined = sortAvizeByUploadAsc([...byId.values()]);
      setForceGate({
        mode: 'export',
        ids,
        // Gaps, missing TPO (merge ON), and unacked OCR-low fields.
        queue: rowsNeedingCarouselEdit(combined),
        peerRows: forceGatePeers(ids),
        mergeTpoPreview: mergeTpoPreviewEnabled,
        mergeTpoRequired: mergeTpoPreviewEnabled,
      });
      return;
    }
    const dupCount = rows.filter((r) => ids.includes(r.id) && r.duplicate_tpo).length;
    if (dupCount > 0) {
      // Warn before download, a post-export toast was easy to miss under „Export gata”.
      setConfirmDuplicate({ mode: 'export', ids, dupCount });
      return;
    }
    runExportSelected(ids);
  };

  const runExportSelected = async (ids, { allowUnconfirmed = false } = {}) => {
    if (!templateId || !ids?.length) return;
    if (exportLockRef.current) return;
    exportLockRef.current = true;
    setExporting(true);
    setBusy(true);
    try {
      const { blob, filename } = await api.avize.exportXlsx({
        template_id: templateId,
        aviz_ids: ids,
        allow_unconfirmed: allowUnconfirmed,
      });
      downloadBlob(blob, filename);
      // Naming the template here is the only place the operator can tell which layout landed
      // in the file, the filename alone reads the same for every export of the day.
      notifySuccess(
        'Export gata',
        `${filename}, șablon ${selectedTemplate?.name || 'selectat'}, `
        + `${columnCountOf(selectedTemplate)} coloane.`
      );
      setForceGate(null);
    } catch (e) {
      if (e?.status === 409 || e?.data?.code === 'NEEDS_REVIEW') {
        const blockedIds = (e?.data?.blocked || []).map((b) => b.id);
        const blocked = sortAvizeByUploadAsc(
          annexReviewBlockedRows(rows, blockedIds.length ? blockedIds : ids),
        );
        setForceGate({
          mode: 'export',
          ids,
          queue: rowsNeedingCarouselEdit(blocked),
          peerRows: forceGatePeers(ids),
          mergeTpoPreview: mergeTpoPreviewEnabled,
          mergeTpoRequired: mergeTpoPreviewEnabled,
        });
      } else if (e?.data?.code === 'MERGE_TPO_REQUIRED') {
        const blockedIds = (e?.data?.blocked || []).map((b) => b.id);
        const missing = rowsMissingTpo(rows, blockedIds.length ? blockedIds : ids);
        setForceGate({
          mode: 'export',
          ids,
          queue: rowsNeedingCarouselEdit(missing.length ? missing : annexReviewBlockedRows(rows, ids)),
          peerRows: forceGatePeers(ids),
          mergeTpoPreview: true,
          mergeTpoRequired: true,
        });
        if (!missing.length) notifyError('Export eșuat', e);
      } else if (e?.data?.code === 'OCR_VERIFY_REQUIRED') {
        const blockedIds = (e?.data?.blocked || []).map((b) => b.id);
        const ocrRows = rowsNeedingOcrVerify(rows, blockedIds.length ? blockedIds : ids);
        setForceGate({
          mode: 'export',
          ids,
          queue: rowsNeedingCarouselEdit(ocrRows.length ? ocrRows : annexReviewBlockedRows(rows, ids)),
          peerRows: forceGatePeers(ids),
          mergeTpoPreview: mergeTpoPreviewEnabled,
          mergeTpoRequired: mergeTpoPreviewEnabled,
        });
        if (!ocrRows.length) notifyError('Export eșuat', e);
      } else {
        notifyError('Export eșuat', e);
      }
    } finally {
      exportLockRef.current = false;
      setExporting(false);
      setBusy(false);
    }
  };

  const runForceGateConfirm = async (opts = {}) => {
    if (!forceGate) return;
    const ready = Boolean(opts.ready);
    const cleanExport = Boolean(opts.cleanExport);
    const gateSource = Array.isArray(forceGate.peerRows) && forceGate.peerRows.length
      ? forceGate.peerRows
      : rows;
    const stillOcr = rowsNeedingOcrVerify(gateSource, forceGate.ids);
    if (stillOcr.length) {
      notifyError(
        'OCR nesigur',
        stillOcr.length === 1
          ? 'Verifică pe document (Salvează în carusel sau Verifică → Marchează verificat) înainte de Confirmă / Unește.'
          : `${stillOcr.length} avize cu OCR nesigur. Verifică pe document înainte de Confirmă / Unește.`,
      );
      return;
    }
    // Hard lock for Confirmă and Unește: merge-TPO ON cannot proceed with blank numar_tpo.
    if (mergeTpoPreviewEnabled || forceGate.mergeTpoRequired) {
      const stillMissing = rowsMissingTpo(gateSource, forceGate.ids);
      if (stillMissing.length) {
        notifyError(
          'TPO obligatoriu',
          stillMissing.length === 1
            ? '„Unește celulele TPO” e activ: completează Număr TPO pe avizul fără TPO înainte de Confirmă / Unește.'
            : `„Unește celulele TPO” e activ: ${stillMissing.length} avize fără Număr TPO. Completează TPO înainte de Confirmă / Unește.`,
        );
        return;
      }
    }
    if (forceGate.mode === 'confirm-single' && forceGate.row) {
      await runConfirmRow(forceGate.row, { force: true });
      return;
    }
    if (forceGate.mode === 'confirm-bulk') {
      await runBulkConfirm(forceGate.ids, { force: true });
      return;
    }
    if (forceGate.mode === 'export') {
      // Required fields complete but not yet Confirmat → confirm first, then clean export.
      if (ready && !cleanExport && forceGate.ids?.length) {
        try {
          await api.avize.bulkConfirm(forceGate.ids, {
            force: true,
            force_reason: 'operator_bulk_confirm_empty_fields',
          });
        } catch (e) {
          // OCR hard lock must not fall through to allow_unconfirmed export.
          if (e?.data?.code === 'OCR_VERIFY_REQUIRED') {
            notifyError(
              'OCR nesigur',
              e?.data?.message
                || 'Verifică pe document (Salvează în carusel sau Verifică) înainte de Unește.',
            );
            return;
          }
          // HITL force-confirm may still refuse; operator already filled required fields — export with allow_unconfirmed.
          if (!(e?.status === 409 || e?.data?.code === 'NEEDS_REVIEW')) {
            notifyError('Confirmare eșuată', e);
            return;
          }
        }
        await runExportSelected(forceGate.ids, { allowUnconfirmed: true });
        return;
      }
      await runExportSelected(forceGate.ids, {
        allowUnconfirmed: !cleanExport,
      });
    }
  };

  const runDuplicateConfirm = async () => {
    if (!confirmDuplicate) return;
    const pending = confirmDuplicate;
    setConfirmDuplicate(null);
    if (pending.mode === 'single') {
      await runConfirmRow(pending.row);
    } else if (pending.mode === 'export') {
      await runExportSelected(pending.ids);
    } else {
      await runBulkConfirm(pending.ids);
    }
  };

  const requestReextract = (row) => {
    if (ocrDown) {
      notifyError(
        'OCR indisponibil',
        'Mistral OCR nu răspunde. Verifică MISTRAL_API_KEY și conexiunea, apoi încearcă din nou.'
      );
      return;
    }
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
    // Immediate feedback, don't wait for the round-trip to flip status.
    setRows((prev) => prev.map((r) => (
      r.id === row.id ? { ...r, status: 'uploaded' } : r
    )));
    try {
      const result = await api.avize.extract({
        id: row.id, file_url: row.file_url, original_filename: row.original_filename,
      });
      let settled = result;
      // Re-extrage always answers 202 and finishes in the background. A single load() here
      // races the worker and leaves the list/form on the old ruta until the 15s poll — and
      // busyId was blocking that poll. Wait until the row leaves `uploaded`.
      if (result?.extraction_pending) {
        notifySuccess(
          'Extragere pornită',
          result.pages > 1
            ? `Documentul are ${result.pages} pagini — aștept OCR-ul…`
            : 'OCR-ul rulează — aștept câmpurile noi…'
        );
        settled = await waitForAvizExtractSettled(
          row.id,
          async (id) => {
            try {
              return await api.entities.AvizDocument.get(id);
            } catch {
              return null;
            }
          },
        );
        if (settled) {
          setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...settled } : r)));
          setEditRow((prev) => {
            if (prev?.id !== row.id) return prev;
            setEditFormRevision((n) => n + 1);
            return { ...prev, ...settled };
          });
          setForceGate((prev) => {
            if (!prev?.queue?.length) return prev;
            const patchRow = (r) => (r.id === row.id ? { ...r, ...settled } : r);
            return {
              ...prev,
              queue: prev.queue.map(patchRow),
              row: prev.row?.id === row.id ? { ...prev.row, ...settled } : prev.row,
            };
          });
          if (reviewId === row.id) setReviewReloadKey((n) => n + 1);
        }
      } else if (settled || result) {
        const fresh = settled || result;
        setEditRow((prev) => {
          if (prev?.id !== row.id) return prev;
          setEditFormRevision((n) => n + 1);
          return { ...prev, ...fresh };
        });
        setForceGate((prev) => {
          if (!prev?.queue?.length) return prev;
          const patchRow = (r) => (r.id === row.id ? { ...r, ...fresh } : r);
          return {
            ...prev,
            queue: prev.queue.map(patchRow),
            row: prev.row?.id === row.id ? { ...prev.row, ...fresh } : prev.row,
          };
        });
        if (reviewId === row.id) setReviewReloadKey((n) => n + 1);
      }
      await load();
      if (!String(settled?.numar_tpo || result?.numar_tpo || '').trim()) {
        notifyError(
          'OCR fără TPO',
          'Extragerea s-a terminat, dar nu am găsit număr TPO. Deschide Editează sau încearcă o poză mai clară.'
        );
      } else if (!result?.extraction_pending) {
        notifySuccess(
          'Re-extras',
          `${settled?.numar_tpo || result.numar_tpo}, TPO/auto/rută din document; km, taxe și observațiile rămân.`
        );
      } else if (settled && settled.status !== 'uploaded') {
        notifySuccess(
          'Re-extras',
          `${settled.numar_tpo || 'Aviz'}, TPO/auto/rută din document; km, taxe și observațiile rămân.`
        );
      }
    } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        notifyError(
          'Extragere întreruptă',
          'OCR-ul a durat prea mult sau conexiunea s-a întrerupt. Verifică Mistral OCR și încearcă din nou.'
        );
        setOcrDown(true);
      } else {
        notifyError('Extragere eșuată', e);
        if (e?.status === 503 || e?.data?.code === 'OCR_DOWN') setOcrDown(true);
      }
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

  const runBulkDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) {
      notifyError('Nimic selectat', 'Bifează cel puțin un aviz pentru ștergere.');
      return;
    }
    if (bulkDeleteLock.current) return;
    bulkDeleteLock.current = true;
    setBusy(true);
    try {
      const result = await api.avize.bulkDelete(ids);
      const n = Number(result?.deleted) || 0;
      notifySuccess(
        'Avize șterse',
        n === 1 ? '1 aviz eliminat.' : `${n} avize eliminate.`
      );
      setSelected(new Set());
      setDeleteBulkOpen(false);
      await load();
    } catch (e) {
      notifyError('Ștergere eșuată', e);
    } finally {
      setBusy(false);
      bulkDeleteLock.current = false;
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
        `${inv.series || 'TRX'}-${inv.number}, ${inv.lines?.length ?? 0} linii din TPO. `
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
    const columns = editTemplate.columns || [];
    if (columns.length === 0) {
      notifyError('Fără coloane', 'Adaugă cel puțin o coloană, altfel exportul nu ar avea ce scrie.');
      return;
    }
    setSaving(true);
    try {
      // Locked Anexa: name / is_default OK; server ignores column edits (#83).
      const payload = {
        name,
        is_default: Boolean(editTemplate.is_default),
        columns,
        options: {
          ...(editTemplate.options && typeof editTemplate.options === 'object' ? editTemplate.options : {}),
          merge_tpo_cells: Boolean(editTemplate.options?.merge_tpo_cells),
        },
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
        notifySuccess('Șablon salvat', `${name}, ${columns.length} coloane, folosit la următorul export.`);
      } else {
        notifySuccess('Șablon salvat', `${name}, ${columns.length} coloane. Alege-l cu „Folosește la export”.`);
      }
    } catch (e) {
      if (e?.status === 409) {
        notifyError('Nume folosit', e);
      } else {
        notifyError('Salvare șablon eșuată', e);
      }
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
    const checked = validateObservationCodeInput({ code: newCode, label: newLabel });
    if (!checked.ok) {
      notifyError('Cod invalid', checked.message);
      return;
    }
    try {
      await api.avize.createObservationCode({ code: checked.code, label: checked.label });
      setNewCode('');
      setNewLabel('');
      const codes = await api.avize.observationCodes();
      setObsCodes(codes);
      notifySuccess('Cod adăugat', `${checked.code}, ${checked.label}`);
    } catch (e) {
      notifyError('Codul nu s-a salvat', e);
    }
  };

  const useTemplateForExport = (id) => {
    const chosen = templates.find((t) => t.id === id);
    if (!chosen) return;
    setTemplateId(id);
    notifySuccess('Șablon activ', `${chosen.name}, ${columnCountOf(chosen)} coloane la următorul export.`);
  };

  const newTemplate = () => {
    const base = templates[0]?.columns || AVIZ_SOURCE_OPTIONS.map((o) => ({
      key: o.value,
      header: o.label,
      source: o.value,
      default_value: '',
    }));
    setEditTemplate({
      name: nextUnusedTemplateName(templates.map((t) => t.name), DEFAULT_NEW_TEMPLATE_NAME),
      is_default: false,
      columns: JSON.parse(JSON.stringify(base)),
      options: { merge_tpo_cells: false },
    });
  };

  const rowLocked = (id) => uploading || busyId === id;

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
      completate. Verifică MISTRAL_API_KEY și apasă „Re-extrage".
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

  const paginationBar = (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-1 py-1">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <label className="inline-flex items-center gap-2">
          <span className="text-slate-500">Afișează</span>
          <select
            value={pageSize}
            onChange={(e) => changePageSize(e.target.value)}
            className="h-9 px-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-[#1D4E89]"
            aria-label="Număr de avize pe pagină"
          >
            {AVIZ_PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <span className="text-slate-500">pe pagină</span>
        </label>
        <span className="text-slate-400 hidden sm:inline">·</span>
        <span className="tabular-nums text-slate-600">
          {total === 0 ? '0 avize' : `${rangeFrom}–${rangeTo} din ${total}`}
        </span>
        {selected.size > 0 ? (
          <span className="text-xs text-slate-500">
            ({selected.size} selectate{selected.size > rows.length ? ', inclusiv pe alte pagini' : ''})
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 0 || busy || refreshing}
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
          disabled={page + 1 >= pageCount || busy || refreshing}
          onClick={() => setPage((p) => p + 1)}
          className="inline-flex h-9 items-center px-3 text-sm font-medium border border-slate-200 bg-white rounded-lg hover:bg-slate-50 disabled:opacity-40"
        >
          Înainte
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">Avize OCR</h1>
          <p className="text-sm text-slate-500 mt-1">Extrage câmpuri din avize și unește-le într-o Anexă Factură XLSX</p>
        </div>
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg self-start">
          {[['avize', 'Avize OCR'], ['sabloane', 'Șabloane'], ['rapoarte', 'Sinteze']].map(([id, label]) => (
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
            <select
              className={`${inputCls} h-10 py-0 min-w-[12rem] w-full sm:w-56 sm:flex-none`}
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              aria-label="Șablon Anexa Factură"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (implicit)' : ''}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={selected.size === 0 || !templateId || busy || exporting}
              onClick={exportSelected}
              aria-busy={exporting}
              title={
                exporting
                  ? 'Se generează anexa…'
                  : selected.size === 0
                    ? 'Bifează avizele din tabel, apoi apasă aici'
                    : 'Unește rândurile selectate într-un fișier Anexa Factură'
              }
              className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium text-white bg-[#0A7A3E] rounded-lg hover:bg-[#096c37] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {exporting
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Download className="w-4 h-4" />}
              {exporting ? 'Se unește…' : `Unește în Anexa XLSX (${selected.size})`}
            </button>
            <button
              type="button"
              disabled={confirmableSelectedIds.length === 0 || busy}
              onClick={bulkConfirm}
              className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium border border-emerald-200 text-emerald-800 bg-white rounded-lg hover:bg-emerald-50 disabled:opacity-40"
            >
              Confirmă selectate
            </button>
            {/* The draft lands in Financiar, and the companion has no /finance, a button whose
                result the operator cannot open anywhere is worse than no button. */}
            {!isDocumentsProfile() && (
              <button
                type="button"
                disabled={selected.size === 0 || busy}
                onClick={draftInvoice}
                className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium border border-slate-200 bg-white rounded-lg hover:bg-slate-50 disabled:opacity-40"
              >
                Ciornă factură
              </button>
            )}
          </div>

          {ocrBanner}
          {filterBar}
          <AvizLegend id="avize-actiuni" title="Legendă acțiuni" items={AVIZ_ACTION_LEGEND} />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={selected.size === 0 || busy}
              onClick={() => {
                setDeleteBulkCount(selected.size);
                setDeleteBulkOpen(true);
              }}
              title={selected.size === 0 ? 'Bifează avizele din tabel, apoi apasă aici' : 'Șterge definitiv avizele selectate'}
              className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium border border-red-200 text-red-700 bg-white rounded-lg hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" />
              Șterge selectate ({selected.size})
            </button>
          </div>

          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-600"
            role="note"
            aria-label="Legendă statusuri"
          >
            {AVIZ_STATUS_DOT_LEGEND.map((item) => (
              <span key={item.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className={`w-2 h-2 rounded-full shrink-0 ${item.dotCls}`} aria-hidden />
                {item.label}
              </span>
            ))}
            <span className="text-slate-500 min-w-0 text-pretty">{AVIZ_STATUS_DOT_ONELINER}</span>
          </div>

          {rows.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200/80 p-12 text-center text-slate-400 shadow-sm space-y-3">
              <ClipboardList className="w-10 h-10 mx-auto mb-1 opacity-40" />
              {hiddenByFilters > 0 ? (
                <>
                  <p className="text-sm text-slate-600">
                    Filtrele ascund {hiddenByFilters} aviz(e) din firmă (inclusiv cele de la șofer).
                  </p>
                  <button
                    type="button"
                    onClick={resetAvizFilters}
                    className="inline-flex h-10 items-center px-4 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg"
                  >
                    Resetează filtrele
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm">
                    Încarcă PDF-uri sau poze de aviz. OCR-ul completează tabelul; tu corectezi km, taxe și observații.
                  </p>
                  <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                    Avizele completate manual de șofer apar aici automat. Verifică că ești logat pe
                    aceeași firmă ca șoferul (ex. <span className="font-medium text-slate-500">admin@rai-spedition.ro</span>)
                    și filtrează după <span className="font-medium text-slate-500">Data încărcării</span>.
                  </p>
                </>
              )}
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
                        <p className={`font-semibold truncate ${lowField(row, 'numar_tpo') ? LOW_FIELD_TEXT_CLS : 'text-[#0A2B4E]'}`}>
                          {row.status === 'uploaded'
                            ? <span className="font-normal text-sky-800">Se procesează…</span>
                            : (row.numar_tpo || 'Fără TPO')}
                          {lowField(row, 'numar_tpo') && row.status !== 'uploaded' ? (
                            <span className="ml-2 text-[10px] font-bold text-red-700" title="OCR nu e sigur pe acest câmp — verifică pe document">OCR nesigur</span>
                          ) : null}
                          {row.duplicate_tpo ? <span className="ml-2 text-[11px] font-normal text-amber-700">aviz duplicat</span> : null}
                        </p>
                        <p className="text-xs text-slate-500 truncate">{row.numar_document_marfa || row.original_filename}</p>
                        <p className={`text-xs mt-1 truncate ${lowField(row, 'numar_auto') ? LOW_FIELD_TEXT_CLS : 'text-slate-500'}`}>
                          {row.numar_auto || '-'} · {formatDate(row.data_efectuare_cursa)}
                        </p>
                        <p className={`text-xs mt-1 truncate ${lowField(row, 'ruta_transport') ? LOW_FIELD_TEXT_CLS : 'text-slate-500'}`} title={displayRoute(row)}>
                          {displayRoute(row) || '-'}
                          {isLearnedRoute(row) ? (
                            <span className="ml-1 text-[10px] font-normal text-slate-400">· învățată</span>
                          ) : null}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-1 truncate" title={formatIncarcareLabel(row, formatAvizIncarcare)}>
                          {formatIncarcareLabel(row, formatAvizIncarcare)}
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
                          <NeedsReviewBadge
                            needsReview={row.needs_review}
                            routing={row.validation_routing}
                            status={row.status}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end mt-3 pt-3 border-t border-slate-100">
                      <AvizRowActions
                        row={row}
                        locked={rowLocked(row.id)}
                        ocrDown={ocrDown}
                        reextracting={busyId === row.id}
                        onEdit={openEdit}
                        onReview={(r) => setReviewId(r.id)}
                        onConfirm={confirmRow}
                        onReextract={requestReextract}
                        onDelete={setDeleteRow}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden xl:block bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
                <p className="px-4 py-2 text-[11px] text-slate-500 border-b border-slate-100 xl:block 2xl:hidden">
                  Marfă și Document apar pe ecrane late (≥1536px). Pe laptop derulează ușor spre dreapta dacă e nevoie, coloana Acțiuni rămâne fixă.
                </p>
                <div className="overflow-x-auto">
                  <table className="text-sm w-full">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-500 text-xs">
                        <th className="px-2 py-2.5 w-9">
                          <input
                            type="checkbox"
                            checked={allPageSelected}
                            onChange={toggleAll}
                            title="Selectează / deselectează pagina curentă"
                          />
                        </th>
                        <th className="text-left font-medium px-2 py-2.5 min-w-[6.5rem]">TPO</th>
                        <th className="text-left font-medium px-2 py-2.5 w-[5.5rem]">Data</th>
                        <th className="text-left font-medium px-2 py-2.5 min-w-[5.5rem] max-w-[8rem]">Auto</th>
                        <th className="text-left font-medium px-2 py-2.5 min-w-[8rem]">Rută</th>
                        <th className="text-left font-medium px-2 py-2.5 min-w-[5rem] hidden 2xl:table-cell">Marfă</th>
                        <th className="text-left font-medium px-2 py-2.5 min-w-[5rem] hidden 2xl:table-cell">Document</th>
                        <th className="text-left font-medium px-2 py-2.5 min-w-[6.5rem]">Stare</th>
                        <th className="text-left font-medium px-2 py-2.5 min-w-[7.5rem]">Încărcare</th>
                        <th className="text-right font-medium px-2 py-2.5 min-w-[6.5rem] sticky right-0 z-10 bg-white shadow-[-8px_0_12px_-8px_rgba(15,23,42,0.08)]">
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
                          <td className={`px-2 py-2.5 font-medium truncate max-w-[9rem] ${lowField(row, 'numar_tpo') ? LOW_FIELD_TEXT_CLS : 'text-[#0A2B4E]'}`} title={lowField(row, 'numar_tpo') ? `${row.numar_tpo || ''} · OCR nesigur` : (row.numar_tpo || row.original_filename || '')}>
                            {busyId === row.id ? (
                              <span className="inline-flex items-center gap-1.5 font-normal text-sky-800">
                                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                Se re-extrage…
                              </span>
                            ) : row.status === 'uploaded' ? (
                              <span className="font-normal text-sky-800 inline-flex items-center gap-1.5">
                                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                Se procesează…
                              </span>
                            ) : row.numar_tpo ? (
                              <>
                                {row.numar_tpo}
                                {lowField(row, 'numar_tpo') ? (
                                  <span className="ml-1 text-[10px] font-bold text-red-700">OCR nesigur</span>
                                ) : null}
                              </>
                            ) : (
                              <span className="font-normal text-slate-400">{row.original_filename || '-'}</span>
                            )}
                            {row.duplicate_tpo && busyId !== row.id ? <div className="text-[10px] font-normal text-amber-700">duplicat</div> : null}
                          </td>
                          <td className="px-2 py-2.5 text-slate-600 truncate whitespace-nowrap">{formatDate(row.data_efectuare_cursa)}</td>
                          <td
                            className={`px-2 py-2.5 truncate max-w-[8rem] ${lowField(row, 'numar_auto') ? LOW_FIELD_TEXT_CLS : ''}`}
                            title={lowField(row, 'numar_auto')
                              ? `${row.numar_auto || ''} · OCR nesigur pe Auto (se stinge când Autoturisme are MTMA + verificat)`
                              : (row.numar_auto || '')}
                          >
                            {row.numar_auto || '-'}
                          </td>
                          <td
                            className={`px-2 py-2.5 truncate max-w-[12rem] ${lowField(row, 'ruta_transport') ? LOW_FIELD_TEXT_CLS : ''}`}
                            title={isLearnedRoute(row) ? `${displayRoute(row)} (regulă învățată)` : displayRoute(row)}
                          >
                            {displayRoute(row) || '-'}
                          </td>
                          <td className="px-2 py-2.5 truncate max-w-[7rem] hidden 2xl:table-cell" title={`${row.cantitate_marfa ?? ''} ${row.tip_marfa || row.quantity_unit || ''}`.trim()}>
                            {row.cantitate_marfa ?? '-'} {row.tip_marfa || row.quantity_unit || ''}
                          </td>
                          <td className="px-2 py-2.5 truncate max-w-[7rem] hidden 2xl:table-cell" title={row.numar_document_marfa || ''}>{row.numar_document_marfa || '-'}</td>
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
                                <NeedsReviewBadge
                                  needsReview={row.needs_review}
                                  routing={row.validation_routing}
                                  status={row.status}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2.5 text-xs text-slate-600 whitespace-nowrap" title={formatIncarcareLabel(row, formatAvizIncarcare)}>
                            {formatIncarcareLabel(row, formatAvizIncarcare)}
                          </td>
                          <td className={`px-2 py-2.5 sticky right-0 z-10 shadow-[-8px_0_12px_-8px_rgba(15,23,42,0.08)] ${
                            busyId === row.id ? 'bg-sky-50/80' : 'bg-white group-hover:bg-slate-50/50'
                          }`}>
                            <div className="flex justify-end">
                              <AvizRowActions
                                row={row}
                                locked={rowLocked(row.id)}
                                ocrDown={ocrDown}
                                reextracting={busyId === row.id}
                                onEdit={openEdit}
                                onReview={(r) => setReviewId(r.id)}
                                onConfirm={confirmRow}
                                onReextract={requestReextract}
                                onDelete={setDeleteRow}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {paginationBar}
            </>
          )}
        </>
      ) : tab === 'sabloane' ? (
        <AvizTemplatesTab
          templates={templates}
          obsCodes={obsCodes}
          newCode={newCode}
          setNewCode={setNewCode}
          newLabel={newLabel}
          setNewLabel={setNewLabel}
          onNewTemplate={newTemplate}
          onEdit={(t) => setEditTemplate(t)}
          onDelete={setDeleteTemplate}
          onAddCode={addObsCode}
          onDeleteCode={(c) => api.avize.deleteObservationCode(c.id).then(() => api.avize.observationCodes().then(setObsCodes)).catch((e) => notifyError('Ștergere eșuată', e))}
          activeTemplateId={templateId}
          onUseForExport={useTemplateForExport}
        />
      ) : (
        <AvizReportsTab
          filterBar={filterBar}
          reportData={reportData}
          onRefresh={loadReports}
          range={{ from: filters.from, to: filters.to }}
        />
      )}

      {editRow && (
        <AvizEditModal
          editRow={editRow}
          formRevision={editFormRevision}
          obsCodes={obsCodes}
          saving={saving}
          reextracting={busyId === editRow.id}
          onClose={closeEditModal}
          onSave={saveEdit}
          onReextract={requestReextract}
          onFileReplaced={(row) => {
            if (!row?.id) return;
            setEditRow((prev) => (prev?.id === row.id ? { ...prev, ...row } : prev));
            setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...row } : r)));
          }}
        />
      )}

      {reviewId && (
        <AvizReviewDrawer
          documentId={reviewId}
          reloadKey={reviewReloadKey}
          reextracting={busyId === reviewId}
          onClose={closeReviewDrawer}
          onSaved={refreshAfterReview}
          onReextract={requestReextract}
        />
      )}

      {forceGate && (
        <AvizForceGateModal
          mode={forceGate.mode === 'export' ? 'export' : 'confirm'}
          queue={forceGate.queue || []}
          initialId={forceGate.queue?.[0]?.id || forceGate.row?.id}
          busy={busy || exporting || Boolean(busyId)}
          reextracting={Boolean(busyId)}
          onCancel={() => setForceGate(null)}
          onConfirm={runForceGateConfirm}
          onSaveItem={saveForceGateItem}
          onReextract={requestReextract}
          peerRows={forceGate.peerRows || null}
          mergeTpoPreview={Boolean(forceGate.mergeTpoPreview)}
          mergeTpoRequired={Boolean(forceGate.mergeTpoRequired ?? forceGate.mergeTpoPreview)}
        />
      )}

      {editTemplate && (
        <ModalShell onClose={() => setEditTemplate(null)} panelClassName="max-w-3xl" labelledBy="tmpl-edit-title">
          <div className="p-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 id="tmpl-edit-title" className="text-lg font-semibold text-[#0A2B4E]">Șablon XLSX</h2>
              <button type="button" onClick={() => setEditTemplate(null)} aria-label="Închide"><X className="w-5 h-5 text-slate-500" /></button>
            </div>
            {isLockedRai(editTemplate) ? (
              <p className="mb-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Coloanele Anexei sunt blocate (layout agreat cu clientul). Poți schimba numele și bifa „implicit”;
                pentru alt set de coloane, fă un șablon nou din Anexă.
              </p>
            ) : null}
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
            <label className="flex items-start gap-2 text-sm text-slate-700 mb-4">
              <input
                type="checkbox"
                className="mt-1"
                checked={Boolean(editTemplate.options?.merge_tpo_cells)}
                onChange={(e) => setEditTemplate((p) => ({
                  ...p,
                  options: {
                    ...(p.options && typeof p.options === 'object' ? p.options : {}),
                    merge_tpo_cells: e.target.checked,
                  },
                }))}
              />
              <span>
                <span className="font-medium text-[#0A2B4E]">Unește celulele TPO</span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  Grupează curse după TPO, sudează Număr TPO în XLSX (toate cursele aceluiași TPO)
                  și lipește în preview paginile adiacente cu același TPO (ex. Baumit).
                </span>
              </span>
            </label>
            <div className={`space-y-2 ${isLockedRai(editTemplate) ? 'opacity-70 pointer-events-none' : ''}`}>
              {(editTemplate.columns || []).map((col, idx) => (
                <div key={`${col.key}-${idx}`} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end bg-slate-50 rounded-lg p-2">
                  <div className="sm:col-span-3">
                    <label className={labelCls}>Header</label>
                    <input
                      className={inputCls}
                      value={col.header || ''}
                      disabled={isLockedRai(editTemplate)}
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
                      disabled={isLockedRai(editTemplate)}
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
                      disabled={isLockedRai(editTemplate)}
                      onChange={(e) => {
                        const columns = [...editTemplate.columns];
                        columns[idx] = { ...col, default_value: e.target.value };
                        setEditTemplate((p) => ({ ...p, columns }));
                      }}
                    />
                  </div>
                  <div className="sm:col-span-2 flex justify-end">
                    {!isLockedRai(editTemplate) ? (
                      <button
                        type="button"
                        className="text-red-500 p-2"
                        onClick={() => setEditTemplate((p) => ({ ...p, columns: p.columns.filter((_, i) => i !== idx) }))}
                        aria-label="Șterge coloana"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            {!isLockedRai(editTemplate) ? (
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
            ) : null}
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
        title={confirmDuplicate?.mode === 'export' ? 'Export cu aviz duplicat?' : 'Aviz duplicat'}
        description={
          confirmDuplicate?.mode === 'export'
            ? (confirmDuplicate.dupCount === 1
              ? 'Un aviz marcat „duplicat” e în selecție, risc de facturare dublă dacă e o încărcare greșită. '
                + 'Verifică lista (Șterge rândul greșit) sau exportă oricum.'
              : `${confirmDuplicate.dupCount} avize marcate „duplicat” sunt în selecție, risc de facturare dublă. `
                + 'Verifică lista sau exportă oricum.')
            : confirmDuplicate?.mode === 'bulk'
              ? `${confirmDuplicate.dupCount} din rândurile selectate sunt același transport ca alt document. `
                + 'Dacă sunt încărcări greșite, folosește Șterge înainte de confirmare. Confirmi oricum?'
              : `„${confirmDuplicate?.row?.numar_tpo || confirmDuplicate?.row?.original_filename || 'Acest aviz'}” `
                + 'este același transport ca alt rând. Dacă e o încărcare greșită, folosește Șterge. Confirmi oricum?'
        }
        confirmLabel={confirmDuplicate?.mode === 'export' ? 'Exportă oricum' : 'Confirmă oricum'}
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
        open={deleteBulkOpen}
        onClose={() => { if (!busy) setDeleteBulkOpen(false); }}
        onConfirm={runBulkDelete}
        busy={busy}
        variant="danger"
        title="Șterge avizele selectate?"
        description={
          deleteBulkCount === 1
            ? 'Ștergeți 1 aviz selectat? Acțiunea nu se poate anula.'
            : `Ștergeți ${deleteBulkCount} avize selectate? Acțiunea nu se poate anula.`
        }
        confirmLabel={deleteBulkCount === 1 ? 'Șterge' : `Șterge ${deleteBulkCount}`}
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
