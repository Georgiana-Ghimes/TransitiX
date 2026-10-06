import { describe, expect, it } from 'vitest';
import {
  computeRouting,
  findDuplicateSuspect,
  parseAvizDate,
  validateAvizFields,
  validateAvizExtraction,
  ROUTING,
} from './validateAviz.js';

describe('parseAvizDate', () => {
  it('parses ISO and DMY', () => {
    expect(parseAvizDate('2026-03-10')).toBe('2026-03-10');
    expect(parseAvizDate('10.03.2026')).toBe('2026-03-10');
    expect(parseAvizDate('10/3/2026')).toBe('2026-03-10');
    expect(parseAvizDate('nope')).toBeNull();
  });
});

describe('validateAvizFields', () => {
  it('requires a real TPO', () => {
    const findings = validateAvizFields({ numar_tpo: 'MPI adeziv' }, {}, { today: '2026-10-01' });
    expect(findings.some((f) => f.rule === 'tpo_invalid')).toBe(true);
  });

  it('accepts a normalized TPO and date on the day', () => {
    const findings = validateAvizFields({
      numar_tpo: 'TPO 2026-0311',
      data_efectuare_cursa: '2026-10-01',
      numar_auto: 'B 123 ABC',
    }, {
      numar_tpo: { confidence: 0.98, status: 'ok', value: 'TPO-2026-0311' },
      data_efectuare_cursa: { confidence: 0.97, status: 'ok', value: '2026-10-01' },
      numar_auto: { confidence: 0.96, status: 'ok', value: 'B-123-ABC' },
    }, { today: '2026-10-01' });
    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('flags a future trip date', () => {
    const findings = validateAvizFields({
      numar_tpo: 'TPO-2026-0001',
      data_efectuare_cursa: '2026-12-01',
      numar_auto: 'B 01 ABC',
    }, {}, { today: '2026-10-01' });
    expect(findings.some((f) => f.rule === 'date_in_future')).toBe(true);
  });

  it('flags invalid quantity', () => {
    const findings = validateAvizFields({
      numar_tpo: 'TPO-1',
      data_efectuare_cursa: '2026-10-01',
      cantitate_marfa: -3,
    }, {}, { today: '2026-10-01' });
    expect(findings.some((f) => f.rule === 'quantity_invalid')).toBe(true);
  });

  it('flags a bare house number posing as document id (#54)', () => {
    const findings = validateAvizFields({
      numar_tpo: 'TPO-0032741',
      data_efectuare_cursa: '2026-10-02',
      numar_document_marfa: '220',
    }, {}, { today: '2026-10-06' });
    expect(findings.some((f) => f.rule === 'doc_no_invalid')).toBe(true);
  });

  it('accepts TRO/PSL document numbers without doc_no_invalid', () => {
    const findings = validateAvizFields({
      numar_tpo: 'TPO-0032741',
      data_efectuare_cursa: '2026-10-02',
      numar_document_marfa: 'TRO-0010203',
    }, {}, { today: '2026-10-06' });
    expect(findings.some((f) => f.rule === 'doc_no_invalid')).toBe(false);
  });
});

describe('computeRouting', () => {
  it('requires HITL when a critical finding is present', () => {
    const routing = computeRouting({
      findings: [{ rule: 'tpo_missing', severity: 'error', source: 'rule_failed' }],
      fields: {},
    });
    expect(routing).toBe(ROUTING.HITL_REQUIRED);
  });

  it('stays auto when fields are at least 90%', () => {
    const routing = computeRouting({
      findings: [],
      fields: {
        numar_tpo: { confidence: 0.90 },
        numar_auto: { confidence: 0.90 },
        data_efectuare_cursa: { confidence: 0.90 },
        ruta_transport: { confidence: 0.90 },
      },
    });
    expect(routing).toBe(ROUTING.AUTO);
  });

  it('does not force HITL for a duplicate suspect', () => {
    const routing = computeRouting({
      findings: [{
        rule: 'duplicate_consignment_90d',
        severity: 'info',
        source: 'duplicate_suspect',
      }],
      fields: {
        numar_tpo: { confidence: 0.90 },
        numar_auto: { confidence: 0.90 },
        data_efectuare_cursa: { confidence: 0.90 },
      },
    });
    expect(routing).toBe(ROUTING.AUTO);
  });
});

describe('findDuplicateSuspect', () => {
  it('matches consignment within lookback', async () => {
    const queryFn = async () => ({
      rows: [{
        id: 'other',
        numar_tpo: 'TPO-2026-0311',
        numar_document_marfa: 'PSL-1',
        data_efectuare_cursa: '2026-10-01',
        numar_auto: 'B-1',
        original_filename: 'a.pdf',
      }],
    });
    const hit = await findDuplicateSuspect(queryFn, {
      companyId: 'co',
      row: {
        numar_tpo: 'TPO-2026-0311',
        numar_document_marfa: 'PSL-1',
        data_efectuare_cursa: '2026-10-01',
        numar_auto: 'B-1',
      },
      excludeId: 'self',
    });
    expect(hit.id).toBe('other');
  });
});

describe('validateAvizExtraction', () => {
  it('packages routing and failed rules', async () => {
    const result = await validateAvizExtraction({
      values: {
        numar_tpo: 'TPO-2026-0001',
        data_efectuare_cursa: '2026-10-01',
        numar_auto: 'B 10 XYZ',
      },
      fields: {
        numar_tpo: { confidence: 0.99, status: 'ok' },
        data_efectuare_cursa: { confidence: 0.98, status: 'ok' },
        numar_auto: { confidence: 0.97, status: 'ok' },
      },
      today: '2026-10-01',
    });
    expect(result.routing).toBe(ROUTING.AUTO);
    expect(result.needs_review).toBe(false);
  });
});
