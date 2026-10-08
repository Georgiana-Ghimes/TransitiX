import { describe, expect, it } from 'vitest';
import { normalizeOcrText, sanitizeOcrText } from './normalizeOcrText.js';

describe('sanitizeOcrText (provider boundary)', () => {
  it('drops control and zero-width characters, keeps newlines and tabs', () => {
    expect(sanitizeOcrText('TPO\u200B-0025629\u0000\u0007\r\nB 330 SRS\tkm')).toBe('TPO-0025629\nB 330 SRS km');
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
