import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, FileText, Loader2, Upload } from 'lucide-react';
import { api } from '@/api/client';
import { notifyError, notifySuccess } from '@/lib/notify';
import { findDriverForUser } from '@/lib/utils';
import { DOC_TYPES } from '@/lib/cmrUi';

const STATUS_LABEL = {
  uploaded: 'Încărcat',
  extracted: 'OCR gata',
  needs_review: 'De revizuit',
  confirmed: 'Confirmat',
  unrecognised: 'Nerecunoscut',
  failed: 'Eșuat',
};

const fieldCls =
  'w-full min-h-[44px] px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-[#1D4E89]';

/**
 * Driver home for road paperwork: camera or gallery → same office avize queue.
 */
export default function DriverUploadDocuments({ user }) {
  const [docType, setDocType] = useState('aviz');
  const [tripId, setTripId] = useState('');
  const [trips, setTrips] = useState([]);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const me = user || await api.auth.me();
      const drivers = await api.entities.Driver.list().catch(() => []);
      const myDriver = findDriverForUser(drivers, me);

      const [mine, tripList] = await Promise.all([
        api.driverDocuments.listMine(30).catch(() => ({ documents: [] })),
        myDriver
          ? api.entities.Trip.filter({ driver_id: myDriver.id }, '-created_date', 30).catch(() => [])
          : Promise.resolve([]),
      ]);

      setDocs(mine.documents || []);
      const active = (Array.isArray(tripList) ? tripList : []).filter(
        (t) => !['livrata', 'anulata'].includes(t.status)
      );
      setTrips(active);
      if (active.length === 1) setTripId((prev) => prev || active[0].id);
    } catch (err) {
      notifyError('Nu am putut încărca documentele', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const uploadFiles = async (fileList) => {
    const files = [...(fileList || [])];
    if (!files.length) return;
    setUploading(true);
    try {
      const result = await api.driverDocuments.upload({
        tripId: tripId || undefined,
        files,
        document_type: docType,
      });
      const n = result.documents?.length || files.length;
      notifySuccess(
        'Documente trimise',
        `${n} fișier(e) → coada biroului (OCR pe /avize)`
      );
      setDocs((prev) => [...(result.documents || []), ...prev].slice(0, 40));
    } catch (err) {
      notifyError('Încărcare eșuată', err);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
      if (cameraRef.current) cameraRef.current.value = '';
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-7 h-7 text-slate-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
        Pozează un aviz / cântar sau alege din galerie. Ajung la birou pe Avize / Rapoarte.
      </p>

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4 sm:p-5 space-y-3 sm:space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Tip document</label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className={fieldCls}
            >
              {DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Cursă (opțional)</label>
            <select
              value={tripId}
              onChange={(e) => setTripId(e.target.value)}
              className={fieldCls}
            >
              <option value="">— Fără cursă (biroul leagă ulterior) —</option>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.cmr_number || t.id.slice(0, 8)} · {t.status}
                </option>
              ))}
            </select>
          </div>
        </div>

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

        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          <button
            type="button"
            disabled={uploading}
            onClick={() => cameraRef.current?.click()}
            className="flex flex-col items-center justify-center gap-1.5 sm:gap-2 min-h-[5.5rem] sm:min-h-[7rem] px-2 sm:px-4 py-3 text-sm font-medium text-white bg-[#0A2B4E] rounded-xl active:scale-[0.99] disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-6 h-6 sm:w-7 sm:h-7 animate-spin" /> : <Camera className="w-6 h-6 sm:w-7 sm:h-7" />}
            Foto
          </button>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="flex flex-col items-center justify-center gap-1.5 sm:gap-2 min-h-[5.5rem] sm:min-h-[7rem] px-2 sm:px-4 py-3 text-sm font-medium text-[#0A2B4E] bg-slate-50 border border-slate-200 rounded-xl active:scale-[0.99] disabled:opacity-50"
          >
            <Upload className="w-6 h-6 sm:w-7 sm:h-7" />
            <span className="text-center leading-tight">
              <span className="sm:hidden">Galerie</span>
              <span className="hidden sm:inline">Galerie / fișier</span>
            </span>
          </button>
        </div>
        <p className="text-[11px] text-slate-400 text-center leading-snug px-1">
          Pe telefon, Foto deschide camera. PDF și imagini din galerie merg la „Galerie”.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-[#0A2B4E]">Trimise recent</h3>
        </div>
        {docs.length > 0 ? (
          <ul className="divide-y divide-slate-50">
            {docs.map((doc) => (
              <li key={doc.id} className="px-4 sm:px-5 py-3 flex items-start gap-3 min-w-0">
                <FileText className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-700 truncate">
                    {doc.original_filename || 'Document'}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 break-words">
                    {doc.document_type || 'aviz'}
                    {' · '}
                    {STATUS_LABEL[doc.status] || doc.status || '—'}
                    {doc.needs_review ? ' · de revizuit' : ''}
                    {doc.created_at
                      ? ` · ${new Date(doc.created_at).toLocaleString('ro-RO')}`
                      : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-8 sm:py-10 text-center text-sm text-slate-400">
            Niciun document trimis încă.
          </p>
        )}
      </div>
    </div>
  );
}
