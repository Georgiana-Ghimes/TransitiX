import { describe, expect, it } from 'vitest';
import {
  cleanFilters,
  driftSummary,
  formatCell,
  hasCriteria,
  totalIsPartial,
  totalsRow,
  warningHint,
  warningLabel,
} from './reportsUi.js';

const COLUMNS = [
  { key: 'nr_crt', header: 'Nr. crt', source: 'nr_crt', numeric: true, type: 'integer', totalled: false },
  { key: 'numar_auto', header: 'Auto', source: 'numar_auto', numeric: false, type: 'text', totalled: false },
  { key: 'gross_weight_kg', header: 'Brut', source: 'gross_weight_kg', numeric: true, type: 'weight', totalled: true },
  { key: 'tarif_km', header: 'Tarif', source: 'tarif_km', numeric: true, type: 'number', totalled: false },
];

describe('formatCell', () => {
  it('leaves a missing figure blank rather than printing a zero', () => {
    expect(formatCell(null, COLUMNS[2])).toBe('');
    expect(formatCell('', COLUMNS[2])).toBe('');
    expect(formatCell(undefined, COLUMNS[2])).toBe('');
  });

  it('prints a real zero when a real zero was measured', () => {
    expect(formatCell(0, COLUMNS[2])).toBe('0');
  });

  it('shows a weight without decimals', () => {
    expect(formatCell(9000, COLUMNS[2]).replace(/ |\s/g, '')).toBe('9.000');
  });

  it('shows a rate with two decimals', () => {
    expect(formatCell(2.5, COLUMNS[3])).toBe('2,50');
  });

  it('passes text through untouched', () => {
    expect(formatCell('B 123 ABC', COLUMNS[1])).toBe('B 123 ABC');
  });
});

describe('totalsRow', () => {
  const totals = { gross_weight_kg: { value: 21400, counted: 2, missing: 1 } };

  it('puts each total under its own column', () => {
    expect(totalsRow(COLUMNS, totals).cells.gross_weight_kg.replace(/ |\s/g, '')).toBe('21.400');
  });

  it('labels the line so it is not read as another delivery', () => {
    expect(totalsRow(COLUMNS, totals).cells.nr_crt).toBe('TOTAL');
  });

  it('leaves columns without a total empty', () => {
    expect(totalsRow(COLUMNS, totals).cells.tarif_km).toBe('');
  });

  it('has no line at all when nothing can be totalled', () => {
    expect(totalsRow(COLUMNS, {})).toBeNull();
  });

  it('knows when a total covers only part of the selection', () => {
    expect(totalIsPartial(totals, 'gross_weight_kg')).toBe(true);
    expect(totalIsPartial({ gross_weight_kg: { value: 1, missing: 0 } }, 'gross_weight_kg')).toBe(false);
  });
});

describe('selection criteria', () => {
  it('refuses an empty selection, the same as the server does', () => {
    expect(hasCriteria({})).toBe(false);
    expect(hasCriteria({ from: '', to: '', plate: '' })).toBe(false);
  });

  it('accepts a single criterion', () => {
    expect(hasCriteria({ with_weight: true })).toBe(true);
    expect(hasCriteria({ batch_id: 'abc' })).toBe(true);
  });

  it('sends only what was actually chosen', () => {
    expect(cleanFilters({ from: '2026-03-01', to: '', plate: '', with_weight: false }))
      .toEqual({ from: '2026-03-01' });
  });
});

describe('warnings', () => {
  it('gives every known code a readable label', () => {
    expect(warningLabel('weight_not_exported')).toBe('Greutatea nu ajunge în raport');
  });

  it('falls back to the code rather than hiding an unknown warning', () => {
    expect(warningLabel('ceva_nou')).toBe('ceva_nou');
  });

  it('explains why the weight warning matters', () => {
    expect(warningHint('weight_not_exported')).toContain('cântar');
  });
});

describe('driftSummary', () => {
  it('says an export still matches the data', () => {
    expect(driftSummary({ reproducible: true, changed_since: [], missing_documents: [] }).tone).toBe('ok');
  });

  it('counts documents corrected after the sheet was sent', () => {
    const summary = driftSummary({ reproducible: true, changed_since: ['a'], missing_documents: [] });
    expect(summary.tone).toBe('warn');
    expect(summary.text).toContain('1 document modificat');
  });

  it('says plainly when an old export cannot be reproduced', () => {
    expect(driftSummary({ reproducible: false }).text).toContain('nu poate fi reprodus');
  });
});
