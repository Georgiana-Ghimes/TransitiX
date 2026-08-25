import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  Check, Crosshair, Loader2, MapPin, RefreshCw, Search, Sparkles, TriangleAlert,
} from 'lucide-react';
import { api } from '@/api/client';
import { notifyError, notifySuccess } from '@/lib/notify';
import {
  FILTERS,
  confirmPayload,
  filterLocations,
  formatCoord,
  fullAddress,
  locationTier,
  pinMoved,
  reasonLabel,
  summarizeLocations,
  tierMeta,
} from '@/lib/locationsUi';

const ROMANIA_CENTER = [45.9432, 24.9668];

function pinIcon(color, pulsing = false) {
  return L.divIcon({
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    html: `<div style="width:26px;height:26px;position:relative">
      <div style="position:absolute;left:5px;top:0;width:16px;height:16px;border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);background:${color};border:2px solid #fff;
        box-shadow:0 2px 6px rgba(0,0,0,.35)${pulsing ? ';animation:tx-pulse 1.4s ease-out infinite' : ''}"></div>
    </div>`,
  });
}

/** Keeps the map centred on the selection without fighting the user's own panning. */
function MapFocus({ position, zoom }) {
  const map = useMap();
  const lastKey = useRef(null);
  useEffect(() => {
    if (!position) return;
    const key = `${position[0]},${position[1]}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    map.flyTo(position, zoom ?? Math.max(map.getZoom(), 16), { duration: 0.6 });
  }, [position, zoom, map]);
  return null;
}

function TierBadge({ tier }) {
  const meta = tierMeta(tier);
  return (
    <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full border whitespace-nowrap ${meta.badge}`}>
      {meta.label}
    </span>
  );
}

export default function Locations() {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('todo');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [geocoding, setGeocoding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [geoStatus, setGeoStatus] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const rows = await api.entities.Location.list('-created_date', 500);
      setLocations(rows);
    } catch (e) {
      notifyError('Nu am putut încărca locațiile', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    api.geo.health().then(setGeoStatus).catch(() => setGeoStatus(null));
  }, [loadData]);

  const visible = useMemo(
    () => filterLocations(locations, filter, search),
    [locations, filter, search]
  );
  const stats = useMemo(() => summarizeLocations(locations), [locations]);
  const selected = useMemo(
    () => locations.find((l) => l.id === selectedId) || null,
    [locations, selectedId]
  );

  const geocoderReady = geoStatus?.geocoding?.configured && geoStatus?.geocoding?.ok;

  const selectLocation = useCallback((location) => {
    setSelectedId(location.id);
    setCandidates([]);
    setDraft(
      location.latitude != null && location.longitude != null
        ? { latitude: Number(location.latitude), longitude: Number(location.longitude) }
        : null
    );
  }, []);

  const runGeocode = async (location, { refresh = false } = {}) => {
    setGeocoding(true);
    try {
      const result = await api.geo.geocodeLocation(location.id, { refresh });
      setCandidates(result.candidates || []);
      if (result.best) {
        setDraft({ latitude: result.best.latitude, longitude: result.best.longitude });
      }
      await loadData();
      if (!result.best) {
        notifyError('Fără rezultat', 'Geocoderul nu a găsit nicio potrivire. Pune pinul manual pe hartă.');
      }
    } catch (e) {
      notifyError('Geocodare eșuată', e);
    } finally {
      setGeocoding(false);
    }
  };

  /** Geocodes everything without a pin, one at a time so the provider is not hammered. */
  const runBatch = async () => {
    const pending = locations.filter((l) => locationTier(l) === 'missing');
    if (!pending.length) return;
    setBatchRunning(true);
    let done = 0;
    try {
      for (const location of pending) {
        try {
          await api.geo.geocodeLocation(location.id);
          done += 1;
        } catch {
          // keep going — one bad address must not stop the run
        }
      }
      await loadData();
      notifySuccess('Geocodare terminată', `${done} din ${pending.length} locații au primit o poziție.`);
    } finally {
      setBatchRunning(false);
    }
  };

  const confirmPin = async () => {
    if (!selected || !draft) return;
    setSaving(true);
    try {
      await api.entities.Location.update(selected.id, confirmPayload(selected, draft));
      notifySuccess('Poziție confirmată', selected.name);
      setCandidates([]);
      await loadData();
    } catch (e) {
      notifyError('Salvarea a eșuat', e);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" />
      </div>
    );
  }

  const selectedTier = selected ? locationTier(selected) : null;
  const moved = selected && draft ? pinMoved(selected, draft) : false;

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <style>{'@keyframes tx-pulse{0%{box-shadow:0 0 0 0 rgba(245,166,35,.7)}70%{box-shadow:0 0 0 12px rgba(245,166,35,0)}100%{box-shadow:0 0 0 0 rgba(245,166,35,0)}}'}</style>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight flex items-center gap-2">
            <MapPin className="w-6 h-6 text-[#F5A623]" /> Locații
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {stats.todo > 0
              ? `${stats.todo} din ${stats.total} locații așteaptă confirmare`
              : `Toate cele ${stats.total} locații sunt confirmate`}
          </p>
        </div>
        <button
          onClick={runBatch}
          disabled={batchRunning || !stats.missing || !geocoderReady}
          title={!geocoderReady ? 'Geocoderul nu este configurat (PHOTON_URL)' : undefined}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-50 transition-colors"
        >
          {batchRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {batchRunning ? 'Geocodez...' : `Geocodează cele fără pin (${stats.missing})`}
        </button>
      </div>

      {geoStatus && !geoStatus.geocoding?.configured && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <TriangleAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <p className="font-medium">Geocoderul nu este configurat</p>
            <p className="text-amber-800 mt-0.5">
              Setează <code className="px-1 bg-amber-100 rounded">PHOTON_URL</code> în <code className="px-1 bg-amber-100 rounded">server/.env</code>.
              Poți în continuare să pui pinul manual pe hartă.
            </p>
          </div>
        </div>
      )}

      {/* Tier counters */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {['missing', 'poor', 'review', 'good', 'verified'].map((tier) => {
          const meta = tierMeta(tier);
          return (
            <div key={tier} className="bg-white rounded-xl border border-slate-200/80 shadow-sm px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: meta.marker }} />
                <span className="text-xs text-slate-500 truncate">{meta.label}</span>
              </div>
              <p className="text-xl font-bold text-[#0A2B4E] mt-0.5 tabular-nums">{stats[tier]}</p>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                filter === f.key ? 'bg-[#0A2B4E] text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Caută după nume, adresă sau oraș"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89]"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Map first on mobile: the pin is the point of the screen */}
        <div className="lg:col-span-3 lg:order-2 bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <MapContainer
            center={ROMANIA_CENTER}
            zoom={7}
            className="z-0 h-[45vh] min-h-[300px] w-full lg:h-[620px]"
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OpenStreetMap"
            />
            <MapFocus position={draft ? [draft.latitude, draft.longitude] : null} />

            {locations.map((location) => {
              const isSelected = location.id === selectedId;
              if (isSelected && draft) return null; // drawn below as the draggable pin
              if (location.latitude == null || location.longitude == null) return null;
              return (
                <Marker
                  key={location.id}
                  position={[Number(location.latitude), Number(location.longitude)]}
                  icon={pinIcon(tierMeta(locationTier(location)).marker)}
                  eventHandlers={{ click: () => selectLocation(location) }}
                />
              );
            })}

            {draft && (
              <Marker
                position={[draft.latitude, draft.longitude]}
                draggable
                autoPan
                icon={pinIcon('#F5A623', true)}
                eventHandlers={{
                  dragend: (e) => {
                    const { lat, lng } = e.target.getLatLng();
                    setDraft({ latitude: lat, longitude: lng });
                  },
                }}
              />
            )}
          </MapContainer>

          {selected && (
            <div className="border-t border-slate-100 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-[#0A2B4E] truncate">{selected.name}</h3>
                    <TierBadge tier={selectedTier} />
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{fullAddress(selected) || 'Fără adresă'}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => runGeocode(selected, { refresh: true })}
                    disabled={geocoding || !geocoderReady}
                    title={!geocoderReady ? 'Geocoderul nu este configurat (PHOTON_URL)' : undefined}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#0A2B4E] bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50"
                  >
                    {geocoding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Re-geocodează
                  </button>
                  <button
                    onClick={confirmPin}
                    disabled={saving || !draft}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#27AE60] rounded-lg hover:bg-emerald-600 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Confirmă poziția
                  </button>
                </div>
              </div>

              <p className="text-xs text-slate-500">{tierMeta(selectedTier).hint}</p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <p className="text-slate-400">Latitudine</p>
                  <p className="font-medium text-slate-700 tabular-nums">{formatCoord(draft?.latitude ?? selected.latitude)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <p className="text-slate-400">Longitudine</p>
                  <p className="font-medium text-slate-700 tabular-nums">{formatCoord(draft?.longitude ?? selected.longitude)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <p className="text-slate-400">Încredere</p>
                  <p className="font-medium text-slate-700 tabular-nums">
                    {selected.geocode_confidence == null ? '—' : Number(selected.geocode_confidence).toFixed(2)}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <p className="text-slate-400">Sursă</p>
                  <p className="font-medium text-slate-700">{selected.geocode_source || '—'}</p>
                </div>
              </div>

              {moved && (
                <p className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <Crosshair className="w-3.5 h-3.5 shrink-0" />
                  Pinul a fost mutat. La confirmare, sursa devine „manual”.
                </p>
              )}

              {candidates.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-slate-600">Variante găsite</p>
                  {candidates.map((candidate, idx) => (
                    <button
                      key={`${candidate.osm_id}-${idx}`}
                      onClick={() => setDraft({ latitude: candidate.latitude, longitude: candidate.longitude })}
                      className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:border-[#1D4E89] hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-700 truncate">
                          {candidate.label || 'Fără etichetă'}
                        </span>
                        <span className="text-xs font-semibold text-[#0A2B4E] tabular-nums shrink-0">
                          {candidate.confidence.toFixed(2)}
                        </span>
                      </div>
                      {candidate.reasons?.length > 0 && (
                        <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                          {candidate.reasons.map(reasonLabel).join(' · ')}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* List */}
        <div className="lg:col-span-2 lg:order-1 bg-white rounded-xl border border-slate-200/80 shadow-sm p-2 space-y-1.5 max-h-[420px] lg:max-h-[620px] overflow-y-auto">
          {visible.length > 0 ? visible.map((location) => {
            const tier = locationTier(location);
            const meta = tierMeta(tier);
            const isSelected = location.id === selectedId;
            return (
              <button
                key={location.id}
                onClick={() => selectLocation(location)}
                className={`w-full text-left p-3 rounded-lg transition-colors ${
                  isSelected ? 'bg-[#0A2B4E] text-white' : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5"
                    style={{ background: isSelected ? '#F5A623' : meta.marker }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{location.name}</p>
                    <p className={`text-xs truncate ${isSelected ? 'text-white/70' : 'text-slate-400'}`}>
                      {fullAddress(location) || 'Fără adresă'}
                    </p>
                  </div>
                  <span
                    className={`text-[11px] font-medium shrink-0 tabular-nums ${
                      isSelected ? 'text-white/80' : 'text-slate-400'
                    }`}
                  >
                    {tier === 'missing'
                      ? meta.short
                      : location.geocode_confidence == null
                        ? meta.short
                        : Number(location.geocode_confidence).toFixed(2)}
                  </span>
                </div>
              </button>
            );
          }) : (
            <div className="text-center py-12 text-slate-400">
              <MapPin className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium text-slate-500">
                {locations.length === 0 ? 'Nicio locație' : 'Nimic pe acest filtru'}
              </p>
              <p className="text-xs mt-1">
                {locations.length === 0
                  ? 'Rulează npm run db:backfill:locations -- --apply'
                  : 'Schimbă filtrul sau caută altceva'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
