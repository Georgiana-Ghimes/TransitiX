import { describe, expect, it, afterEach } from 'vitest';
import {
  extractSemanticAddresses,
  semanticAddressesEnabled,
} from './semanticAddresses.js';

describe('semanticAddresses', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('stays off — route extraction is structural labels/columns only', () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    process.env.AVIZ_SEMANTIC_ADDRESSES = '1';
    expect(semanticAddressesEnabled()).toBe(false);
  });

  it('extractSemanticAddresses is a no-op while disabled', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    process.env.AVIZ_SEMANTIC_ADDRESSES = '1';
    const result = await extractSemanticAddresses(
      'Expeditor Site BOL Str. Republicii Bolintin-Deal. Adresa de livrare Sosea Viilor Bucuresti.',
    );
    expect(result).toBeNull();
  });
});
