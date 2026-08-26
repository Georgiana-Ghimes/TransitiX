import type { Dimensions, LoadUnit, LoadUnitType } from './types';

/** Standard footprints. Heights are typical loaded heights, not the bare pallet. */
export const UNIT_PRESETS: Record<Exclude<LoadUnitType, 'custom'>, Dimensions & { label: string }> = {
  euro_pallet: { label: 'Europalet', lengthMm: 1200, widthMm: 800, heightMm: 1450 },
  industrial_pallet: { label: 'Palet industrial', lengthMm: 1200, widthMm: 1000, heightMm: 1450 },
  box: { label: 'Ladă', lengthMm: 600, widthMm: 400, heightMm: 400 },
  parcel: { label: 'Colet', lengthMm: 400, widthMm: 300, heightMm: 300 },
  roll: { label: 'Roll container', lengthMm: 800, widthMm: 700, heightMm: 1700 },
};

export function presetFor(type: LoadUnitType): Dimensions {
  if (type === 'custom') return { lengthMm: 1000, widthMm: 800, heightMm: 1000 };
  const preset = UNIT_PRESETS[type];
  return { lengthMm: preset.lengthMm, widthMm: preset.widthMm, heightMm: preset.heightMm };
}

export function unitTypeLabel(type: LoadUnitType): string {
  return type === 'custom' ? 'Personalizat' : UNIT_PRESETS[type].label;
}

let counter = 0;
/** Ids only need to be unique within a plan; a counter keeps them stable and readable. */
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter.toString(36)}-${Date.now().toString(36)}`;
}

export function resetIdCounter(): void {
  counter = 0;
}

export type CreateLoadUnitInput = {
  type: LoadUnitType;
  quantity: number;
  weightKg: number;
  dimensions?: Partial<Dimensions>;
  stackable?: boolean;
  maxStackWeightKg?: number;
  orderNumber?: string;
  stopNumber?: number;
  customer?: string;
  color?: string;
  label?: string;
  id?: string;
};

export function createLoadUnit(input: CreateLoadUnitInput): LoadUnit {
  const base = presetFor(input.type);
  return {
    id: input.id ?? nextId('unit'),
    type: input.type,
    dimensions: {
      lengthMm: input.dimensions?.lengthMm ?? base.lengthMm,
      widthMm: input.dimensions?.widthMm ?? base.widthMm,
      heightMm: input.dimensions?.heightMm ?? base.heightMm,
    },
    weightKg: input.weightKg,
    quantity: Math.max(1, Math.trunc(input.quantity)),
    stackable: input.stackable ?? true,
    maxStackWeightKg: input.maxStackWeightKg,
    orderNumber: input.orderNumber,
    stopNumber: input.stopNumber,
    customer: input.customer,
    color: input.color,
    label: input.label,
  };
}

/** Total weight a load unit record represents, across its quantity. */
export function totalWeightKg(unit: LoadUnit): number {
  return unit.weightKg * unit.quantity;
}

/** How many of a unit are still waiting to be placed. */
export function remainingQuantity(unit: LoadUnit, placedCount: number): number {
  return Math.max(0, unit.quantity - placedCount);
}
