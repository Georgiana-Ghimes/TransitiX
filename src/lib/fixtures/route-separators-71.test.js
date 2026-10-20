/**
 * Fixture-driven checks for ClickUp #71 (route separators → zone-tax delivery leg).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { avizDeliveryAddress, deliveryLegFromRuta } from '../avizZoneTax.js';

const dir = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(dir, 'route-separators-71.json'), 'utf8'));

describe('route-separators-71 fixture (#71)', () => {
  it('builds the same delivery leg for every separator × origin', () => {
    const dest = fixture.destination;
    for (const origin of fixture.origins) {
      for (const { sep, label } of fixture.separators) {
        const ruta = `${origin}${sep}${dest}`;
        expect(deliveryLegFromRuta(ruta), `${label} | ${origin}`).toBe(dest);
        expect(
          avizDeliveryAddress({ ruta_transport: ruta }),
          `address ${label} | ${origin}`,
        ).toMatchObject(fixture.expectedAddress);
      }
    }
  });

  it('matches every explicit route in the fixture', () => {
    for (const row of fixture.routes) {
      if (row.id === 'annex_short_slash') continue; // short form — leg only
      const leg = deliveryLegFromRuta(row.ruta);
      expect(leg, row.id).toBeTruthy();
      expect(leg.toLowerCase()).toContain('viilor');
      if (row.ruta.includes('Viilor nr. 52')) {
        expect(avizDeliveryAddress({ ruta_transport: row.ruta })).toMatchObject({
          street: expect.stringMatching(/viilor/i),
          number: '52',
          cityId: 'bucuresti',
          supported: true,
        });
      }
    }
  });

  it('does not split glued hyphen in Bolintin-Deal', () => {
    for (const row of fixture.negative) {
      expect(deliveryLegFromRuta(row.ruta)).toBe(row.expectedDeliveryLeg);
    }
  });
});
