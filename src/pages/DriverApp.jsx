import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import StatusBadge from '@/components/StatusBadge';
import DriverNotifications from '@/components/driver/DriverNotifications';
import DriverChat from '@/components/driver/DriverChat';
import DriverProfile from '@/components/driver/DriverProfile';
import { Route, Package, Truck, Camera, ChevronRight, Loader2, CheckCircle2, CircleDot, Navigation, MessageSquare, User, Bell } from 'lucide-react';

const STATUS_FLOW = [
  { key: 'alocata', label: 'Pornire', icon: CircleDot, next: 'incarcata', actionLabel: '✓ Am pornit' },
  { key: 'incarcata', label: 'Încărcare', icon: Package, next: 'in_tranzit', actionLabel: '📦 Am încărcat' },
  { key: 'in_tranzit', label: 'În tranzit', icon: Truck, next: 'livrata', actionLabel: '🚛 Sunt în tranzit' },
  { key: 'livrata', label: 'Livrată', icon: CheckCircle2, next: null, actionLabel: '📋 Am livrat' },
];

export default function DriverApp() {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState('trips');
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => { loadTrips(); loadUnreadCount(); }, []);

  const loadUnreadCount = async () => {
    try {
      const notifs = await base44.entities.DriverNotification.filter({ is_read: false });
      setUnreadCount(notifs.length);
    } catch (e) { console.error(e); }
  };

  const loadTrips = async () => {
    try {
      const data = await base44.entities.Trip.list('-created_date', 50);
      setTrips(data.filter(t => ['alocata', 'incarcata', 'in_tranzit'].includes(t.status)));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const updateStatus = async (trip, newStatus) => {
    setUpdating(true);
    try {
      await base44.entities.Trip.update(trip.id, { status: newStatus });
      if (newStatus === 'livrata') {
        await base44.entities.Trip.update(trip.id, { actual_delivery_date: new Date().toISOString().split('T')[0] });
      }
      // Create notification for status change
      const statusLabels = { alocata: 'alocată', incarcata: 'încărcată', in_tranzit: 'în tranzit', livrata: 'livrată' };
      await base44.entities.DriverNotification.create({
        title: `Cursă ${statusLabels[newStatus] || newStatus}`,
        message: `Cursa CMR ${trip.cmr_number || ''} a fost marcată ca ${statusLabels[newStatus] || newStatus}.`,
        type: 'status_update',
        trip_id: trip.id,
        cmr_number: trip.cmr_number,
        is_read: false,
      });
      loadUnreadCount();
      const updated = { ...trip, status: newStatus };
      setSelectedTrip(updated);
      await loadTrips();
    } catch (e) { console.error(e); }
    finally { setUpdating(false); }
  };

  const uploadCMR = async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedTrip) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const docs = await base44.entities.TripDocument.filter({ trip_id: selectedTrip.id });
      if (docs.length > 0) {
        await base44.entities.TripDocument.update(docs[0].id, { original_image_url: file_url });
      } else {
        await base44.entities.TripDocument.create({ trip_id: selectedTrip.id, cmr_number: selectedTrip.cmr_number, original_image_url: file_url, is_confirmed: false });
      }
      // Auto-run OCR
      await base44.integrations.Core.InvokeLLM({
        prompt: `Extract CMR document data from this image. Return JSON with: cmr_number, date, shipper, consignee, goods_description, weight, packages.`,
        file_urls: [file_url],
        response_json_schema: { type: 'object', properties: { cmr_number: { type: 'string' }, date: { type: 'string' }, shipper: { type: 'string' }, consignee: { type: 'string' }, goods_description: { type: 'string' }, weight: { type: 'string' }, packages: { type: 'string' } } }
      });
      alert('CMR încărcat și trimis pentru procesare OCR!');
    } catch (e) { console.error(e); alert('Eroare: ' + (e.message || '')); }
    finally { setUploading(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" /></div>;

  const currentFlowStep = STATUS_FLOW.findIndex(s => s.key === selectedTrip?.status);

  return (
    <div className="max-w-md mx-auto pb-20">
      {/* Mobile header */}
      <div className="bg-[#0A2B4E] text-white px-5 py-4 -mx-4 lg:-mx-6 lg:rounded-t-xl sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-white/60">Aplicație Șofer</p>
            <p className="font-bold text-lg">{selectedTrip ? selectedTrip.cmr_number : 'Cursele mele'}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center font-semibold">I</div>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {tab === 'notifications' ? (
          <DriverNotifications onRead={loadUnreadCount} />
        ) : tab === 'chat' ? (
          <DriverChat />
        ) : tab === 'profile' ? (
          <DriverProfile />
        ) : selectedTrip ? (
          <>
            {/* Back button */}
            <button onClick={() => setSelectedTrip(null)} className="text-sm text-[#1D4E89] flex items-center gap-1">← Înapoi la curse</button>

            {/* Trip card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-slate-400">CURSĂ</span>
                <StatusBadge status={selectedTrip.status} />
              </div>
              <h2 className="font-bold text-[#0A2B4E] text-lg">{selectedTrip.cmr_number}</h2>
              <div className="mt-4 space-y-3">
                <div className="flex gap-3">
                  <div className="w-2 flex-shrink-0 flex flex-col items-center"><div className="w-2.5 h-2.5 rounded-full bg-[#F5A623]" /><div className="w-0.5 flex-1 bg-slate-200 mt-1" /></div>
                  <div><p className="text-xs text-slate-400">Încărcare</p><p className="text-sm font-medium text-slate-700">{selectedTrip.shipper_name}</p><p className="text-xs text-slate-500">{selectedTrip.shipper_address}</p></div>
                </div>
                <div className="flex gap-3">
                  <div className="w-2 flex-shrink-0 flex justify-center"><div className="w-2.5 h-2.5 rounded-full bg-[#27AE60]" /></div>
                  <div><p className="text-xs text-slate-400">Descărcare</p><p className="text-sm font-medium text-slate-700">{selectedTrip.consignee_name}</p><p className="text-xs text-slate-500">{selectedTrip.consignee_address}</p></div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-slate-100 text-center">
                <div><p className="text-xs text-slate-400">Data</p><p className="text-sm font-medium text-slate-700">{selectedTrip.loading_date ? new Date(selectedTrip.loading_date).toLocaleDateString('ro-RO') : '-'}</p></div>
                <div><p className="text-xs text-slate-400">Greutate</p><p className="text-sm font-medium text-slate-700">{selectedTrip.weight_kg ? selectedTrip.weight_kg + ' kg' : '-'}</p></div>
                <div><p className="text-xs text-slate-400">Colete</p><p className="text-sm font-medium text-slate-700">{selectedTrip.package_count || '-'}</p></div>
              </div>
              {selectedTrip.special_instructions && (
                <div className="mt-3 p-3 bg-amber-50 rounded-lg"><p className="text-xs text-amber-600 font-medium mb-1">⚠ Instrucțiuni speciale</p><p className="text-sm text-slate-600">{selectedTrip.special_instructions}</p></div>
              )}
            </div>

            {/* Status progress */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-[#0A2B4E] mb-4">Progres cursă</h3>
              <div className="space-y-3">
                {STATUS_FLOW.map((step, idx) => {
                  const Icon = step.icon;
                  const isDone = idx < currentFlowStep || selectedTrip.status === 'livrata';
                  const isCurrent = idx === currentFlowStep;
                  return (
                    <div key={step.key} className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isDone ? 'bg-emerald-100' : isCurrent ? 'bg-[#0A2B4E]' : 'bg-slate-100'}`}>
                        <Icon className={`w-4 h-4 ${isDone ? 'text-emerald-600' : isCurrent ? 'text-white' : 'text-slate-400'}`} />
                      </div>
                      <span className={`text-sm ${isDone ? 'text-slate-400 line-through' : isCurrent ? 'font-medium text-[#0A2B4E]' : 'text-slate-400'}`}>{step.label}</span>
                      {isCurrent && step.next && (
                        <button onClick={() => updateStatus(selectedTrip, step.next)} disabled={updating} className="ml-auto px-4 py-2 text-sm font-medium text-white bg-[#27AE60] rounded-lg hover:bg-emerald-600 disabled:opacity-50 min-h-[44px]">
                          {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : step.actionLabel}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* CMR upload */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-[#0A2B4E] mb-3">Document CMR</h3>
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl py-8 cursor-pointer hover:border-[#1D4E89] hover:bg-slate-50 transition-colors min-h-[100px]">
                {uploading ? <><Loader2 className="w-8 h-8 text-[#1D4E89] animate-spin mb-2" /><p className="text-sm text-slate-500">Se încarcă CMR...</p></> : <><Camera className="w-8 h-8 text-slate-400 mb-2" /><p className="text-sm text-slate-500 font-medium">📸 Încarcă CMR</p><p className="text-xs text-slate-400 mt-1">Se va procesa automat OCR</p></>}
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={uploadCMR} disabled={uploading} />
              </label>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-3">
              <button className="flex flex-col items-center justify-center gap-1 py-4 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 min-h-[80px]">
                <Navigation className="w-5 h-5 text-[#1D4E89]" /><span className="text-xs font-medium">Vezi ruta</span>
              </button>
              <button onClick={() => { setSelectedTrip(null); setTab('chat'); }} className="flex flex-col items-center justify-center gap-1 py-4 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 min-h-[80px]">
                <MessageSquare className="w-5 h-5 text-[#1D4E89]" /><span className="text-xs font-medium">Chat dispecer</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="font-bold text-[#0A2B4E] text-lg">Curse active</h2>
            {trips.length > 0 ? (
              <div className="space-y-3">
                {trips.map(trip => (
                  <button key={trip.id} onClick={() => setSelectedTrip(trip)} className="w-full text-left bg-white rounded-xl border border-slate-200 shadow-sm p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-bold text-[#0A2B4E]">{trip.cmr_number}</p>
                        <p className="text-xs text-slate-500">{trip.loading_date ? new Date(trip.loading_date).toLocaleDateString('ro-RO') : ''} · {trip.vehicle_plate}</p>
                      </div>
                      <StatusBadge status={trip.status} />
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <span className="truncate flex-1">{trip.shipper_name} → {trip.consignee_name}</span>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 shadow-sm">
                <Route className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Nu ai curse active asignate.</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom tab bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around py-2 lg:max-w-md lg:left-1/2 lg:-translate-x-1/2">
        {[
          { key: 'trips', icon: Route, label: 'Curse' },
          { key: 'notifications', icon: Bell, label: 'Notificări', badge: unreadCount },
          { key: 'chat', icon: MessageSquare, label: 'Chat' },
          { key: 'profile', icon: User, label: 'Profil' },
        ].map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => { setTab(t.key); if (t.key === 'notifications') loadUnreadCount(); }} className={`relative flex flex-col items-center gap-1 px-4 py-1 ${tab === t.key ? 'text-[#0A2B4E]' : 'text-slate-400'}`}>
              <Icon className="w-5 h-5" />
              {t.badge > 0 && <span className="absolute top-0 right-2 w-4 h-4 text-[10px] font-bold text-white bg-red-500 rounded-full flex items-center justify-center">{t.badge > 9 ? '9+' : t.badge}</span>}
              <span className="text-xs font-medium">{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}