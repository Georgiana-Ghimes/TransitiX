/**
 * The zone map: what `tax_zones` actually covers on the ground.
 *
 * `tax_zones.polygon` has always driven the TPO — `resolveZone` prefers an outline over a
 * textual matcher — but nothing on screen could show one, so the column was writable only
 * through the API and unverifiable by the person responsible for the invoice. This screen is
 * the missing half: draw what is stored, and check an address against it using the same
 * functions the calculation uses rather than a second opinion written for the map.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer, TileLayer, Polygon, Polyline, CircleMarker, Tooltip, Popup, useMap, useMapEvents,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  Loader2, MapPin, Search, Upload, TriangleAlert, Eye, EyeOff, Info,
  PenLine, Undo2, Check, X,
} from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { api } from '@/api/client';
import { notifyError, notifySuccess } from '@/lib/notify';
import {
  ZoneImportError,
  combinedBounds,
  geometryBounds,
  geometrySummary,
  geometryToRings,
  latLngsToGeometry,
  looksLikePlausibleOutline,
  parseZoneOutlines,
} from '@/lib/zoneGeometry';
import { zoneReferenceFor } from '@/lib/bucharestZones';

// Bucharest, because the A/B access zones are why this screen exists. Any zone anywhere else
// still draws — the map fits to whatever outlines the company has as soon as they load.
const FALLBACK_CENTER = [44.4325, 26.1039];
const FALLBACK_ZOOM = 11;

// Distinct enough to tell two overlapping zones apart at a glance, and readable over OSM tiles.
const ZONE_COLORS = ['#1D4E89', '#B45309', '#166534', '#7E22CE', '#BE123C', '#0E7490'];

function colorFor(index) {
  return ZONE_COLORS[index % ZONE_COLORS.length];
}

function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    map.fitBounds(L.latLngBounds(bounds).pad(0.12), { animate: true });
  }, [bounds, map]);
  return null;
}

/** Collects vertices while tracing. Leaflet owns the click; React only keeps the list. */
function TraceCollector({ onPoint }) {
  useMapEvents({
    click(e) {
      onPoint([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

function FlyTo({ point }) {
  const map = useMap();
  useEffect(() => {
    if (!point) return;
    map.flyTo([point.latitude, point.longitude], Math.max(map.getZoom(), 14), { duration: 0.8 });
  }, [point, map]);
  return null;
}

const cardCls = 'bg-white rounded-xl border border-slate-200/80 shadow-sm';
const inputCls = 'w-full h-10 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4E89]/30';

function formatAmount(rate) {
  if (!rate) return null;
  const amount = Number(rate.amount);
  if (!Number.isFinite(amount)) return null;
  return `${amount.toFixed(2)} ${rate.currency || 'RON'}`;
}

function bracketLabel(rate) {
  const min = Number(rate.mma_min_kg) || 0;
  const max = rate.mma_max_kg == null ? null : Number(rate.mma_max_kg);
  const t = (kg) => `${(kg / 1000).toLocaleString('ro-RO', { maximumFractionDigits: 1 })}t`;
  return max == null ? `peste ${t(min)}` : `${t(min)} – ${t(max)}`;
}

export default function ZoneMap() {
  const [zones, setZones] = useState([]);
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(() => new Set());

  const [address, setAddress] = useState('');
  const [mma, setMma] = useState('');
  const [searching, setSearching] = useState(false);
  const [hit, setHit] = useState(null);

  const [importing, setImporting] = useState(null);
  const fileRef = useRef(null);

  // A file describing several zones: which outline goes onto the zone being imported.
  const [choice, setChoice] = useState(null);

  // Tracing: the zone being drawn, and the vertices clicked so far.
  const [tracing, setTracing] = useState(null);
  const [trace, setTrace] = useState([]);
  const [savingTrace, setSavingTrace] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.commercial.overview();
      setZones(data?.zones ?? []);
      setRates(data?.zone_rates ?? []);
    } catch (err) {
      notifyError('Zonele nu au putut fi încărcate', err);
    } finally {
      setLoading(false);
    }
  };

  const drawable = useMemo(
    () => zones
      .map((zone, i) => ({ zone, color: colorFor(i), rings: geometryToRings(zone.polygon) }))
      .filter((z) => z.rings.length > 0 && !hidden.has(z.zone.id)),
    [zones, hidden],
  );

  const bounds = useMemo(
    () => combinedBounds(zones.filter((z) => !hidden.has(z.id)).map((z) => z.polygon)),
    [zones, hidden],
  );

  const ratesFor = (zoneId) => rates.filter((r) => r.tax_zone_id === zoneId);

  const withPolygon = zones.filter((z) => geometryToRings(z.polygon).length > 0).length;

  const toggle = (id) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const search = async (e) => {
    e?.preventDefault();
    const q = address.trim();
    if (!q) return;
    setSearching(true);
    setHit(null);
    try {
      const res = await api.commercial.locateZone({ address: q, mmaKg: mma === '' ? null : Number(mma) });
      setHit(res);
      if (!res.point) notifyError('Adresă negăsită', res.message || 'Geocodarea nu a returnat niciun rezultat.');
    } catch (err) {
      notifyError('Căutarea a eșuat', err);
    } finally {
      setSearching(false);
    }
  };

  const pickFile = (zone) => {
    setImporting(zone);
    fileRef.current?.click();
  };

  const applyOutline = async (zone, outline) => {
    const { geometry, droppedSlivers = 0, spikes = [] } = outline;
    if (!looksLikePlausibleOutline(geometry)) {
      notifyError(
        'Coordonate în afara hărții',
        'Fișierul pare proiectat (ex. Stereo 70) sau cu latitudinea și longitudinea inversate. '
        + 'Se așteaptă WGS84, în ordinea longitudine, latitudine.',
      );
      return;
    }
    try {
      const { rings, points } = geometrySummary(geometry);
      await api.entities.TaxZone.update(zone.id, { polygon: geometry });
      // The cleanup is named out loud: someone deciding whether a boundary is right has to know
      // the file was not stored exactly as it arrived.
      const cleaned = droppedSlivers
        ? ` ${droppedSlivers} inel(e) fără suprafață, rămase din desenare, au fost eliminate.`
        : '';
      notifySuccess(
        `Contur încărcat pe ${zone.code}`,
        `${rings} contur(uri), ${points} puncte.${cleaned} `
        + 'Din acest moment zona se potrivește pe poziție, nu pe text.',
      );
      // Reported, never corrected: reshaping an outer boundary on the operator's behalf would
      // change what an address is charged with nothing on screen saying it happened.
      if (spikes.length) {
        notifyError(
          'Verifică conturul',
          `${spikes.length} vârf(uri) ies și revin pe aceeași linie — de obicei o scăpare la `
          + `desenare. Primul e la ${spikes[0].position[1].toFixed(5)}, `
          + `${spikes[0].position[0].toFixed(5)}. Conturul a fost salvat neschimbat.`,
        );
      }
      await load();
    } catch (err) {
      notifyError('Importul a eșuat', err);
    }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const zone = importing;
    setImporting(null);
    if (!file || !zone) return;

    try {
      const outlines = parseZoneOutlines(await file.text(), file.name);
      // One file routinely describes both zones. Picking the first would quietly give this
      // zone the other one's boundary, so the operator says which is which.
      if (outlines.length > 1) setChoice({ zone, outlines });
      else await applyOutline(zone, outlines[0]);
    } catch (err) {
      if (err instanceof ZoneImportError) notifyError('Fișier neacceptat', err.message);
      else notifyError('Importul a eșuat', err);
    }
  };

  const startTrace = (zone) => {
    setTracing(zone);
    setTrace(geometryToRings(zone.polygon)[0] ?? []);
    setHit(null);
  };

  const cancelTrace = () => {
    setTracing(null);
    setTrace([]);
  };

  const saveTrace = async () => {
    const geometry = latLngsToGeometry(trace);
    if (!geometry) {
      notifyError('Prea puține puncte', 'Un contur are nevoie de cel puțin trei puncte.');
      return;
    }
    setSavingTrace(true);
    try {
      await api.entities.TaxZone.update(tracing.id, { polygon: geometry });
      notifySuccess(
        `Contur salvat pe ${tracing.code}`,
        `${trace.length} puncte. Zona se potrivește de acum pe poziție.`,
      );
      cancelTrace();
      await load();
    } catch (err) {
      notifyError('Conturul nu a putut fi salvat', err);
    } finally {
      setSavingTrace(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0A2B4E]">Harta zonelor</h1>
          <p className="text-sm text-slate-500">
            Zonele de taxare pe hartă, cu tarifele pe MMA. Căutarea unei adrese folosește
            aceeași potrivire ca și calculul TPO.
          </p>
        </div>
        <span className="text-xs text-slate-500">
          {zones.length} zone · {withPolygon} cu contur
        </span>
      </div>

      <form onSubmit={search} className={`${cardCls} p-3 flex flex-wrap gap-2 items-center`}>
        <div className="flex-1 min-w-[240px]">
          <input
            className={inputCls}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Strada, oraș — ex. Calea Victoriei, București"
          />
        </div>
        <div className="w-32">
          <input
            className={inputCls}
            value={mma}
            onChange={(e) => setMma(e.target.value)}
            inputMode="numeric"
            placeholder="MMA (kg)"
          />
        </div>
        <button
          type="submit"
          disabled={searching || !address.trim()}
          className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium bg-[#0A2B4E] text-white rounded-lg hover:bg-[#123f6d] disabled:opacity-40"
        >
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Verifică
        </button>
      </form>

      {hit?.point && !tracing ? <LocateResult hit={hit} /> : null}

      {tracing ? (
        <TraceBar
          zone={tracing}
          count={trace.length}
          saving={savingTrace}
          onUndo={() => setTrace((p) => p.slice(0, -1))}
          onClear={() => setTrace([])}
          onCancel={cancelTrace}
          onSave={saveTrace}
        />
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className={`${cardCls} overflow-hidden`} style={{ height: '62vh', minHeight: 380 }}>
          <MapContainer
            center={FALLBACK_CENTER}
            zoom={FALLBACK_ZOOM}
            scrollWheelZoom
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OpenStreetMap"
            />
            {tracing ? null : <FitBounds bounds={bounds} />}
            <FlyTo point={hit?.point} />
            {tracing ? <TraceCollector onPoint={(p) => setTrace((prev) => [...prev, p])} /> : null}

            {drawable.map(({ zone, color, rings }) => (
              <Polygon
                key={zone.id}
                positions={rings}
                pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.16 }}
              >
                <Tooltip sticky>
                  <span className="font-semibold">{zone.code}</span> · {zone.name}
                </Tooltip>
                <Popup>
                  <ZonePopup zone={zone} rates={ratesFor(zone.id)} />
                </Popup>
              </Polygon>
            ))}

            {tracing && trace.length ? (
              <>
                {/* Open while drawing, closed on save: showing a filled shape before the ring
                    is closed would suggest an area that does not exist yet. */}
                <Polyline
                  positions={trace.length > 2 ? [...trace, trace[0]] : trace}
                  pathOptions={{ color: '#F5A623', weight: 3, dashArray: '6 4' }}
                />
                {trace.map((p, i) => (
                  <CircleMarker
                    key={`${p[0]},${p[1]},${i}`}
                    center={p}
                    radius={i === 0 ? 6 : 4}
                    pathOptions={{
                      color: '#0A2B4E',
                      fillColor: i === 0 ? '#F5A623' : '#ffffff',
                      fillOpacity: 1,
                      weight: 2,
                    }}
                  />
                ))}
              </>
            ) : null}

            {hit?.point && !tracing ? (
              <CircleMarker
                center={[hit.point.latitude, hit.point.longitude]}
                radius={8}
                pathOptions={{ color: '#0A2B4E', fillColor: '#F5A623', fillOpacity: 1, weight: 2 }}
              >
                <Tooltip permanent direction="top" offset={[0, -8]}>
                  {hit.zone ? `${hit.zone.code}` : 'Fără zonă'}
                </Tooltip>
              </CircleMarker>
            ) : null}
          </MapContainer>
        </div>

        <div className="space-y-2">
          {zones.length === 0 ? (
            <div className={`${cardCls} p-4 text-sm text-slate-500`}>
              Nicio zonă definită. Zonele se creează în <strong>Config. comercială → Zone și taxe</strong>;
              aici le încarci conturul și le verifici pe hartă.
            </div>
          ) : null}

          {zones.map((zone, i) => (
            <ZoneCard
              key={zone.id}
              zone={zone}
              color={colorFor(i)}
              rates={ratesFor(zone.id)}
              hidden={hidden.has(zone.id)}
              onToggle={() => toggle(zone.id)}
              onImport={() => pickFile(zone)}
              onTrace={() => startTrace(zone)}
              tracing={tracing?.id === zone.id}
              busy={Boolean(tracing) && tracing.id !== zone.id}
              highlighted={hit?.zone?.id === zone.id}
            />
          ))}

          <p className="flex gap-2 text-[11px] text-slate-400 px-1 pt-1">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>
              Contururile se încarcă din GeoJSON sau KML, în WGS84. Delimitarea oficială a
              zonelor de acces din București se publică de Primăria Capitalei.
            </span>
          </p>
        </div>
      </div>

      {choice ? (
        <OutlinePicker
          zone={choice.zone}
          outlines={choice.outlines}
          onCancel={() => setChoice(null)}
          onPick={async (outline) => {
            const zone = choice.zone;
            setChoice(null);
            await applyOutline(zone, outline);
          }}
        />
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept=".geojson,.json,.kml,application/geo+json,application/json,application/vnd.google-earth.kml+xml"
        className="hidden"
        onChange={onFile}
      />
    </div>
  );
}

/**
 * Which outline in a multi-zone file belongs to the zone being imported.
 *
 * The placemark name is shown but never acted on: a file calling something "ZONA A si B" is
 * not telling us which ring it drew, and the size and extent below it are what actually let
 * someone tell the inner zone from the outer one.
 */
function OutlinePicker({ zone, outlines, onCancel, onPick }) {
  return (
    <ModalShell onClose={onCancel} labelledBy="outline-picker-title" panelClassName="max-w-lg w-full">
      <div className="p-4 space-y-3">
        <h2 id="outline-picker-title" className="text-base font-semibold text-[#0A2B4E]">
          Care contur este pentru {zone.code}?
        </h2>
        <p className="text-xs text-slate-500">
          Fișierul conține {outlines.length} contururi. Alege-l pe cel care delimitează
          <strong> {zone.name}</strong>; pe celelalte le încarci separat, pe zonele lor.
        </p>

        <ul className="space-y-2">
          {outlines.map((o, i) => {
            const { rings, points } = geometrySummary(o.geometry);
            const b = geometryBounds(o.geometry);
            const span = b
              ? `${(b[1][0] - b[0][0]).toFixed(3)}° lat × ${(b[1][1] - b[0][1]).toFixed(3)}° lon`
              : '—';
            return (
              <li key={`${o.name ?? 'contur'}-${i}`}>
                <button
                  type="button"
                  onClick={() => onPick(o)}
                  className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-[#1D4E89] hover:bg-slate-50"
                >
                  <span className="block text-sm font-medium text-slate-800">
                    {o.name || `Contur ${i + 1}`}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    {points} puncte · {rings > 1 ? `${rings - 1} excluderi · ` : ''}întindere {span}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex justify-end">
          <button type="button" onClick={onCancel}
            className="h-9 px-3 text-xs border border-slate-200 rounded-lg hover:bg-slate-50">
            Renunță
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/**
 * The tracing controls, with the zone's official perimeter beside them.
 *
 * The street list is the point: PMB defines these zones by naming the arteries that form the
 * ring, and the OSM basemap labels those same streets. Tracing against the regulation is what
 * separates an outline that can be defended from one drawn off a screenshot.
 */
function TraceBar({ zone, count, saving, onUndo, onClear, onCancel, onSave }) {
  const reference = zoneReferenceFor(zone.code);

  return (
    <div className={`${cardCls} p-3 space-y-2 border-[#F5A623] ring-1 ring-[#F5A623]/40`}>
      <div className="flex flex-wrap items-center gap-2">
        <PenLine className="w-4 h-4 text-[#B45309] shrink-0" />
        <span className="text-sm font-medium text-slate-800">
          Trasezi conturul pentru <strong>{zone.code}</strong>
        </span>
        <span className="text-xs text-slate-500">
          {count === 0 ? 'Click pe hartă pentru primul punct' : `${count} puncte`}
        </span>

        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={onUndo} disabled={!count || saving}
            className="inline-flex h-9 items-center gap-1.5 px-3 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40">
            <Undo2 className="w-3.5 h-3.5" /> Înapoi
          </button>
          <button type="button" onClick={onClear} disabled={!count || saving}
            className="inline-flex h-9 items-center gap-1.5 px-3 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40">
            Golește
          </button>
          <button type="button" onClick={onCancel} disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 px-3 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40">
            <X className="w-3.5 h-3.5" /> Renunță
          </button>
          <button type="button" onClick={onSave} disabled={count < 3 || saving}
            className="inline-flex h-9 items-center gap-1.5 px-3 text-xs font-medium bg-[#0A2B4E] text-white rounded-lg hover:bg-[#123f6d] disabled:opacity-40">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Salvează conturul
          </button>
        </div>
      </div>

      {reference ? (
        <div className="pt-2 border-t border-slate-100">
          <p className="text-[11px] text-slate-500 mb-1">
            <strong>{reference.label}</strong> — perimetrul oficial. {reference.threshold}.
          </p>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            {reference.perimeter.join(' · ')}
          </p>
        </div>
      ) : (
        <p className="pt-2 border-t border-slate-100 text-[11px] text-slate-400">
          Nu am un perimetru oficial de referință pentru codul {zone.code} — trasează după
          documentația proprie.
        </p>
      )}
    </div>
  );
}

function LocateResult({ hit }) {
  const amount = formatAmount(hit.rate);
  const noZone = !hit.zone;

  return (
    <div className={`${cardCls} p-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm`}>
      <MapPin className="w-4 h-4 text-[#1D4E89] shrink-0" />
      <span className="text-slate-700 font-medium">{hit.point.label || hit.address}</span>

      {noZone ? (
        <span className="text-slate-500">Nu cade în nicio zonă activă.</span>
      ) : (
        <>
          <span className="px-2 py-0.5 rounded-full bg-[#0A2B4E] text-white text-xs font-semibold">
            {hit.zone.code}
          </span>
          <span className="text-slate-600">{hit.zone.name}</span>
          <span className="text-[11px] text-slate-400">
            {hit.matched_by === 'polygon' ? 'după contur' : 'după text (fără contur pe acest punct)'}
          </span>
          {hit.rate ? (
            <span className="text-slate-800 font-semibold">{amount}</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-700">
              <TriangleAlert className="w-3.5 h-3.5" />
              {hit.mma_kg == null
                ? 'Completează MMA ca să vezi taxa'
                : `Fără tarif valabil la ${hit.date} pentru ${hit.mma_kg} kg`}
            </span>
          )}
        </>
      )}

      {hit.outcome?.action === 'review' ? (
        <span className="text-[11px] text-amber-700">
          Geocodare incertă — verifică pinul înainte să te bazezi pe rezultat.
        </span>
      ) : null}
    </div>
  );
}

function ZonePopup({ zone, rates }) {
  return (
    <div className="text-xs space-y-1">
      <p className="font-semibold text-slate-800">{zone.code} · {zone.name}</p>
      {rates.length === 0 ? (
        <p className="text-slate-500">Fără tarife — zona nu produce nicio taxă.</p>
      ) : (
        <ul className="space-y-0.5">
          {rates.map((r) => (
            <li key={r.id} className="text-slate-600">
              {bracketLabel(r)}: <strong>{formatAmount(r)}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ZoneCard({
  zone, color, rates, hidden, onToggle, onImport, onTrace, tracing, busy, highlighted,
}) {
  const { rings, points } = geometrySummary(zone.polygon);
  const hasOutline = rings > 0;

  return (
    <div className={`${cardCls} p-3 ${highlighted ? 'ring-2 ring-[#F5A623]' : ''} ${busy ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />
        <span className="font-semibold text-sm text-slate-800">{zone.code}</span>
        <span className="text-sm text-slate-600 truncate">{zone.name}</span>
        {zone.is_active === false ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">inactivă</span>
        ) : null}
        <button
          type="button"
          onClick={onToggle}
          disabled={!hasOutline}
          title={hasOutline ? (hidden ? 'Arată pe hartă' : 'Ascunde de pe hartă') : 'Fără contur de afișat'}
          className="ml-auto p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
        >
          {hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      <p className="mt-1 text-[11px] text-slate-500">
        {hasOutline
          ? `${rings} contur${rings > 1 ? 'uri' : ''} · ${points} puncte · potrivire pe poziție`
          : 'Fără contur — zona se potrivește doar pe județ, oraș sau cod poștal'}
      </p>

      {rates.length ? (
        <ul className="mt-1.5 space-y-0.5">
          {rates.map((r) => (
            <li key={r.id} className="text-[11px] text-slate-600 flex justify-between gap-2">
              <span>{bracketLabel(r)}</span>
              <span className="font-medium text-slate-800">{formatAmount(r)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-[11px] text-amber-700">Fără tarife — zona nu produce nicio taxă.</p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onImport}
          disabled={busy || tracing}
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          <Upload className="w-3.5 h-3.5" />
          {hasOutline ? 'Înlocuiește' : 'Încarcă'}
        </button>
        <button
          type="button"
          onClick={onTrace}
          disabled={busy || tracing}
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          <PenLine className="w-3.5 h-3.5" />
          {hasOutline ? 'Retrasează' : 'Trasează'}
        </button>
      </div>
    </div>
  );
}
