import { describe, expect, it } from 'vitest';
import { displayRoute, emptyForm, isLockedRai, lowField } from './avizeUi.js';

describe('avizeUi', () => {
  it('locks the default Anexa Factura RAI template', () => {
    expect(isLockedRai({ is_default: true, name: 'Anexa Factura RAI' })).toBe(true);
    expect(isLockedRai({ is_default: false, name: 'Anexa Factura RAI' })).toBe(false);
  });

  it('prefers office ruta_display over parser route', () => {
    expect(displayRoute({ ruta_display: 'Militari', ruta_transport: 'Client → Livrare' })).toBe('Militari');
    expect(displayRoute({ ruta_transport: 'Client → Livrare' })).toBe('Client → Livrare');
  });

  it('marks low-confidence fields', () => {
    expect(lowField({ field_confidence: { numar_tpo: 'low' } }, 'numar_tpo')).toBe(true);
    expect(lowField({}, 'numar_tpo')).toBe(false);
  });

  it('seeds edit form from a row including trip_id', () => {
    const form = emptyForm({ numar_tpo: 'TPO-1', trip_id: 'trip-9', ruta_display: 'B' });
    expect(form.numar_tpo).toBe('TPO-1');
    expect(form.trip_id).toBe('trip-9');
    expect(form.ruta_display).toBe('B');
  });
});
