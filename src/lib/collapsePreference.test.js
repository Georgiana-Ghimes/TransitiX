import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collapseStorageKey, readCollapsed, writeCollapsed } from './collapsePreference.js';

function fakeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    store,
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('collapseStorageKey', () => {
  it('namespaces the key so two panels do not share one preference', () => {
    expect(collapseStorageKey('avize-actiuni')).not.toBe(collapseStorageKey('avize-sabloane'));
    expect(collapseStorageKey('avize-actiuni')).toMatch(/^transitix_collapsed_/);
  });
});

describe('round trip', () => {
  it('remembers a panel that was closed', () => {
    writeCollapsed('avize-actiuni', true);
    expect(readCollapsed('avize-actiuni')).toBe(true);
  });

  it('remembers a panel that was reopened', () => {
    writeCollapsed('avize-actiuni', true);
    writeCollapsed('avize-actiuni', false);
    expect(readCollapsed('avize-actiuni')).toBe(false);
  });

  it('keeps the two legends apart', () => {
    writeCollapsed('avize-actiuni', true);
    expect(readCollapsed('avize-sabloane')).toBe(false);
  });
});

describe('when there is nothing to read', () => {
  it('falls back for a key never written', () => {
    expect(readCollapsed('nou')).toBe(false);
    expect(readCollapsed('nou', true)).toBe(true);
  });

  it('ignores a value it did not write', () => {
    // A leftover from an older version must not pin a panel shut with no way to tell why.
    vi.stubGlobal('localStorage', fakeStorage({ [collapseStorageKey('avize-actiuni')]: 'yes' }));
    expect(readCollapsed('avize-actiuni')).toBe(false);
  });

  it('falls back when storage itself throws', () => {
    // A private window, or site data blocked: reading throws rather than returning null, and a
    // help panel is never worth breaking the screen over.
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    });
    expect(readCollapsed('avize-actiuni', true)).toBe(true);
    expect(() => writeCollapsed('avize-actiuni', true)).not.toThrow();
  });

  it('does nothing without an id', () => {
    expect(readCollapsed('', true)).toBe(true);
    expect(readCollapsed(null)).toBe(false);
    expect(() => writeCollapsed(null, true)).not.toThrow();
    expect(localStorage.store.size).toBe(0);
  });
});
