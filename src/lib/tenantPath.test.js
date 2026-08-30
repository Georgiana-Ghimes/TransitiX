import { describe, expect, it } from 'vitest';
import {
  PRODUCT_SLUGS,
  detectSlugFromPath,
  stripTenantSlug,
  tenantPath,
} from './tenantPath.js';

describe('tenantPath', () => {
  it('uses fixed product slugs', () => {
    expect(PRODUCT_SLUGS.transitix_full).toBe('txdemo7k2m');
    expect(PRODUCT_SLUGS.rai_documents).toBe('raidocs4n9p');
  });

  it('detects slug from path and ignores reserved', () => {
    expect(detectSlugFromPath('/txdemo7k2m/avize')).toBe('txdemo7k2m');
    expect(detectSlugFromPath('/platform')).toBe(null);
    expect(detectSlugFromPath('/login')).toBe(null);
  });

  it('builds and strips tenant paths', () => {
    expect(tenantPath('txdemo7k2m', '/avize')).toBe('/txdemo7k2m/avize');
    expect(stripTenantSlug('/txdemo7k2m/trips/1', 'txdemo7k2m')).toBe('/trips/1');
  });
});
