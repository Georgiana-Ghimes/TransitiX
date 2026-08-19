import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Truck, RefreshCw, Loader2 } from 'lucide-react';
import DemoBanner from '@/components/DemoBanner';

// Fix default marker icons when bundling Leaflet with Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const truckIcon = L.divIcon({
  html: `<div style="background:#0A2B4E;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3)">🚛</div>`,
  iconSize: [32, 32], iconAnchor: [16, 16], className: '',
});

const BUCHAREST = [44.4268, 26.1025];

export default function GPSMap() {
  const [vehicles, setVehicles] = useState([]);
  const [gpsLogs, setGpsLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [simulating, setSimulating] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [vehs, logs] = await Promise.all([
        api.entities.Vehicle.list(),
        api.entities.GPSLog.filter({ is_current: true }),
      ]);
      setVehicles(vehs.filter(v => v.is_active));
      setGpsLogs(logs);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const simulateMovement = async () => {
    setSimulating(true);
    try {
      const activeVehicles = vehicles.filter(v => v.status === 'in_trip' || v.status === 'available');
      const newLogs = activeVehicles.map(v => {
        const lat = BUCHAREST[0] + (Math.random() - 0.5) * 4;
        const lng = BUCHAREST[1] + (Math.random() - 0.5) * 6;
        return {
          vehicle_id: v.id, vehicle_plate: v.plate,
          latitude: lat, longitude: lng,
          speed: Math.floor(Math.random() * 80) + 10,
          heading: Math.floor(Math.random() * 360),
        };
      });
      await api.integrations.Core.SimulateGps(newLogs);
      await loadData();
    } catch (e) { console.error(e); }
    finally { setSimulating(false); }
  };

  const getVehicleLog = (vehicleId) => gpsLogs.find(l => l.vehicle_id === vehicleId);

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" /></div>;

  const positions = vehicles.map(v => ({ vehicle: v, log: getVehicleLog(v.id) })).filter(p => p.log);

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">Tracking GPS</h1>
          <p className="text-sm text-slate-500 mt-1">{positions.length} poziții simulate pe hartă</p>
        </div>
        <button onClick={simulateMovement} disabled={simulating} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-50 transition-colors">
          {simulating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {simulating ? 'Simulez...' : 'Simulează poziții (demo)'}
        </button>
      </div>

      <DemoBanner title="Hartă demo, nu telematică live">
        Pozițiile sunt generate în jurul Bucureștiului. Routena și QuickCargo se leagă de Acron / CargoTrack. Transitix va primi webhook de la furnizorul vostru, nu un tracker propriu.
      </DemoBanner>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Vehicle list */}
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-3 space-y-2 max-h-56 lg:max-h-[600px] overflow-y-auto order-2 lg:order-1">
          {positions.length > 0 ? positions.map(({ vehicle, log }) => (
            <button
              key={vehicle.id}
              onClick={() => setSelected(vehicle.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left ${selected === vehicle.id ? 'bg-[#0A2B4E] text-white' : 'hover:bg-slate-50'}`}
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${selected === vehicle.id ? 'bg-white/20' : 'bg-[#0A2B4E]'}`}>
                <Truck className="w-4.5 h-4.5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{vehicle.plate}</p>
                <p className={`text-xs ${selected === vehicle.id ? 'text-white/70' : 'text-slate-400'}`}>{log.speed} km/h</p>
              </div>
            </button>
          )) : (
            <div className="text-center py-8 text-slate-400">
              <Truck className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Apasă „Actualizează poziții"</p>
            </div>
          )}
        </div>

        {/* Map */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden order-1 lg:order-2">
          <MapContainer center={BUCHAREST} zoom={6} className="z-0 h-[50vh] min-h-[280px] max-h-[600px] w-full lg:h-[600px]">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap'
            />
            {positions.map(({ vehicle, log }) => (
              <Marker key={vehicle.id} position={[log.latitude, log.longitude]} icon={truckIcon}
                eventHandlers={{ click: () => setSelected(vehicle.id) }}
              >
                <Popup>
                  <div className="space-y-1">
                    <p className="font-bold text-[#0A2B4E]">{vehicle.plate}</p>
                    <p className="text-xs">{vehicle.brand} {vehicle.model}</p>
                    <p className="text-xs">⚡ {log.speed} km/h · {log.ignition ? 'Motor pornit' : 'Motor oprit'}</p>
                    <p className="text-xs text-slate-400">Lat: {log.latitude.toFixed(4)}, Lng: {log.longitude.toFixed(4)}</p>
                    <Link to="/trips" className="text-xs text-blue-600">Vezi cursele</Link>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </div>

      {/* Selected vehicle details */}
      {selected && (() => {
        const sel = positions.find(p => p.vehicle.id === selected);
        if (!sel) return null;
        return (
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-[#0A2B4E] flex items-center justify-center"><Truck className="w-5 h-5 text-white" /></div>
              <div><h3 className="font-semibold text-[#0A2B4E]">{sel.vehicle.plate}</h3><p className="text-xs text-slate-500">{sel.vehicle.brand} {sel.vehicle.model}</p></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400">Viteză</p><p className="font-semibold text-slate-700">{sel.log.speed} km/h</p></div>
              <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400">Direcție</p><p className="font-semibold text-slate-700">{sel.log.heading}°</p></div>
              <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400">Motor</p><p className="font-semibold text-slate-700">{sel.log.ignition ? 'Pornit' : 'Oprit'}</p></div>
              <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400">Kilometraj</p><p className="font-semibold text-slate-700">{sel.vehicle.mileage?.toLocaleString('ro-RO') || '-'} km</p></div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}