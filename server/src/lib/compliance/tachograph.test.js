import { describe, expect, it } from 'vitest';
import {
  analyseTachographBuffer,
  guessPlates,
  isTachographFilename,
  scanVuTlv,
} from './tachograph.js';

function vuBlock(tag, value) {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(value.length);
  const t = Buffer.alloc(2);
  t.writeUInt16BE(tag);
  return Buffer.concat([t, len, value]);
}

describe('tachograph foundation', () => {
  it('accepts common extensions', () => {
    expect(isTachographFilename('C_20260825_1234.ddd')).toBe(true);
    expect(isTachographFilename('M_xxx.C1B')).toBe(true);
    expect(isTachographFilename('photo.jpg')).toBe(false);
  });

  it('scans VU TLV and names known tags', () => {
    const buf = Buffer.concat([
      vuBlock(0x7601, Buffer.from('overview-payload-xxxxx')),
      vuBlock(0x7602, Buffer.from('activities')),
    ]);
    const { blocks, consumed } = scanVuTlv(buf);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].name).toBe('vu_overview_g1');
    expect(blocks[1].name).toBe('vu_activities_g1');
    expect(consumed).toBe(buf.length);
  });

  it('classifies a synthetic VU file and guesses plates from ASCII', () => {
    const payload = Buffer.from('Vehicle TM-12-ABC depot TIMISOARA', 'ascii');
    const buf = vuBlock(0x7621, payload);
    const result = analyseTachographBuffer(buf, { filename: 'vu.ddd' });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('vu');
    expect(result.status).toBe('partial');
    expect(result.known_tag_count).toBe(1);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(guessPlates(result.ascii_samples).length + result.plates_guess.length).toBeGreaterThan(0);
    expect(result.plates_guess.some((p) => /TM/.test(p) || /ABC/.test(p))).toBe(true);
  });

  it('rejects tiny buffers as failed', () => {
    const result = analyseTachographBuffer(Buffer.from([1, 2, 3]));
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
  });
});
