import { describe, expect, it } from 'vitest';
import { groupByRule, headline, severityMeta, subjectLabel, summarise } from './checksUi.js';

const RULES = [
  { id: 'trip_no_tariff', severity: 'error', label: 'Cursă fără tarif', consequence: 'c', fix: 'f' },
  { id: 'tpo_stale', severity: 'warning', label: 'TPO vechi', consequence: 'c', fix: 'f' },
];

const FINDINGS = [
  { rule: 'tpo_stale', severity: 'warning', key: 'a', subject: { type: 'trip', id: '1', label: 'TPO-1' } },
  { rule: 'tpo_stale', severity: 'warning', key: 'b', subject: { type: 'trip', id: '2', label: 'TPO-2' } },
  { rule: 'trip_no_tariff', severity: 'error', key: 'c', subject: { type: 'trip', id: '3', label: 'TPO-3' } },
];

describe('groupByRule', () => {
  it('puts the errors first, whatever their count', () => {
    const groups = groupByRule(FINDINGS, RULES);
    expect(groups[0].rule).toBe('trip_no_tariff');
  });

  it('collapses repeats of one rule into a single group', () => {
    const groups = groupByRule(FINDINGS, RULES);
    expect(groups.find((g) => g.rule === 'tpo_stale').items).toHaveLength(2);
  });

  it('attaches the catalog entry so the screen can explain the rule', () => {
    expect(groupByRule(FINDINGS, RULES)[0].meta.fix).toBe('f');
  });

  it('still groups a rule the catalog does not know about', () => {
    const groups = groupByRule([{ rule: 'nou', severity: 'warning', key: 'x' }], RULES);
    expect(groups[0].meta).toBeNull();
    expect(groups[0].items).toHaveLength(1);
  });

  it('orders equally severe rules by how many there are', () => {
    const many = [
      ...FINDINGS.filter((f) => f.rule === 'tpo_stale'),
      { rule: 'document_no_weight', severity: 'warning', key: 'd' },
    ];
    const groups = groupByRule(many, RULES);
    expect(groups[0].rule).toBe('tpo_stale');
  });

  it('handles an empty list', () => {
    expect(groupByRule([], RULES)).toEqual([]);
  });
});

describe('headline', () => {
  it('says plainly when there is nothing to fix', () => {
    expect(headline({ by_severity: { error: 0, warning: 0 } })).toContain('Nimic de corectat');
  });

  it('leads with the billing problems', () => {
    expect(headline({ by_severity: { error: 2, warning: 5 } }))
      .toBe('2 probleme care afectează facturarea · 5 de verificat');
  });

  it('uses the singular for one', () => {
    expect(headline({ by_severity: { error: 1, warning: 0 } })).toContain('1 problemă');
  });

  it('survives a missing summary', () => {
    expect(headline(undefined)).toContain('Nimic de corectat');
  });
});

describe('severityMeta', () => {
  it('marks an error as billing-blocking', () => {
    expect(severityMeta('error').label).toBe('Blochează facturarea');
  });

  it('falls back rather than crashing on a severity it does not know', () => {
    expect(severityMeta('critic').label).toBe('critic');
  });
});

describe('subjectLabel', () => {
  it('says what the finding is about', () => {
    expect(subjectLabel({ type: 'trip', label: 'TPO-1' })).toBe('Cursă TPO-1');
    expect(subjectLabel({ type: 'document', label: 'aviz.pdf' })).toBe('Document aviz.pdf');
  });

  it('handles a subject type it does not recognise', () => {
    expect(subjectLabel({ type: 'ceva', label: 'X' })).toBe('X');
  });

  it('handles no subject', () => {
    expect(subjectLabel(null)).toBe('—');
  });
});

describe('summarise', () => {
  it('recounts after a dismissal so the header follows the list', () => {
    const remaining = FINDINGS.filter((f) => f.severity !== 'error');
    expect(summarise(remaining).by_severity).toEqual({ error: 0, warning: 2 });
  });

  it('counts per rule as well', () => {
    expect(summarise(FINDINGS).by_rule).toEqual({ tpo_stale: 2, trip_no_tariff: 1 });
  });

  it('handles an empty list', () => {
    expect(summarise([])).toEqual({ total: 0, by_rule: {}, by_severity: { error: 0, warning: 0 } });
  });
});
