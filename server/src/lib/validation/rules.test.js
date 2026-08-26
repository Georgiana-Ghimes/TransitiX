import { describe, expect, it } from 'vitest';
import {
  checkCmrUnsigned,
  checkDocumentLinked,
  checkDocumentWeight,
  checkDuplicateTpo,
  checkTpoStale,
  checkTpoTotal,
  checkTrip,
  checkTripDistance,
  checkTripTariff,
  sortFindings,
  summariseFindings,
} from './rules.js';
import { RULES, getRule } from './catalog.js';

const TARIFF = {
  vehicle_class: '10t',
  trip_rate: 250,
  km_rate: 2.5,
  currency: 'RON',
  valid_from: '2026-01-01',
  valid_to: null,
};

const TRIP = {
  id: 'trip-1',
  cmr_number: 'CMR-1',
  tpo_number: 'TPO 2026-0311',
  contract_id: 'contract-1',
  vehicle_class: '10t',
  loading_date: '2026-03-10',
  distance_km: 42,
  tpo_total: 355,
  charges_total: 355,
  tpo_calculated_at: '2026-03-10T10:00:00Z',
  updated_at: '2026-03-10T10:00:00Z',
};

// ------------------------------------------------------------------ tariff

describe('checkTripTariff', () => {
  it('is quiet when a tariff covers the trip date', () => {
    expect(checkTripTariff(TRIP, [TARIFF])).toBeNull();
  });

  it('raises an error when the contract has no tariff at all', () => {
    const found = checkTripTariff(TRIP, []);
    expect(found.rule).toBe('trip_no_tariff');
    expect(found.severity).toBe('error');
  });

  it('raises an error when the tariff expired before the trip', () => {
    const expired = { ...TARIFF, valid_to: '2026-02-28' };
    expect(checkTripTariff(TRIP, [expired])).not.toBeNull();
  });

  it('raises an error when the tariff starts after the trip', () => {
    const future = { ...TARIFF, valid_from: '2026-04-01' };
    expect(checkTripTariff(TRIP, [future])).not.toBeNull();
  });

  it('raises an error when the vehicle has no commercial class', () => {
    const found = checkTripTariff({ ...TRIP, vehicle_class: null }, [TARIFF]);
    expect(found.message).toContain('clasă de vehicul');
  });

  it('accepts a Date, because pg hands DATE columns back as Date objects', () => {
    const trip = { ...TRIP, loading_date: new Date('2026-03-10T00:00:00Z') };
    expect(checkTripTariff(trip, [TARIFF])).toBeNull();
  });

  it('says nothing about a trip that is not on a contract', () => {
    expect(checkTripTariff({ ...TRIP, contract_id: null }, [])).toBeNull();
  });

  it('says nothing when the trip has no date to read rates as of', () => {
    expect(checkTripTariff({ ...TRIP, loading_date: null }, [])).toBeNull();
  });
});

// ------------------------------------------------------------------- total

describe('checkTpoTotal', () => {
  it('is quiet when the total is the sum of the lines', () => {
    expect(checkTpoTotal(TRIP)).toBeNull();
  });

  it('raises an error when they drifted apart', () => {
    const found = checkTpoTotal({ ...TRIP, charges_total: 300 });
    expect(found.severity).toBe('error');
    expect(found.message).toContain('355.00');
    expect(found.message).toContain('300.00');
  });

  it('tolerates a rounding difference below half a ban', () => {
    expect(checkTpoTotal({ ...TRIP, charges_total: 355.004 })).toBeNull();
  });

  it('treats no charge rows as zero, which is a real mismatch', () => {
    expect(checkTpoTotal({ ...TRIP, charges_total: null })).not.toBeNull();
  });

  it('says nothing about a trip nobody has priced', () => {
    expect(checkTpoTotal({ ...TRIP, tpo_total: null })).toBeNull();
  });
});

// ---------------------------------------------------------------- distance

describe('checkTripDistance', () => {
  it('warns when a priced trip has no distance', () => {
    const found = checkTripDistance({ ...TRIP, distance_km: null });
    expect(found.rule).toBe('trip_no_distance');
    expect(found.severity).toBe('warning');
  });

  it('is quiet about an unpriced trip — that is unfinished, not wrong', () => {
    expect(checkTripDistance({ ...TRIP, tpo_total: null, distance_km: null })).toBeNull();
  });

  it('is quiet when the distance is there', () => {
    expect(checkTripDistance(TRIP)).toBeNull();
  });
});

// ------------------------------------------------------------------- stale

describe('checkTpoStale', () => {
  it('warns when the trip was edited after it was priced', () => {
    const found = checkTpoStale({ ...TRIP, updated_at: '2026-03-11T09:00:00Z' });
    expect(found.rule).toBe('tpo_stale');
  });

  it('ignores the second the calculation itself touched the row', () => {
    expect(checkTpoStale({ ...TRIP, updated_at: '2026-03-10T10:00:00.500Z' })).toBeNull();
  });

  it('changes its key when the trip changes again, so a dismissal does not hide the new edit', () => {
    const first = checkTpoStale({ ...TRIP, updated_at: '2026-03-11T09:00:00Z' });
    const second = checkTpoStale({ ...TRIP, updated_at: '2026-03-12T09:00:00Z' });
    expect(first.key).not.toBe(second.key);
  });

  it('says nothing about a trip that was never priced', () => {
    expect(checkTpoStale({ ...TRIP, tpo_calculated_at: null })).toBeNull();
  });
});

// --------------------------------------------------------------------- cmr

describe('checkCmrUnsigned', () => {
  const DELIVERED = {
    ...TRIP,
    status: 'livrata',
    cmr_source: 'digital',
    cmr_signed_loading_at: '2026-03-10T08:00:00Z',
    cmr_signed_delivery_at: null,
  };

  it('warns when a delivered trip has a note nobody closed', () => {
    const found = checkCmrUnsigned(DELIVERED);
    expect(found.rule).toBe('cmr_unsigned');
    expect(found.message).toContain('destinatarul nu a semnat');
  });

  it('says so differently when the note was never signed at all', () => {
    const found = checkCmrUnsigned({ ...DELIVERED, cmr_signed_loading_at: null });
    expect(found.message).toContain('ciornă');
  });

  it('is quiet once the consignee has signed', () => {
    expect(checkCmrUnsigned({ ...DELIVERED, cmr_signed_delivery_at: '2026-03-11T15:00:00Z' })).toBeNull();
  });

  it('says nothing about a trip that has not been delivered yet', () => {
    expect(checkCmrUnsigned({ ...DELIVERED, status: 'in_tranzit' })).toBeNull();
  });

  it('never fires on a company that runs on paper CMRs', () => {
    // No digital note exists, so there is nothing abandoned — warning on every one of their
    // trips would make the screen useless to them.
    expect(checkCmrUnsigned({ ...DELIVERED, cmr_source: null })).toBeNull();
    expect(checkCmrUnsigned({ ...DELIVERED, cmr_source: 'scan' })).toBeNull();
  });
});

// --------------------------------------------------------------- documents

describe('document rules', () => {
  const CONFIRMED = {
    id: 'doc-1', status: 'confirmed', numar_tpo: 'TPO 2026-0311',
    original_filename: 'aviz.pdf', gross_weight_kg: 9000, trip_id: 'trip-1',
  };

  it('warns about a confirmed aviz with no weighing', () => {
    const found = checkDocumentWeight({ ...CONFIRMED, gross_weight_kg: null });
    expect(found.rule).toBe('document_no_weight');
  });

  it('does not nag about a document nobody has confirmed yet', () => {
    expect(checkDocumentWeight({ ...CONFIRMED, status: 'extracted', gross_weight_kg: null })).toBeNull();
  });

  it('warns about a confirmed aviz attached to no trip', () => {
    expect(checkDocumentLinked({ ...CONFIRMED, trip_id: null }).rule).toBe('document_unlinked');
  });

  it('raises one finding per duplicated number, not one per document', () => {
    const found = checkDuplicateTpo([
      CONFIRMED,
      { ...CONFIRMED, id: 'doc-2', original_filename: 'aviz2.pdf' },
      { ...CONFIRMED, id: 'doc-3', original_filename: 'aviz3.pdf' },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('3 documente');
  });

  it('ignores documents with no TPO rather than grouping them together', () => {
    expect(checkDuplicateTpo([
      { ...CONFIRMED, id: 'a', numar_tpo: null },
      { ...CONFIRMED, id: 'b', numar_tpo: '' },
    ])).toEqual([]);
  });

  it('matches numbers regardless of case and padding', () => {
    expect(checkDuplicateTpo([
      { ...CONFIRMED, id: 'a', numar_tpo: 'TPO 2026-0311' },
      { ...CONFIRMED, id: 'b', numar_tpo: ' tpo 2026-0311 ' },
    ])).toHaveLength(1);
  });
});

// ----------------------------------------------------------------- rollups

describe('checkTrip', () => {
  it('is silent on a clean trip', () => {
    expect(checkTrip(TRIP, () => [TARIFF])).toEqual([]);
  });

  it('reports every problem a broken trip has, not just the first', () => {
    const broken = { ...TRIP, distance_km: null, charges_total: 0, updated_at: '2026-04-01T00:00:00Z' };
    const rules = checkTrip(broken, () => []).map((f) => f.rule);
    expect(rules).toEqual(expect.arrayContaining([
      'trip_no_tariff', 'tpo_total_mismatch', 'trip_no_distance', 'tpo_stale',
    ]));
  });

  it('includes the unsigned-CMR rule in the trip sweep', () => {
    const abandoned = {
      ...TRIP, status: 'livrata', cmr_source: 'digital', cmr_signed_delivery_at: null,
    };
    expect(checkTrip(abandoned, () => [TARIFF]).map((f) => f.rule)).toContain('cmr_unsigned');
  });
});

describe('sortFindings', () => {
  it('puts the errors first, because those change an invoice', () => {
    const sorted = sortFindings([
      { rule: 'trip_no_distance', severity: 'warning', key: 'b' },
      { rule: 'trip_no_tariff', severity: 'error', key: 'a' },
    ]);
    expect(sorted[0].severity).toBe('error');
  });

  it('does not mutate what it was given', () => {
    const input = [
      { rule: 'z', severity: 'warning', key: 'b' },
      { rule: 'a', severity: 'error', key: 'a' },
    ];
    sortFindings(input);
    expect(input[0].rule).toBe('z');
  });
});

describe('summariseFindings', () => {
  it('counts by rule and by severity', () => {
    const summary = summariseFindings([
      { rule: 'trip_no_tariff', severity: 'error' },
      { rule: 'trip_no_tariff', severity: 'error' },
      { rule: 'tpo_stale', severity: 'warning' },
    ]);
    expect(summary).toEqual({
      total: 3,
      by_rule: { trip_no_tariff: 2, tpo_stale: 1 },
      by_severity: { error: 2, warning: 1 },
    });
  });

  it('handles nothing at all', () => {
    expect(summariseFindings([]).total).toBe(0);
  });
});

// ----------------------------------------------------------------- catalog

describe('catalog', () => {
  it('explains every rule the engine can raise', () => {
    // A rule with no stated consequence is an alert nobody can act on, and the screen would
    // have nothing to show beside it.
    const raised = new Set([
      ...checkTrip({ ...TRIP, distance_km: null, charges_total: 0, updated_at: '2026-04-01T00:00:00Z',
        status: 'livrata', cmr_source: 'digital' }, () => []).map((f) => f.rule),
      checkDocumentWeight({ id: 'd', status: 'confirmed', gross_weight_kg: null }).rule,
      checkDocumentLinked({ id: 'd', status: 'confirmed', trip_id: null }).rule,
      checkDuplicateTpo([{ id: 'a', numar_tpo: 'X' }, { id: 'b', numar_tpo: 'X' }])[0].rule,
    ]);
    for (const rule of raised) expect(getRule(rule), `catalog entry for ${rule}`).not.toBeNull();
  });

  it('agrees with the rules about how severe each one is', () => {
    expect(getRule('trip_no_tariff').severity).toBe(checkTripTariff(TRIP, []).severity);
    expect(getRule('tpo_stale').severity)
      .toBe(checkTpoStale({ ...TRIP, updated_at: '2026-04-01T00:00:00Z' }).severity);
  });

  it('gives every catalogued rule a consequence and a fix', () => {
    for (const rule of RULES) {
      expect(rule.consequence, rule.id).toBeTruthy();
      expect(rule.fix, rule.id).toBeTruthy();
    }
  });
});
