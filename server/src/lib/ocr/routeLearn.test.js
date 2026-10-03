import { describe, expect, it } from 'vitest';
import {
  addressTokensFromOcr,
  applyLearnedRoute,
  buildRouteRuleFromOcr,
  matchRouteRule,
  MIN_LEARN_TOKENS,
  preferLearnedRoute,
} from './routeLearn.js';

const REZUMAT = `
Expeditor
Site: MIL-
Depozit: NEAMTIU
Aviz de expeditie rezumat: TPO-0031027
Adresa de livrare    Referinta client
BOL MBMARFA Bolintin
Str. Republicii, nr. 1F
Bolintin-Deal RO 087015 ROU
Termen de livrare
Placuta de inmatriculare B 911 VFM
`;

const OTHER_ADDRESS = `
Expeditor Site: BOL Bolintin str. Republicii nr. 1F Bolintin-Deal
Adresa de livrare CS-DEMO Șosea Viilor nr. 52 București Sector 5 RO 050151
Placuta de inmatriculare B 111 ABC
TPO-0025803
`;

describe('routeLearn', () => {
  it('builds tokens from Site/Depozit + delivery street', () => {
    const tokens = addressTokensFromOcr(REZUMAT);
    expect(tokens).toEqual(expect.arrayContaining(['mil', 'neamtiu', 'republicii', '1f', 'bolintin-deal']));
    expect(tokens.length).toBeGreaterThanOrEqual(MIN_LEARN_TOKENS);
  });

  it('matches similar OCR via tokens and misses a different address', () => {
    const built = buildRouteRuleFromOcr(REZUMAT);
    expect(built).not.toBeNull();
    expect(built.tokens).toEqual(expect.arrayContaining(['republicii', 'neamtiu']));

    const rule = {
      match_regex: built.matchRegex,
      match_tokens: built.tokens,
      ruta_transport: 'MIL-NEAMTIU / Str. Republicii nr. 1F, Bolintin-Deal',
      updated_at: '2026-10-03T00:00:00.000Z',
    };

    const similar = `
Expeditor Site MIL Depozit NEAMTIU
Adresa de livrare
Str. Republicii nr. 1F Bolintin-Deal RO 087015
`;
    expect(matchRouteRule(similar, [rule])?.ruta_transport).toBe(rule.ruta_transport);
    expect(matchRouteRule(OTHER_ADDRESS, [rule])).toBeNull();
  });

  it('prefers the rule with more tokens when several match', () => {
    const broad = buildRouteRuleFromOcr(`
Adresa de livrare Str. Republicii nr. 1F Domnesti RO 077000
`);
    const specific = buildRouteRuleFromOcr(REZUMAT);
    expect(matchRouteRule(REZUMAT, [
      {
        match_regex: broad.matchRegex,
        match_tokens: broad.tokens,
        ruta_transport: 'BROAD',
        updated_at: '2026-10-01T00:00:00.000Z',
      },
      {
        match_regex: specific.matchRegex,
        match_tokens: specific.tokens,
        ruta_transport: 'SPECIFIC',
        updated_at: '2026-10-02T00:00:00.000Z',
      },
    ])?.ruta_transport).toBe('SPECIFIC');
  });

  it('applyLearnedRoute overrides parser values unless corrected_fields pins the route', () => {
    const built = buildRouteRuleFromOcr(REZUMAT);
    const rules = [{
      id: 'r1',
      match_regex: built.matchRegex,
      match_tokens: built.tokens,
      ruta_transport: 'MIL-NEAMTIU / Str. Republicii nr. 1F, Bolintin-Deal',
      updated_at: new Date().toISOString(),
    }];

    const applied = applyLearnedRoute(
      { ruta_transport: 'Str. Republicii', numar_tpo: 'TPO-1' },
      REZUMAT,
      rules,
    );
    expect(applied.learned).toBe(true);
    expect(applied.values.ruta_transport).toBe(rules[0].ruta_transport);

    const pinned = applyLearnedRoute(
      { ruta_transport: 'Custom office route' },
      REZUMAT,
      rules,
      { correctedFields: ['ruta_transport'] },
    );
    expect(pinned.learned).toBe(false);
    expect(pinned.values.ruta_transport).toBe('Custom office route');
  });

  it('preferLearnedRoute keeps corrected stored routes', () => {
    const built = buildRouteRuleFromOcr(REZUMAT);
    const rules = [{
      match_regex: built.matchRegex,
      match_tokens: built.tokens,
      ruta_transport: 'LEARNED',
      updated_at: new Date().toISOString(),
    }];
    const kept = preferLearnedRoute('OFFICE', REZUMAT, rules, { corrected: true });
    expect(kept.route).toBe('OFFICE');
    expect(kept.learned).toBe(false);
  });

  it('refuses to learn when fewer than MIN_LEARN_TOKENS', () => {
    expect(buildRouteRuleFromOcr('Placuta B 111 ABC TPO-1')).toBeNull();
  });
});
