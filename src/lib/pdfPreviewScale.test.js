import { describe, expect, it } from 'vitest';
import { pdfPageScale } from './pdfPreviewScale.js';

describe('pdfPageScale', () => {
  it('fits the page to the pane and caps the upscale', () => {
    expect(pdfPageScale(600, 600)).toBe(1);
    expect(pdfPageScale(900, 600)).toBe(1.5);
    expect(pdfPageScale(200, 600)).toBe(0.5);
    expect(pdfPageScale(2000, 400)).toBe(2);
  });

  it('does not invent a scale before the pane has a width', () => {
    expect(pdfPageScale(0, 600)).toBe(1);
    expect(pdfPageScale(400, 0)).toBe(1);
  });
});
