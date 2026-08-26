import { describe, expect, it } from 'vitest';
import { durationMs } from './sessions.js';

describe('durationMs', () => {
  it('reads the units a JWT config uses', () => {
    expect(durationMs('30m')).toBe(30 * 60_000);
    expect(durationMs('12h')).toBe(12 * 3_600_000);
    expect(durationMs('7d')).toBe(7 * 86_400_000);
    expect(durationMs('45s')).toBe(45_000);
  });

  it('tolerates spacing and case', () => {
    expect(durationMs(' 7 D ')).toBe(7 * 86_400_000);
  });

  it('falls back rather than storing a session that never expires', () => {
    // A row with a nonsense expiry would either never be pruned or be treated as already dead.
    expect(durationMs('câteva zile')).toBe(7 * 86_400_000);
    expect(durationMs(undefined)).toBe(7 * 86_400_000);
    expect(durationMs('', 1000)).toBe(1000);
  });
});
