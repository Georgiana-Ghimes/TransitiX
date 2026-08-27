import { describe, expect, it } from 'vitest';
import { normalizeOcrText } from './normalizeOcrText.js';

describe('normalizeOcrText', () => {
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

  it('spaces a glued Romanian plate', () => {
    expect(normalizeOcrText('Placuta B330SRS.')).toContain('B 330 SRS');
  });

  it('leaves unrelated text alone', () => {
    expect(normalizeOcrText('hello world')).toBe('hello world');
  });
});
