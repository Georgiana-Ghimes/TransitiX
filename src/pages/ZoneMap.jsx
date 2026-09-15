/**
 * The zone map: the access zones a city defines, and what they cost here.
 *
 * The outlines are shipped with the app (`lib/zoneReference.js`), not configured per company,
 * Bucharest's A and B are the same public fact for every operator, so the screen draws them
 * with no setup at all. What is company-specific is whether a zone charges anything, and that
 * lives in `tax_zones`, reaching the invoice through `resolveZone`.
 *
 * Those two are kept visibly apart on purpose. A boundary that quietly acquired the power to
 * add money to an invoice would be a change nobody could point at afterwards, so linking a
 * reference zone to pricing is an explicit action with a button on it and a status on the card.
 *
 * Checking an address goes to the server rather than being recomputed here, so the answer this
 * screen gives is the answer the TPO would give.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer, TileLayer, Polygon, CircleMarker, Tooltip, Popup, useMap,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  Loader2, MapPin, Search, TriangleAlert, Eye, EyeOff, Info, Link2, Check, ChevronDown, Upload,
} from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { api } from '@/api/client';
import { notifyError, notifySuccess } from '@/lib/notify';
import {
  ZoneImportError,
  combinedBounds,
  pointInGeometry,
  ringsWithCutouts,
  geometryBounds,
  geometrySummary,
  geometryToRings,
  looksLikePlausibleOutline,
  parseZoneOutlines,
} from '@/lib/zoneGeometry';
import { ZONE_CITIES, cityById, referenceZone } from '@/lib/zoneReference';
import {
  hasStreetIndex, loadStreetIndex, lookupAddress, resolveAddress,
} from '@/lib/streetZones';

const cardCls = 'bg-white rounded-xl border border-slate-200/80 shadow-sm';
const inputCls = 'w-full h-10 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4E89]/30';

function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    map.fitBounds(L.latLngBounds(bounds).pad(0.12), { animate: true });
  }, [bounds, map]);
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
  const [cityId, setCityId] = useState(ZONE_CITIES[0].id);
  const [taxZones, setTaxZones] = useState([]);
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(() => new Set());
  const [linking, setLinking] = useState(null);

  const [address, setAddress] = useState('');
  const [mma, setMma] = useState('');
  const [plate, setPlate] = useState('');
  const [searching, setSearching] = useState(false);
  const [hit, setHit] = useState(null);

  const [streetIndex, setStreetIndex] = useState(null);
  const [lookup, setLookup] = useState(null);

  const [importing, setImporting] = useState(null);
  const [choice, setChoice] = useState(null);
  const fileRef = useRef(null);

  const city = cityById(cityId);

  // The field asks for kilograms and the tariff table speaks in tonnes, so "7,5" gets typed.
  // Offered as a correction rather than applied: silently multiplying somebody's number is how
  // a 7,5 kg answer becomes a 7.500 kg charge nobody chose.
  const mmaNumber = Number(String(mma).replace(',', '.'));
  const tonnesLikely = mma !== '' && Number.isFinite(mmaNumber)
    && mmaNumber > 0 && mmaNumber < 100;

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.commercial.zones();
      setTaxZones(data?.zones ?? []);
      setRates(data?.zone_rates ?? []);
    } catch (err) {
      // The outlines still draw without this. The map stays useful as a reference even when
      // the pricing side cannot be read.
      notifyError('Tarifele nu au putut fi încărcate', err);
    } finally {
      setLoading(false);
    }
  };

  const taxZoneFor = (code) => taxZones.find(
    (z) => String(z.code || '').trim().toUpperCase() === code,
  ) ?? null;

  const ratesFor = (zoneId) => (zoneId ? rates.filter((r) => r.tax_zone_id === zoneId) : []);

  const visible = useMemo(() => city.zones.filter((z) => !hidden.has(z.code)), [city, hidden]);

  /**
   * What each visible zone draws: its own outline, with the zones nested inside it punched out.
   *
   * Zone B's perimeter really does enclose Zone A, so filling both paints the inner zone twice
   * and the strictest zone ends up the muddiest on screen. The cutout is display only, the
   * stored outline stays the official one and `resolveZone` still separates them on priority.
   *
   * Drawn outermost first, so the inner zone's border sits on top of the hole its neighbour
   * leaves behind rather than under it.
   */
  const drawable = useMemo(() => {
    const ordered = [...visible].sort((a, b) => a.priority - b.priority);
    return ordered.map((zone) => ({
      zone,
      rings: ringsWithCutouts(
        zone.outline,
        visible.filter((other) => other.code !== zone.code).map((other) => other.outline),
      ),
    }));
  }, [visible]);
  const bounds = useMemo(() => combinedBounds(visible.map((z) => z.outline)), [visible]);

  const toggle = (code) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  // Loaded on first use, not with the page: a few hundred kilobytes that a map nobody searches
  // should never pay for.
  const ensureIndex = async () => {
    if (streetIndex?.cityId === city.id) return streetIndex;
    if (!hasStreetIndex(city.id)) return null;
    const loaded = await loadStreetIndex(city.id);
    setStreetIndex(loaded);
    return loaded;
  };

  /**
   * Answers from the shipped index first, and only asks the geocoder when the street is not in
   * it. The index never leaves the browser, which is the whole reason it exists: a search box
   * on this screen is routinely fed a customer's delivery address.
   */
  const search = async (e) => {
    e?.preventDefault();
    const q = address.trim();
    if (!q) return;
    setSearching(true);
    setHit(null);
    setLookup(null);
    try {
      const index = await ensureIndex();
      if (index) {
        const found = lookupAddress(index, q);
        if (found.status !== 'unknown') {
          setLookup(found);
          setSearching(false);
          return;
        }
        // Not in the index: it may be a street we do not carry, or an address with a number.
        // Fall through to the geocoder only if one is configured.
        setLookup(found);
      }

      const res = await api.commercial.locateZone({
        address: q,
        city: city.label,
        mmaKg: mma === '' ? null : mmaNumber,
        plate: plate.trim() || null,
      });
      // Which drawn outline holds the pin. Asked here because the server answers about
      // pricing, and a zone on the map that is not linked yet would otherwise come back as
      // "no zone" while the operator is looking at the pin sitting inside it.
      const drawn = res.point
        ? [...city.zones]
          .sort((a, b) => b.priority - a.priority)
          .find((z) => pointInGeometry([res.point.latitude, res.point.longitude], z.outline))
        : null;
      setHit({ ...res, drawn: drawn ?? null });
      if (!res.point) {
        notifyError('Adresă negăsită', res.message || 'Geocodarea nu a returnat niciun rezultat.');
      }
    } catch (err) {
      // With the index answering the common case, a missing geocoder is a note, not a failure.
      if (err?.status === 503) {
        notifyError(
          'Strada nu e în index',
          'Nu am găsit strada în lista orașului, iar geocodarea nu e configurată pe server '
          + 'ca rezervă. Verifică scrierea sau caută pe hartă.',
        );
      } else {
        notifyError('Căutarea a eșuat', err);
      }
    } finally {
      setSearching(false);
    }
  };

  const pickSuggestion = (entry) => {
    setAddress(entry.label);
    setLookup({ status: 'exact', query: entry.label, found: entry, suggestions: [] });
    setHit(null);
  };

  /**
   * Gives a reference zone the power to charge, by putting its outline into `tax_zones`.
   * The priority comes from the reference, because it is what encodes that A sits inside B,
   * leaving it to whoever creates the row is how a central address ends up on B's cheaper rate.
   */
  const linkForPricing = async (zone) => {
    setLinking(zone.code);
    try {
      let target = taxZoneFor(zone.code);
      if (target) {
        await api.entities.TaxZone.update(target.id, {
          polygon: zone.outline,
          priority: zone.priority,
        });
      } else {
        target = await api.entities.TaxZone.create({
          code: zone.code,
          name: zone.name,
          kind: 'zone',
          matcher: {},
          polygon: zone.outline,
          priority: zone.priority,
          is_active: true,
        });
      }

      // Existing brackets are never overwritten. A rate is versioned by validity period and a
      // report run later has to reproduce the figure it used, so replacing one in place would
      // quietly rewrite history. A company that already priced this zone keeps its own numbers.
      const already = ratesFor(target.id).length > 0;
      let added = 0;
      if (!already) {
        for (const bracket of zone.tariffs.brackets) {
          await api.entities.TaxZoneRate.create({
            tax_zone_id: target.id,
            mma_min_kg: bracket.minKg,
            mma_max_kg: bracket.maxKg,
            amount: bracket.daily,
            currency: zone.tariffs.currency,
            valid_from: zone.tariffs.validFrom,
          });
          added += 1;
        }
      }

      notifySuccess(
        `${zone.code} intră în calcul`,
        added
          ? `Contur oficial și ${added} tranșe de MMA (${zone.tariffs.source}, taxa pe zi, `
            + `din ${zone.tariffs.validFrom}).`
          : 'Conturul oficial a fost pus pe zonă. Tranșele existente au rămas neatinse.',
      );
      await load();
    } catch (err) {
      notifyError('Legarea la calcul a eșuat', err);
    } finally {
      setLinking(null);
    }
  };

  const applyOutline = async (taxZone, outline) => {
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
      const { points } = geometrySummary(geometry);
      await api.entities.TaxZone.update(taxZone.id, { polygon: geometry });
      const cleaned = droppedSlivers
        ? ` ${droppedSlivers} inel(e) fără suprafață au fost eliminate.`
        : '';
      notifySuccess(`Contur înlocuit pe ${taxZone.code}`, `${points} puncte.${cleaned}`);
      if (spikes.length) {
        // Reported, never corrected: reshaping a boundary on the operator's behalf would change
        // what an address is charged with nothing on screen saying it happened.
        notifyError(
          'Verifică conturul',
          `${spikes.length} vârf(uri) ies și revin pe aceeași linie, de obicei o scăpare la `
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
    const taxZone = importing;
    setImporting(null);
    if (!file || !taxZone) return;
    try {
      const outlines = parseZoneOutlines(await file.text(), file.name);
      if (outlines.length > 1) setChoice({ taxZone, outlines });
      else await applyOutline(taxZone, outlines[0]);
    } catch (err) {
      if (err instanceof ZoneImportError) notifyError('Fișier neacceptat', err.message);
      else notifyError('Importul a eșuat', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const extraZones = taxZones.filter((z) => !referenceZone(z.code));

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-[#0A2B4E]">Harta zonelor</h1>
        <p className="text-sm text-slate-500">
          Zonele de acces pentru autovehicule grele. Verificarea unei adrese folosește aceeași
          potrivire ca și calculul TPO.
        </p>
      </div>

      {/* One tab per city in the reference. Rendered even for a single city: the structure is
          what says another can be added without the screen changing shape. */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {ZONE_CITIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => { setCityId(c.id); setHit(null); setHidden(new Set()); }}
            className={`px-4 h-10 text-sm font-medium -mb-px border-b-2 ${
              c.id === cityId
                ? 'border-[#0A2B4E] text-[#0A2B4E]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <form onSubmit={search} className={`${cardCls} p-3 flex flex-wrap gap-2 items-center`}>
        <div className="flex-1 min-w-[240px]">
          <input
            className={inputCls}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Strada și numărul, ex. Calea 13 Septembrie 102"
          />
        </div>
        <div className="w-32">
          <input
            className={inputCls}
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            placeholder="Nr. auto"
          />
        </div>
        <div className="w-36">
          <input
            className={inputCls}
            value={mma}
            onChange={(e) => setMma(e.target.value)}
            inputMode="numeric"
            placeholder="MTMA (kg)"
          />
          {tonnesLikely ? (
            <button
              type="button"
              onClick={() => setMma(String(Math.round(Number(mma) * 1000)))}
              className="mt-1 text-[11px] text-amber-700 hover:underline"
            >
              {mma} pare în tone, pune {Number(mma) * 1000} kg?
            </button>
          ) : null}
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

      {lookup && lookup.status !== 'unknown' ? (
        <StreetResult
          lookup={lookup}
          city={city}
          index={streetIndex}
          mmaKg={mma === '' ? null : mmaNumber}
          taxZoneFor={taxZoneFor}
          ratesFor={ratesFor}
          onPick={pickSuggestion}
        />
      ) : null}

      {lookup?.status === 'unknown' && lookup.suggestions.length && !hit ? (
        <div className={`${cardCls} p-3 text-sm`}>
          <span className="text-slate-600">Nu am găsit „{lookup.query}”. Ai vrut:</span>
          <span className="ml-2 inline-flex flex-wrap gap-1.5">
            {lookup.suggestions.map((sug) => (
              <button
                key={sug.key}
                type="button"
                onClick={() => pickSuggestion(sug)}
                className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50"
              >
                {sug.label}
              </button>
            ))}
          </span>
        </div>
      ) : null}

      {hit?.point ? <LocateResult hit={hit} /> : null}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        <div className={`${cardCls} overflow-hidden`} style={{ height: '62vh', minHeight: 380 }}>
          <MapContainer
            key={city.id}
            center={city.center}
            zoom={city.zoom}
            scrollWheelZoom
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OpenStreetMap"
            />
            <FitBounds bounds={bounds} />
            <FlyTo point={hit?.point} />

            {drawable.map(({ zone, rings }) => (
              <Polygon
                key={zone.code}
                positions={rings}
                pathOptions={{
                  color: zone.color, weight: 2, fillColor: zone.color, fillOpacity: 0.16,
                }}
              >
                <Tooltip sticky>
                  <span className="font-semibold">{zone.code}</span> · {zone.name}
                </Tooltip>
                <Popup>
                  <ZonePopup zone={zone} rates={ratesFor(taxZoneFor(zone.code)?.id)} />
                </Popup>
              </Polygon>
            ))}

            {hit?.point ? (
              <CircleMarker
                center={[hit.point.latitude, hit.point.longitude]}
                radius={8}
                pathOptions={{ color: '#0A2B4E', fillColor: '#F5A623', fillOpacity: 1, weight: 2 }}
              >
                <Tooltip permanent direction="top" offset={[0, -8]}>
                  {hit.zone ? hit.zone.code : 'Fără zonă'}
                </Tooltip>
              </CircleMarker>
            ) : null}
          </MapContainer>
        </div>

        <div className="space-y-2">
          {city.zones.map((zone) => (
            <ZoneCard
              key={zone.code}
              zone={zone}
              taxZone={taxZoneFor(zone.code)}
              rates={ratesFor(taxZoneFor(zone.code)?.id)}
              hidden={hidden.has(zone.code)}
              linking={linking === zone.code}
              onToggle={() => toggle(zone.code)}
              onLink={() => linkForPricing(zone)}
              onImport={(taxZone) => { setImporting(taxZone); fileRef.current?.click(); }}
              highlighted={hit?.zone?.code === zone.code}
            />
          ))}

          {extraZones.length ? (
            <div className={`${cardCls} p-3`}>
              <p className="text-[11px] font-medium text-slate-500 mb-1">
                Alte zone din tarifare
              </p>
              <ul className="space-y-0.5">
                {extraZones.map((z) => (
                  <li key={z.id} className="text-[11px] text-slate-600">
                    {z.code} · {z.name}
                    {geometryToRings(z.polygon).length ? '' : ', fără contur'}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-slate-400">
                În afara referinței livrate, deci nu se desenează aici.
              </p>
            </div>
          ) : null}

          <p className="flex gap-2 text-[11px] text-slate-400 px-1 pt-1">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>{city.note}</span>
          </p>
        </div>
      </div>

      {choice ? (
        <OutlinePicker
          taxZone={choice.taxZone}
          outlines={choice.outlines}
          onCancel={() => setChoice(null)}
          onPick={async (outline) => {
            const taxZone = choice.taxZone;
            setChoice(null);
            await applyOutline(taxZone, outline);
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
 * Two separate facts, never merged: where the pin fell, and what the calculation will charge.
 *
 * They can legitimately differ, a zone drawn on the map charges nothing until it is linked to
 * pricing, and collapsing them into one line would either hide a zone the operator can see or
 * promise a tax that will not appear on the invoice.
 */
/**
 * What the index knows about a street, and what that means for the invoice.
 *
 * The two are reported separately for the same reason the geocoded result does it: a zone drawn
 * on the map charges nothing until it is linked to pricing, and a street that only partly lies
 * in its zone has no single answer at all.
 */
function StreetResult({ lookup, city, index, mmaKg, taxZoneFor, ratesFor, onPick }) {
  if (lookup.status === 'ambiguous') {
    return (
      <div className={`${cardCls} p-3 text-sm`}>
        <div className="flex items-start gap-2">
          <TriangleAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-slate-700">
              „{lookup.query}” poate fi mai multe străzi, iar ele <strong>nu sunt în aceeași
              zonă</strong>. Alege una:
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {lookup.suggestions.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => onPick(entry)}
                  className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50"
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const entry = lookup.found;
  const answer = resolveAddress(index, lookup, city.zones);
  const zone = answer?.zone ? city.zones.find((z) => z.code === answer.zone) : null;
  const taxZone = zone ? taxZoneFor(zone.code) : null;
  const rate = taxZone && mmaKg != null ? pickRate(ratesFor(taxZone.id), mmaKg) : null;
  const settled = answer?.certain === true;

  return (
    <div className={`${cardCls} p-3 space-y-2 text-sm`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <MapPin className="w-4 h-4 text-[#1D4E89] shrink-0" />
        <span className="text-slate-700 font-medium">
          {entry.label}{lookup.number ? ` ${lookup.number}` : ''}
        </span>
        {lookup.sharedWith > 1 ? (
          <span className="text-[11px] text-slate-400">
            {lookup.sharedWith} străzi cu acest nume, toate în aceeași zonă
          </span>
        ) : lookup.status === 'without-type' ? (
          <span className="text-[11px] text-slate-400">
            potrivit după nume, verifică dacă e strada corectă
          </span>
        ) : null}
        <span className="text-[11px] text-slate-400">din indexul {city.label}</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[11px] uppercase tracking-wide text-slate-400 w-16">Zonă</span>
        {!zone && settled ? (
          <span className="text-slate-500">În afara zonelor restricționate.</span>
        ) : !zone ? (
          <span className="inline-flex items-center gap-1 text-amber-700">
            <TriangleAlert className="w-3.5 h-3.5" />
            Numărul cade între {answer.between.map((z) => z || 'zonă liberă').join(' și ')},
            verifică pe hartă.
          </span>
        ) : (
          <>
            <span
              className="px-2 py-0.5 rounded-full text-white text-xs font-semibold"
              style={{ backgroundColor: zone.color }}
            >
              {zone.code}
            </span>
            <span className="text-slate-600">{zone.name}</span>
            {settled ? (
              <span className="text-[11px] text-slate-400">
                {answer.source === 'number' ? 'după numărul stradal' : zone.threshold}
              </span>
            ) : answer.needsNumber ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                <TriangleAlert className="w-3.5 h-3.5" />
                strada traversează limita, adaugă numărul pentru un răspuns exact
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                <TriangleAlert className="w-3.5 h-3.5" />
                nu am numărul {lookup.number} în index, verifică pe hartă
              </span>
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[11px] uppercase tracking-wide text-slate-400 w-16">Calcul</span>
        {!zone ? (
          <span className="text-slate-500">
            {settled ? 'Nicio taxă de zonă.' : 'Nedecis, nicio sumă de arătat.'}
          </span>
        ) : !taxZone ? (
          <span className="inline-flex items-center gap-1 text-amber-700">
            <TriangleAlert className="w-3.5 h-3.5" />
            {zone.code} nu e activată pentru calcul, TPO-ul nu va adăuga nicio taxă aici.
          </span>
        ) : mmaKg == null ? (
          <span className="text-slate-500">Completează MMA ca să vezi taxa.</span>
        ) : rate ? (
          <>
            <span className="text-slate-800 font-semibold">{formatAmount(rate)}</span>
            <span className="text-[11px] text-slate-400">
              {zone.code} · {mmaKg.toLocaleString('ro-RO')} kg
              {settled ? '' : ' · dacă adresa e în zonă'}
            </span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1 text-amber-700">
            <TriangleAlert className="w-3.5 h-3.5" />
            {zone.code} nu are tranșă pentru {mmaKg.toLocaleString('ro-RO')} kg.
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The bracket covering a weight, narrowest first.
 *
 * Deliberately the same rule as `findZoneRate` on the server, because this reads the very rows
 * that function reads. It is a display of the stored tariff, not a second opinion about it.
 */
function pickRate(rates, mmaKg) {
  const matching = rates.filter((r) => {
    const min = Number(r.mma_min_kg) || 0;
    const max = r.mma_max_kg == null ? Infinity : Number(r.mma_max_kg);
    return mmaKg >= min && mmaKg <= max;
  });
  return matching.sort((a, b) => {
    const spanA = (a.mma_max_kg == null ? Infinity : Number(a.mma_max_kg)) - Number(a.mma_min_kg);
    const spanB = (b.mma_max_kg == null ? Infinity : Number(b.mma_max_kg)) - Number(b.mma_min_kg);
    return spanA - spanB;
  })[0] ?? null;
}

function LocateResult({ hit }) {
  const drawn = hit.drawn;
  const charged = hit.zone;
  const amount = formatAmount(hit.rate);

  return (
    <div className={`${cardCls} p-3 space-y-2 text-sm`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <MapPin className="w-4 h-4 text-[#1D4E89] shrink-0" />
        <span className="text-slate-700 font-medium">{hit.point.label || hit.address}</span>
        {hit.query && hit.query !== hit.address ? (
          <span className="text-[11px] text-slate-400">căutat ca „{hit.query}”</span>
        ) : null}
        {hit.outcome?.action === 'review' ? (
          <span className="text-[11px] text-amber-700">
            Geocodare incertă, verifică pinul pe hartă.
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[11px] uppercase tracking-wide text-slate-400 w-16">Zonă</span>
        {drawn ? (
          <>
            <span
              className="px-2 py-0.5 rounded-full text-white text-xs font-semibold"
              style={{ backgroundColor: drawn.color }}
            >
              {drawn.code}
            </span>
            <span className="text-slate-600">{drawn.name}</span>
            <span className="text-[11px] text-slate-400">{drawn.threshold}</span>
          </>
        ) : (
          <span className="text-slate-500">În afara zonelor restricționate.</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[11px] uppercase tracking-wide text-slate-400 w-16">Calcul</span>
        {charged && hit.rate ? (
          <>
            <span className="text-slate-800 font-semibold">{amount}</span>
            <span className="text-[11px] text-slate-400">
              {charged.code} · {hit.matched_by === 'polygon' ? 'după contur' : 'după text'}
              {hit.mma_kg != null ? ` · ${hit.mma_kg.toLocaleString('ro-RO')} kg` : ''}
            </span>
          </>
        ) : charged ? (
          <span className="inline-flex items-center gap-1 text-amber-700">
            <TriangleAlert className="w-3.5 h-3.5" />
            {hit.mma_kg == null
              ? `${charged.code} intră în calcul, dar fără MMA nu se poate alege tranșa.`
              : `${charged.code} nu are tarif valabil la ${hit.date} pentru ${hit.mma_kg.toLocaleString('ro-RO')} kg.`}
          </span>
        ) : drawn ? (
          <span className="inline-flex items-center gap-1 text-amber-700">
            <TriangleAlert className="w-3.5 h-3.5" />
            {drawn.code} nu e activată pentru calcul, TPO-ul nu va adăuga nicio taxă aici.
          </span>
        ) : (
          <span className="text-slate-500">Nicio taxă de zonă.</span>
        )}
      </div>
    </div>
  );
}

function ZonePopup({ zone, rates }) {
  return (
    <div className="text-xs space-y-1">
      <p className="font-semibold text-slate-800">{zone.code} · {zone.name}</p>
      <p className="text-slate-500">{zone.threshold}</p>
      {rates?.length ? (
        <ul className="space-y-0.5 pt-1">
          {rates.map((r) => (
            <li key={r.id} className="text-slate-600">
              {bracketLabel(r)}: <strong>{formatAmount(r)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-slate-500 pt-1">Fără tarife, nu produce nicio taxă.</p>
      )}
    </div>
  );
}

function OutlinePicker({ taxZone, outlines, onCancel, onPick }) {
  return (
    <ModalShell onClose={onCancel} labelledBy="outline-picker-title" panelClassName="max-w-lg w-full">
      <div className="p-4 space-y-3">
        <h2 id="outline-picker-title" className="text-base font-semibold text-[#0A2B4E]">
          Care contur este pentru {taxZone.code}?
        </h2>
        <p className="text-xs text-slate-500">
          Fișierul conține {outlines.length} contururi. Numele din fișier nu spune sigur care e
          care, mărimea și întinderea de mai jos te lasă să distingi interiorul de exterior.
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

/** "5001 kg – 7500 kg" reads wrong on a tariff table; the decision speaks in tonnes. */
function tonnage({ minKg, maxKg }) {
  const t = (kg) => (kg / 1000).toLocaleString('ro-RO', { maximumFractionDigits: 1 });
  // The stored minimum is one kilogram above the printed one, so the bracket does not overlap
  // its neighbour. Showing that kilogram would make the table look wrong next to the decision.
  return maxKg == null ? `peste ${t(minKg - 1)} t` : `${t(minKg - 1)} – ${t(maxKg)} t`;
}

function lei(value) {
  return `${value.toLocaleString('ro-RO')} lei`;
}

function ZoneCard({
  zone, taxZone, rates, hidden, linking, onToggle, onLink, onImport, highlighted,
}) {
  const [showPerimeter, setShowPerimeter] = useState(false);
  const [showTariffs, setShowTariffs] = useState(false);
  const linked = Boolean(taxZone);
  // A linked zone can still be matching on text alone, if its row carries no outline.
  const hasOutline = linked && geometryToRings(taxZone.polygon).length > 0;

  return (
    <div className={`${cardCls} p-3 ${highlighted ? 'ring-2 ring-[#F5A623]' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: zone.color }} />
        <span className="font-semibold text-sm text-slate-800">{zone.code}</span>
        <span className="text-sm text-slate-600 truncate">{zone.name}</span>
        <button
          type="button"
          onClick={onToggle}
          title={hidden ? 'Arată pe hartă' : 'Ascunde de pe hartă'}
          className="ml-auto p-1 text-slate-400 hover:text-slate-700"
        >
          {hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      <p className="mt-1 text-[11px] text-slate-500">{zone.threshold}</p>

      <div className="mt-2">
        {!linked || !hasOutline ? (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-2">
            <p className="text-[11px] text-amber-900">
              {!linked
                ? <>Se vede pe hartă, dar <strong>nu intră în calcul</strong>. TPO-ul citește zonele din tarifare, unde această zonă nu există încă.</>
                : <>Zona există în tarifare, dar <strong>fără contur</strong>, se potrivește pe text, nu pe poziție.</>}
            </p>
            <button
              type="button"
              onClick={onLink}
              disabled={linking}
              className="mt-2 inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-amber-300 bg-white text-amber-900 hover:bg-amber-100 disabled:opacity-40"
            >
              {linking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
              {linked ? 'Pune conturul oficial' : 'Activează pentru calcul'}
            </button>
          </div>
        ) : (
          <p className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
            <Check className="w-3.5 h-3.5" /> Intră în calcul, pe poziție
          </p>
        )}
      </div>

      {linked && rates?.length ? (
        <ul className="mt-2 space-y-0.5">
          {rates.map((r) => (
            <li key={r.id} className="text-[11px] text-slate-600 flex justify-between gap-2">
              <span>{bracketLabel(r)}</span>
              <span className="font-medium text-slate-800">{formatAmount(r)}</span>
            </li>
          ))}
        </ul>
      ) : linked ? (
        <p className="mt-2 text-[11px] text-amber-700">
          Fără tranșe de MMA, zona nu produce nicio taxă.
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setShowTariffs((v) => !v)}
        className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700"
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showTariffs ? 'rotate-180' : ''}`} />
        Taxele oficiale ({zone.tariffs.source})
      </button>
      {showTariffs ? (
        <div className="mt-1">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-slate-400">
                <th className="text-left font-normal pb-0.5">MTMA</th>
                <th className="text-right font-normal pb-0.5">pe zi</th>
                <th className="text-right font-normal pb-0.5">pe lună</th>
              </tr>
            </thead>
            <tbody>
              {zone.tariffs.brackets.map((b) => (
                <tr key={b.minKg} className="text-slate-600">
                  <td className="py-px">{tonnage(b)}</td>
                  <td className="py-px text-right tabular-nums">{lei(b.daily)}</td>
                  <td className="py-px text-right tabular-nums text-slate-400">{lei(b.monthly)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-slate-400">
            Calculul folosește taxa pe zi, o zonă se taxează o dată pe cursă. Abonamentul lunar
            e afișat doar informativ; dacă îl ai, taxa pe cursă nu mai reflectă costul real.
          </p>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setShowPerimeter((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showPerimeter ? 'rotate-180' : ''}`} />
          Perimetrul oficial ({zone.perimeter.length} artere)
        </button>
        {linked ? (
          <button
            type="button"
            onClick={() => onImport(taxZone)}
            title="Înlocuiește conturul folosit la calcul cu unul dintr-un fișier"
            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700"
          >
            <Upload className="w-3.5 h-3.5" /> Alt contur
          </button>
        ) : null}
      </div>

      {showPerimeter ? (
        <p className="mt-1 text-[11px] text-slate-600 leading-relaxed">
          {zone.perimeter.join(' · ')}
        </p>
      ) : null}
    </div>
  );
}
