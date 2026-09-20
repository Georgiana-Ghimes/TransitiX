import { describe, expect, it } from 'vitest';
import { AVIZ_FORM_FIELDS, AVIZ_SOURCE_OPTIONS, STATUS_LABEL, nextAvizStatusOnSave } from './avizAnnex.js';
import { ANNEX_SOURCE_KEYS } from '../../server/src/lib/avizTemplate.js';

describe('avizAnnex field map', () => {
  it('lists the 14 fields the Editează form can save', () => {
    expect(AVIZ_FORM_FIELDS.map((f) => f.key)).toEqual([
      'numar_tpo',
      'data_efectuare_cursa',
      'valoare_tpo',
      'numar_auto',
      'ruta_transport',
      'tip_marfa',
      'cantitate_marfa',
      'net_weight_kg',
      // Weighbridge figure: editable on the form, fed into Anexa “Cantitate” as tons, not a
      // separate column on the locked RAI A–N layout.
      'gross_weight_kg',
      'numar_document_marfa',
      'numar_curse',
      'taxe_suplimentare',
      'km_parcursi',
      'tarif_km',
      'observatii',
    ]);
  });

  it('keeps every XLSX annex source editable on the form (except generated Nr. crt)', () => {
    const formKeys = AVIZ_FORM_FIELDS.map((f) => f.key);
    expect(formKeys).toEqual(expect.arrayContaining(
      ANNEX_SOURCE_KEYS.filter((key) => key !== 'nr_crt')
    ));
    expect(formKeys).toContain('gross_weight_kg');
    expect(formKeys).toContain('net_weight_kg');
  });

  it('exposes Nr. crt plus every form field as template sources', () => {
    expect(AVIZ_SOURCE_OPTIONS.map((o) => o.value)).toEqual([
      'nr_crt',
      ...AVIZ_FORM_FIELDS.map((f) => f.key),
    ]);
  });

  it('labels row status in Romanian', () => {
    expect(STATUS_LABEL).toEqual({
      uploaded: 'Se procesează…',
      extracted: 'Extras',
      confirmed: 'Confirmat',
    });
  });

  it('keeps Confirmat when Editează saves', () => {
    expect(nextAvizStatusOnSave('uploaded')).toBe('extracted');
    expect(nextAvizStatusOnSave('extracted')).toBe('extracted');
    expect(nextAvizStatusOnSave('confirmed')).toBe('confirmed');
  });
});
