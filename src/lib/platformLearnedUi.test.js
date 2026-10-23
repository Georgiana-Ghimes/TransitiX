import { describe, expect, it } from 'vitest';
import {
  LEARNED_SOURCE_LABEL,
  LEARNED_TRUST_LABEL,
  learnedTrustClass,
  mergePrompt,
  mergedVariantsLabel,
} from './platformLearnedUi.js';

describe('platformLearnedUi', () => {
  it('labels every trust state and source the API returns', () => {
    for (const k of ['trusted', 'candidate', 'disabled']) expect(LEARNED_TRUST_LABEL[k]).toBeTruthy();
    for (const k of ['parsed', 'corrected', 'manual']) expect(LEARNED_SOURCE_LABEL[k]).toBeTruthy();
  });

  it('names both addresses and the target evidence in the merge prompt', () => {
    const { title, description } = mergePrompt(
      { display: 'Str. Kepublicii nr. 1F, Bolintin-Deal' },
      { display: 'Str. Republicii nr. 1F, Bolintin-Deal', postcode: '087015', trust: 'trusted', seen_count: 27 },
    );
    expect(title).toBe('Unești adresele?');
    expect(description).toContain('Str. Republicii nr. 1F, Bolintin-Deal');
    expect(description).toContain('Kepublicii');
    expect(description).toContain('087015');
    expect(description).toContain('27 avize');
  });

  it('lists merged variants, or nothing', () => {
    expect(mergedVariantsLabel([])).toBeNull();
    expect(mergedVariantsLabel(null)).toBeNull();
    expect(mergedVariantsLabel([{ display: 'Str. Kepublicii nr. 1F, Bolintin-Deal' }]))
      .toBe('Variantă unită: Str. Kepublicii nr. 1F, Bolintin-Deal');
    expect(mergedVariantsLabel([{ display: 'A' }, { display: 'B' }])).toBe('Variante unite: A · B');
  });

  it('colours trusted green, disabled red, candidates amber', () => {
    expect(learnedTrustClass('trusted')).toContain('emerald');
    expect(learnedTrustClass('disabled')).toContain('red');
    expect(learnedTrustClass('candidate')).toContain('amber');
  });
});
