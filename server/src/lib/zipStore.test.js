import { describe, expect, it } from 'vitest';
import { zipStore } from './zipStore.js';

describe('zipStore', () => {
  it('writes a zip local header signature', () => {
    const buf = zipStore([{ name: 'a.txt', data: Buffer.from('hi') }]);
    expect(buf.slice(0, 4).toString('hex')).toBe('504b0304');
    expect(buf.length).toBeGreaterThan(30);
  });
});
