import React, { useEffect, useState } from 'react';
import { api } from '@/api/client';
import StatusBadge from '@/components/StatusBadge';
import DriverNotifications from '@/components/driver/DriverNotifications';
import DriverChat from '@/components/driver/DriverChat';
import DriverProfile from '@/components/driver/DriverProfile';
import {
  formatDate,
  isActiveTripStatus,
  findDriverForUser,
  openNavigation,
} from '@/lib/utils';
import {
  Route, Package, Truck, Camera, ChevronRight, Loader2, CheckCircle2,
  CircleDot, Navigation, MessageSquare, User, Bell, Phone,
} from 'lucide-react';

/** One primary action per status — TMS driver pattern */
const STATUS_FLOW = [
  { key: 'alocata', label: 'Alocată', icon: CircleDot, next: 'incarcata', actionLabel: '📦 Am încărcat' },
  { key: 'incarcata', label: 'Încărcată', icon: Package, next: 'in_tranzit', actionLabel: '🚛 Am plecat' },
  { key: 'in_tranzit', label: 'În tranzit', icon: Truck, next: 'livrata', actionLabel: '📋 Am livrat' },
  { key: 'livrata', label: 'Livrată', icon: CheckCircle2, next: null, actionLabel: null },
];

export default function DriverApp() {
  const [user, setUser] = useState(null);
  const [driver, setDriver] = useState(null);
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [tripDoc, setTripDoc] = useState(null);
  const [tab, setTab] = useState('trips');
  const [listMode, setListMode] = useState('active'); // active | history
  const [unreadCount, setUnreadCount] = useState(0);
  const [previewMode, setPreviewMode] = useState(false);

  useEffect(() => {
    bootstrap();
  }, []);

  useEffect(() => {
    if (!selectedTrip?.id) {
      setTripDoc(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const docs = await api.entities.TripDocument.filter({ trip_id: selectedTrip.id });
        if (!cancelled) setTripDoc(docs[0] || null);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedTrip?.id]);

  const bootstrap = async () => {
    setLoading(true);
    try {
      const me = await api.auth.me();
      setUser(me);
      const drivers = await api.entities.Driver.list();
      const myDriver = findDriverForUser(drivers, me);
      setDriver(myDriver);

      const isOffice = ['admin', 'dispatcher', 'finance'].includes(me.role);
      setPreviewMode(!myDriver && isOffice);

      await Promise.all([loadTrips(me, myDriver, isOffice), loadUnreadCount()]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadUnreadCount = async () => {
    try {
      const notifs = await api.entities.DriverNotification.filter({ is_read: false });
      setUnreadCount(notifs.length);
    } catch (e) {
      console.error(e);
    }
  };

  const loadTrips = async (me = user, myDriver = driver, isOffice = previewMode) => {
    try {
      const data = await api.entities.Trip.list('-created_date', 200);
      let scoped = data;

      if (myDriver) {
        scoped = data.filter((t) => t.driver_id === myDriver.id);
      } else if (isOffice || (me && ['admin', 'dispatcher', 'finance'].includes(me.role))) {
        // Office preview: all trips that are assigned or active
        scoped = data.filter((t) => t.driver_id || isActiveTripStatus(t.status) || t.status === 'livrata');
      } else {
        scoped = [];
      }

      setTrips(scoped);

      // Keep selected trip in sync
      setSelectedTrip((prev) => {
        if (!prev) return null;
        return scoped.find((t) => t.id === prev.id) || null;
      });
    } catch (e) {
      console.error(e);
    }
  };

  const updateStatus = async (trip, newStatus) => {
    setUpdating(true);
    try {
      const patch = { status: newStatus };
      if (newStatus === 'livrata') {
        patch.actual_delivery_date = new Date().toISOString().slice(0, 10);
      }
      const updated = await api.entities.Trip.update(trip.id, patch);

      const statusLabels = {
        alocata: 'alocată',
        incarcata: 'încărcată',
        in_tranzit: 'în tranzit',
        livrata: 'livrată',
      };
      try {
        await api.entities.DriverNotification.create({
          title: `Status: ${statusLabels[newStatus] || newStatus}`,
          message: `Cursa ${trip.cmr_number || ''} → ${statusLabels[newStatus] || newStatus}.`,
          type: 'status_update',
          trip_id: trip.id,
          cmr_number: trip.cmr_number,
          is_read: false,
        });
      } catch {
        // non-blocking
      }

      setSelectedTrip(updated);
      await loadTrips();
      loadUnreadCount();
    } catch (e) {
      console.error(e);
      alert('Nu am putut actualiza statusul: ' + (e.message || ''));
    } finally {
      setUpdating(false);
    }
  };

  const uploadCMR = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!selectedTrip) {
      alert('Selectează o cursă înainte de a încărca CMR.');
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      const { file_url } = await api.integrations.Core.UploadFile({ file });
      const docs = await api.entities.TripDocument.filter({ trip_id: selectedTrip.id });
      let docRow;
      if (docs.length > 0) {
        docRow = await api.entities.TripDocument.update(docs[0].id, {
          original_image_url: file_url,
          is_confirmed: false,
          ocr_extracted_data: null,
        });
      } else {
        docRow = await api.entities.TripDocument.create({
          trip_id: selectedTrip.id,
          cmr_number: selectedTrip.cmr_number,
          original_image_url: file_url,
          is_confirmed: false,
        });
      }

      const ocr = await api.integrations.Core.InvokeLLM({
        prompt: 'Extract CMR document data from this image.',
        file_urls: [file_url],
        trip_id: selectedTrip.id,
        trip_context: selectedTrip,
        response_json_schema: {
          type: 'object',
          properties: {
            cmr_number: { type: 'string' },
            date: { type: 'string' },
            shipper: { type: 'string' },
            consignee: { type: 'string' },
            goods_description: { type: 'string' },
            weight: { type: 'string' },
            packages: { type: 'string' },
          },
        },
      });

      docRow = await api.entities.TripDocument.update(docRow.id, { ocr_extracted_data: ocr });
      setTripDoc(docRow);
      alert('CMR încărcat și procesat. Dispecerul poate confirma datele OCR.');
    } catch (err) {
      console.error(err);
      alert('Eroare: ' + (err.message || 'Upload eșuat'));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" />
      </div>
    );
  }

  const activeTrips = trips.filter((t) => !['livrata', 'anulata'].includes(t.status));
  const historyTrips = trips.filter((t) => ['livrata', 'anulata'].includes(t.status));
  const visibleTrips = listMode === 'active' ? activeTrips : historyTrips;
  const currentFlowStep = STATUS_FLOW.findIndex((s) => s.key === selectedTrip?.status);
  const initials =
    (user?.full_name || user?.name || 'Ș')
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

  return (
    <div className="max-w-md mx-auto pb-24">
      <div className="bg-[#0A2B4E] text-white px-5 py-4 -mx-4 lg:-mx-6 lg:rounded-t-xl sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-white/60">Aplicație Șofer</p>
            <p className="font-bold text-lg">
              {selectedTrip && tab === 'trips' ? selectedTrip.cmr_number : 'Cursele mele'}
            </p>
          </div>
          <div className="w-9 h-9 rounded-full bg-[#F5A623] text-[#0A2B4E] flex items-center justify-center font-semibold text-sm">
            {initials}
          </div>
        </div>
        {previewMode && tab === 'trips' && !selectedTrip && (
          <p className="mt-2 text-xs text-amber-200/90 bg-white/10 rounded-lg px-3 py-2">
            Mod previzualizare dispecer — vezi cursele din firmă. Pentru experiența reală de șofer, autentifică-te cu <strong>sofer@transitix.ro</strong>.
          </p>
        )}
      </div>

      <div className="p-4 space-y-4">
        {tab === 'notifications' ? (
          <DriverNotifications onRead={loadUnreadCount} />
        ) : tab === 'chat' ? (
          <DriverChat />
        ) : tab === 'profile' ? (
          <DriverProfile driver={driver} trips={trips} />
        ) : selectedTrip ? (
          <>
            <button
              onClick={() => setSelectedTrip(null)}
              className="text-sm text-[#1D4E89] flex items-center gap-1"
            >
              ← Înapoi la curse
            </button>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-slate-400">CURSĂ</span>
                <StatusBadge status={selectedTrip.status} />
              </div>
              <h2 className="font-bold text-[#0A2B4E] text-lg">{selectedTrip.cmr_number}</h2>
              {(selectedTrip.driver_name || selectedTrip.vehicle_plate) && (
                <p className="text-xs text-slate-500 mt-1">
                  {selectedTrip.driver_name || '—'} · {selectedTrip.vehicle_plate || '—'}
                </p>
              )}

              <div className="mt-4 space-y-3">
                <div className="flex gap-3">
                  <div className="w-2 flex-shrink-0 flex flex-col items-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#F5A623]" />
                    <div className="w-0.5 flex-1 bg-slate-200 mt-1" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-slate-400">Încărcare</p>
                    <p className="text-sm font-medium text-slate-700">{selectedTrip.shipper_name}</p>
                    <p className="text-xs text-slate-500">{selectedTrip.shipper_address}</p>
                    {selectedTrip.shipper_phone && (
                      <a href={`tel:${selectedTrip.shipper_phone}`} className="inline-flex items-center gap-1 text-xs text-[#1D4E89] mt-1">
                        <Phone className="w-3 h-3" /> {selectedTrip.shipper_phone}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="w-2 flex-shrink-0 flex justify-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#27AE60]" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-slate-400">Descărcare</p>
                    <p className="text-sm font-medium text-slate-700">{selectedTrip.consignee_name}</p>
                    <p className="text-xs text-slate-500">{selectedTrip.consignee_address}</p>
                    {selectedTrip.consignee_phone && (
                      <a href={`tel:${selectedTrip.consignee_phone}`} className="inline-flex items-center gap-1 text-xs text-[#1D4E89] mt-1">
                        <Phone className="w-3 h-3" /> {selectedTrip.consignee_phone}
                      </a>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-slate-100 text-center">
                <div>
                  <p className="text-xs text-slate-400">Data</p>
                  <p className="text-sm font-medium text-slate-700">{formatDate(selectedTrip.loading_date)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Greutate</p>
                  <p className="text-sm font-medium text-slate-700">
                    {selectedTrip.weight_kg ? `${selectedTrip.weight_kg} kg` : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Colete</p>
                  <p className="text-sm font-medium text-slate-700">{selectedTrip.package_count || '-'}</p>
                </div>
              </div>

              {selectedTrip.special_instructions && (
                <div className="mt-3 p-3 bg-amber-50 rounded-lg">
                  <p className="text-xs text-amber-600 font-medium mb-1">Instrucțiuni speciale</p>
                  <p className="text-sm text-slate-600">{selectedTrip.special_instructions}</p>
                </div>
              )}
            </div>

            {isActiveTripStatus(selectedTrip.status) && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-[#0A2B4E] mb-4">Progres cursă</h3>
                <div className="space-y-3">
                  {STATUS_FLOW.map((step, idx) => {
                    const Icon = step.icon;
                    const isDone = idx < currentFlowStep || selectedTrip.status === 'livrata';
                    const isCurrent = idx === currentFlowStep;
                    return (
                      <div key={step.key} className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                            isDone ? 'bg-emerald-100' : isCurrent ? 'bg-[#0A2B4E]' : 'bg-slate-100'
                          }`}
                        >
                          <Icon
                            className={`w-4 h-4 ${
                              isDone ? 'text-emerald-600' : isCurrent ? 'text-white' : 'text-slate-400'
                            }`}
                          />
                        </div>
                        <span
                          className={`text-sm ${
                            isDone
                              ? 'text-slate-400 line-through'
                              : isCurrent
                                ? 'font-medium text-[#0A2B4E]'
                                : 'text-slate-400'
                          }`}
                        >
                          {step.label}
                        </span>
                        {isCurrent && step.next && (
                          <button
                            onClick={() => updateStatus(selectedTrip, step.next)}
                            disabled={updating}
                            className="ml-auto px-4 py-2.5 text-sm font-medium text-white bg-[#27AE60] rounded-lg hover:bg-emerald-600 disabled:opacity-50 min-h-[48px]"
                          >
                            {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : step.actionLabel}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-[#0A2B4E] mb-3">Document CMR</h3>
              {tripDoc?.original_image_url && !uploading && (
                <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium mb-2">
                    <CheckCircle2 className="w-4 h-4" />
                    CMR încărcat
                    {tripDoc.ocr_extracted_data?._stub && (
                      <span className="text-xs font-normal text-emerald-600">(OCR precompletat)</span>
                    )}
                  </div>
                  <img
                    src={tripDoc.original_image_url}
                    alt="CMR"
                    className="w-full max-h-48 object-contain rounded border border-slate-200 bg-white"
                  />
                </div>
              )}
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl py-8 cursor-pointer hover:border-[#1D4E89] hover:bg-slate-50 transition-colors min-h-[100px]">
                {uploading ? (
                  <>
                    <Loader2 className="w-8 h-8 text-[#1D4E89] animate-spin mb-2" />
                    <p className="text-sm text-slate-500">Se încarcă CMR...</p>
                  </>
                ) : (
                  <>
                    <Camera className="w-8 h-8 text-slate-400 mb-2" />
                    <p className="text-sm text-slate-500 font-medium">
                      {tripDoc?.original_image_url ? 'Reîncarcă CMR' : 'Încarcă CMR'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">Poză din cameră sau galerie</p>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  className="hidden"
                  onChange={uploadCMR}
                  disabled={uploading}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() =>
                  openNavigation(selectedTrip.consignee_address || selectedTrip.shipper_address)
                }
                className="flex flex-col items-center justify-center gap-1 py-4 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 min-h-[80px]"
              >
                <Navigation className="w-5 h-5 text-[#1D4E89]" />
                <span className="text-xs font-medium">Navigare</span>
              </button>
              <button
                onClick={() => {
                  setSelectedTrip(null);
                  setTab('chat');
                }}
                className="flex flex-col items-center justify-center gap-1 py-4 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 min-h-[80px]"
              >
                <MessageSquare className="w-5 h-5 text-[#1D4E89]" />
                <span className="text-xs font-medium">Chat dispecer</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => setListMode('active')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                  listMode === 'active' ? 'bg-white text-[#0A2B4E] shadow-sm' : 'text-slate-500'
                }`}
              >
                Active ({activeTrips.length})
              </button>
              <button
                onClick={() => setListMode('history')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                  listMode === 'history' ? 'bg-white text-[#0A2B4E] shadow-sm' : 'text-slate-500'
                }`}
              >
                Istoric ({historyTrips.length})
              </button>
            </div>

            {visibleTrips.length > 0 ? (
              <div className="space-y-3">
                {visibleTrips.map((trip) => (
                  <button
                    key={trip.id}
                    onClick={() => setSelectedTrip(trip)}
                    className="w-full text-left bg-white rounded-xl border border-slate-200 shadow-sm p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-bold text-[#0A2B4E]">{trip.cmr_number}</p>
                        <p className="text-xs text-slate-500">
                          {formatDate(trip.loading_date)}
                          {trip.vehicle_plate ? ` · ${trip.vehicle_plate}` : ''}
                        </p>
                      </div>
                      <StatusBadge status={trip.status} />
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <span className="truncate flex-1">
                        {trip.shipper_name} → {trip.consignee_name}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 shadow-sm">
                <Route className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm font-medium text-slate-600">
                  {listMode === 'active' ? 'Nicio cursă activă' : 'Nicio cursă în istoric'}
                </p>
                <p className="text-xs mt-2 max-w-xs mx-auto">
                  {driver
                    ? 'Când dispeceratul îți alocă o cursă, apare aici automat.'
                    : previewMode
                      ? 'Creează o cursă din meniul Curse și alocă un șofer + vehicul.'
                      : 'Contul tău nu e legat de un profil de șofer. Contactează adminul.'}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <nav className="fixed bottom-0 left-1/2 z-20 w-full max-w-md -translate-x-1/2 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-4">
          {[
            { key: 'trips', icon: Route, label: 'Curse' },
            { key: 'notifications', icon: Bell, label: 'Notificări', badge: unreadCount },
            { key: 'chat', icon: MessageSquare, label: 'Chat' },
            { key: 'profile', icon: User, label: 'Profil' },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setTab(t.key);
                  if (t.key !== 'trips') setSelectedTrip(null);
                  if (t.key === 'notifications') loadUnreadCount();
                }}
                className={`relative flex flex-col items-center justify-center gap-0.5 py-2.5 px-1 ${
                  active ? 'text-[#0A2B4E]' : 'text-slate-400'
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.25 : 2} />
                {t.badge > 0 && (
                  <span className="absolute top-1.5 right-[18%] flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {t.badge > 9 ? '9+' : t.badge}
                  </span>
                )}
                <span className="max-w-full truncate text-[10px] font-medium leading-tight">
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
