import { describe, expect, it } from 'vitest';
import { normalizeOcrText, sanitizeOcrText } from './normalizeOcrText.js';

describe('sanitizeOcrText (provider boundary)', () => {
  it('drops control and zero-width characters, keeps newlines and tab cell borders', () => {
    // NUL → tab (PDF column marker); BEL and other controls still dropped.
    expect(sanitizeOcrText('TPO\u200B-0025629\u0000\u0007\r\nB 330 SRS\tkm')).toBe('TPO-0025629\t\nB 330 SRS\tkm');
  });

  it('turns PDF NUL column separators into tabs (reportlab Adresa|Client)', () => {
    const raw = [
      'Adresa de livrare\u0000Client',
      'Bulevardul Timisoara nr. 26\u0000Strada Locotenent Moga nr. 18',
      'Timisoara RO 061344\u0000Fundeni RO 077086',
    ].join('\n');
    const out = sanitizeOcrText(raw);
    expect(out).toContain('Adresa de livrare\tClient');
    expect(out).toContain('Bulevardul Timisoara nr. 26\tStrada Locotenent Moga nr. 18');
    expect(out).toContain('Timisoara RO 061344\tFundeni RO 077086');
    expect(out).not.toMatch(/061344Fundeni/);
  });

  it('keeps Baumit Adresa|Client tabs so delivery is not glued to the Client seat', () => {
    const raw = [
      'Adresă de livrare\tClient',
      'str Garlei nr.10\tALEEA TERASEI NR.5',
      'Potiogi RO 137370\tBucurești Sector 4 RO 041772',
    ].join('\n');
    const out = sanitizeOcrText(raw);
    expect(out).toContain('Adresă de livrare\tClient');
    expect(out).toContain('str Garlei nr.10\tALEEA TERASEI NR.5');
    expect(out).not.toMatch(/str Garlei nr\.10 ALEEA TERASEI/);
  });

  it('normalises unicode so a composed and a decomposed ș compare equal', () => {
    const composed = 'Expedi\u021Bie';
    const decomposed = 'Expedi\u0163ie'.normalize('NFD');
    expect(sanitizeOcrText(decomposed)).toBe(sanitizeOcrText(decomposed.normalize('NFC')));
    expect(sanitizeOcrText(composed)).toBe('Expediție');
  });

  it('flattens typographic quotes, dashes and odd spaces', () => {
    expect(sanitizeOcrText('„Baumit”\u00A0–\u00A0\u2018RAI\u2019 \u2212 5')).toBe('"Baumit" - \'RAI\' - 5');
  });

  it('removes markdown rulers, box drawing and symbol runs but keeps the content', () => {
    const md = '| Nr | Km |\n|----|----|\n| 1 | 420 |\n────────\nTotal ...... 420 ####';
    const out = sanitizeOcrText(md);
    expect(out).not.toMatch(/----/);
    expect(out).not.toMatch(/─/);
    expect(out).not.toMatch(/\.{4,}|#{4,}/);
    expect(out).not.toContain('|');
    expect(out).toContain('1');
    expect(out).toContain('420');
    expect(out).toContain('Total');
  });

  it('joins quantity and unit split across markdown table cells', () => {
    expect(sanitizeOcrText('| 11000444 | SuperPrimer | 72.00 | buc |')).toContain('72.00 buc');
    expect(sanitizeOcrText('Cantitate **72.00** buc')).toContain('72.00 buc');
  });

  it('caps blank lines and trims lines', () => {
    expect(sanitizeOcrText('  a  \n\n\n\n  b   c ')).toBe('a\n\nb c');
  });

  it('is idempotent', () => {
    const once = sanitizeOcrText('TP0-O0&5813 \u00AB x \u00BB\n\n\n\nend');
    expect(sanitizeOcrText(once)).toBe(once);
  });

  it('is a no-op on clean text and on empty input', () => {
    expect(sanitizeOcrText('PSL-0044362 B 330 SRS 12,5 t')).toBe('PSL-0044362 B 330 SRS 12,5 t');
    expect(sanitizeOcrText('')).toBe('');
    expect(sanitizeOcrText(null)).toBe('');
  });

  it('maps OCR German ä to Romanian ă so weight labels match (07.10.2026.BAU)', () => {
    const line = 'Greutate netä: 9,100.06 kg\tGreutate brutä: 9,317.90 kg';
    const out = sanitizeOcrText(line);
    expect(out).toContain('Greutate netă:');
    expect(out).toContain('Greutate brută:');
    expect(out).not.toMatch(/brutä|netä/);
  });

  it('maps OCR $ to Romanian ș / șt (Balote$i ← Balotești)', () => {
    expect(sanitizeOcrText('Str. Fabricii nr. 20, Balote$i RO 077040')).toContain('Balotești');
    expect(sanitizeOcrText('Balote$i')).toBe('Balotești');
    expect(sanitizeOcrText('pret $12')).toBe('pret $12');
  });
});

describe('normalizeOcrText street OCR fixes', () => {
  it('repairs Kepublicii → Republicii (TPO-0033490)', () => {
    expect(normalizeOcrText('Str. Kepublicii, nr. 1F Bolintin-Deal')).toContain('Republicii');
    expect(normalizeOcrText('Str. Kepublicii, nr. 1F Bolintin-Deal')).not.toMatch(/Kepublicii/i);
  });
});

describe('normalizeOcrText TRO misread as TPO', () => {
  it('repairs goods-table TPO back to TRO, keeps rezumat / transport header', () => {
    const raw = [
      'Aviz de expediție rezumat: TPO-0033395',
      'Num de comandă de transport TPO-0033395',
      'Comanda de transfer TPO-0010692',
      'Aviz de expediție TPO-0010692 Referinta client',
    ].join('\n');
    const out = normalizeOcrText(raw);
    expect(out).toContain('rezumat: TPO-0033395');
    expect(out).toContain('transport TPO-0033395');
    expect(out).toContain('Comanda de transfer TRO-0010692');
    expect(out).toContain('Aviz de expediție TRO-0010692');
  });
});

describe('normalizeOcrText', () => {
  it('runs the sanitiser first, so a zero-width inside a code does not hide it', () => {
    expect(normalizeOcrText('TP\u200B0-0025629')).toBe('TPO-0025629');
  });

  it('repairs glued PSL after a lowercase letter', () => {
    expect(normalizeOcrText('Aviz de expeditiePSL-0044362')).toContain('PSL-0044362');
  });

  it('repairs underscore-glued TPO', () => {
    expect(normalizeOcrText('Comanda de transport_TPO-0025629')).toContain('TPO-0025629');
  });

  it('repairs PS-###### handwriting miss of L', () => {
    expect(normalizeOcrText('Avioleexpelitie:PS-0044362')).toContain('PSL-0044362');
  });

  it('repairs TP0 as TPO', () => {
    expect(normalizeOcrText('TP0-0025629')).toBe('TPO-0025629');
  });

  it('repairs IRO / TRQ glare misreads as TRO (#75)', () => {
    expect(normalizeOcrText('Aviz IRO-0010601')).toContain('TRO-0010601');
    expect(normalizeOcrText('TRQ-0010601')).toContain('TRO-0010601');
  });

  it('repairs split sac under yellow / night wash (#76)', () => {
    expect(normalizeOcrText('210.00 s ac')).toContain('210.00 sac');
    expect(normalizeOcrText('140.00 sa c')).toContain('140.00 sac');
  });

  it('repairs letter O as zero in date years (#77)', () => {
    expect(normalizeOcrText('Data: 02.10.202O')).toContain('02.10.2020');
  });

  it('repairs MMARFA / Bolintin-Deal / Industriei under night OCR (#79)', () => {
    expect(normalizeOcrText('Depozit: MIMARFA')).toContain('MMARFA');
    expect(normalizeOcrText('BOL MBMARFA Bolintin')).toContain('MBMARFA');
    expect(normalizeOcrText('Bolintin-Dina RO 087015')).toContain('Bolintin-Deal');
    expect(normalizeOcrText('Str. Industriului, nr. 7')).toContain('Industriei');
  });

  it('repairs Bulevardul Piperii → Pipera (#89)', () => {
    expect(normalizeOcrText('Bulevardul Piperii nr. 1/VII')).toContain('Bulevardul Pipera');
    expect(normalizeOcrText('Bvd. Piperii nr. 1')).toContain('Bvd. Pipera');
    // Unrelated “Piperii” (without boulevard type) stays put.
    expect(normalizeOcrText('Magazin Piperii')).toBe('Magazin Piperii');
  });

  it('repairs handwritten TPO with a slash separator', () => {
    expect(normalizeOcrText('Num de comanda de transport: TPO / 31027')).toContain('TPO-31027');
    expect(normalizeOcrText('TPO/31027')).toContain('TPO-31027');
  });

  it('repairs handwriting TPO with O-as-zero and ampersand noise', () => {
    expect(normalizeOcrText('TPO-O025813')).toContain('TPO-0025813');
    expect(normalizeOcrText('TP0-O0&5813')).toMatch(/TPO-00\d{4,}/);
  });

  it('spaces a glued Romanian plate', () => {
    expect(normalizeOcrText('Placuta B330SRS.')).toContain('B 330 SRS');
  });

  it('repairs a handwritten plate whose zero was read as a letter', () => {
    expect(normalizeOcrText('B 33o SRS')).toContain('B 330 SRS');
    expect(normalizeOcrText('CJ 1l ABC')).toContain('CJ 11 ABC');
  });

  it('leaves a letters-only run alone rather than inventing a plate', () => {
    expect(normalizeOcrText('CS OOO SRL')).toBe('CS OOO SRL');
  });

  it('leaves unrelated text alone', () => {
    expect(normalizeOcrText('hello world')).toBe('hello world');
  });
});
