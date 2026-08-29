export const AVIZ_FORM_FIELDS = [
  { key: 'numar_tpo', label: 'Număr TPO' },
  { key: 'data_efectuare_cursa', label: 'Data efectuare cursă', type: 'date' },
  { key: 'valoare_tpo', label: 'Valoare TPO', type: 'number', step: '0.01' },
  { key: 'numar_auto', label: 'Număr auto' },
  { key: 'ruta_transport', label: 'Rută transport' },
  { key: 'tip_marfa', label: 'Tip marfă' },
  { key: 'cantitate_marfa', label: 'Cantitate marfă', type: 'number', step: '0.001' },
  { key: 'numar_document_marfa', label: 'Număr document marfă' },
  { key: 'numar_curse', label: 'Număr curse', type: 'number', step: '1' },
  { key: 'taxe_suplimentare', label: 'Taxe suplimentare', type: 'number', step: '0.01' },
  { key: 'km_parcursi', label: 'Km parcurși', type: 'number', step: '0.01' },
  { key: 'tarif_km', label: 'Tarif km', type: 'number', step: '0.0001' },
  { key: 'observatii', label: 'Observații' },
];

export const AVIZ_SOURCE_OPTIONS = [
  { value: 'nr_crt', label: 'Nr. Crt. (generat)' },
  ...AVIZ_FORM_FIELDS.map((f) => ({ value: f.key, label: f.label })),
];

export const STATUS_LABEL = {
  uploaded: 'Se procesează…',
  extracted: 'Extras',
  confirmed: 'Confirmat',
};

/** Salvează must not demote Confirmat; uploaded becomes extracted. */
export function nextAvizStatusOnSave(current) {
  if (current === 'uploaded') return 'extracted';
  return current || 'extracted';
}
