import { describe, expect, it } from 'vitest';
import {
  blockBox,
  blockRect,
  blocksForValue,
  containedRect,
  looseText,
  matchBlocksForValue,
  matchFields,
  valueCandidates,
} from './ocrBlocks.js';

const page = { page: 0, page_width: 1000, page_height: 1400 };
const blocks = [
  { ...page, text: 'Comanda de transport TP0 - 0025629', confidence: 0.91, bbox: { x0: 100, y0: 50, x1: 600, y1: 90 } },
  { ...page, text: 'Nr. auto: B 33O SRS', confidence: 0.62, bbox: { x0: 100, y0: 120, x1: 400, y1: 150 } },
  { ...page, text: 'Data: 14.09.2026', confidence: 0.97, bbox: { x0: 650, y0: 120, x1: 900, y1: 150 } },
  { ...page, text: 'Greutate 9.000 kg', confidence: 0.88, bbox: { x0: 100, y0: 300, x1: 400, y1: 330 } },
  { ...page, text: 'Timișoara - Arad - Oradea', confidence: 0.8, bbox: { x0: 100, y0: 400, x1: 700, y1: 430 } },
  { ...page, text: '12', confidence: 0.5, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
  { ...page, page: 1, text: 'TPO-0025629 (copie)', confidence: 0.9, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
];

describe('looseText / valueCandidates', () => {
  it('folds look-alikes and punctuation', () => {
    expect(looseText('TP0 - 0025629')).toBe('TP00025629');
    expect(looseText('B 33O SRS')).toBe('B330SRS');
  });

  it('spells an ISO date the way a form prints it', () => {
    expect(valueCandidates('2026-09-14')).toEqual(['14092026', '140926', '20260914']);
  });

  it('spells a numeric with and without decimals / thousands', () => {
    expect(valueCandidates('9000.00')).toEqual(expect.arrayContaining(['900000', '9000']));
  });
});

describe('matchBlocksForValue', () => {
  it('finds a TPO through an O/0 confusion and prefers the requested page', () => {
    const all = matchBlocksForValue(blocks, 'TPO-0025629');
    expect(all.map((m) => m.index)).toEqual([0, 6]);
    expect(matchBlocksForValue(blocks, 'TPO-0025629', { page: 0 }).map((m) => m.index)).toEqual([0]);
  });

  it('finds a plate, a date and a weight in their printed forms', () => {
    expect(matchBlocksForValue(blocks, 'B 330 SRS')[0].index).toBe(1);
    expect(matchBlocksForValue(blocks, '2026-09-14')[0].index).toBe(2);
    expect(matchBlocksForValue(blocks, '9000.00')[0].index).toBe(3);
  });

  it('matches a route on two of its towns, scored lower', () => {
    const m = matchBlocksForValue(blocks, 'Timisoara - Oradea');
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ index: 4, score: 0.5 });
  });

  it('never matches a short number against a stray digit block', () => {
    expect(matchBlocksForValue(blocks, '12')).toEqual([]);
    expect(matchBlocksForValue(blocks, '')).toEqual([]);
    expect(matchBlocksForValue(blocks, null)).toEqual([]);
  });

  it('matchFields drops fields without a hit', () => {
    const out = matchFields(blocks, { numar_tpo: 'TPO-0025629', tip_marfa: 'ciment' }, { page: 0 });
    expect(Object.keys(out)).toEqual(['numar_tpo']);
  });
});

describe('geometry', () => {
  it('letterboxes a portrait image inside a landscape box', () => {
    const rect = containedRect(1000, 500, 1000, 1400);
    expect(rect.height).toBe(500);
    expect(rect.width).toBeCloseTo(357.14, 1);
    expect(rect.left).toBeCloseTo((1000 - 357.14) / 2, 1);
    expect(rect.top).toBe(0);
  });

  it('scales a bbox from page space onto the rendered rect', () => {
    const rect = { left: 10, top: 20, width: 500, height: 700 };
    expect(blockBox(blocks[0], rect)).toEqual({ left: 60, top: 45, width: 250, height: 20 });
  });

  it('blockRect speaks percentages and blocksForValue hands back the blocks', () => {
    expect(blockRect(blocks[0])).toEqual({ left: 10, top: expect.closeTo(3.571, 2), width: 50, height: expect.closeTo(2.857, 2) });
    expect(blocksForValue(blocks, 'B 330 SRS')).toEqual([blocks[1]]);
  });

  it('falls back to natural size when the page has no dimensions and refuses an empty box', () => {
    const rect = { left: 0, top: 0, width: 500, height: 700 };
    const noDims = { text: 'x', bbox: { x0: 0, y0: 0, x1: 500, y1: 700 } };
    expect(blockBox(noDims, rect, { width: 1000, height: 1400 })).toEqual({ left: 0, top: 0, width: 250, height: 350 });
    expect(blockBox(noDims, rect, null)).toBeNull();
    expect(blockBox({ ...page, bbox: { x0: 5, y0: 5, x1: 5, y1: 9 } }, rect)).toBeNull();
    expect(blockBox({ ...page, bbox: null }, rect)).toBeNull();
  });
});
