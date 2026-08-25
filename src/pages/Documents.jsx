import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { AlertTriangle, FileText, Truck, Users, Upload, HardDrive, Camera } from 'lucide-react';
import { notifyError, notifySuccess } from '@/lib/notify';

const KIND_LABEL = { vu: 'Unitate vehicul', card: 'Card șofer', unknown: 'Necunoscut' };
const STATUS_LABEL = {
  partial: 'Parțial (TLV)',
  stored: 'Arhivat',
  failed: 'Eșuat',
};

export default function Documents() {
  const [expiring, setExpiring] = useState([]);
  const [horizonDays, setHorizonDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [imports, setImports] = useState([]);
  const [pendingCmrs, setPendingCmrs] = useState([]);
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [vehicleList, driverList, company, tacho, tripDocs] = await Promise.all([
        api.entities.Vehicle.list(),
        api.entities.Driver.list(),
        api.company.get().catch(() => null),
        api.tachograph.listImports(30).catch(() => []),
        api.entities.TripDocument.filter({ is_confirmed: false }).catch(() => []),
      ]);
      setVehicles(vehicleList);
      setDrivers(driverList);
      setImports(Array.isArray(tacho) ? tacho : []);
      const pending = (Array.isArray(tripDocs) ? tripDocs : [])
        .filter((d) => d.original_image_url && !d.is_confirmed)
        .sort((a, b) => new Date(b.created_date || b.created_at || 0) - new Date(a.created_date || a.created_at || 0));
      setPendingCmrs(pending);
      const now = new Date();
      const days = Array.isArray(company?.settings?.document_expiry_days)
        ? company.settings.document_expiry_days
        : [30];
      const horizonDaysValue = days.length ? Math.max(...days) : 30;
      setHorizonDays(horizonDaysValue);
      const inHorizon = new Date();
      inHorizon.setDate(now.getDate() + horizonDaysValue);
      const list = [];

      vehicleList.forEach((v) => {
        const docs = [
          { type: 'ITP', number: v.itp_number, date: v.itp_expiry },
          { type: 'RCA', number: v.rca_number, date: v.rca_expiry },
          { type: 'Rovinietă', number: v.rovinieta_number, date: v.rovinieta_expiry },
          { type: 'CASCO', number: v.casco_number, date: v.casco_expiry },
        ];
        docs.forEach((d) => {
          if (d.date && new Date(d.date) <= inHorizon) {
            list.push({ entity: `${v.brand} ${v.model} (${v.plate})`, entityType: 'vehicle', ...d, expired: new Date(d.date) < now });
          }
        });
      });

      driverList.forEach((d) => {
        const docs = [
          { type: 'Permis', number: d.license_number, date: d.license_expiry },
          { type: 'Medical', number: d.medical_certificate_number, date: d.medical_certificate_expiry },
          { type: 'Tahograf', number: d.tachograph_card_number, date: d.tachograph_card_expiry },
        ];
        docs.forEach((doc) => {
          if (doc.date && new Date(doc.date) <= inHorizon) {
            list.push({ entity: d.name, entityType: 'driver', ...doc, expired: new Date(doc.date) < now });
          }
        });
      });

      list.sort((a, b) => new Date(a.date) - new Date(b.date));
      setExpiring(list);
    } catch (e) {
      console.error(e);
      notifyError('Nu am putut încărca documentele', e);
    } finally {
      setLoading(false);
    }
  };

  const onPickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const result = await api.tachograph.importFile({
        file,
        driver_id: driverId || undefined,
        vehicle_id: vehicleId || undefined,
      });
      notifySuccess(
        'Tahograf importat',
        `${KIND_LABEL[result.analysis?.kind] || result.analysis?.kind} · ${STATUS_LABEL[result.analysis?.status] || result.analysis?.status}`
      );
      setImports((prev) => [result.import, ...prev].slice(0, 30));
    } catch (err) {
      notifyError('Import tahograf eșuat', err);
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" />
      </div>
    );
  }

  const expired = expiring.filter((d) => d.expired);
  const upcoming = expiring.filter((d) => !d.expired);

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">Documente</h1>
        <p className="text-sm text-slate-500 mt-1">
          {expired.length} expirate · {upcoming.length} expiră în {horizonDays} zile
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center gap-2">
          <Camera className="w-5 h-5 text-[#1D4E89]" />
          <div>
            <h2 className="font-semibold text-[#0A2B4E]">CMR încărcate de șofer</h2>
            <p className="text-xs text-slate-500">Rapoarte de confirmat pe cursă (OCR)</p>
          </div>
        </div>
        {pendingCmrs.length > 0 ? (
          <div className="divide-y divide-slate-50">
            {pendingCmrs.map((doc) => (
              <Link
                key={doc.id}
                to={`/trips/${doc.trip_id}`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/80"
              >
                <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">
                    CMR {doc.cmr_number || '—'}
                  </p>
                  <p className="text-xs text-slate-500">
                    Neconfirmat · {doc.created_date || doc.created_at
                      ? new Date(doc.created_date || doc.created_at).toLocaleString('ro-RO')
                      : '—'}
                  </p>
                </div>
                <span className="text-xs font-medium text-[#1D4E89]">Deschide cursa</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-slate-400 text-sm">
            Niciun CMR neconfirmat de la șoferi.
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
            <HardDrive className="w-5 h-5 text-[#0A2B4E]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-[#0A2B4E]">Import tahograf (.ddd)</h2>
            <p className="text-xs text-slate-500 mt-1">
              Arhivăm download-ul VU/card și detectăm tipul TLV. Analiza completă Reg. 561/2006
              vine mai târziu — nu inventăm încălcări din fișierul brut.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Șofer (opțional)</label>
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              className="px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white"
            >
              <option value="">—</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Vehicul (opțional)</label>
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className="px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white"
            >
              <option value="">—</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.plate}</option>
              ))}
            </select>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".ddd,.tgd,.c1b,.v1b,.DDD,.TGD,.C1B,.V1B"
            className="hidden"
            onChange={onPickFile}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            {uploading ? 'Se încarcă…' : 'Încarcă .ddd'}
          </button>
        </div>
        {imports.length > 0 ? (
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
            {imports.map((row) => (
              <div key={row.id} className="px-3 py-2.5 flex flex-wrap gap-2 items-start justify-between text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-slate-700 truncate">{row.original_filename}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {KIND_LABEL[row.kind] || row.kind}
                    {' · '}
                    {STATUS_LABEL[row.status] || row.status}
                    {row.known_tag_count != null ? ` · ${row.known_tag_count}/${row.tag_count || 0} tag-uri cunoscute` : ''}
                    {row.driver_name ? ` · ${row.driver_name}` : ''}
                    {row.vehicle_plate ? ` · ${row.vehicle_plate}` : ''}
                  </p>
                </div>
                <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                  {row.created_at ? new Date(row.created_at).toLocaleString('ro-RO') : ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400">Niciun import încă.</p>
        )}
      </div>

      {expired.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <h2 className="font-semibold text-red-700">Documente expirate</h2>
          </div>
          <div className="space-y-2">
            {expired.map((d, i) => (
              <div key={i} className="flex items-center gap-3 bg-white rounded-lg p-3">
                {d.entityType === 'vehicle' ? <Truck className="w-4 h-4 text-slate-400" /> : <Users className="w-4 h-4 text-slate-400" />}
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-700">{d.entity}</p>
                  <p className="text-xs text-slate-500">{d.type} · {d.number || 'fără număr'}</p>
                </div>
                <span className="text-xs font-medium text-red-600">
                  Expirat: {new Date(d.date).toLocaleDateString('ro-RO')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-500" />
            <h2 className="font-semibold text-[#0A2B4E]">Expiră în {horizonDays} zile</h2>
          </div>
        </div>
        {upcoming.length > 0 ? (
          <div className="divide-y divide-slate-50">
            {upcoming.map((d, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/50">
                {d.entityType === 'vehicle' ? <Truck className="w-4 h-4 text-slate-400" /> : <Users className="w-4 h-4 text-slate-400" />}
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-700">{d.entity}</p>
                  <p className="text-xs text-slate-500">{d.type} · {d.number || 'fără număr'}</p>
                </div>
                <span className="text-xs font-medium text-amber-600">
                  Expiră: {new Date(d.date).toLocaleDateString('ro-RO')}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center text-slate-400">
            <p className="text-sm">Nu există documente care expiră în curând.</p>
          </div>
        )}
      </div>
    </div>
  );
}
