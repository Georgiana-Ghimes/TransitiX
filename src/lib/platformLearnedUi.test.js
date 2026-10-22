import { describe, expect, it } from 'vitest';
import { LEARNED_SOURCE_LABEL, LEARNED_TRUST_LABEL, learnedTrustClass } from './platformLearnedUi.js';

describe('platformLearnedUi', () => {
  it('labels every trust state and source the API returns', () => {
    for (const k of ['trusted', 'candidate', 'disabled']) expect(LEARNED_TRUST_LABEL[k]).toBeTruthy();
    for (const k of ['parsed', 'corrected', 'manual']) expect(LEARNED_SOURCE_LABEL[k]).toBeTruthy();
  });

  it('colours trusted green, disabled red, candidates amber', () => {
    expect(learnedTrustClass('trusted')).toContain('emerald');
    expect(learnedTrustClass('disabled')).toContain('red');
    expect(learnedTrustClass('candidate')).toContain('amber');
  });
});
