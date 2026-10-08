import { describe, expect, it } from 'vitest';
import {
  computeRouting,
  detectMultipleAvizeInText,
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

  it('flags an implausibly low gross weight (#66)', () => {
    const findings = validateAvizFields({
      numar_tpo: 'TPO-0033293',
      data_efectuare_cursa: '2026-10-05',
      numar_auto: 'B 77 PLT',
      gross_weight_kg: 12,
    }, {}, { today: '2026-10-05' });
    expect(findings.some((f) => f.rule === 'weight_implausible_low')).toBe(true);
    expect(computeRouting({
      fields: {},
      findings: findings.filter((f) => f.rule === 'weight_implausible_low'),
    })).toBe(ROUTING.HITL_REQUIRED);
  });

  it('forces HITL when gross is below net (#73)', () => {
    const findings = validateAvizFields({
      numar_tpo: 'TPO-0033294',
      data_efectuare_cursa: '2026-10-05',
      numar_auto: 'B 77 PLT',
      gross_weight_kg: 1704.82,
      net_weight_kg: 16700.88,
    }, {}, { today: '2026-10-05' });
    expect(findings.some((f) => f.rule === 'gross_below_net')).toBe(true);
    expect(computeRouting({
      fields: {},
      findings: findings.filter((f) => f.rule === 'gross_below_net'),
    })).toBe(ROUTING.HITL_REQUIRED);
  });

  it('forces HITL when the trip date is years too old (#77)', () => {
    const findings = validateAvizFields({
      numar_tpo: 'TPO-0033531',
      data_efectuare_cursa: '2020-10-02',
      numar_auto: 'B 615 TXA',
    }, {}, { today: '2026-10-08' });
    const old = findings.filter((f) => f.rule === 'date_too_old');
    expect(old).toHaveLength(1);
    expect(old[0].severity).toBe('error');
    expect(computeRouting({ fields: {}, findings: old })).toBe(ROUTING.HITL_REQUIRED);
  });

  it('forces HITL when trip date is empty and asks for manual fill (#81)', () => {
    const findings = validateAvizFields({
      numar_tpo: 'TPO-0033531',
      data_efectuare_cursa: null,
      numar_auto: 'B 902 DLV',
      numar_document_marfa: 'PSL-0062341',
      gross_weight_kg: 5504.18,
      net_weight_kg: 5400.88,
    }, {
      data_efectuare_cursa: { value: null, confidence: 0, status: 'missing' },
      numar_tpo: { confidence: 0.95, status: 'ok', value: 'TPO-0033531' },
      numar_auto: { confidence: 0.95, status: 'ok', value: 'B-902-DLV' },
    }, {
      today: '2026-10-08',
      rawText: 'Aviz de expeditie: PSL-0062341\nData avizului de exp\nComanda van\n',
    });
    const missing = findings.filter((f) => f.rule === 'date_missing');
    expect(missing).toHaveLength(1);
    expect(missing[0].severity).toBe('error');
    expect(missing[0].message).toMatch(/completează manual/i);
    // Empty date must not also spam „Scor OCR 0%”.
    expect(findings.some((f) => f.rule === 'critical_low_confidence' && f.field === 'data_efectuare_cursa')).toBe(false);
    expect(computeRouting({ fields: {}, findings: missing })).toBe(ROUTING.HITL_REQUIRED);
  });

  it('forces HITL when tip and quantity are empty but a goods table is on the page (#76)', () => {
    const findings = validateAvizFields({
      numar_tpo: 'TPO-0033516',
      data_efectuare_cursa: '2026-10-02',
      numar_auto: 'AG 88 DMX',
      numar_document_marfa: 'PSL-0062309',
      tip_marfa: null,
      cantitate_marfa: null,
      gross_weight_kg: 14253.78,
      net_weight_kg: 14000,
    }, {}, {
      today: '2026-10-02',
      rawText: 'Aviz PSL-0062309\n11000151 Tencuiala TM 40 kg\n11000146 MPX 35 40 kg\nGreutate bruta 14253.78\n',
    });
    const goods = findings.filter((f) => f.rule === 'goods_missing');
    expect(goods.map((f) => f.field).sort()).toEqual(['cantitate_marfa', 'tip_marfa']);
    expect(computeRouting({ fields: {}, findings: goods })).toBe(ROUTING.HITL_REQUIRED);
  });

  it('forces HITL when aviz/transfer labels exist but document number is empty (#75)', () => {
    const findings = validateAvizFields({
      numar_tpo: 'TPO-0033508',
      data_efectuare_cursa: '2026-10-01',
      numar_auto: 'IF 51 GTR',
      numar_document_marfa: null,
      net_weight_kg: 3600,
      gross_weight_kg: 3770.9,
    }, {}, {
      today: '2026-10-01',
      rawText: 'Aviz de expeditie rezumat: TPO-0033508\nAviz de expeditie\nComanda de transfer\n',
    });
    expect(findings.some((f) => f.rule === 'doc_no_missing')).toBe(true);
    expect(computeRouting({
      fields: {},
      findings: findings.filter((f) => f.rule === 'doc_no_missing'),
    })).toBe(ROUTING.HITL_REQUIRED);
  });

  it('forces HITL when net is present but gross is empty under a greutate brută label (#74)', () => {
    const findings = validateAvizFields({
      numar_tpo: 'TPO-0033539',
      data_efectuare_cursa: '2026-10-03',
      numar_auto: 'PH 40 VLM',
      net_weight_kg: 6640.15,
      gross_weight_kg: null,
    }, {}, {
      today: '2026-10-03',
      rawText: 'Greutate neta, kg: 6,640.15\nGreutate bruta, kg:\n',
    });
    expect(findings.some((f) => f.rule === 'gross_missing_near_net')).toBe(true);
    expect(computeRouting({
      fields: {},
      findings: findings.filter((f) => f.rule === 'gross_missing_near_net'),
    })).toBe(ROUTING.HITL_REQUIRED);
  });

  it('forces HITL when the page has a handwritten corectat note (#65)', () => {
    const findings = validateAvizFields({
      numar_tpo: 'TPO-0033200',
      data_efectuare_cursa: '2026-10-01',
      numar_auto: 'B 01 ABC',
      cantitate_marfa: 432,
      gross_weight_kg: 10993.83,
    }, {}, {
      today: '2026-10-01',
      rawText: '432.00 sac 400 corectat la incarcare Greutate bruta 10,993.83 kg 10.193,83',
    });
    const hand = findings.filter((f) => f.rule === 'hand_correction_on_document');
    expect(hand.length).toBe(2);
    expect(hand.map((f) => f.field).sort()).toEqual(['cantitate_marfa', 'gross_weight_kg']);
    expect(hand.every((f) => f.severity === 'error')).toBe(true);
    expect(computeRouting({ fields: {}, findings: hand })).toBe(ROUTING.HITL_REQUIRED);
  });

  it('forces HITL when OCR text has two PSL avize side by side (#59)', () => {
    const raw = `
Aviz de expeditie: PSL-0062034
Comanda de transport TPO-0033171
Placuta: IF 27 LDX
Cantitate 324.00 sac
Greutate bruta, kg: 8,262.31
Aviz de expeditie: PSL-0062035
Comanda de transport TPO-0033172
Placuta: B 85 WNT
Cantitate 270.00 sac
Greutate bruta, kg: 6,882.72
`;
    expect(detectMultipleAvizeInText(raw)).toEqual({
      document_numbers: ['PSL-0062034', 'PSL-0062035'],
      tpo_numbers: ['TPO-0033171', 'TPO-0033172'],
    });
    const findings = validateAvizFields({
      numar_tpo: 'TPO-0033171',
      data_efectuare_cursa: '2026-10-01',
      numar_auto: 'IF-27-LDX / B-85-WNT',
      numar_document_marfa: 'PSL-0062034',
      cantitate_marfa: 594,
    }, {
      numar_tpo: { confidence: 0.95, status: 'ok' },
      data_efectuare_cursa: { confidence: 0.95, status: 'ok' },
      numar_auto: { confidence: 0.95, status: 'ok' },
    }, { today: '2026-10-07', rawText: raw });
    expect(findings.some((f) => f.rule === 'multiple_avize_in_image' && f.severity === 'error')).toBe(true);
    expect(computeRouting({ findings, fields: {
      numar_tpo: { confidence: 0.95 },
      data_efectuare_cursa: { confidence: 0.95 },
      numar_auto: { confidence: 0.95 },
    } })).toBe(ROUTING.HITL_REQUIRED);
  });

  it('does not flag a single aviz that reprints its own PSL (#59)', () => {
    const raw = 'Aviz PSL-0062034\nTPO-0033171\nPSL-0062034 footer reprint';
    expect(detectMultipleAvizeInText(raw)).toBeNull();
    const findings = validateAvizFields({
      numar_tpo: 'TPO-0033171',
      data_efectuare_cursa: '2026-10-01',
      numar_document_marfa: 'PSL-0062034',
    }, {}, { today: '2026-10-07', rawText: raw });
    expect(findings.some((f) => f.rule === 'multiple_avize_in_image')).toBe(false);
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
