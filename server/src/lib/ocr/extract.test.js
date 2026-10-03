import { describe, expect, it } from 'vitest';
import {
  canonicalPlate,
  extractDate,
  extractGoodsUnit,
  extractGrossWeight,
  extractNetWeight,
  extractPalletCount,
  extractPlate,
  extractQuantity,
  isGenericCountUnit,
  isPlausibleQuantity,
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

describe('canonicalPlate', () => {
  it('writes every plate the one way, whatever the separator was', () => {
    // Two formats used to coexist: this extractor produced "B 123 ABC" and normalizePlate in
    // avizOcr produced "B-123-ABC". As the key of a vehicle registry that is two lorries, and
    // one of them never gets its MTMA filled in.
    for (const form of ['B 123 ABC', 'B-123-ABC', 'B123ABC', 'b 123 abc']) {
      expect(canonicalPlate(form), form).toBe('B-123-ABC');
    }
  });

  it('keeps a tractor and its trailer, in order, without repeating one', () => {
    expect(canonicalPlate('B 112 VFM / B 475AGR')).toBe('B-112-VFM / B-475-AGR');
    expect(canonicalPlate('B 112 VFM / B 112 VFM')).toBe('B-112-VFM');
  });

  it('returns a string it does not recognise unchanged, never empty', () => {
    // The fleet holds deliberate non-standard entries. Emptying them would be worse than
    // leaving them inconsistent, and `vehicles.plate` is NOT NULL.
    expect(canonicalPlate('B-900-DEMO')).toBe('B-900-DEMO');
    expect(canonicalPlate('B TEST 1')).toBe('B TEST 1');
    expect(canonicalPlate('')).toBe('');
    expect(canonicalPlate(null)).toBe('');
  });

  it('is idempotent', () => {
    expect(canonicalPlate(canonicalPlate('B 123 ABC'))).toBe('B-123-ABC');
  });
});

describe('extractPlate', () => {
  it('reads a spaced Romanian plate', () => {
    expect(extractPlate('Auto: B 123 ABC').value).toBe('B-123-ABC');
  });

  it('keeps tractor and trailer when both are on the aviz', () => {
    expect(extractPlate(
      'Transportator: RAI-SPEDITION SRL. Autovehicul: B 911 VFM / B 138 VRT',
    ).value).toBe('B-911-VFM / B-138-VRT');
  });

  it('rejects a plate-shaped string without a real county', () => {
    expect(extractPlate('QQ 12 XYZ').value).toBeNull();
    expect(extractPlate('CJ 12 XYZ').value).toBe('CJ-12-XYZ');
  });

  it('does not keep bookmark/UI noise glued to a partial plate', () => {
    const found = extractPlate(
      'Placuta de inmatriculare 330 SRS FOOTY STREAM TRANSPORTATOR'
    );
    expect(found.value).toBeNull();
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

describe('gross weight, the field the report actually needs', () => {
  it('reads the unit-in-the-label form Baumit actually prints', () => {
    // `Greutate bruta, kg  15,744.00`. Only `number unit` was matched, so on a real Baumit
    // aviz the weight came back empty and the annex printed the bucket count in the tonnes
    // column: 768 where the weighbridge said 15.74.
    expect(extractGrossWeight('Greutate bruta, kg 15,744.00').value).toBe(15744);
    expect(extractNetWeight('Greutate neta, kg 15,360.00').value).toBe(15360);
  });

  it('reads Greutate brută/netă (kg) 9.487,80 — unit in parentheses', () => {
    const block = `
Greutate netă (kg) 9.450,00
Greutate brută (kg) 9.487,80
`;
    expect(extractNetWeight(block).value).toBe(9450);
    expect(extractGrossWeight(block).value).toBe(9487.8);
  });

  it('reads US-style thousands with parentheses unit', () => {
    expect(extractGrossWeight('Greutate brută (kg) 9,487.80').value).toBe(9487.8);
    expect(extractNetWeight('Greutate netă (kg) 9,450.00').value).toBe(9450);
  });

  it('reads it across the line breaks a PDF puts between tokens', () => {
    const asPdfGivesIt = 'Greutate\nbruta,\nkg\n15,744.00\npce / preluare';
    expect(extractGrossWeight(asPdfGivesIt).value).toBe(15744);
  });

  it('does not let a number swallow the next line', () => {
    // Every token on its own row is what pdf-parse hands back. A digit class including \s
    // would run straight through the newline into the following figure.
    const two = 'Greutate bruta, kg 15,744.00\n768.00\nbuc';
    expect(extractGrossWeight(two).value).toBe(15744);
  });

  it('keeps net and gross apart in the unit-first form', () => {
    const both = 'Greutate neta, kg 15,360.00 Greutate bruta, kg 15,744.00';
    expect(extractGrossWeight(both).value).toBe(15744);
    expect(extractNetWeight(both).value).toBe(15360);
  });

  it('does not read a net-only document as a gross weight', () => {
    expect(extractGrossWeight('Greutate neta, kg 15,360.00').value).toBeNull();
  });

  it('reads gross from the Baumit PDF column order (kg after sac, label empty)', () => {
    // Real pdf-parse stream from Aviz_Baumit_cu_zona_centrala „B”: gross digits sit in the
    // goods table after "378.00 sac"; "Greutate brută:" is followed only by "pce / preluare".
    const zonaCentrala = `
Cantitatea
378.00
sac
9,487.80
kg
Cantitatea
pachetului
7.00
pal
Greutate
netă:
9,450.00
kg
Greutate
brută:
pce
/
preluare
pce
`;
    expect(extractNetWeight(zonaCentrala).value).toBe(9450);
    expect(extractGrossWeight(zonaCentrala).value).toBe(9487.8);
  });

  it('does not treat product unit size "25 kg" as gross beside a labelled net', () => {
    const onlyNetAndBag = 'Adeziv ADCELEX 25 kg (54/pal)\nGreutate netă: 9,450.00 kg\nGreutate brută: pce';
    expect(extractGrossWeight(onlyNetAndBag).value).toBeNull();
  });

  it('still accepts a space as the thousands separator', () => {
    expect(extractGrossWeight('Greutate bruta, kg 15 744,00').value).toBe(15744);
  });

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

  it('prefers Numărul de găleți over the first product-line Cantitate', () => {
    // Multi-line transfer: eleven găleți rows counted as buc, then the footer total.
    const lines = [48, 48, 72, 48, 24, 72, 48, 48, 48, 72, 48]
      .map((n) => `Cantitate ${n}.00 buc`)
      .join('\n');
    const text = `${lines}\nNumărul de găleți: 576,00`;
    expect(extractQuantity(text).value).toEqual({ quantity: 576, unit: 'galeti' });
  });

  it('reads footer total when photo OCR splits label and number onto two lines (#42)', () => {
    const lines = [48, 48, 72, 48, 24, 72, 48, 48, 48, 72, 48]
      .map((n) => `Cantitate ${n}.00 buc`)
      .join('\n');
    const text = `${lines}\nNumarul de galeti\n576,00`;
    expect(extractQuantity(text).value).toEqual({ quantity: 576, unit: 'galeti' });
  });

  it('sums product lines when footer label is present but the figure failed OCR (#42)', () => {
    const lines = [48, 48, 72, 48, 24, 72, 48, 48, 48, 72, 48]
      .map((n) => `Cantitate ${n}.00 buc`)
      .join('\n');
    // Label without a readable total — tip becomes găleți, quantity must not stay on 48.
    const text = `${lines}\nNumarul de galeti`;
    expect(extractQuantity(text).value).toEqual({ quantity: 576, unit: 'galeti' });
  });

  it('does not take the first product line when footer label exists but only one line OCR (#42)', () => {
    const text = 'Cantitate 48.00 buc BetonKontakt\nNumarul de galeti';
    expect(extractQuantity(text).value).toBeNull();
  });

  it('reads OCR-garbled ga1eti footer totals (#42)', () => {
    expect(extractQuantity('Cantitate 48.00 buc\nNumarul de ga1eti 576,00').value)
      .toEqual({ quantity: 576, unit: 'galeti' });
  });

  it('sums packaging lines when the footer total is missing', () => {
    const text = [
      '270.00 sac FinoGrande',
      '378.00 sac Beton',
      '105.00 sac MPA',
      '54.00 sac DuoContact',
      '16.00 pce Palet Euro returnabil',
    ].join('\n');
    expect(extractQuantity(text).value).toEqual({ quantity: 807, unit: 'saci' });
  });

  it('keeps a single product line and ignores euro-pallet pce', () => {
    const text = 'Cantitate 72.00 buc SuperPrimer\n3.00 pce Palet Euro returnabil';
    expect(extractQuantity(text).value).toEqual({ quantity: 72, unit: 'bucati' });
  });

  it('does not put Greutate brută into Cantitate when columns scramble', () => {
    // Real SuperPrimer / TRO miss: Cantitate showed 1550.998 next to 1.551,00 kg.
    const text = `
Aviz de expeditie: TRO-0009884
Cantitate: 1.550,998 kg
72.00 buc SuperPrimer 20 kg (24/pal)
3.00 pce Palet Euro returnabil
Greutate neta, kg: 1,440.03
Greutate bruta, kg: 1,551.00
`;
    expect(extractQuantity(text).value).toEqual({ quantity: 72, unit: 'bucati' });
  });

  it('refuses a lone Cantitate-in-kg that is the weighbridge figure', () => {
    const text = `
Cantitate: 1.550,998 kg
Greutate bruta, kg: 1,551.00
`;
    expect(extractQuantity(text).value).toBeNull();
  });

  it('reads 72 buc from a Mistral markdown table row', () => {
    const text = `
Aviz de expeditie: TRO-0009884
| Articol | Descriere | Cantitate |
| 11000444 | SuperPrimer 20 kg (24/pal) | 72.00 | buc |
| 11000001 | Palet Euro returnabil | 3.00 | pce |
Greutate bruta, kg: 1,551.00
`;
    const doc = extractDocument(text, { documentType: 'aviz' });
    expect(doc.values.quantity).toBe(72);
    // Tip marfă must not become „paleti” from the euro-pallet article code.
    expect(doc.values.tip_marfa).not.toBe('paleti');
  });

  it('keeps SuperPrimer 72 buc when a găleți footer label has no total', () => {
    const text = `
Cantitate 72.00 buc SuperPrimer
3.00 pce Palet Euro returnabil
Numarul de galeti
Greutate bruta, kg: 1,551.00
`;
    expect(extractQuantity(text).value).toEqual({ quantity: 72, unit: 'galeti' });
  });

  it('does not double 72 buc when the packaging line is echoed twice in the text', () => {
    // Cached hybrid merge used to append PDF text under OCR → 72+72=144.
    const text = `
11000444 SuperPrimer 20 kg (24/pal) 72.00 buc
11000001 Palet Euro returnabil 3.00 pce
Greutate bruta, kg: 1,551.00
11000444 SuperPrimer 20 kg (24/pal) 72.00 buc
11000001 Palet Euro returnabil 3.00 pce
Greutate bruta, kg: 1,551.00
`;
    expect(extractQuantity(text).value).toEqual({ quantity: 72, unit: 'bucati' });
  });

  it('reads a pallet count', () => {
    expect(extractPalletCount('Paleti: 18').value).toBe(18);
  });

  it('rejects OCR magnitudes that cannot fit one truck', () => {
    // Romanian thousands / glued digits from poor photos, not a real bag count.
    expect(extractQuantity('Cantitate: 245.000 saci').value).toBeNull();
    expect(extractQuantity('245090 saci').value).toBeNull();
    expect(isPlausibleQuantity(245000, 'saci')).toBe(false);
    expect(isPlausibleQuantity(245, 'saci')).toBe(true);
    // Large but real loads must still be accepted (hard ceiling is for OCR garbage only).
    expect(isPlausibleQuantity(10000, 'saci')).toBe(true);
    expect(extractQuantity('Cantitate: 10000 saci').value).toEqual({ quantity: 10000, unit: 'saci' });
  });

  it('still accepts a labelled quantity in kilograms within truck weight', () => {
    expect(extractQuantity('Cantitate: 4200 kg').value).toEqual({ quantity: 4200, unit: 'kg' });
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
      numar_auto: 'B-123-ABC',
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
    expect(result.values.numar_auto).toBe('B-330-SRS');
    expect(result.values.data_efectuare_cursa).toBe('2026-08-10');
    expect(result.values.gross_weight_kg).toBe(9964.15);
    expect(result.values.net_weight_kg).toBe(9800);
    expect(result.values.quantity).toBe(245);
    expect(result.values.pallets).toBe(7);
    expect(result.values.ruta_transport || '').not.toMatch(/Paletizare/i);
    expect(String(result.values.tip_marfa || '')).toMatch(/MP[I1]/i);
    expect(String(result.values.tip_marfa || '')).not.toMatch(/^38245090$/);
  });

  it('does not treat Bolintin-Deal as the route when Adresa de livrare is Dobroești', () => {
    // Ticket 35: loose City-City matched the Expeditor town; annex showed Bolintin-Deal.
    const text = `
BAUMIT ROMANIA SRL
AVIZ DE INSOTIRE A MARFII
Expeditor Site: BOL Bolintin str. Republicii nr. IF Bolintin-Deal RO 087015
Aviz de expeditie: PSL-0044362
Adresă de livrare CS-DEMOS-OBI CIRESULUI STR CIRESULUI, NR 31B Dobroești RO 077085
Client factură: C23901185 DEMOS INTERMED SRL
Placuta de inmatriculare B 330 SRS
TPO-0025629
Data: 10.08.2026
Greutate bruta: 9964 kg
`;
    const result = extractDocument(text, { documentType: 'aviz' });
    expect(result.profile_id).toBe('aviz_baumit_psl');
    expect(result.values.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Str. Ciresului nr. 31B, Dobroesti');
    expect(result.values.ruta_transport).toMatch(/Ciresului/i);
    expect(result.values.ruta_transport).not.toBe('Bolintin-Deal');
  });

  it('keeps Republicii nr. + Bolintin-Deal when Referința client sits on the heading row', () => {
    const text = `
BAUMIT ROMANIA COM SRL
Aviz de expeditie rezumat: TPO-0031027
Expeditor Site: MIL Depozit: NEAMTIU
Adresa de livrare    Referinta client
MD MARFA BOL Bolintin
Str. Republicii, nr. 1F
Bolintin-Deal RO 087015
Placuta de inmatriculare B 911 VFM / B 138 VRT
`;
    const result = extractDocument(text, { documentType: 'aviz' });
    expect(result.values.ruta_transport).toMatch(/Republicii/i);
    expect(result.values.ruta_transport).toMatch(/1F/);
    expect(result.values.ruta_transport).toMatch(/Bolintin-Deal/i);
  });

  it('still accepts an explicit City - City route with spaces around the dash', () => {
    const result = extractDocument(PSL_AVIZ);
    expect(result.values.ruta_transport).toMatch(/Bucuresti\s*-\s*Chiajna/i);
  });

  /**
   * Real Paddle output from a handwritten notebook photo (wrong rotation often wins,
   * "aviz" is mangled). Previously profile detection scored 0 and TPO was discarded.
   */
  it('still pulls TPO from mangled handwriting OCR without clear aviz markers', () => {
    const hand = `
TPO-O025813
Datoviacxpedt11.020263:10.
OeROtitMMMARFA
TP0-O026813
Expeolita
TW
`;
    const result = extractDocument(hand, { documentType: 'aviz' });
    expect(result.profile_id).toBe('aviz_generic');
    expect(result.values.numar_tpo).toBe('TPO-0025813');
    expect(result.needs_review).toBe(true);
  });

  /**
   * Printed Baumit TRO with blank "Num de comanda de transport"; the driver wrote
   * `TPO / 31027` in red. Hybrid print + handwriting must not leave numar_tpo empty.
   */
  it('reads a handwritten TPO / ##### next to the transport-order label on a printed TRO', () => {
    const hybrid = `
BAUMIT ROMANIA COM SRL
Aviz de expeditie: TRO-0009884
Data: 21.09.2026
Adresa de livrare
Str. Republicii, nr. 1F
Bolintin-Deal RO 087015
Num de comanda de transport: TPO / 31027
Greutate neta: 1.440,03 kg
Greutate bruta: 1.551,00 kg
`;
    const result = extractDocument(hybrid, { documentType: 'aviz' });
    expect(result.profile_id).toBe('aviz_baumit_tro');
    expect(result.values.numar_tpo).toBe('TPO-31027');
    expect(result.values.numar_document_marfa).toMatch(/TRO/i);
    // Five digits ≠ padded 7 — prefill, but review (same rule as truncated codes).
    expect(result.fields.numar_tpo.status).not.toBe('ok');
  });

  it('reads handwritten TPO on the line below the blank transport-order label', () => {
    const hybrid = `
Aviz de expeditie TRO-0009884 Baumit
Num de comanda de transport:
TPO / 31027
Auto: B 112 VFM
`;
    const result = extractDocument(hybrid, { documentType: 'aviz' });
    expect(result.values.numar_tpo).toBe('TPO-31027');
  });

  /**
   * A hand over the corner of the page truncates the code without making it look wrong.
   * Copied onto an invoice that is worse than a blank field, so it has to reach an operator.
   */
  it('flags a TPO whose digit count is short instead of trusting it', () => {
    const short = extractDocument(
      'Aviz de expeditie PSL-0044362\nComanda transport: TPO 002562',
      { documentType: 'aviz' }
    );
    expect(short.values.numar_tpo).toBe('TPO-002562');
    expect(short.fields.numar_tpo.status).not.toBe('ok');

    const full = extractDocument(
      'Aviz de expeditie PSL-0044362\nComanda transport: TPO 0025620',
      { documentType: 'aviz' }
    );
    expect(full.fields.numar_tpo.status).toBe('ok');
  });

  it('reads a handwritten plate once the zero is repaired', () => {
    const result = extractDocument(
      'Aviz de expeditie PSL-0044362\nPlacuta de inmatriculare B 33o SRS',
      { documentType: 'aviz' }
    );
    expect(result.values.numar_auto).toBe('B-330-SRS');
  });

  it('keeps quantity and its unit apart from the weight', () => {
    const result = extractDocument(PSL_AVIZ);
    expect(result.values.quantity).toBe(378);
    expect(result.values.quantity_unit).toBe('saci');
    expect(result.values.gross_weight_kg).toBe(9000);
  });

  it('takes Numărul de găleți as quantity, not the first product line', () => {
    const lines = [48, 48, 72, 48, 24, 72, 48, 48, 48, 72, 48]
      .map((n) => `Articol SuperPrimer\nCantitate ${n}.00 buc`)
      .join('\n');
    const text = [
      'Aviz de expeditie TRO-0009999',
      'Comanda transport: TPO-0031027',
      lines,
      'Numărul de găleți: 576,00',
      'Greutate brută (kg) 12.345,00',
    ].join('\n');
    const result = extractDocument(text, { documentType: 'aviz' });
    expect(result.values.quantity).toBe(576);
    expect(result.values.quantity_unit).toBe('galeti');
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

  it('leaves quantity empty when OCR invents an impossible bag count', () => {
    const result = extractDocument(
      'AVIZ DE INSOTIRE\nTPO 2026-0313\nData: 12.03.2026\nCantitate: 245.000 saci',
      { documentType: 'aviz' }
    );
    expect(result.values.quantity).toBeUndefined();
    expect(result.review_fields).toContain('quantity');
    expect(result.needs_review).toBe(true);
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

describe('tip marfa: the word that names something', () => {
  it('prefers the packaging the document names over the count', () => {
    // A Baumit transfer aviz prints `Cantitate 768.00 buc` and, two lines down, `Numarul de
    // galeti 768.00`. Both describe buckets; only the second says so. Writing "bucati" onto the
    // customer's annex puts a word in front of them that names nothing.
    const aviz = 'Cantitate 768.00 buc BetonKontakt 20 kg Numarul de galeti 768.00';
    expect(extractGoodsUnit(aviz).value).toBe('galeti');
  });

  it('reads the label whichever way it is spelled', () => {
    expect(extractGoodsUnit('Numărul de găleți 768').value).toBe('galeti');
    expect(extractGoodsUnit('numarul de saci 420').value).toBe('saci');
  });

  it('ranks a named packaging above a bare count wherever they appear', () => {
    expect(extractGoodsUnit('768 buc, 420 saci').value).toBe('saci');
    expect(extractGoodsUnit('18 paleti si 768 buc').value).toBe('paleti');
  });

  it('offers a bare count for review rather than writing it unattended', () => {
    // 0.4 sits under ACCEPT_CONFIDENCE, so "bucati" reaches an operator instead of the annex.
    const bare = extractGoodsUnit('Cantitate 768.00 buc');
    expect(bare.value).toBe('bucati');
    expect(bare.confidence).toBeLessThan(ACCEPT_CONFIDENCE);
  });

  it('never reads a weight as a kind of goods', () => {
    expect(extractGoodsUnit('Greutate bruta, kg 15,744.00').value).toBeNull();
    expect(extractGoodsUnit('9,5 t').value).toBeNull();
  });

  it('knows which words only count', () => {
    for (const unit of ['buc', 'bucati', 'bucăți', 'pcs', 'PCE']) {
      expect(isGenericCountUnit(unit), unit).toBe(true);
    }
    for (const unit of ['saci', 'galeti', 'paleti', '']) {
      expect(isGenericCountUnit(unit), unit).toBe(false);
    }
  });
});

// ------------------------------------------------------- carnet de bord

/**
 * A driver's handwritten notebook page. Written as the sidecar tends to return it: the codes
 * confused (`TP0`, `TR0`, letter O for zero), the label colons lost, the route wrapped onto a
 * second line, and `DATA` punctuated with a colon where the hand wrote a dot.
 */
const CARNET_OCR = `TP0 - OO25813
DATA 11:08.2026
NR AUTO B-112-VFM
RUTA TRANS. MIC NEAMTIUMILI
TARI
BUD.IULIU MANIU 600
TIP MARFA GALETI
CANT MARFA 15,744,00
NR DOCUMENT TR0-0008053
NR CURSE 1`;

describe('carnet de bord profile', () => {
  it('is detected on a carnet and never steals a printed aviz', () => {
    expect(detectProfile(CARNET_OCR).profile?.id).toBe('carnet_bord');
    // The carnet's labels must not outrank Baumit's own markers on a printed page, or every
    // aviz starts extracting through the handwriting layout.
    expect(detectProfile(PADDLE_BAUMIT_PSL).profile?.id).toBe('aviz_baumit_psl');
    expect(detectProfile(CMR_TEXT).profile?.id).toBe('cmr_standard');
  });

  it('reads every field off the page', () => {
    const { values } = extractDocument(CARNET_OCR, { profileId: 'carnet_bord' });
    expect(values.numar_tpo).toBe('TPO-0025813');
    expect(values.data_efectuare_cursa).toBe('2026-08-11');
    expect(values.numar_auto).toBe('B-112-VFM');
    expect(values.numar_document_marfa).toBe('TRO-0008053');
    expect(values.tip_marfa).toBe('GALETI');
    expect(values.quantity).toBe(15744);
    expect(values.numar_curse).toBe(1);
  });

  it('maps numbered sheet lines (driver writing guide) onto fields', () => {
    // Same order as DRIVER_SHEET_GUIDE / DRIVER_SHEET_FIELD_BY_NO — values only, no labels.
    const numbered = [
      '1. 0025999',
      '2. 15.09.2026',
      '3. 450',
      '4. CJ 12 ABC',
      '5. Cluj → Sibiu',
      '6. SACI',
      '7. 12,5 t',
      '8. 12500',
      '9. 12000',
      '10. PSL-0044999',
      '11. 2',
      '12. 80',
      '13. 120',
      '14. 2,50',
    ].join('\n');
    const { values } = extractDocument(numbered, { profileId: 'carnet_bord' });
    expect(values.numar_tpo).toBe('TPO-0025999');
    expect(values.data_efectuare_cursa).toBe('2026-09-15');
    expect(values.valoare_tpo).toBe(450);
    expect(values.numar_auto).toBe('CJ-12-ABC');
    expect(values.ruta_transport).toMatch(/Cluj/i);
    expect(values.tip_marfa).toMatch(/SACI/i);
    expect(values.quantity).toBe(12.5);
    expect(values.gross_weight_kg).toBe(12500);
    expect(values.net_weight_kg).toBe(12000);
    expect(values.numar_document_marfa).toBe('PSL-0044999');
    expect(values.numar_curse).toBe(2);
    expect(values.taxe_suplimentare).toBe(80);
    expect(values.km_parcursi).toBe(120);
    expect(values.tarif_km).toBe(2.5);
  });

  it('picks carnet_bord on a numbered guide sheet even when line 10 is a PSL code', () => {
    // Real cab photo: PSL on the doc-number slot made detectProfile prefer aviz_baumit_psl,
    // so quantity / weight / trip count never ran through numbered fallbacks.
    const sheet = [
      '1. TPO - 00230',
      '2. 01/10/2026',
      '3. -',
      '4. B - 100 - PLM',
      '5. Bol - Deal / Bd. Dacia 36',
      '6. GĂLEȚI',
      '7. 9.96',
      '8. 8000',
      '9. 7843',
      '10. PSL - 12345',
      '11. 2',
      '12. -',
      '13. -',
      '14. -',
    ].join('\n');
    expect(detectProfile(sheet).profile?.id).toBe('carnet_bord');
    const { values, profile_id } = extractDocument(sheet);
    expect(profile_id).toBe('carnet_bord');
    expect(values.numar_tpo).toBe('TPO-00230');
    expect(values.data_efectuare_cursa).toBe('2026-10-01');
    expect(values.numar_auto).toBe('B-100-PLM');
    expect(values.ruta_transport).toMatch(/Dacia/i);
    expect(values.tip_marfa).toMatch(/GĂLEȚI|galeti/i);
    expect(values.quantity).toBe(9.96);
    expect(values.gross_weight_kg).toBe(8000);
    expect(values.net_weight_kg).toBe(7843);
    expect(values.numar_document_marfa).toBe('PSL-12345');
    expect(values.numar_curse).toBe(2);
    expect(values.valoare_tpo ?? null).toBeNull();
  });

  it('skips blank optional numbered lines instead of inventing zeros', () => {
    const sparse = [
      '1. TPO-0025999',
      '2. 15.09.2026',
      '3.',
      '4. B 112 VFM',
      '7. 10',
      '8. 10000 kg',
      '12. -',
      '13. gol',
    ].join('\n');
    const { values } = extractDocument(sparse, { profileId: 'carnet_bord' });
    expect(values.numar_tpo).toBe('TPO-0025999');
    expect(values.numar_auto).toBe('B-112-VFM');
    expect(values.valoare_tpo ?? null).toBeNull();
    expect(values.taxe_suplimentare ?? null).toBeNull();
    expect(values.km_parcursi ?? null).toBeNull();
    expect(values.quantity).toBe(10);
    expect(values.gross_weight_kg).toBe(10000);
  });

  it('keeps the delivery address, which sits on the line below the label', () => {
    // Reading only the labelled line drops the destination — the half the annex needs.
    const { values } = extractDocument(CARNET_OCR, { profileId: 'carnet_bord' });
    expect(values.ruta_transport).toContain('IULIU MANIU 600');
    expect(values.ruta_transport).toContain('→');
    // The label itself is not part of the route.
    expect(values.ruta_transport).not.toMatch(/ruta|trans\./i);
  });

  it('reads a number whose separator does both jobs', () => {
    // `15,744,00` is a comma for thousands and for the decimal. parseNumber returns null for
    // it and must not change — it decides what a weight means everywhere else.
    expect(parseNumber('15,744,00')).toBeNull();
    const { values } = extractDocument('CANT MARFA: 15,744,00', { profileId: 'carnet_bord' });
    expect(values.quantity).toBe(15744);
    // Grouping all the way down is still grouping. Were the rightmost separator taken as the
    // decimal here, `1,234,567` would become 1234.567 — a plausible-looking number, under the
    // ceiling, written unattended. It reads as 1234567 instead, which the quantity ceiling
    // then refuses, so the figure reaches an operator rather than the annex.
    const grouped = extractDocument('CANT MARFA: 1,234,567', { profileId: 'carnet_bord' });
    expect(grouped.values.quantity ?? null).toBeNull();
    expect(grouped.values.quantity).not.toBe(1234.567);
  });

  it('does not take the next line as the unit', () => {
    // `\s*` before the unit reaches across the newline and reads the `NR` of `NR. DOCUMENT`.
    // toColumns then copies that into Tip marfa when it is empty, putting a word on the
    // customer's annex that names nothing.
    const { values } = extractDocument(CARNET_OCR, { profileId: 'carnet_bord' });
    expect(values.quantity_unit ?? null).toBeNull();
  });

  it('will not invent a date out of a time of day', () => {
    // The colon form is accepted only behind the DATA label and only as three parts.
    const bare = extractDocument('Plecare 11:08 din depozit', { profileId: 'carnet_bord' });
    expect(bare.values.data_efectuare_cursa ?? null).toBeNull();
  });

  it('leaves a trip count it cannot believe to an operator', () => {
    const none = extractDocument('NR CURSE: 0', { profileId: 'carnet_bord' });
    expect(none.values.numar_curse ?? null).toBeNull();
  });
});
