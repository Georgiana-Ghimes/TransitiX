export const AVIZ_FORM_FIELDS = [
  { key: 'numar_tpo', label: 'Număr TPO' },
  { key: 'data_efectuare_cursa', label: 'Data efectuare cursă', type: 'date' },
  // Text + inputMode, not type=number: spinner / controlled-state fights cleared typed
  // values when tabbing between empty fields (same class of bug as numar_curse).
  { key: 'valoare_tpo', label: 'Valoare TPO', inputMode: 'decimal' },
  { key: 'numar_auto', label: 'Număr auto' },
  { key: 'ruta_transport', label: 'Rută transport' },
  { key: 'tip_marfa', label: 'Tip marfă' },
  { key: 'cantitate_marfa', label: 'Cantitate (saci/galeți/m³)', inputMode: 'decimal' },
  { key: 'gross_weight_kg', label: 'Greutate brută (kg)', inputMode: 'decimal' },
  { key: 'net_weight_kg', label: 'Greutate netă (kg)', inputMode: 'decimal' },
  { key: 'numar_document_marfa', label: 'Număr document marfă' },
  { key: 'numar_curse', label: 'Număr curse', inputMode: 'numeric' },
  { key: 'taxe_suplimentare', label: 'Taxe suplimentare', inputMode: 'decimal' },
  { key: 'km_parcursi', label: 'Km parcurși', inputMode: 'decimal' },
  { key: 'tarif_km', label: 'Tarif km', inputMode: 'decimal' },
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
