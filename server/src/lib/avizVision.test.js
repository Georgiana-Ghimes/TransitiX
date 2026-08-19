import { describe, expect, it } from 'vitest';
import { isTextPoor } from './avizVision.js';

describe('avizVision', () => {
  it('treats short OCR as text-poor (Vision fallback)', () => {
    expect(isTextPoor('')).toBe(true);
    expect(isTextPoor('   hi  ')).toBe(true);
    expect(isTextPoor('x'.repeat(40))).toBe(false);
  });
});
