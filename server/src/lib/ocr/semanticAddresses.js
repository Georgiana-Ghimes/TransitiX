/**
 * Semantic pickup / delivery addresses from OCR text (LLM), not template positions.
 *
 * OCR still reads the page; this layer decides which block is origin vs destination
 * from logistics labels (Expeditor / Adresa de livrare / Consignee / …), then compacts
 * a ruta_transport string for the annex.
 */

import { mistralChatJson } from './mistralChat.js';
import { isSuspiciousRoute } from '../avizOcr.js';

const SYSTEM = `You extract logistics addresses from Romanian shipping documents (aviz, CMR, delivery note).
Return ONLY valid JSON with this shape:
{
  "origin": {
    "raw": "full address text under Expeditor / Site / Depozit / Pickup",
    "locality": "city or commune only",
    "street_name": "street name without type word",
    "street_type": "strada|soseaua|bulevardul|aleea|piata|calea|null",
    "house_number": "number as printed, e.g. 1F or 52",
    "postcode": "6-digit postal code or null"
  },
  "destination": {
    "raw": "full address under Adresa de livrare / Consignee / Destination / Unloading",
    "locality": "...",
    "street_name": "...",
    "street_type": "...",
    "house_number": "...",
    "postcode": "..."
  },
  "confidence": { "origin": 0.0, "destination": 0.0 }
}

Rules:
- Origin is ALWAYS the street + locality under Expeditor. Never site codes alone, never Client / Client factură, never house numbers in the route string.
- Destination is ALWAYS the LEFT column under the heading "Adresa de livrare" (site code CS-… + street + locality). On Baumit PDFs that heading shares a row with "Client" on the RIGHT — never use the Client / Client factură address (C########, Locotenent Moga, Aeroportului billing seat, etc.) as destination.
- Ignore PDF footers like PAGINA 1/1, plate numbers, TPO/PSL/TRO codes, product lines, weights.
- If a field is missing, use null. confidence is 0..1 for how sure you are about that leg.
- Do not invent streets. Prefer null over guessing.`;

/** Route addresses are structural (labels + columns). LLM layer stays off. */
export function semanticAddressesEnabled() {
  return false;
}

function formatSpacedLeg(addr) {
  if (!addr || typeof addr !== 'object') return null;
  const name = String(addr.street_name || '').trim();
  const type = String(addr.street_type || '').trim();
  const locality = String(addr.locality || '').trim();
  const typeLabel = ({
    strada: 'Str.', str: 'Str.',
    sosea: 'Șosea', soseaua: 'Șosea', sos: 'Șosea',
    bulevardul: 'Bvd.', bvd: 'Bvd.', blvd: 'Bvd.', bd: 'Bvd.',
    aleea: 'Aleea', al: 'Aleea',
    piata: 'Piața', pta: 'Piața',
    calea: 'Calea',
  })[type.toLowerCase().replace(/\.$/, '')] || (name ? 'Str.' : null);
  const titled = (value) => String(value || '').split(/(\s+|-)/).map((part) => {
    if (!part || part === '-' || /^\s+$/.test(part)) return part;
    if (/^\d/.test(part)) return part;
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }).join('').replace(/\s+/g, ' ').trim();
  const street = [typeLabel, titled(name)].filter(Boolean).join(' ');
  const place = titled(locality);
  if (street && place) return `${street}, ${place}`;
  return street || place || null;
}

function clipOcrText(text, max = 12_000) {
  const s = String(text || '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated]`;
}

/**
 * @param {string} ocrText
 * @param {{ timeoutMs?: number, chatJson?: Function }} [options]
 * @returns {Promise<null|{
 *   ruta_transport: string,
 *   origin: object,
 *   destination: object,
 *   delivery_address: object,
 *   confidence: { origin: number, destination: number, route: number },
 *   source: 'llm'
 * }>}
 */
export async function extractSemanticAddresses(ocrText, { timeoutMs, chatJson = mistralChatJson } = {}) {
  if (!semanticAddressesEnabled()) return null;
  const text = clipOcrText(ocrText);
  if (text.trim().length < 40) return null;

  const parsed = await chatJson({
    system: SYSTEM,
    user: `Document OCR text:\n\n${text}`,
    timeoutMs,
  });
  if (!parsed || typeof parsed !== 'object') return null;

  const origin = parsed.origin && typeof parsed.origin === 'object' ? parsed.origin : null;
  const destination = parsed.destination && typeof parsed.destination === 'object' ? parsed.destination : null;
  const originLeg = formatSpacedLeg(origin);
  const destLeg = formatSpacedLeg(destination);

  let ruta = null;
  if (originLeg && destLeg) ruta = `${originLeg} / ${destLeg}`;
  else if (destLeg) ruta = destLeg;
  else if (originLeg) ruta = originLeg;
  if (!ruta) return null;

  const cOrigin = clamp01(parsed.confidence?.origin);
  const cDest = clamp01(parsed.confidence?.destination);
  const routeConf = Math.min(
    cOrigin ?? 0.7,
    cDest ?? 0.7,
    originLeg && destLeg ? 1 : 0.75,
  );

  return {
    ruta_transport: ruta,
    origin,
    destination,
    delivery_address: destinationToDeliveryShape(destination),
    confidence: {
      origin: cOrigin,
      destination: cDest,
      route: routeConf,
    },
    source: 'llm',
  };
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function destinationToDeliveryShape(destination) {
  if (!destination) return null;
  const locality = String(destination.locality || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ș|ş/gi, 's')
    .replace(/ț|ţ/gi, 't')
    .trim() || null;
  const streetName = String(destination.street_name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ș|ş/gi, 's')
    .replace(/ț|ţ/gi, 't')
    .toLowerCase()
    .trim() || null;
  const house = String(destination.house_number || '').replace(/\s+/g, '');
  const houseNorm = /^[IL]F$/i.test(house) ? `1${house.slice(-1).toUpperCase()}` : (house || null);
  const typeRaw = String(destination.street_type || '').toLowerCase().replace(/\.$/, '') || null;
  return {
    locality,
    street: [streetName, houseNorm].filter(Boolean).join(' ') || null,
    streetName,
    streetType: typeRaw,
    houseNumber: houseNorm,
  };
}

/**
 * Decide whether LLM route should replace the regex/profile route.
 * Incomplete single-leg routes (no ` / `) lose to a two-leg semantic answer.
 */
/** Kept for unit tests of the dormant module; extract path never calls this. */
export function preferSemanticRoute(currentRoute, semantic, rawText = null) {
  if (!semantic?.ruta_transport) return false;
  if (!currentRoute || isSuspiciousRoute(currentRoute, rawText)) return true;
  return false;
}
