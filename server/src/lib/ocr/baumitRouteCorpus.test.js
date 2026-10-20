/**
 * Baumit route corpus — ≥150 automated checks on golden path + CP edge cases.
 * Uses manifest raw_text (Baumit tab layout) through sanitize → parseBaumitAviz.
 * PDFs/photos under fixtures/baumit-route-corpus/ are for manual upload / regen.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBaumitAviz } from '../avizOcr.js';
import { sanitizeOcrText } from './normalizeOcrText.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/baumit-route-corpus');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

function parseCase(entry) {
  return parseBaumitAviz(sanitizeOcrText(entry.raw_text));
}

function routeLocality(route) {
  const legs = String(route || '').split(/\s*\/\s*/);
  const last = legs[legs.length - 1] || '';
  const m = last.match(/,\s*([^,]+)\s*$/);
  return m ? m[1].trim() : '';
}

describe('baumit-route-corpus manifest', () => {
  it('has enough cases for a wide regression net', () => {
    expect(manifest.length).toBeGreaterThanOrEqual(40);
  });
});

describe('baumit-route-corpus parse (raw_text)', () => {
  for (const entry of manifest) {
    describe(entry.slug, () => {
      const parsed = () => parseCase(entry);

      it('keeps Expeditor origin in ruta_transport', () => {
        const p = parsed();
        expect(p.ruta_transport || '').toMatch(new RegExp(entry.origin_substr, 'i'));
        expect(p.ruta_transport || '').toMatch(new RegExp(entry.origin_locality, 'i'));
      });

      it(`delivery locality is ${entry.expect_locality}`, () => {
        const p = parsed();
        expect(p.delivery_address?.locality).toBe(entry.expect_locality);
        expect(routeLocality(p.ruta_transport)).toMatch(
          new RegExp(entry.expect_locality.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
        );
      });

      it(`keeps street hint ${entry.expect_street_substr}`, () => {
        const p = parsed();
        expect(p.ruta_transport || '').toMatch(new RegExp(entry.expect_street_substr, 'i'));
        // Street name on Bvd. Timisoara may equal the wrong-town trap — locality must still win.
        if (entry.force_bucuresti_from_cp) {
          expect(p.ruta_transport || '').toMatch(/,\s*Bucuresti\b/i);
        }
      });

      it(`keeps postcode ${entry.expect_postcode} off the route string`, () => {
        const p = parsed();
        expect(p.delivery_address?.postcode).toBe(entry.expect_postcode);
        expect(p.ruta_transport || '').not.toMatch(new RegExp(`\\b${entry.expect_postcode}\\b`));
      });

      it('reads TPO and plate', () => {
        const p = parsed();
        expect(p.numar_tpo).toBe(entry.tpo);
        expect(p.numar_auto).toBe(entry.expect_plate_norm);
      });

      for (const banned of entry.must_not_locality || []) {
        it(`must not use locality ${banned}`, () => {
          const p = parsed();
          expect(routeLocality(p.ruta_transport)).not.toMatch(new RegExp(`^${banned}$`, 'i'));
          expect(p.delivery_address?.locality).not.toMatch(new RegExp(`^${banned}$`, 'i'));
        });
      }
    });
  }
});

describe('baumit-route-corpus kind rollups', () => {
  const byKind = (kind) => manifest.filter((e) => e.kind === kind);

  it('golden paths keep printed Bucuresti / town', () => {
    const rows = [...byKind('golden'), ...byKind('golden-extra')];
    expect(rows.length).toBeGreaterThanOrEqual(20);
    for (const entry of rows) {
      const p = parseCase(entry);
      expect(p.delivery_address?.locality).toBe(entry.expect_locality);
      expect(p.ruta_transport).toMatch(new RegExp(entry.expect_street_substr, 'i'));
    }
  });

  it('edge-cp with 01–06 postcode forces Bucuresti over Timisoara print', () => {
    const rows = byKind('edge-cp').filter((e) => e.force_bucuresti_from_cp);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const entry of rows) {
      const p = parseCase(entry);
      expect(p.delivery_address?.locality).toBe('Bucuresti');
      expect(routeLocality(p.ruta_transport)).toMatch(/Bucuresti/i);
      expect(routeLocality(p.ruta_transport)).not.toMatch(/^Timisoara$/i);
    }
  });

  it('negative real Timisoara 30xxxx stays Timisoara', () => {
    const rows = byKind('negative');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const entry of rows) {
      const p = parseCase(entry);
      expect(p.delivery_address?.locality).toBe('Timisoara');
      expect(p.ruta_transport).toMatch(/Timisoara/);
      expect(p.ruta_transport).not.toMatch(/Bucuresti/i);
    }
  });

  it('client-column traps do not steal the delivery street', () => {
    for (const entry of byKind('trap')) {
      const p = parseCase(entry);
      expect(p.ruta_transport || '').toMatch(new RegExp(entry.expect_street_substr, 'i'));
      expect(p.ruta_transport || '').not.toMatch(/Aeroportului/i);
      if (entry.slug.includes('fundeni') || entry.slug.includes('sabareni')) {
        expect(p.delivery_address?.locality).toBe('Sabareni');
      }
    }
  });
});
