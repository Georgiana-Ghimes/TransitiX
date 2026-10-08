import { describe, expect, it } from 'vitest';
import {
  canonicalPlate,
  extractDate,
  detectHandCorrection,
  extractGoodsUnit,
  extractGrossWeight,
  extractNetWeight,
  extractPalletCount,
  extractPlate,
  extractQuantity,
  isGenericCountUnit,
  isPlausibleLoadWeightKg,
  isPlausibleQuantity,
  overallConfidence,
  parseNumber,
} from './fields.js';
import { detectProfile, getProfile, looksLikeCmrDocument, profilesFor } from './profiles.js';
import {
  ACCEPT_CONFIDENCE,
  applyCorrections,
  extractDocument,
  fieldStatus,
  refineFieldsWithBlocks,
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

/** Handwritten Romanian CMR with standard numbered boxes (#66). */
const CMR_HANDWRITTEN_BOXES = `
CMR SCRISOARE DE TRASURA
0247315
Expeditor: Montaro Romania Com SRL
1. Expeditor ...
3. Ploiesti
4. Sos. Giurgiului nr. 120, Bucuresti Sector 4
6. -
7. 720
8. saci
9. Adeziv FlexBond
11. 14844 kg
12. 12
Auto: B 77 PLT
Data: 05.10.2026
Locul de incarcare: Ploiesti
Locul de descarcare: Sos. Giurgiului nr. 120, Bucuresti Sector 4
720.00 sac
18.00 pal
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

  it('keeps cents when OCR turns the thousands comma into a second dot (#51)', () => {
    // Printed `21,326.48` / `20,950.00` / `5,280.88` / `1,528.06` often come back as
    // all-dots. Stripping every dot produced ×100 (2132648, 2095000, …).
    expect(parseNumber('21.326.48')).toBe(21326.48);
    expect(parseNumber('20.950.00')).toBe(20950);
    expect(parseNumber('5.280.88')).toBe(5280.88);
    expect(parseNumber('1.528.06')).toBe(1528.06);
    expect(parseNumber('21,326.48')).toBe(21326.48);
    expect(parseNumber('20,950.00')).toBe(20950);
  });

  it('still reads multi-dot thousands without a decimal group', () => {
    expect(parseNumber('1.234.567')).toBe(1234567);
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

  it('keeps a Bulgarian tractor before the Romanian trailer (#60)', () => {
    expect(canonicalPlate('CA 4471 KX / B 63 RTX')).toBe('CA-4471-KX / B-63-RTX');
    expect(canonicalPlate('Placuta de inmatriculare: CA 4471 KX / B 63 RTX')).toBe('CA-4471-KX / B-63-RTX');
  });

  it('does not treat product "TM 40 kg" as a second plate (#52)', () => {
    // TM is a real county (Timiș). Deduped identical plates + goods line → TM-40-KG.
    expect(canonicalPlate(
      'Placuta de inmatriculare IF 14 RAI / IF 14 RAI\n11000151 Tencuiala TM 40 kg (35/pal)',
    )).toBe('IF-14-RAI');
    expect(canonicalPlate(
      'B 34 BAU / B 34 BAU\nTencuiala TM 40 kg (35/pal) 280.00 sac',
    )).toBe('B-34-BAU');
    expect(canonicalPlate(
      'B 207 TRK / B 207 TRK\nTencuiala TM 40 kg (35/pal)',
    )).toBe('B-207-TRK');
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

  it('does not drop the foreign tractor for the RO trailer (#60)', () => {
    const found = extractPlate(`
Aviz de expeditie rezumat: TPO-0033258
Transportator: RAI-SPEDITION SRL
Placuta de inmatriculare: CA 4471 KX / B 63 RTX
Nume sofer: Georgiev Stoyan
`);
    expect(found.value).toBe('CA-4471-KX / B-63-RTX');
    expect(found.value.startsWith('CA-4471-KX')).toBe(true);
  });

  it('rejects a plate-shaped string without a real county', () => {
    expect(extractPlate('QQ 12 XYZ').value).toBeNull();
    expect(extractPlate('CJ 12 XYZ').value).toBe('CJ-12-XYZ');
  });

  it('rejects TM-40-KG from the goods table (#52)', () => {
    expect(extractPlate('Tencuiala TM 40 kg (35/pal)').value).toBeNull();
    expect(extractPlate(
      'Placuta IF 14 RAI / IF 14 RAI\nTencuiala TM 40 kg',
    ).value).toBe('IF-14-RAI');
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
    expect(extractDate('Data: 10.03.2026', { asOf: '2026-10-08' }).value).toBe('2026-03-10');
  });

  it('reads ISO', () => {
    expect(extractDate('2026-03-10', { asOf: '2026-10-08' }).value).toBe('2026-03-10');
  });

  it('reads a Romanian month name', () => {
    expect(extractDate('10 mar 2026', { asOf: '2026-10-08' }).value).toBe('2026-03-10');
  });

  it('rejects an impossible date', () => {
    expect(extractDate('45.99.2026', { asOf: '2026-10-08' }).value).toBeNull();
  });

  it('repairs OCR year 2020→2026 when 6 was read as 0 (#77)', () => {
    // IMG-20261002-WA0045/0046: header 02.10.2026 under cool light → OCR 02.10.2020.
    const labelled = extractDate('Data avizului de expeditie: 02.10.2020', { asOf: '2026-10-08' });
    expect(labelled.value).toBe('2026-10-02');
    expect(labelled.confidence).toBeLessThanOrEqual(0.55);

    const withTime = extractDate('Data aviz de expeditie: 02.10.2020 05:48', { asOf: '2026-10-08' });
    expect(withTime.value).toBe('2026-10-02');

    // Correct 2026 stays high confidence.
    const ok = extractDate('Data avizului de expeditie: 02.10.2026', { asOf: '2026-10-08' });
    expect(ok.value).toBe('2026-10-02');
    expect(ok.confidence).toBeGreaterThanOrEqual(0.9);

    // A recent-enough OCR year is kept (no inventing 2026 from 2025).
    expect(extractDate('Data: 02.10.2025', { asOf: '2026-10-08' }).value).toBe('2025-10-02');
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

  it('reads Montaro photo OCR when the thousands comma becomes a second dot (#51)', () => {
    // WA0014 / WA0018 / WA0019: printed `21,326.48` often OCR'd as `21.326.48`.
    const wa0014 = 'Greutate neta, kg: 20.950.00\nGreutate bruta, kg: 21.326.48';
    const wa0018 = 'Greutate neta, kg 5.280.88\nGreutate bruta, kg 5.560.68';
    const wa0019 = 'Greutate neta, kg: 1.440.15\nGreutate bruta, kg: 1.528.06';
    expect(extractGrossWeight(wa0014).value).toBe(21326.48);
    expect(extractNetWeight(wa0014).value).toBe(20950);
    expect(extractGrossWeight(wa0018).value).toBe(5560.68);
    expect(extractNetWeight(wa0018).value).toBe(5280.88);
    expect(extractGrossWeight(wa0019).value).toBe(1528.06);
    expect(extractNetWeight(wa0019).value).toBe(1440.15);
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

  it('prefers handwritten qty/gross when the page says corectat (#65)', () => {
    const text = `
Aviz de expeditie: PSL-0062041
Comanda de transport: TPO-0033200
11001457 Adeziv FlexBond 25 kg (54/pal) 432.00 sac 400
8.00 pal
corectat la incarcare
Greutate neta: 10,800.00 kg
Greutate bruta: 10,993.83 kg 10.193,83
`;
    expect(detectHandCorrection(text).present).toBe(true);
    expect(extractQuantity(text).value).toEqual({ quantity: 400, unit: 'saci' });
    expect(extractQuantity(text).confidence).toBeLessThan(0.9);
    expect(extractGrossWeight(text).value).toBe(10193.83);
    expect(extractGrossWeight(text).confidence).toBeLessThan(0.9);
  });

  it('still flags corectat even when OCR keeps only the printed figures (#65)', () => {
    const text = `
432.00 sac
corectat la incarcare
Greutate bruta, kg 10,993.83
`;
    expect(detectHandCorrection(text).present).toBe(true);
    expect(extractQuantity(text).value.quantity).toBe(432);
    expect(extractQuantity(text).confidence).toBeLessThanOrEqual(0.55);
    expect(extractGrossWeight(text).value).toBe(10993.83);
    expect(extractGrossWeight(text).confidence).toBeLessThanOrEqual(0.55);
  });

  it('reads quantity on a pallet-only return (pce is the goods) (#64)', () => {
    const text = `
Aviz de expeditie rezumat: TPO-0033293
Aviz de expeditie TRO-0010370
Observatii: Retur paleti goi
11000001 Palet Euro returnabil 15.00 pce
Greutate neta: 337,50 kg
Greutate bruta: 337,50 kg
`;
    expect(extractQuantity(text).value).toEqual({ quantity: 15, unit: 'paleti' });
    expect(extractGoodsUnit(text).value).toBe('paleti');
    const doc = extractDocument(text, { documentType: 'aviz' });
    expect(doc.values.quantity).toBe(15);
    expect(doc.values.tip_marfa).toBe('paleti');
  });

  it('reads BCA volume in m³ and ignores euro-pallet pce (#63)', () => {
    // Trailing digit of "m3" used to glue onto the next line's "Palet" → fake 3 paleți.
    const text = `
Aviz de expeditie: PSL-0062100
BCA Montaro 600x250x200 mm, 28.80 m³
Palet Euro returnabil 20.00 pce
Greutate bruta: 12,000.00 kg
`;
    expect(extractQuantity(text).value).toEqual({ quantity: 28.8, unit: 'm³' });
    expect(extractGoodsUnit(text).value).toBe('m³');
    const doc = extractDocument(text, { documentType: 'aviz' });
    expect(doc.values.quantity).toBe(28.8);
    expect(doc.values.tip_marfa).toBe('m³');
    expect(doc.values.quantity_unit).toBe('m³');
  });

  it('sums sac lines split across rows under night / table OCR (#76)', () => {
    // IMG-20261002-WA0044: yellow ceiling light; figure and "sac" often land on consecutive lines.
    const split = `
Aviz de expeditie: PSL-0062309
Comanda de transport: TPO-0033516
Placuta: AG 88 DMX
11000151 Tencuiala TM 40 kg (35/pal)
210.00
sac
6.00
pal
11000146 MPX 35 40 kg (35/pal)
140.00
sac
4.00
pal
11000001 Palet Euro returnabil
10.00
pce
Greutate neta, kg: 14,000.00
Greutate bruta, kg: 14,253.78
`;
    expect(extractQuantity(split).value).toEqual({ quantity: 350, unit: 'saci' });
    expect(extractGoodsUnit(split).value).toBe('saci');
    const doc = extractDocument(split, { documentType: 'aviz' });
    expect(doc.values.quantity).toBe(350);
    expect(doc.values.tip_marfa).toBe('saci');
    // Must not invent 3 paleți from "m3\\nPalet" style glue (#63 regression).
    const m3 = `
BCA Montaro 28.80 m3
Palet Euro returnabil 20.00 pce
`;
    expect(extractQuantity(m3).value).toEqual({ quantity: 28.8, unit: 'm³' });
  });

  it('recovers bag count from net ÷ bag kg when sac is washed out (#76)', () => {
    const washed = `
Aviz de expeditie: PSL-0062309
Comanda de transport: TPO-0033516
11000151 Tencuiala TM 40 kg (35/pal) 210.00 6.00
11000146 MPX 35 40 kg (35/pal) 140.00 4.00
11000001 Palet Euro returnabil 10.00
Greutate neta, kg: 14,000.00
Greutate bruta, kg: 14,253.78
`;
    const q = extractQuantity(washed);
    expect(q.value).toEqual({ quantity: 350, unit: 'saci' });
    expect(q.confidence).toBeLessThanOrEqual(0.55);
    expect(extractGoodsUnit(washed).value).toBe('saci');
  });

  it('sums saci + găleți (buc) on a mixed sheet and skips euro-pallet (#62)', () => {
    // PSL-0062056: 7× sac (401) + 6× buc găleți (197) + 15 pce paleți.
    const text = `
Aviz de expeditie: PSL-0062056
54.00 sac Adeziv FlexBond
54.00 sac Adeziv FlexBond
108.00 sac Beton Montaro
54.00 sac Nivela Quattro
54.00 sac Tencuiala
42.00 sac Tencuiala
35.00 sac Tencuiala
24.00 buc UniBaza Grund
24.00 buc SilikoTop
48.00 buc Glet FinoLux
24.00 buc FinishPro
44.00 buc HidroStop
33.00 buc Vopsea lavabila
15.00 pce Palet Euro returnabil
Greutate bruta: 14,807.89 kg
`;
    expect(extractQuantity(text).value).toEqual({ quantity: 598, unit: 'saci/galeti' });
    expect(extractGoodsUnit(text).value).toBe('saci/galeti');
    const doc = extractDocument(text, { documentType: 'aviz' });
    expect(doc.values.quantity).toBe(598);
    expect(doc.values.tip_marfa).toBe('saci/galeti');
    expect(doc.values.quantity_unit).toBe('saci/galeti');
  });

  it('keeps a single product line and ignores euro-pallet pce', () => {
    const text = 'Cantitate 72.00 buc SuperPrimer\n3.00 pce Palet Euro returnabil';
    expect(extractQuantity(text).value).toEqual({ quantity: 72, unit: 'galeti' });
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
    expect(extractQuantity(text).value).toEqual({ quantity: 72, unit: 'galeti' });
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
    expect(doc.values.tip_marfa).toBe('galeti');
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
    expect(extractQuantity(text).value).toEqual({ quantity: 72, unit: 'galeti' });
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

  it('rejects a tiny gross weight that is usually CMR box 12 (#66)', () => {
    expect(isPlausibleLoadWeightKg(12)).toBe(false);
    expect(isPlausibleLoadWeightKg(14844)).toBe(true);
    expect(extractGrossWeight('Greutate bruta: 12 kg').value).toBeNull();
    expect(extractGrossWeight('Greutate bruta: 14844 kg').value).toBe(14844);
  });

  it('repairs a digit dropped under a stain when ×10 lands above net (#73 / #74)', () => {
    // Stain on the thousands place: paper 17.004,82 → OCR 1.704,82; net stays 16.700,88.
    const stained = `
Greutate neta, kg: 16.700,88
Greutate bruta, kg: 1.704,82
`;
    expect(extractNetWeight(stained).value).toBe(16700.88);
    const repaired = extractGrossWeight(stained);
    expect(repaired.value).toBe(17048.2);
    expect(repaired.confidence).toBeLessThanOrEqual(0.55);
    const ok = `
Greutate neta, kg: 16.700,88
Greutate bruta, kg: 17.004,82
`;
    expect(extractGrossWeight(ok).value).toBe(17004.82);
  });

  it('recovers greutate brută under a translucent coffee stain (#74)', () => {
    // IMG-20261003-WA0047: net clean, gross under stain — OCR may drop a digit, glue decimals,
    // or space the groups. Paper shows 6,994.45 / 6.640,15.
    const droppedDigit = `
Greutate neta, kg: 6,640.15
Greutate bruta, kg: 699.45
`;
    const d = extractGrossWeight(droppedDigit);
    expect(d.value).toBe(6994.5);
    expect(d.confidence).toBeLessThanOrEqual(0.55);

    const glued = `
Greutate neta, kg: 6,640.15
Greutate bruta, kg: 6.99445
`;
    expect(extractGrossWeight(glued).value).toBe(6994.45);

    const spaced = `
Greutate neta, kg: 6,640.15
Greutate bruta, kg: 6 994 45
`;
    expect(extractGrossWeight(spaced).value).toBe(6994.45);

    const clean = `
Greutate neta, kg: 6,640.15
Greutate bruta, kg: 6,994.45
`;
    expect(extractGrossWeight(clean).value).toBe(6994.45);
    expect(extractGrossWeight(clean).confidence).toBeGreaterThanOrEqual(0.9);

    // Completely empty after the label — leave null (validation forces HITL).
    const hollow = `
Greutate neta, kg: 6,640.15
Greutate bruta, kg:
`;
    expect(extractGrossWeight(hollow).value).toBeNull();
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
    // Tip marfă is packaging only — never the MPI product line.
    expect(String(result.values.tip_marfa || '')).toMatch(/^(saci|galeti|paleti|bucati)$/i);
    expect(String(result.values.tip_marfa || '')).not.toMatch(/MP[I1]|38245090/i);
  });

  it('does not put Produs / Cantitate / SKU into Rută transport (#70)', () => {
    const text = `
Aviz de expeditie: PSL-0056700
Comanda de transport: TPO-0032700
Expeditor Site: BOL Depozit: DEAL
Adresa de livrare / Ruta Str. Bucuresti
Produs Cantitate UM
FinoGrande 20 kg 48.00 sac
Greutate bruta: 1.000,00 kg
Placuta de inmatriculare: B 220 KLM
`;
    const result = extractDocument(text);
    expect(result.values.ruta_transport || '').toMatch(/Bucuresti/i);
    expect(result.values.ruta_transport || '').not.toMatch(/Produs|Cantitate|FinoGrande/i);
    expect(result.values.numar_document_marfa).toBe('PSL-0056700');
  });

  it('keeps Expeditor street + delivery on PSL when profile would be generic (#80)', () => {
    // IMG-20261002-WA0046 (PSL-0062317): BOL Industriei → Rebreanu. Without Baumit in OCR,
    // aviz_generic used to leave only the delivery leg (or nothing).
    const text = `
Aviz de expeditie: PSL-0062317
Data avizului de expeditie: 02.10.2026
Expeditor
Site: BOL Bolintin
Str. Industriei, nr. 7 Bolintin-Deal RO 087015 ROU
Adresa de livrare
CS-TITAN- OBI LIVIU REBREANU
Strada Liviu Rebreanu nr. 13
Bucuresti Sector 3 RO 031783, ROU
Comanda de transport: TPO-0033531
Placuta de inmatriculare B 615 TXA / B 615 TXA
216.00 sac Beton Montaro
Greutate bruta: 8,263.17 kg
`;
    const result = extractDocument(text, { documentType: 'aviz' });
    expect(result.values.ruta_transport).toBe(
      'Str. Industriei nr. 7, Bolintin-Deal / Str. Liviu Rebreanu nr. 13, Bucuresti',
    );
    expect(result.values.ruta_transport).toMatch(/Industriei/i);
    expect(result.values.ruta_transport).toMatch(/Rebreanu/i);
  });

  it('recovers Expeditor street when the Expeditor heading is missing from OCR (#80)', () => {
    const text = `
Aviz de expeditie: PSL-0062317
Site: BOL Bolintin
Str. Industriei, nr. 7 Bolintin-Deal RO 087015 ROU
Adresa de livrare
Strada Liviu Rebreanu nr. 13
Bucuresti Sector 3 RO 031783 ROU
TPO-0033531 B 615 TXA 216.00 sac
`;
    const result = extractDocument(text, { documentType: 'aviz' });
    expect(result.values.ruta_transport).toMatch(/Industriei/i);
    expect(result.values.ruta_transport).toMatch(/Rebreanu/i);
    expect(result.values.ruta_transport).not.toMatch(/^BOL\s*\//);
  });

  it('repairs MIMARFA / Bolintin-Dina / Industriului on night OCR routes (#79)', () => {
    // IMG-20261002-WA0045: grainy night photo — MMARFA→MIMARFA, Deal→Dina, Industriei→Industriului.
    const text = `
Aviz de expeditie rezumat: TPO-0033523
Data aviz de expeditie: 02.10.2026 05:48
Expeditor Site: MIL Depozit: MIMARFA
Adresa de livrare: BOL MBMARFA Bolintin
Str. Industriului, nr. 7 Bolintin-Dina RO 087015 ROU
Placuta: B 29 NKL / B 81 NKL
Aviz de expeditie TRO-0010609
Greutate neta, kg: 3,360.00
Greutate bruta, kg: 3,526.78
`;
    const result = extractDocument(text, { documentType: 'aviz' });
    expect(result.values.ruta_transport).toBe('MIL-MMARFA / Str. Industriei nr. 7, Bolintin-Deal');
    expect(result.values.ruta_transport).not.toMatch(/MIMARFA|Bolintin-Dina|Industriului/i);
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
  it('does not take house number 220 as document number when TRO is on the page (#54)', () => {
    // Rezumat: "Bvd. Iuliu Maniu, nr. 220" sat next to aviz/nr. patterns; generic profile
    // used to capture "220" before TRO-0010203.
    const rezumat = `
Aviz de expeditie rezumat: TPO-0032741
Expeditor Site: MIL Depozit: MMARFA
Adresa de livrare
MIL DEPOZIT Militari
Bvd. Iuliu Maniu, nr. 220 Bucuresti Sector 6 RO 061101 ROU
Transportator RAI-SPEDITION SRL
Placuta de inmatriculare PH 09 ZTM / PH 22 ZTM
Aviz de expeditie TRO-0010203
Comanda de transfer TRO-0010203
Greutate neta, kg 5.280,88
Greutate bruta, kg 5.560,68
`;
    const asTro = extractDocument(rezumat, { documentType: 'aviz' });
    expect(asTro.values.numar_document_marfa).toBe('TRO-0010203');
    expect(asTro.values.numar_document_marfa).not.toBe('220');

    const asGeneric = extractDocument(rezumat, { profileId: 'aviz_generic' });
    expect(asGeneric.values.numar_document_marfa).toBe('TRO-0010203');
    expect(asGeneric.values.numar_document_marfa).not.toBe('220');
  });

  it('recovers TRO document number when glare OCR turns it into TPO (#75)', () => {
    // IMG-20261001-WA0043: TPO-0033508 in the rezumat title; TRO-0010601 under
    // „Aviz de expediție” / „Comanda de transfer” washed out → often read as TPO-0010601.
    const glare = `
Aviz de expeditie rezumat: TPO-0033508
01.10.2026 07:15
Expeditor Site / Depozit: MIL / NEAMTIU
Adresa de livrare: MIL DEPOZIT Militari, Bvd. Iuliu Maniu, nr. 220 Bucuresti Sector 6
Transportator: RAI-SPEDITION SRL
Placuta: IF 51 GTR / IF 51 GTR
Aviz de expeditie TPO-0010601
Comanda de transfer TPO-0010601
Greutate neta, kg: 3,600.00
Greutate bruta, kg: 3,770.90
Numarul de galeti: 168.00
`;
    const result = extractDocument(glare, { documentType: 'aviz' });
    expect(result.values.numar_tpo).toBe('TPO-0033508');
    expect(result.values.numar_document_marfa).toBe('TRO-0010601');

    const iro = glare.replace(/TPO-0010601/g, 'IRO-0010601');
    expect(extractDocument(iro, { documentType: 'aviz' }).values.numar_document_marfa).toBe('TRO-0010601');
  });

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
    expect(result.values.numar_tpo).toBe('TPO-0031027');
    expect(result.values.numar_document_marfa).toMatch(/TRO/i);
    // Padded to 7 digits — same form as printed TPO-0032xxx on the annex (#55).
    expect(result.fields.numar_tpo.status).toBe('ok');
  });

  it('reads handwritten TPO on the line below the blank transport-order label', () => {
    const hybrid = `
Aviz de expeditie TRO-0009884 Baumit
Num de comanda de transport:
TPO / 31027
Auto: B 112 VFM
`;
    const result = extractDocument(hybrid, { documentType: 'aviz' });
    expect(result.values.numar_tpo).toBe('TPO-0031027');
  });

  it('zero-pads handwritten TPO/32755 to seven digits (#55)', () => {
    const hybrid = `
Aviz de expeditie: TRO-0010215
Num de comanda de transport: TPO/32755
Greutate neta, kg: 1,440.15
Greutate bruta, kg: 1,528.06
`;
    const result = extractDocument(hybrid, { documentType: 'aviz' });
    expect(result.values.numar_tpo).toBe('TPO-0032755');
    expect(result.fields.numar_tpo.status).toBe('ok');
  });

  /**
   * Stamp / rotation can hide "Comandă de transport TPO-…". A bare `NNNN/YYYY` from
   * `Nr. Reg. Com.: J00/0000/2000` must not become Număr TPO (#58).
   */
  it('does not take Nr. Reg. Com. 0000/2000 as TPO when the real code is missing (#58)', () => {
    const text = `
Aviz de expeditie: PSL-0062011
Data avizului de expeditie: 29.09.2026
Comanda de transport
Placuta de inmatriculare: B 218 KPN / B 218 KPN
Greutate bruta, kg: 1,528.06
Montaro Romania Com SRL
Nr. Reg. Com.: J00/0000/2000 | CUI: RO000000000
`;
    const result = extractDocument(text, { documentType: 'aviz' });
    expect(result.values.numar_tpo).toBeUndefined();
    expect(result.fields.numar_tpo?.status ?? 'missing').toBe('missing');
    expect(result.needs_review).toBe(true);
    expect(result.review_fields).toContain('numar_tpo');
  });

  it('still reads a clear printed TPO when the commercial-register footer is present (#58)', () => {
    const text = `
Aviz de expeditie: PSL-0062048
Comanda de transport TPO-0033193
Placuta de inmatriculare: B 218 KPN
Nr. Reg. Com.: J00/0000/2000 | CUI: RO00000000
`;
    const result = extractDocument(text, { documentType: 'aviz' });
    expect(result.values.numar_tpo).toBe('TPO-0033193');
  });

  /**
   * Dark photo: structural regex still yields a 7-digit TPO at high confidence, but the OCR
   * block that carries the digits is weak. Without blending, HITL auto (0.90) never fires (#56).
   */
  it('caps TPO confidence when the matching OCR block is weak (#56)', () => {
    const text = `
BAUMIT ROMANIA SRL
AVIZ DE INSOTIRE A MARFII
Nr. document PSL 4417/2026
TPO 2026-1088
Data: 12.03.2026
Auto: B 112 VFM
`;
    const blocks = [
      { page: 1, type: 'line', text: 'TPO 2026-1088', confidence: 0.62 },
      { page: 1, type: 'line', text: 'Auto: B 112 VFM', confidence: 0.91 },
    ];
    const result = extractDocument(text, { documentType: 'aviz', blocks });
    expect(result.values.numar_tpo).toBe('TPO-2026-1088');
    expect(result.fields.numar_tpo.confidence).toBeLessThan(0.9);
    expect(result.fields.numar_tpo.block_confidence).toBe(0.62);
    expect(result.needs_review).toBe(true);
    expect(result.review_fields).toContain('numar_tpo');
  });

  it('caps critical fields from a weak page mean when no block matches the value (#56)', () => {
    const fields = {
      numar_tpo: { value: 'TPO-0010888', confidence: 0.95, matched: 'TPO 0010888', status: 'ok' },
      numar_auto: { value: 'B-112-VFM', confidence: 0.92, matched: 'B 112 VFM', status: 'ok' },
    };
    // Blocks do not contain the TPO digits (OCR misread), but page mean is weak.
    const blocks = [
      { text: 'Aviz de expeditie', confidence: 0.55 },
      { text: 'Greutate bruta', confidence: 0.7 },
    ];
    refineFieldsWithBlocks(fields, blocks);
    // Cap is CRITICAL auto − 0.01 (0.89), not the page-mean threshold itself.
    expect(fields.numar_tpo.confidence).toBe(0.89);
    expect(fields.numar_tpo.status).toBe('ok'); // ACCEPT is 0.80; HITL still needs review via criticalReview
    expect(fields.numar_auto.confidence).toBe(0.89);
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

  it('reads a handwritten CMR on /avize without carnet box mapping (#66)', () => {
    expect(looksLikeCmrDocument(CMR_HANDWRITTEN_BOXES)).toBe(true);
    expect(detectProfile(CMR_HANDWRITTEN_BOXES, { documentType: 'aviz' }).profile?.id).toBe('aviz_cmr');
    const result = extractDocument(CMR_HANDWRITTEN_BOXES, { documentType: 'aviz' });
    expect(result.profile_id).toBe('aviz_cmr');
    expect(result.values.numar_document_marfa).toBe('0247315');
    expect(result.values.ruta_transport).toMatch(/Ploiesti/i);
    expect(result.values.ruta_transport).toMatch(/Giurgiului/i);
    expect(result.values.ruta_transport).toMatch(/Bucuresti/i);
    expect(result.values.tip_marfa).toBe('saci');
    expect(result.values.quantity).toBe(720);
    expect(result.values.gross_weight_kg).toBe(14844);
    expect(result.values.net_weight_kg ?? null).toBeNull();
    expect(result.values.gross_weight_kg).not.toBe(12);
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
    // Keep gross above net (8.244 kg) — a figure below net is refused as OCR damage (#73).
    const again = reExtract(PSL_AVIZ.replace('9.000 kg', '8.500 kg'), {
      corrections: corrected.values,
      correctedFields: corrected.corrected_fields,
    });
    expect(again.values.gross_weight_kg).toBe(8500);
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

  it('keeps găleți when OCR footer misreads Numărul de găleți as paleți (#82)', () => {
    // IMG-20261006-WA0056: 144+48 buc, euro 8 pce, footer total 192 — OCR often writes paleți.
    const text = `
Aviz de expeditie rezumat: TPO-0033610
11000436 BetonKontakt Plus 20 kg (24/pal) 144.00 buc
11000447 UniBaza Grund 20 kg (24/pal) 48.00 buc
11000001 Palet Euro returnabil 8.00 pce
Greutate neta, kg 3,840.00
Greutate bruta, kg 4,038.63
Numarul de paleti 192.00
Paleti la locul livrarii: predare ......... pce / preluare ......... pce
`;
    expect(extractGoodsUnit(text).value).toBe('galeti');
    expect(extractQuantity(text).value).toEqual({ quantity: 192, unit: 'galeti' });
    const doc = extractDocument(text, { documentType: 'aviz' });
    expect(doc.values.tip_marfa).toBe('galeti');
    expect(doc.values.quantity).toBe(192);
    expect(doc.values.tip_marfa).not.toBe('paleti');
  });

  it('still reads a true Numărul de paleți return as paleți (#82)', () => {
    const text = `
Retur paleți goi
11000001 Palet Euro returnabil 15.00 pce
Numarul de paleti 15.00
`;
    expect(extractGoodsUnit(text).value).toBe('paleti');
    expect(extractQuantity(text).value).toEqual({ quantity: 15, unit: 'paleti' });
  });

  it('ranks a named packaging above a bare count wherever they appear', () => {
    // sac + buc on one page is a mixed load (#62), not “saci wins and buc disappears”.
    expect(extractGoodsUnit('768 buc, 420 saci').value).toBe('saci/galeti');
    expect(extractGoodsUnit('18 paleti si 768 buc').value).toBe('paleti');
  });

  it('offers a bare count for review rather than writing it unattended', () => {
    // 0.4 sits under ACCEPT_CONFIDENCE, so "bucati" reaches an operator instead of the annex.
    const bare = extractGoodsUnit('Cantitate 768.00 buc');
    expect(bare.value).toBe('bucati');
    expect(bare.confidence).toBeLessThan(ACCEPT_CONFIDENCE);
  });

  it('treats TRO table `buc` as găleți when Numărul de găleți is missing (#57)', () => {
    const unibaza = `
Aviz de expeditie: TRO-0010215
Adresa de livrare
Str. Industriei, nr. 7 Bolintin-Deal
Num de comanda de transport: TPO/32755
1 11000447 UniBaza Grund 20 kg (24/pal) 72.00 buc
2 11000001 Palet Euro returnabil 3.00 pce
Greutate neta, kg: 1,440.15
Greutate bruta, kg: 1,528.06
`;
    const a = extractDocument(unibaza, { documentType: 'aviz' });
    expect(a.values.quantity).toBe(72);
    expect(a.values.tip_marfa).toBe('galeti');
    expect(a.values.quantity_unit).toBe('galeti');

    const mixed = `
Aviz de expeditie: TRO-0010238
1 11001371 SilikoTop 1.5 K 25 kg (24/pal) 48.00 buc
2 11000455 Glet FinoLux Superior20KG (24/pal) 24.00 buc
3 11000001 Palet Euro returnabil 3.00 pce
Greutate neta, kg: 1,680.15
Greutate bruta, kg: 1,770.31
`;
    const b = extractDocument(mixed, { documentType: 'aviz' });
    expect(b.values.quantity).toBe(72);
    expect(b.values.tip_marfa).toBe('galeti');
    expect(b.values.quantity_unit).toBe('galeti');
  });

  it('never reads a weight as a kind of goods', () => {
    expect(extractGoodsUnit('Greutate bruta, kg 15,744.00').value).toBeNull();
    expect(extractGoodsUnit('9,5 t').value).toBeNull();
  });

  it('keeps tip marfa as packaging, not the product row', () => {
    const text = `
BAUMIT ROMANIA SRL
AVIZ DE INSOTIRE A MARFII
Aviz de expeditie: PSL-0044999
TPO-0025999
Cantitate 245.00 sac MPI Adeziv 25 kg
Numarul de saci 245.00
`;
    const tip = extractDocument(text, { documentType: 'aviz' }).values.tip_marfa;
    expect(tip).toBe('saci');
    expect(String(tip)).not.toMatch(/MPI|Adeziv/i);
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
    expect(values.tip_marfa).toBe('galeti');
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
    expect(values.numar_tpo).toBe('TPO-0000230');
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

  it('reads volume on guide slot 7 as Cantitate m³ (#69)', () => {
    // ASCII `m3` (handwriting OCR rarely emits ³). Old carnet unit class stopped at `m`.
    const sheet = [
      'CARNET DE BORD (ghid 1-14)',
      '1. TPO-0032706',
      '2. 10.10.2026',
      '3. -',
      '4. B 220 KLM',
      '5. Bol -> Targoviste',
      '6. nisip sortat',
      '7. 18.5 m3',
      '8. 26500',
      '9. 25800',
      '10. PSL-0056706',
      '11. 1',
      '12. -',
      '13. -',
      '14. -',
    ].join('\n');
    const { values } = extractDocument(sheet, { profileId: 'carnet_bord' });
    expect(values.quantity).toBe(18.5);
    expect(values.quantity_unit).toBe('m³');
    expect(values.tip_marfa).toMatch(/nisip/i);
    expect(values.gross_weight_kg).toBe(26500);
    expect(values.numar_document_marfa).toBe('PSL-0056706');
  });

  it('remaps a short carnet when the driver skips Valoare TPO (#68)', () => {
    // Real cab photos: indices 1–9 without guide slot 3 (valoare), so plate sits on 3, route on 4, …
    const shortA = [
      'CARNET DE BORD',
      '1. TPO-0032601',
      '2. 09.10.2026',
      '3. B 112 VFM',
      '4. Bol -> Ploiesti',
      '5. nisip',
      '6. 15.5 m3',
      '7. Greutate 28000 kg',
      '8. PSL-0056601',
      '9. 1 cursa',
    ].join('\n');
    const a = extractDocument(shortA, { profileId: 'carnet_bord' });
    expect(a.values.numar_tpo).toBe('TPO-0032601');
    expect(a.values.data_efectuare_cursa).toBe('2026-10-09');
    expect(a.values.valoare_tpo ?? null).toBeNull();
    expect(a.values.numar_auto).toBe('B-112-VFM');
    expect(a.values.ruta_transport).toMatch(/Ploiesti/i);
    expect(a.values.tip_marfa).toMatch(/nisip/i);
    expect(a.values.quantity).toBe(15.5);
    expect(a.values.gross_weight_kg).toBe(28000);
    expect(a.values.net_weight_kg ?? null).toBeNull();
    expect(a.values.numar_document_marfa).toBe('PSL-0056601');
    expect(a.values.numar_curse).toBe(1);
    // The old index map put plate digits into Valoare TPO and PSL into greutate.
    expect(a.values.valoare_tpo).not.toBe(112);
    expect(a.values.gross_weight_kg).not.toBe(56705);
    expect(a.values.gross_weight_kg).not.toBe(56601);

    const shortB = [
      'CARNET DE BORD',
      '1. TPO-0032705',
      '2. 10.10.2026',
      '3. CJ 45 XYZ',
      '4. Bol -> Pitesti',
      '5. balast',
      '6. 22.0 m3',
      '7. Greutate 31000 kg',
      '8. PSL-0056705',
      '9. 1 cursa',
    ].join('\n');
    const b = extractDocument(shortB, { profileId: 'carnet_bord' });
    expect(b.values.numar_tpo).toBe('TPO-0032705');
    expect(b.values.numar_auto).toBe('CJ-45-XYZ');
    expect(b.values.ruta_transport).toMatch(/Pitesti/i);
    expect(b.values.tip_marfa).toMatch(/balast/i);
    expect(b.values.quantity).toBe(22);
    expect(b.values.gross_weight_kg).toBe(31000);
    expect(b.values.net_weight_kg ?? null).toBeNull();
    expect(b.values.numar_document_marfa).toBe('PSL-0056705');
    expect(b.values.numar_curse).toBe(1);
    expect(b.values.ruta_transport).not.toMatch(/balast/i);
    expect(b.values.tip_marfa).not.toMatch(/kg/i);
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
