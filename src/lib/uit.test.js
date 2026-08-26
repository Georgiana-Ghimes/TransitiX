import { describe, expect, it } from 'vitest';
import { STUB_PREFIX, isPlaceholderUit, isStubUit, uitBadge } from './uit.js';
import { STUB_PREFIX as SERVER_PREFIX } from '../../server/src/lib/compliance/etransport.js';

describe('the client and the server agree on what a placeholder looks like', () => {
  it('shares one prefix', () => {
    // If these drift, the screen starts presenting development codes as real ones — on a
    // document that gets checked at the roadside.
    expect(STUB_PREFIX).toBe(SERVER_PREFIX);
  });
});

describe('isStubUit', () => {
  it('recognises a placeholder', () => {
    expect(isStubUit('STUB-RO1234567890ABCDEF')).toBe(true);
  });

  it('does not flag a real code', () => {
    expect(isStubUit('RO1234567890ABCDEF')).toBe(false);
  });

  it('handles nothing', () => {
    expect(isStubUit(null)).toBe(false);
    expect(isStubUit('')).toBe(false);
  });
});

describe('isPlaceholderUit', () => {
  it('trusts the stored source', () => {
    expect(isPlaceholderUit({ uit_code: 'RO123', uit_source: 'stub' })).toBe(true);
    expect(isPlaceholderUit({ uit_code: 'RO123', uit_source: 'anaf' })).toBe(false);
  });

  it('falls back to the prefix for rows written before the column existed', () => {
    expect(isPlaceholderUit({ uit_code: 'STUB-RO123' })).toBe(true);
  });

  it('says nothing about a route with no code at all', () => {
    expect(isPlaceholderUit({ uit_status: 'failed' })).toBe(false);
    expect(isPlaceholderUit(null)).toBe(false);
  });
});

describe('uitBadge', () => {
  it('never prints a placeholder as though it were a UIT', () => {
    const badge = uitBadge({ uit_code: 'STUB-RO123' });
    expect(badge.label).toBe('UIT DE TEST');
    expect(badge.label).not.toContain('STUB-RO123');
    expect(badge.tone).toBe('warn');
  });

  it('shows a real code in full', () => {
    const badge = uitBadge({ uit_code: 'RO998877', uit_source: 'anaf', uit_status: 'obtained' });
    expect(badge.label).toBe('UIT RO998877');
    expect(badge.tone).toBe('ok');
  });

  it('renders nothing without a code', () => {
    expect(uitBadge({})).toBeNull();
  });
});
