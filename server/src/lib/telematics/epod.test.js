import { describe, expect, it } from 'vitest';
import {
  normalizePhotoUrls,
  stopStatusForOutcome,
  validatePodInput,
} from './epod.js';

describe('validatePodInput', () => {
  it('requires recipient + signature for livrat', () => {
    expect(validatePodInput({ outcome: 'livrat' }).ok).toBe(false);
    expect(validatePodInput({
      outcome: 'livrat',
      recipient_name: 'Ion',
      signature_data_url: 'data:image/png;base64,aaa',
    }).ok).toBe(true);
  });

  it('requires refusal reason for refuzat', () => {
    expect(validatePodInput({ outcome: 'refuzat' }).ok).toBe(false);
    expect(validatePodInput({ outcome: 'refuzat', refusal_reason: 'Închis' }).ok).toBe(true);
  });
});

describe('stopStatusForOutcome', () => {
  it('maps refusal to esuat', () => {
    expect(stopStatusForOutcome('refuzat')).toBe('esuat');
    expect(stopStatusForOutcome('livrat')).toBe('finalizat');
  });
});

describe('normalizePhotoUrls', () => {
  it('keeps only upload/http urls and caps at 8', () => {
    expect(normalizePhotoUrls(['/uploads/a.jpg', 'ftp://x', null, 'https://cdn/x'])).toEqual([
      '/uploads/a.jpg',
      'https://cdn/x',
    ]);
  });
});
