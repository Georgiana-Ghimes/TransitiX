/**
 * Built-in report layouts.
 *
 * A preset is a starting point, not a lock: instantiating one writes an ordinary editable
 * template row. The exception is the RAI annex, whose column order is agreed with the customer
 * and is protected elsewhere (`isLockedRaiTemplate`) precisely so nobody edits it by accident.
 */
import { getSource } from './sources.js';

/**
 * A column defaults to blank, not to zero.
 *
 * A missing weighing printed as `0` reads on a customer's sheet as a truck that went out empty,
 * and it drags the column total down while still looking complete. Blank is the honest cell for
 * "we do not have this figure"; only a column that genuinely has a neutral value — the RAI annex
 * zeros, one trip per aviz — says so explicitly.
 */
function col(source, overrides = {}) {
  const meta = getSource(source);
  return {
    key: overrides.key || source,
    header: overrides.header || meta?.label || source,
    source,
    default_value: overrides.default_value ?? '',
  };
}

export const REPORT_PRESETS = [
  {
    id: 'rai_anexa',
    name: 'Anexa Factura RAI',
    description: 'Anexa contractuală RAI, 14 coloane, în ordinea agreată cu clientul.',
    locked: true,
    columns: [
      col('nr_crt', { header: 'Nr. crt', default_value: '' }),
      col('numar_tpo', { header: 'Numar TPO' }),
      col('data_efectuare_cursa', { header: 'Data efectuare cursa' }),
      col('valoare_tpo', { header: 'Valoare TPO', default_value: 0 }),
      col('numar_auto', { header: 'Numar auto' }),
      col('ruta_transport', { header: 'Ruta transport' }),
      col('tip_marfa', { header: 'Tip marfa' }),
      col('cantitate_marfa', { header: 'Cantitate marfa (t/m3/galeti)', default_value: '' }),
      col('numar_document_marfa', { header: 'Numar document marfa (aviz/factura)' }),
      col('numar_curse', { header: 'Numar curse', default_value: 1 }),
      col('taxe_suplimentare', { header: 'Taxa suplimentara', default_value: 0 }),
      col('km_parcursi', { header: 'Km parcursi', default_value: 0 }),
      col('tarif_km', { header: 'Tarif km', default_value: 0 }),
      col('observatii', { header: 'Observatii' }),
    ],
  },
  {
    // The layout the client described: a delivery sheet checked against the weighbridge, so
    // gross weight is a column of its own and the sack/pallet count sits beside it rather than
    // standing in for it.
    id: 'baumit_greutati',
    name: 'Centralizator Baumit — greutăți',
    description: 'Livrări cu greutate brută și netă pe fiecare aviz, pentru verificare cu cântarul.',
    columns: [
      col('nr_crt', { header: 'Nr. crt', default_value: '' }),
      col('data_efectuare_cursa', { header: 'Data livrare' }),
      col('numar_auto', { header: 'Auto' }),
      col('numar_document_marfa', { header: 'Aviz nr.' }),
      col('numar_tpo', { header: 'TPO' }),
      col('ruta_transport', { header: 'Rută' }),
      col('tip_marfa', { header: 'Produs' }),
      col('cantitate_marfa', { header: 'Cantitate', default_value: '' }),
      col('quantity_unit', { header: 'UM' }),
      col('pallets', { header: 'Paleți' }),
      col('gross_weight_kg', { header: 'Greutate brută (kg)' }),
      col('net_weight_kg', { header: 'Greutate netă (kg)' }),
      col('observatii', { header: 'Observații' }),
    ],
  },
  {
    id: 'centralizator_km',
    name: 'Centralizator km și tarife',
    description: 'Kilometri, tarif și valoare pe cursă, pentru decontul lunar.',
    columns: [
      col('nr_crt', { header: 'Nr. crt', default_value: '' }),
      col('data_efectuare_cursa', { header: 'Data cursă' }),
      col('data_facturare', { header: 'Dată facturare' }),
      col('numar_auto', { header: 'Auto' }),
      col('numar_tpo', { header: 'TPO' }),
      col('ruta_transport', { header: 'Rută' }),
      col('numar_curse', { header: 'Curse', default_value: 1 }),
      col('km_parcursi', { header: 'Km' }),
      col('tarif_km', { header: 'Tarif/km' }),
      col('taxe_suplimentare', { header: 'Taxe' }),
      col('valoare_tpo', { header: 'Valoare' }),
    ],
  },
];

export function getPreset(id) {
  return REPORT_PRESETS.find((p) => p.id === String(id || '')) || null;
}

/** Presets as the template builder shows them: name, description, column count. */
export function listPresets() {
  return REPORT_PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    locked: Boolean(p.locked),
    column_count: p.columns.length,
    sources: p.columns.map((c) => c.source),
  }));
}
