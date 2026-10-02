import { describe, expect, it } from 'vitest';
import {
  FIELD_HOT_RATE,
  SUGGESTION_MIN_DOCS,
  avizOcrFieldChanges,
  summariseFeedback,
} from './feedback.js';

const user = { id: 'u1', name: 'Ana' };

describe('avizOcrFieldChanges', () => {
  it('reports only OCR fields that actually changed', () => {
    // km / weight stay equal across pg string vs form number; only the plate changes.
    const prev = { numar_tpo: 'TPO-0025629', numar_auto: 'B 330 SRS', km_parcursi: '120.00', gross_weight_kg: '9000.00' };
    const data = { numar_tpo: 'TPO-0025629', numar_auto: 'B 331 SRS', km_parcursi: 120, gross_weight_kg: 9000 };
    const changes = avizOcrFieldChanges(prev, data, user, { now: new Date('2026-10-01T10:00:00Z') });
    expect(changes).toEqual([
      {
        field: 'numar_auto', old_value: 'B 330 SRS', new_value: 'B 331 SRS',
        operator_id: 'u1', operator_name: 'Ana', timestamp: '2026-10-01T10:00:00.000Z',
      },
    ]);
  });

  it('treats a pg DATE and the form\'s YYYY-MM-DD as the same day', () => {
    const prev = { data_efectuare_cursa: new Date(2026, 8, 14) };
    expect(avizOcrFieldChanges(prev, { data_efectuare_cursa: '2026-09-14' }, user)).toEqual([]);
    const changed = avizOcrFieldChanges(prev, { data_efectuare_cursa: '2026-09-15' }, user);
    expect(changed).toHaveLength(1);
    expect(changed[0].old_value).toBe('2026-09-14');
  });

  it('does not count a field the payload did not send', () => {
    expect(avizOcrFieldChanges({ numar_tpo: 'X' }, { status: 'confirmed' }, user)).toEqual([]);
  });

  it('counts null → value and value → null', () => {
    expect(avizOcrFieldChanges({ numar_tpo: null }, { numar_tpo: 'TPO-1' }, user)).toHaveLength(1);
    expect(avizOcrFieldChanges({ numar_tpo: 'TPO-1' }, { numar_tpo: null }, user)).toHaveLength(1);
  });
});

function doc(id, routing, failed = []) {
  return { id, routing, status: 'extracted', failed_rules: failed };
}
function corrected(document_id, changes, who = 'Ana') {
  return {
    document_id,
    user_name: who,
    detail: { field_changes: changes.map(([field, from, to]) => ({ field, old_value: from, new_value: to })) },
  };
}

describe('summariseFeedback', () => {
  it('counts fields, touch rate per routing and operators', () => {
    const documents = [doc('a', 'auto'), doc('b', 'hitl_optional'), doc('c', 'hitl_required', ['tpo_format']), doc('d', 'hitl_optional')];
    const events = [
      corrected('b', [['numar_tpo', 'TP0-1', 'TPO-1'], ['numar_auto', 'B33OSRS', 'B 330 SRS']]),
      corrected('c', [['numar_tpo', null, 'TPO-2']], 'Ion'),
      corrected('zz', [['tip_marfa', 'x', 'y']]), // extracted before the window
    ];
    const out = summariseFeedback({ events, documents });
    expect(out.documents).toMatchObject({ total: 4, touched: 2, touched_outside_window: 1, touch_rate: 0.5, corrections: 4 });
    expect(out.fields[0]).toMatchObject({ field: 'numar_tpo', label: 'TPO', critical: true, corrections: 2, documents: 2, doc_rate: 0.5 });
    expect(out.fields[0].examples[0]).toEqual({ from: 'TP0-1', to: 'TPO-1' });
    expect(out.routing.auto).toEqual({ total: 1, touched: 0, touch_rate: 0 });
    expect(out.routing.hitl_optional).toEqual({ total: 2, touched: 1, touch_rate: 0.5 });
    expect(out.routing.hitl_required).toEqual({ total: 1, touched: 1, touch_rate: 1 });
    expect(out.rules).toEqual([{ rule: 'tpo_format', documents: 1, doc_rate: 0.25 }]);
    expect(out.operators).toEqual([{ name: 'Ana', corrections: 3 }, { name: 'Ion', corrections: 1 }]);
    expect(out.enough_data).toBe(false);
    expect(out.suggestions).toEqual([]);
  });

  it('falls back to detail.corrections for older events', () => {
    const out = summariseFeedback({
      documents: [doc('a', 'auto')],
      events: [{ document_id: 'a', detail: { corrections: { numar_auto: 'B 1 ABC' } } }],
    });
    expect(out.fields[0]).toMatchObject({ field: 'numar_auto', corrections: 1 });
  });

  it('speaks a suggestion only past the minimum sample', () => {
    const documents = Array.from({ length: SUGGESTION_MIN_DOCS }, (_, i) => doc(`d${i}`, 'auto'));
    const hot = Math.ceil(SUGGESTION_MIN_DOCS * FIELD_HOT_RATE) + 1;
    const events = Array.from({ length: hot }, (_, i) => corrected(`d${i}`, [['ruta_transport', 'a', 'b']]));
    const out = summariseFeedback({ events, documents });
    expect(out.enough_data).toBe(true);
    expect(out.suggestions.map((s) => s.kind)).toContain('field_hot');
    // 4 of 10 auto docs corrected → the auto band is letting misses through
    expect(out.suggestions.map((s) => s.kind)).toContain('miss');

    // One document short of the sample: same data, no suggestion.
    const quiet = summariseFeedback({ events, documents: documents.slice(1) });
    expect(quiet.enough_data).toBe(false);
    expect(quiet.suggestions).toEqual([]);
  });

  it('is empty-safe', () => {
    const out = summariseFeedback({});
    expect(out.documents.total).toBe(0);
    expect(out.documents.touch_rate).toBeNull();
    expect(out.fields).toEqual([]);
  });
});
