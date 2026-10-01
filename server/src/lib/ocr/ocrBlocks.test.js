import { describe, expect, it } from 'vitest';
import {
  BLOCKS_MAX,
  BLOCK_TEXT_MAX,
  normalizeBbox,
  normalizeBlock,
  normalizeConfidence,
  normalizePages,
} from './ocrBlocks.js';

describe('normalizeBbox', () => {
  it('reads the three spellings and an array', () => {
    expect(normalizeBbox({ x0: 1, y0: 2, x1: 3, y1: 4 })).toEqual({ x0: 1, y0: 2, x1: 3, y1: 4 });
    expect(normalizeBbox({ top_left_x: 1, top_left_y: 2, bottom_right_x: 3, bottom_right_y: 4 }))
      .toEqual({ x0: 1, y0: 2, x1: 3, y1: 4 });
    expect(normalizeBbox({ x: 1, y: 2, w: 2, h: 2 })).toEqual({ x0: 1, y0: 2, x1: 3, y1: 4 });
    expect(normalizeBbox([1, 2, 3, 4])).toEqual({ x0: 1, y0: 2, x1: 3, y1: 4 });
  });

  it('refuses a half-filled box rather than inventing a corner', () => {
    expect(normalizeBbox({ x0: 1, y0: 2 })).toBeNull();
    expect(normalizeBbox('nope')).toBeNull();
    expect(normalizeBbox(null)).toBeNull();
  });
});

describe('normalizeConfidence', () => {
  it('accepts a number, a percentage, an array and an object', () => {
    expect(normalizeConfidence({ confidence: 0.87 })).toBe(0.87);
    expect(normalizeConfidence({ confidence: 87 })).toBe(0.87);
    expect(normalizeConfidence({ confidence_scores: [0.8, 1] })).toBe(0.9);
    expect(normalizeConfidence({ confidence_scores: { text: 0.5, layout: 1 } })).toBe(0.75);
    expect(normalizeConfidence({})).toBeNull();
  });
});

describe('normalizePages', () => {
  it('flattens pages, keeps the page index and dimensions, caps text', () => {
    const long = 'x'.repeat(BLOCK_TEXT_MAX + 50);
    const blocks = normalizePages([
      { dimensions: { width: 1000, height: 1400 }, blocks: [{ type: 'text', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 }, text: 'TPO 2026-0311', confidence: 0.95 }] },
      { blocks: [{ markdown: long, bbox: [1, 1, 2, 2] }] },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ page: 0, text: 'TPO 2026-0311', confidence: 0.95, page_width: 1000, page_height: 1400 });
    expect(blocks[1].page).toBe(1);
    expect(blocks[1].text).toHaveLength(BLOCK_TEXT_MAX);
    expect(blocks[1].page_width).toBeNull();
  });

  it('stops at the cap', () => {
    const many = Array.from({ length: BLOCKS_MAX + 20 }, () => ({ text: 'a', bbox: [0, 0, 1, 1] }));
    expect(normalizePages([{ blocks: many }])).toHaveLength(BLOCKS_MAX);
  });

  it('survives a block with no bbox', () => {
    expect(normalizeBlock({ text: 'free' }, 3)).toMatchObject({ page: 3, bbox: null, text: 'free' });
  });
});
