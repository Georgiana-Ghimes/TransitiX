import { createLoadUnit } from '../domain/loadUnits';
import type { LoadUnit } from '../domain/types';

/**
 * A believable day's work for a 13.6 m curtainsider: four drops, mixed pallet types,
 * one non-stackable order and a batch of loose parcels.
 */
export function demoLoadUnits(): LoadUnit[] {
  return [
    createLoadUnit({
      id: 'unit-10231',
      type: 'euro_pallet',
      quantity: 8,
      weightKg: 620,
      orderNumber: '10231',
      customer: 'ACME Distribuție SRL',
      stopNumber: 1,
      label: 'Băuturi',
    }),
    createLoadUnit({
      id: 'unit-10232',
      type: 'euro_pallet',
      quantity: 6,
      weightKg: 480,
      orderNumber: '10232',
      customer: 'Metro Cash & Carry',
      stopNumber: 2,
      label: 'Conserve',
    }),
    createLoadUnit({
      id: 'unit-10233',
      type: 'industrial_pallet',
      quantity: 5,
      weightKg: 910,
      orderNumber: '10233',
      customer: 'Profi Rom Food',
      stopNumber: 3,
      stackable: false,
      label: 'Electrocasnice',
    }),
    createLoadUnit({
      id: 'unit-10234',
      type: 'euro_pallet',
      quantity: 9,
      weightKg: 540,
      orderNumber: '10234',
      customer: 'Selgros Cash & Carry',
      stopNumber: 4,
      maxStackWeightKg: 700,
      label: 'Hârtie',
    }),
    createLoadUnit({
      id: 'unit-10235',
      type: 'parcel',
      quantity: 12,
      weightKg: 24,
      orderNumber: '10235',
      customer: 'Curier local',
      stopNumber: 2,
      label: 'Colete',
    }),
  ];
}
