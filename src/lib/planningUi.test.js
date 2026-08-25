import { describe, expect, it } from 'vitest';
import {
  compareScenarioKpis,
  formatCapabilities,
  formatHours,
  formatKm,
  formatLei,
  parseCapabilities,
  scenarioStatusLabel,
} from './planningUi.js';

describe('formatters', () => {
  it('formats distances and durations for the board', () => {
    expect(formatKm(12.34)).toMatch(/12/);
    expect(formatHours(90)).toBe('1 h 30 min');
    expect(formatHours(45)).toBe('45 min');
    expect(formatLei(54)).toMatch(/54/);
  });

  it('labels scenario statuses in Romanian', () => {
    expect(scenarioStatusLabel('promovat')).toBe('În plan');
    expect(scenarioStatusLabel('rulat')).toBe('Rulat');
  });
});

describe('capabilities', () => {
  it('round-trips a comma-separated string', () => {
    expect(parseCapabilities('ADR, frigo ; lift')).toEqual(['ADR', 'frigo', 'lift']);
    expect(formatCapabilities(['ADR', 'frigo'])).toBe('ADR, frigo');
  });
});

describe('compareScenarioKpis', () => {
  it('flattens the columns a comparison table needs', () => {
    const rows = compareScenarioKpis([
      { id: '1', name: 'A', status: 'rulat', kpis: { routes: 3, distance_km: 400, unassigned: 1 } },
    ]);
    expect(rows[0]).toMatchObject({ id: '1', routes: 3, distance_km: 400, unassigned: 1 });
  });
});
