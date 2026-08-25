/**
 * Digital tachograph .ddd / .tgd / .c1b / .v1b — foundation parser.
 *
 * EU 2016/799 download files are TLV concatenations. Full activity decode
 * (Reg. 561 analysis) is a later increment. Here we:
 * - scan TLV blocks (VU 2-byte tags and card 3-byte tags)
 * - classify vu | card | unknown
 * - extract printable plate-like / card-like strings
 * - never invent driving hours
 */

import crypto from 'crypto';

/** Known VU transfer tags (SID 0x76 + TREP). */
export const VU_TAGS = {
  0x7600: 'vu_download_interface_version',
  0x7601: 'vu_overview_g1',
  0x7602: 'vu_activities_g1',
  0x7603: 'vu_events_faults_g1',
  0x7604: 'vu_detailed_speed_g1',
  0x7605: 'vu_technical_data_g1',
  0x7621: 'vu_overview_g2',
  0x7622: 'vu_activities_g2',
  0x7623: 'vu_events_faults_g2',
  0x7624: 'vu_detailed_speed_g2',
  0x7625: 'vu_technical_data_g2',
  0x7631: 'vu_overview_g2v2',
  0x7632: 'vu_activities_g2v2',
  0x7633: 'vu_events_faults_g2v2',
  0x7635: 'vu_technical_data_g2v2',
};

/** Common driver-card elementary file FIDs (high byte of 3-byte card tag). */
export const CARD_FID_HINTS = {
  0x0501: 'card_icc',
  0x0520: 'card_identification',
  0x050e: 'card_driver_activity',
  0x050f: 'card_vehicles_used',
  0x0504: 'card_events_data',
  0x0505: 'card_faults_data',
};

const ALLOWED_EXT = new Set(['.ddd', '.tgd', '.c1b', '.v1b', '.C1B', '.V1B', '.DDD', '.TGD']);

export function isTachographFilename(name) {
  const lower = String(name || '').toLowerCase();
  const i = lower.lastIndexOf('.');
  if (i < 0) return false;
  return ALLOWED_EXT.has(lower.slice(i));
}

function readU16BE(buf, offset) {
  if (offset + 2 > buf.length) return null;
  return buf.readUInt16BE(offset);
}

/**
 * Scan VU-style TLV: tag(2) + length(2) + value(length).
 * Stops when remaining bytes cannot form a header or length overruns.
 */
export function scanVuTlv(buf) {
  const blocks = [];
  let offset = 0;
  while (offset + 4 <= buf.length) {
    const tag = readU16BE(buf, offset);
    const length = readU16BE(buf, offset + 2);
    if (tag == null || length == null) break;
    if (length === 0xffff) break; // reserved
    if (offset + 4 + length > buf.length) break;
    const value = buf.subarray(offset + 4, offset + 4 + length);
    blocks.push({
      offset,
      tag,
      tag_hex: tag.toString(16).padStart(4, '0'),
      length,
      name: VU_TAGS[tag] || null,
      value,
    });
    offset += 4 + length;
  }
  return { blocks, consumed: offset, remaining: buf.length - offset };
}

/**
 * Scan card-style TLV: tag(3) = FID(2)+type(1) + length(2) + value.
 */
export function scanCardTlv(buf) {
  const blocks = [];
  let offset = 0;
  while (offset + 5 <= buf.length) {
    const fid = readU16BE(buf, offset);
    const type = buf[offset + 2];
    const length = readU16BE(buf, offset + 3);
    if (fid == null || length == null) break;
    if (length === 0xffff) break;
    if (offset + 5 + length > buf.length) break;
    const value = buf.subarray(offset + 5, offset + 5 + length);
    const tag = (fid << 8) | type;
    blocks.push({
      offset,
      tag,
      fid,
      type,
      tag_hex: tag.toString(16).padStart(6, '0'),
      length,
      name: CARD_FID_HINTS[fid] || null,
      value,
    });
    offset += 5 + length;
  }
  return { blocks, consumed: offset, remaining: buf.length - offset };
}

/** Extract printable ASCII runs (min length). */
export function extractAsciiRuns(buf, { min = 5, max = 32 } = {}) {
  const runs = [];
  let cur = '';
  for (let i = 0; i < buf.length; i += 1) {
    const b = buf[i];
    const ok = (b >= 0x20 && b <= 0x7e) || b === 0x0a || b === 0x0d;
    if (ok && b >= 0x20 && b <= 0x7e) {
      cur += String.fromCharCode(b);
      if (cur.length > max) {
        if (cur.length >= min) runs.push(cur.slice(0, max));
        cur = '';
      }
    } else if (cur) {
      if (cur.length >= min) runs.push(cur);
      cur = '';
    }
  }
  if (cur.length >= min) runs.push(cur);
  return [...new Set(runs)];
}

/** Romanian / EU plate-like tokens from ASCII runs. */
export function guessPlates(strings = []) {
  const plates = [];
  const re = /\b([A-Z]{1,3}[- ]?\d{2,3}[- ]?[A-Z]{2,3}|\d{2,3}[- ]?[A-Z]{2,3}[- ]?\d{2,3})\b/g;
  for (const s of strings) {
    const upper = s.toUpperCase();
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(upper))) {
      plates.push(m[1].replace(/\s+/g, '-'));
    }
  }
  return [...new Set(plates)].slice(0, 8);
}

/**
 * Classify + summarise a tachograph download buffer.
 */
export function analyseTachographBuffer(buf, { filename } = {}) {
  if (!Buffer.isBuffer(buf) && !(buf instanceof Uint8Array)) {
    throw Object.assign(new Error('Buffer invalid'), { status: 400 });
  }
  const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (buffer.length < 8) {
    return {
      ok: false,
      kind: 'unknown',
      status: 'failed',
      message: 'Fișier prea mic pentru un download tahograf',
      size_bytes: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      tags: [],
      plates_guess: [],
      ascii_samples: [],
    };
  }

  const vu = scanVuTlv(buffer);
  const card = scanCardTlv(buffer);
  const vuKnown = vu.blocks.filter((b) => b.name).length;
  const cardKnown = card.blocks.filter((b) => b.name).length;
  const vuCoverage = vu.consumed / buffer.length;
  const cardCoverage = card.consumed / buffer.length;

  let kind = 'unknown';
  let blocks = [];
  if (vuKnown > 0 && vuCoverage >= cardCoverage) {
    kind = 'vu';
    blocks = vu.blocks;
  } else if (cardKnown > 0) {
    kind = 'card';
    blocks = card.blocks;
  } else if (vuCoverage > 0.5 && vu.blocks.length > 0) {
    kind = 'vu';
    blocks = vu.blocks;
  } else if (cardCoverage > 0.5 && card.blocks.length > 0) {
    kind = 'card';
    blocks = card.blocks;
  }

  const ascii = extractAsciiRuns(buffer);
  const plates = guessPlates(ascii);
  const tagSummary = blocks.slice(0, 40).map((b) => ({
    tag: b.tag_hex,
    name: b.name,
    length: b.length,
  }));

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const partial = kind !== 'unknown';

  return {
    ok: true,
    kind,
    status: partial ? 'partial' : 'stored',
    message: partial
      ? 'Fișier arhivat; tip detectat. Analiza completă 561/2006 vine mai târziu.'
      : 'Fișier arhivat; tip necunoscut — TLV-urile nu s-au potrivit pe schema VU/card.',
    size_bytes: buffer.length,
    sha256,
    filename: filename || null,
    tags: tagSummary,
    tag_count: blocks.length,
    known_tag_count: blocks.filter((b) => b.name).length,
    plates_guess: plates,
    ascii_samples: ascii.slice(0, 12),
    coverage: {
      vu: Math.round(vuCoverage * 1000) / 1000,
      card: Math.round(cardCoverage * 1000) / 1000,
    },
  };
}
