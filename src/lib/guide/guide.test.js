import { describe, expect, it } from 'vitest';
import { DRIVER_GUIDE, guideFor, officeGuide, searchSections, sectionText } from './index.js';
import { BLOCK_TYPES } from './schema.js';

const ALL_GUIDES = [
  ['șofer', DRIVER_GUIDE],
  ['birou, companion', officeGuide({ companion: true })],
  ['birou, complet', officeGuide({ companion: false })],
];

describe('guideFor', () => {
  it('gives a driver the driver guide, whatever the build', () => {
    expect(guideFor({ role: 'driver', companion: true }).id).toBe('driver');
    expect(guideFor({ role: 'driver', companion: false }).id).toBe('driver');
  });

  it('gives the office roles the office guide', () => {
    for (const role of ['admin', 'dispatcher', 'finance']) {
      expect(guideFor({ role, companion: true }).id).toBe('office-companion');
    }
  });

  it('does not describe screens the companion does not have', () => {
    // Explaining Financiar and Tracking GPS to somebody whose menu holds five items is worse
    // than saying nothing: they go looking for a screen that was never built for them.
    const text = officeGuide({ companion: true }).sections.map(sectionText).join(' ');
    expect(text).not.toMatch(/Tracking GPS/);
    expect(text).not.toMatch(/Planning AI/);
    expect(officeGuide({ companion: false }).sections.map(sectionText).join(' '))
      .toMatch(/Tracking GPS/);
  });

  it('is a different document for the driver, not a shorter office one', () => {
    const driverText = DRIVER_GUIDE.sections.map(sectionText).join(' ');
    // Office vocabulary that has no meaning in a cab.
    expect(driverText).not.toMatch(/MTMA/);
    expect(driverText).not.toMatch(/XLSX/i);
    expect(driverText).not.toMatch(/șablon/i);
  });
});

describe('fiecare ghid', () => {
  for (const [name, guide] of ALL_GUIDES) {
    describe(name, () => {
      it('has a title, an intro and sections', () => {
        expect(guide.title).toBeTruthy();
        expect(guide.intro).toBeTruthy();
        expect(guide.sections.length).toBeGreaterThan(3);
      });

      it('gives every section a unique anchor', () => {
        const ids = guide.sections.map((s) => s.id);
        expect(ids.every(Boolean)).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it('leaves no section empty, which is how a guide rots unnoticed', () => {
        for (const section of guide.sections) {
          expect(section.title, section.id).toBeTruthy();
          expect(section.blocks?.length, section.id).toBeGreaterThan(0);
          for (const block of section.blocks) {
            expect(BLOCK_TYPES, `${section.id}: ${block.type}`).toContain(block.type);
            expect(sectionText(section).length).toBeGreaterThan(40);
          }
        }
      });

      it('fills every steps and terms block', () => {
        for (const section of guide.sections) {
          for (const block of section.blocks) {
            if (block.type === 'steps') expect(block.items.length, section.id).toBeGreaterThan(1);
            if (block.type === 'terms') {
              for (const t of block.items) {
                expect(t.term, section.id).toBeTruthy();
                expect(t.text, section.id).toBeTruthy();
              }
            }
          }
        }
      });

      it('carries no em dashes, the app is not written by a machine', () => {
        expect(guide.sections.map(sectionText).join(' ')).not.toMatch(/—/);
        expect(guide.intro).not.toMatch(/—/);
      });
    });
  }
});

describe('searchSections', () => {
  const guide = officeGuide({ companion: true });

  it('returns everything for an empty query', () => {
    expect(searchSections(guide.sections, '')).toHaveLength(guide.sections.length);
    expect(searchSections(guide.sections, '   ')).toHaveLength(guide.sections.length);
  });

  it('finds a topic typed without diacritics', () => {
    // Nobody types "greutatea brută" on a keyboard set to English.
    const found = searchSections(guide.sections, 'greutate bruta');
    expect(found.length).toBeGreaterThan(0);
    expect(found.map((s) => s.id)).toContain('greutate');
  });

  it('matches words in any order, not as one substring', () => {
    const found = searchSections(guide.sections, 'zona taxa');
    expect(found.map((s) => s.id)).toContain('taxa-zona');
  });

  it('narrows as more words are added', () => {
    const one = searchSections(guide.sections, 'aviz');
    const two = searchSections(guide.sections, 'aviz duplicat');
    expect(two.length).toBeLessThan(one.length);
  });

  it('finds nothing rather than everything for a word nobody wrote', () => {
    expect(searchSections(guide.sections, 'zzzqqq')).toEqual([]);
  });

  it('searches the body, not only the titles', () => {
    // "HCGMB" appears in a paragraph and in no heading.
    expect(searchSections(guide.sections, 'HCGMB').map((s) => s.id)).toContain('taxa-zona');
  });
});

describe('ghidul șoferului', () => {
  const text = DRIVER_GUIDE.sections.map(sectionText).join(' ');

  it('explains every status the upload screen can show', () => {
    // A driver who cannot tell one status from another sends the same aviz five times.
    for (const status of [
      'Se procesează', 'OCR gata', 'De revizuit', 'Confirmat',
      'Nerecunoscut', 'Eșuat', 'Netrimis',
    ]) {
      expect(text, status).toContain(status);
    }
  });

  it('covers the limits the server enforces', () => {
    expect(text).toContain('8 fișiere');
    expect(text).toContain('15 MB');
  });

  it('says what happens with no signal, because that is when it is read', () => {
    expect(searchSections(DRIVER_GUIDE.sections, 'semnal').map((s) => s.id)).toContain('fara-semnal');
  });
});
