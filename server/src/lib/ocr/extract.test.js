import { describe, expect, it } from 'vitest';
import {
  extractDate,
  extractGrossWeight,
  extractNetWeight,
  extractPalletCount,
  extractPlate,
  extractQuantity,
  overallConfidence,
  parseNumber,
} from './fields.js';
import { detectProfile, getProfile, profilesFor } from './profiles.js';
import {
  ACCEPT_CONFIDENCE,
  applyCorrections,
  extractDocument,
  fieldStatus,
  reExtract,
  summariseExtraction,
} from './extract.js';

const PSL_AVIZ = `
BAUMIT ROMANIA SRL
AVIZ DE INSOTIRE A MARFII
Nr. document PSL 4417/2026
TPO 2026-0311
Data: 10.03.2026
Auto: B 123 ABC
Ruta: Bucuresti - Chiajna
Tip marfa: Mortar uscat
Cantitate: 378 saci
Paleti: 18
Greutate bruta: 9.000 kg
Greutate neta: 8.244 kg
`;

const CMR_TEXT = `
CMR SCRISOARE DE TRANSPORT
CMR nr. RO-2026-5512
Expeditor: Baumit Romania SRL
Destinatar: Depozit Chiajna SRL
Transportator: Transitix SRL
Auto: B 123 ABC
Data: 10.03.2026
Greutate bruta 9000 kg
`;

/** Real PaddleOCR output from a photographed Baumit PSL aviz (glued codes, OCR typos). */
const PADDLE_BAUMIT_PSL = `
Expeditor
Site: BOL Bolintin
Aviz de expeditiePSL-0044362
Data avizutui de expeditie
10.08.2026
Comanda vanzare
SOR-0046409
Transportator
Placuta de inmatriculare B 330 SRS
Comanda de transport_TPO-0025629
Nr_Descriere
MP1 25 40 kg (35/pal)
GTIN: 5945752000371 / Cod marfa: 38245090
245.00 sac
7.00 pal
11001674
Servicit Paletizare-Infotiere
7.00 pce
Greutate neta: 9,800.00 kg
Greutate bruta: 9,964.15 kg
Paletif inctusi In tivrare sunt ambalaje aferente produseior si nu fac oblectut unei operatiuni
Baumit Romania Com SRL
`;

// ------------------------------------------------------------------ fields

describe('parseNumber', () => {
  it('reads Romanian decimals', () => {
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('8244')).toBe(8244);
    expect(parseNumber('9,5')).toBe(9.5);
  });

  it('treats a dot before three digits as a thousands separator', () => {
    expect(parseNumber('9.000')).toBe(9000);
  });

  it('reads plain decimals too', () => {
    expect(parseNumber('1.5')).toBe(1.5);
  });

  it('returns null for junk', () => {
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber(null)).toBeNull();
  });
});

describe('extractPlate', () => {
  it('reads a spaced Romanian plate', () => {
    expect(extractPlate('Auto: B 123 ABC').value).toBe('B 123 ABC');
  });

  it('trusts a real county prefix more than a plausible shape', () => {
    const real = extractPlate('CJ 12 XYZ');
    const shaped = extractPlate('QQ 12 XYZ');
    expect(real.confidence).toBeGreaterThan(shaped.confidence);
  });

  it('returns nothing when there is no plate', () => {
    expect(extractPlate('nimic aici').value).toBeNull();
  });
});

describe('extractDate', () => {
  it('reads dd.mm.yyyy', () => {
    expect(extractDate('Data: 10.03.2026').value).toBe('2026-03-10');
  });

  it('reads ISO', () => {
    expect(extractDate('2026-03-10').value).toBe('2026-03-10');
  });

  it('reads a Romanian month name', () => {
    expect(extractDate('10 mar 2026').value).toBe('2026-03-10');
  });

  it('rejects an impossible date', () => {
    expect(extractDate('45.99.2026').value).toBeNull();
  });
});

describe('gross weight — the field the report actually needs', () => {
  it('reads a labelled gross weight and trusts it', () => {
    const found = extractGrossWeight('Greutate bruta: 9.000 kg');
    expect(found.value).toBe(9000);
    expect(found.confidence).toBeGreaterThanOrEqual(ACCEPT_CONFIDENCE);
  });

  it('converts tonnes to kilograms', () => {
    expect(extractGrossWeight('Masa bruta 9,5 t').value).toBe(9500);
  });

  it('does not trust an unlabelled weight, because it may be the net', () => {
    const found = extractGrossWeight('Greutate 9000 kg');
    expect(found.value).toBe(9000);
    expect(found.confidence).toBeLessThan(ACCEPT_CONFIDENCE);
  });

  it('never mistakes a quantity for a weight', () => {
    expect(extractGrossWeight('Cantitate: 378 saci').value).toBeNull();
  });

  it('reads the net weight separately', () => {
    expect(extractNetWeight('Greutate neta: 8.244 kg').value).toBe(8244);
  });
});

describe('quantity stays separate from weight', () => {
  it('reads quantity with its unit', () => {
    expect(extractQuantity('Cantitate: 378 saci').value).toEqual({ quantity: 378, unit: 'saci' });
  });

  it('reads a pallet count', () => {
    expect(extractPalletCount('Paleti: 18').value).toBe(18);
  });
});

describe('overallConfidence', () => {
  it('weights important fields more heavily', () => {
    const fields = { a: { confidence: 1 }, b: { confidence: 0 } };
    expect(overallConfidence(fields, { a: 3, b: 1 })).toBe(0.75);
  });

  it('ignores fields with zero weight', () => {
    const fields = { a: { confidence: 1 }, b: { confidence: 0 } };
    expect(overallConfidence(fields, { a: 1, b: 0 })).toBe(1);
  });

  it('handles no fields', () => {
    expect(overallConfidence({})).toBe(0);
  });
});

// ---------------------------------------------------------------- profiles

describe('profile detection', () => {
  it('recognises a PSL aviz', () => {
    expect(detectProfile(PSL_AVIZ).profile?.id).toBe('aviz_baumit_psl');
  });

  it('recognises a CMR', () => {
    expect(detectProfile(CMR_TEXT).profile?.id).toBe('cmr_standard');
  });

  it('narrows candidates by document type', () => {
    const detected = detectProfile(CMR_TEXT, { documentType: 'aviz' });
    expect(detected.candidates.every((c) => c.profile.documentType === 'aviz')).toBe(true);
  });

  it('recognises nothing in unrelated text', () => {
    expect(detectProfile('lista de cumparaturi: paine, lapte').profile).toBeNull();
  });

  it('ranks candidates so an operator can override the guess', () => {
    const detected = detectProfile(PSL_AVIZ);
    expect(detected.candidates.length).toBeGreaterThan(1);
    expect(detected.candidates[0].score).toBeGreaterThanOrEqual(detected.candidates[1].score);
  });

  it('lists profiles per document type', () => {
    expect(profilesFor('cmr').every((p) => p.documentType === 'cmr')).toBe(true);
  });
});

// -------------------------------------------------------------- extraction

describe('extractDocument', () => {
  it('pulls the whole PSL aviz', () => {
    const result = extractDocument(PSL_AVIZ);
    expect(result.profile_id).toBe('aviz_baumit_psl');
    expect(result.values).toMatchObject({
      numar_auto: 'B 123 ABC',
      data_efectuare_cursa: '2026-03-10',
      gross_weight_kg: 9000,
      net_weight_kg: 8244,
      pallets: 18,
    });
  });

  it('recovers TPO/PSL from glued PaddleOCR photo text', () => {
    const result = extractDocument(PADDLE_BAUMIT_PSL, { documentType: 'aviz' });
    expect(result.profile_id).toBe('aviz_baumit_psl');
    expect(result.values.numar_tpo).toBe('TPO-0025629');
    expect(result.values.numar_document_marfa).toBe('PSL-0044362');
    expect(result.values.numar_auto).toBe('B 330 SRS');
    expect(result.values.data_efectuare_cursa).toBe('2026-08-10');
    expect(result.values.gross_weight_kg).toBe(9964.15);
    expect(result.values.net_weight_kg).toBe(9800);
    expect(result.values.quantity).toBe(245);
    expect(result.values.pallets).toBe(7);
    expect(result.values.ruta_transport || '').not.toMatch(/Paletizare/i);
    expect(String(result.values.tip_marfa || '')).toMatch(/MP[I1]/i);
    expect(String(result.values.tip_marfa || '')).not.toMatch(/^38245090$/);
  });

  it('keeps quantity and its unit apart from the weight', () => {
    const result = extractDocument(PSL_AVIZ);
    expect(result.values.quantity).toBe(378);
    expect(result.values.quantity_unit).toBe('saci');
    expect(result.values.gross_weight_kg).toBe(9000);
  });

  it('scores every field, not just the document', () => {
    const result = extractDocument(PSL_AVIZ);
    expect(result.fields.numar_auto.confidence).toBeGreaterThan(0);
    expect(Object.values(result.fields).every((f) => 'status' in f)).toBe(true);
  });

  it('marks a document that needs review instead of accepting it silently', () => {
    const poor = extractDocument('AVIZ ceva neclar 12.03.2026');
    expect(poor.needs_review).toBe(true);
    expect(poor.review_fields.length).toBeGreaterThan(0);
  });

  it('reports an unrecognised document rather than guessing a profile', () => {
    const result = extractDocument('lista de cumparaturi');
    expect(result.status).toBe('unrecognised');
    expect(result.profile_id).toBeNull();
    expect(result.needs_review).toBe(true);
  });

  it('lets an operator force a profile when detection is wrong', () => {
    const result = extractDocument(PSL_AVIZ, { profileId: 'aviz_generic' });
    expect(result.profile_id).toBe('aviz_generic');
    expect(result.forced_profile).toBe(true);
  });

  it('does not pre-fill a field it is barely sure about', () => {
    const result = extractDocument(PSL_AVIZ);
    for (const [name, field] of Object.entries(result.fields)) {
      if (field.status === 'missing') expect(result.values[name]).toBeUndefined();
    }
  });

  it('survives an extractor that throws', () => {
    const broken = {
      id: 'broken', documentType: 'aviz', name: 'Broken', markers: [/aviz/],
      fields: { bad: () => { throw new Error('boom'); }, ok: () => ({ value: 'x', confidence: 1 }) },
      weights: {},
    };
    const detected = detectProfile('aviz', { profiles: [broken] });
    expect(detected.profile?.id).toBe('broken');
  });

  it('extracts a CMR', () => {
    const result = extractDocument(CMR_TEXT);
    expect(result.document_type).toBe('cmr');
    expect(result.values.cmr_number).toContain('RO-2026-5512');
    expect(result.values.gross_weight_kg).toBe(9000);
  });
});

describe('fieldStatus', () => {
  it('splits trusted, review and missing', () => {
    expect(fieldStatus(0.95)).toBe('ok');
    expect(fieldStatus(0.5)).toBe('review');
    expect(fieldStatus(0.1)).toBe('missing');
  });
});

// ------------------------------------------------------------- corrections

describe('manual corrections', () => {
  it('pins a corrected field to full confidence', () => {
    const base = extractDocument(PSL_AVIZ);
    const fixed = applyCorrections(base, { numar_auto: 'CJ 99 ZZZ' });
    expect(fixed.values.numar_auto).toBe('CJ 99 ZZZ');
    expect(fixed.fields.numar_auto).toMatchObject({ confidence: 1, status: 'ok', source: 'manual' });
  });

  it('records which fields a person touched', () => {
    const fixed = applyCorrections(extractDocument(PSL_AVIZ), { numar_auto: 'CJ 99 ZZZ', tip_marfa: 'Adeziv' });
    expect(fixed.corrected_fields.sort()).toEqual(['numar_auto', 'tip_marfa']);
  });

  it('clears the review flag once every weak field is corrected', () => {
    const poor = extractDocument('AVIZ 12.03.2026');
    const corrections = Object.fromEntries(poor.review_fields.map((name) => [name, 'x']));
    expect(applyCorrections(poor, corrections).needs_review).toBe(false);
  });

  it('re-extraction keeps the operator corrections', () => {
    const corrected = applyCorrections(extractDocument(PSL_AVIZ), { numar_auto: 'CJ 99 ZZZ' });
    const again = reExtract(PSL_AVIZ, {
      corrections: corrected.values,
      correctedFields: corrected.corrected_fields,
    });
    // OCR would have read B 123 ABC again; the human value must survive.
    expect(again.values.numar_auto).toBe('CJ 99 ZZZ');
    expect(again.values.gross_weight_kg).toBe(9000);
  });

  it('re-extraction refreshes fields nobody touched', () => {
    const corrected = applyCorrections(extractDocument(PSL_AVIZ), { numar_auto: 'CJ 99 ZZZ' });
    const again = reExtract(PSL_AVIZ.replace('9.000 kg', '7.500 kg'), {
      corrections: corrected.values,
      correctedFields: corrected.corrected_fields,
    });
    expect(again.values.gross_weight_kg).toBe(7500);
  });
});

describe('summariseExtraction', () => {
  it('gives the batch list what it needs per document', () => {
    const summary = summariseExtraction(extractDocument(PSL_AVIZ));
    expect(summary).toMatchObject({ profile_id: 'aviz_baumit_psl' });
    expect(summary.filled).toBeGreaterThan(0);
    expect(summary.total).toBeGreaterThanOrEqual(summary.filled);
  });
});

describe('quantity must never absorb a weight', () => {
  it('does not read "Greutate 4200 kg" as a quantity', () => {
    // Seen on a real poor-quality aviz: the weight was landing in the quantity column.
    expect(extractQuantity('Greutate 4200 kg').value).toBeNull();
  });

  it('still reads a labelled quantity given in kilograms', () => {
    expect(extractQuantity('Cantitate: 4200 kg').value).toEqual({ quantity: 4200, unit: 'kg' });
  });

  it('leaves the weight field alone', () => {
    expect(extractGrossWeight('Greutate 4200 kg').value).toBe(4200);
  });

  it('an aviz with only a weight yields no quantity', () => {
    const result = extractDocument('AVIZ DE INSOTIRE\nData 12.03.2026\nGreutate 4200 kg');
    expect(result.values.quantity).toBeUndefined();
    expect(result.values.gross_weight_kg).toBe(4200);
  });
});

describe('the operator corrects what is on the screen, not what the extractor calls it', () => {
  it('clears the review flag when the quantity is corrected under its column name', () => {
    // The form shows `cantitate_marfa`; the extractor's field is `quantity`. Before these were
    // linked, correcting the visible field left the invisible one missing and the document was
    // stuck in review for good.
    const poor = extractDocument('AVIZ\nTPO 2026-0313\nData: 12.03.2026');
    const filled = {};
    for (const name of poor.review_fields) filled[name] = 'verificat';
    filled.cantitate_marfa = 96;
    delete filled.quantity;

    const fixed = applyCorrections(poor, filled, { previouslyCorrected: [] });
    expect(fixed.review_fields).not.toContain('quantity');
    expect(fixed.needs_review).toBe(false);
  });

  it('stores the value once, under the name the extractor uses', () => {
    const fixed = applyCorrections(extractDocument(PSL_AVIZ), { cantitate_marfa: 400 });
    expect(fixed.values.quantity).toBe(400);
    expect(fixed.values).not.toHaveProperty('cantitate_marfa');
  });

  it('records both spellings, so a screen highlighting corrections keeps working', () => {
    const fixed = applyCorrections(extractDocument(PSL_AVIZ), { cantitate_marfa: 400 });
    expect(fixed.corrected_fields).toEqual(expect.arrayContaining(['quantity', 'cantitate_marfa']));
  });

  it('keeps the correction through a forced re-extraction', () => {
    const fixed = applyCorrections(extractDocument(PSL_AVIZ), { cantitate_marfa: 400 });
    const again = reExtract(PSL_AVIZ, {
      corrections: fixed.values,
      correctedFields: fixed.corrected_fields,
    });
    expect(again.values.quantity).toBe(400);
  });
});
