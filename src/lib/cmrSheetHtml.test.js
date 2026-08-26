import { describe, expect, it } from 'vitest';
import { PAGE, cmrSheetFilename, cmrSheetHtml, escapeHtml, sheetState } from './cmrSheetHtml.js';

const MODEL = {
  trip: { id: 't1', cmr_number: 'CMR-2026-0311' },
  data: {
    expeditor: 'Baumit Romania SRL\nStr. Fabricii 1',
    destinatar: 'Depozit Chiajna SRL',
    transportator: 'Transitix SRL',
    numar_colete: 18,
    natura_marfii: 'Mortar uscat',
    greutate_bruta_kg: 9000,
    volum_mc: 12.5,
    rezerve_incarcare: 'Doi saci rupți',
    intocmit_la: 'București',
    intocmit_data: '2026-03-10',
  },
  signatures: {},
  stages: { incarcare: { signed_at: null }, livrare: { signed_at: null } },
};

const SIGNED = {
  ...MODEL,
  signatures: {
    semnatura_expeditor: '/uploads/a.png',
    semnatura_transportator: '/uploads/b.png',
    semnatura_destinatar: '/uploads/c.png',
  },
  stages: {
    incarcare: { signed_at: '2026-03-10T08:00:00Z' },
    livrare: { signed_at: '2026-03-11T15:00:00Z' },
  },
};

const printedAt = new Date('2026-03-12T09:00:00Z');
const render = (model) => cmrSheetHtml(model, { printedAt });

describe('sheetState', () => {
  it('calls an unsigned note a draft', () => {
    expect(sheetState(MODEL).kind).toBe('draft');
  });

  it('distinguishes a half-signed note', () => {
    expect(sheetState({ ...MODEL, stages: { incarcare: { signed_at: 'x' }, livrare: {} } }).kind)
      .toBe('partial');
  });

  it('calls a fully signed note complete', () => {
    expect(sheetState(SIGNED).kind).toBe('complete');
  });
});

describe('cmrSheetHtml', () => {
  it('prints the numbered boxes of a consignment note', () => {
    const html = render(SIGNED);
    for (const box of ['1. Expeditor', '2. Destinatar', '16. Transportator', '11. Greutate brută']) {
      expect(html).toContain(box);
    }
  });

  it('carries the values through', () => {
    const html = render(SIGNED);
    expect(html).toContain('Baumit Romania SRL');
    expect(html).toContain('Mortar uscat');
    expect(html).toContain('Doi saci rupți');
  });

  it('says loudly when nothing has been signed', () => {
    // A page that looks like a finished CMR when nobody signed it is worse than no page.
    expect(render(MODEL)).toContain('CIORNĂ');
  });

  it('says when only the loading was signed', () => {
    const html = render({ ...MODEL, stages: { incarcare: { signed_at: 'x' }, livrare: {} } });
    expect(html).toContain('livrarea nesemnată');
  });

  it('prints no warning banner on a complete note', () => {
    expect(render(SIGNED)).not.toContain('CIORNĂ');
    expect(render(SIGNED)).not.toContain('nesemnată');
  });

  it('keeps the operator’s line breaks in a reservation', () => {
    const html = render({ ...MODEL, data: { ...MODEL.data, rezerve_incarcare: 'unu\ndoi' } });
    expect(html).toContain('unu<br>doi');
  });

  it('formats a Romanian date and number', () => {
    const html = render(SIGNED);
    expect(html).toContain('10.03.2026');
    expect(html).toContain('9.000');
    expect(html).toContain('12,50');
  });

  it('leaves an empty box empty rather than printing "undefined"', () => {
    const html = render({ ...MODEL, data: { expeditor: 'X' } });
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('null');
  });

  it('draws a signature line where there is no signature', () => {
    expect(render(MODEL)).toContain('dashed');
  });

  it('embeds each signature image once it exists', () => {
    const html = cmrSheetHtml(SIGNED, { printedAt, signatureUrl: (u) => `${u}?token=abc` });
    expect(html).toContain('/uploads/a.png?token=abc');
    expect(html).toContain('/uploads/c.png?token=abc');
  });

  it('escapes anything a person typed', () => {
    const html = render({ ...MODEL, data: { ...MODEL.data, natura_marfii: '<script>x</script>' } });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('lays out at A4 portrait, the size the rasterizer works in', () => {
    expect(render(SIGNED)).toContain(`width:${PAGE.width}px`);
  });

  it('survives a model with almost nothing in it', () => {
    expect(() => cmrSheetHtml({}, { printedAt })).not.toThrow();
    expect(() => cmrSheetHtml(null, { printedAt })).not.toThrow();
  });
});

describe('cmrSheetFilename', () => {
  it('names the file after the consignment note', () => {
    expect(cmrSheetFilename(MODEL)).toBe('CMR-CMR-2026-0311.pdf');
  });

  it('strips anything a filesystem would object to', () => {
    expect(cmrSheetFilename({ trip: { cmr_number: 'a/b\\c:d' } })).toBe('CMR-a_b_c_d.pdf');
  });

  it('falls back when there is no number', () => {
    expect(cmrSheetFilename({})).toBe('CMR-CMR.pdf');
  });
});

describe('escapeHtml', () => {
  it('escapes the characters that would break out of an attribute or a tag', () => {
    expect(escapeHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
  });

  it('turns nothing into an empty string', () => {
    expect(escapeHtml(null)).toBe('');
  });
});
