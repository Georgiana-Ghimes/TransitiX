/**
 * The zone map: the access zones a city defines, and what they cost here.
 *
 * The outlines are shipped with the app (`lib/zoneReference.js`), not configured per company —
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
  geometryBounds,
  geometrySummary,
  geometryToRings,
  looksLikePlausibleOutline,
  parseZoneOutlines,
} from '@/lib/zoneGeometry';
import { ZONE_CITIES, cityById, referenceZone } from '@/lib/zoneReference';

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
  const [searching, setSearching] = useState(false);
  const [hit, setHit] = useState(null);

  const [importing, setImporting] = useState(null);
  const [choice, setChoice] = useState(null);
  const fileRef = useRef(null);

  const city = cityById(cityId);

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
  const bounds = useMemo(() => combinedBounds(visible.map((z) => z.outline)), [visible]);

  const toggle = (code) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
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
      const res = await api.commercial.locateZone({
        address: q,
        mmaKg: mma === '' ? null : Number(mma),
      });
      setHit(res);
      if (!res.point) {
        notifyError('Adresă negăsită', res.message || 'Geocodarea nu a returnat niciun rezultat.');
      }
    } catch (err) {
      notifyError('Căutarea a eșuat', err);
    } finally {
      setSearching(false);
    }
  };

  /**
   * Gives a reference zone the power to charge, by putting its outline into `tax_zones`.
   * The priority comes from the reference, because it is what encodes that A sits inside B —
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
            placeholder={`Strada, oraș — ex. Calea Victoriei, ${city.label}`}
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

            {visible.map((zone) => (
              <Polygon
                key={zone.code}
                positions={geometryToRings(zone.outline)}
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
                    {geometryToRings(z.polygon).length ? '' : ' — fără contur'}
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

function LocateResult({ hit }) {
  const amount = formatAmount(hit.rate);

  return (
    <div className={`${cardCls} p-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm`}>
      <MapPin className="w-4 h-4 text-[#1D4E89] shrink-0" />
      <span className="text-slate-700 font-medium">{hit.point.label || hit.address}</span>

      {!hit.zone ? (
        <span className="text-slate-500">Nu cade în nicio zonă activă din tarifare.</span>
      ) : (
        <>
          <span className="px-2 py-0.5 rounded-full bg-[#0A2B4E] text-white text-xs font-semibold">
            {hit.zone.code}
          </span>
          <span className="text-slate-600">{hit.zone.name}</span>
          <span className="text-[11px] text-slate-400">
            {hit.matched_by === 'polygon' ? 'după contur' : 'după text (nu după contur)'}
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
        <p className="text-slate-500 pt-1">Fără tarife — nu produce nicio taxă.</p>
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
          care — mărimea și întinderea de mai jos te lasă să distingi interiorul de exterior.
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
                : <>Zona există în tarifare, dar <strong>fără contur</strong> — se potrivește pe text, nu pe poziție.</>}
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
          Fără tranșe de MMA — zona nu produce nicio taxă.
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
            Calculul folosește taxa pe zi — o zonă se taxează o dată pe cursă. Abonamentul lunar
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
