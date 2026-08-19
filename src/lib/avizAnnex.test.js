import { describe, expect, it } from 'vitest';
import { AVIZ_FORM_FIELDS, AVIZ_SOURCE_OPTIONS, STATUS_LABEL, nextAvizStatusOnSave } from './avizAnnex.js';
import { ANNEX_SOURCE_KEYS } from '../../server/src/lib/avizTemplate.js';

describe('avizAnnex field map', () => {
  it('lists the 13 annex fields the Editează form can save', () => {
    expect(AVIZ_FORM_FIELDS.map((f) => f.key)).toEqual([
      'numar_tpo',
      'data_efectuare_cursa',
      'valoare_tpo',
      'numar_auto',
      'ruta_transport',
      'tip_marfa',
      'cantitate_marfa',
      'numar_document_marfa',
      'numar_curse',
      'taxe_suplimentare',
      'km_parcursi',
      'tarif_km',
      'observatii',
    ]);
  });

  it('keeps form keys aligned with the XLSX annex sources (except generated Nr. crt)', () => {
    expect(AVIZ_FORM_FIELDS.map((f) => f.key)).toEqual(
      ANNEX_SOURCE_KEYS.filter((key) => key !== 'nr_crt')
    );
  });

  it('exposes Nr. crt plus every form field as template sources', () => {
    expect(AVIZ_SOURCE_OPTIONS.map((o) => o.value)).toEqual([
      'nr_crt',
      ...AVIZ_FORM_FIELDS.map((f) => f.key),
    ]);
  });

  it('labels row status in Romanian', () => {
    expect(STATUS_LABEL).toEqual({
      uploaded: 'Încărcat',
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
