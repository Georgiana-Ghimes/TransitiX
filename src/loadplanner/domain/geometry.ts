import type {
  Box,
  CargoArea,
  CargoSection,
  Dimensions,
  LoadUnit,
  Millimetres,
  Placement,
  Rotation,
  VehicleTemplate,
} from './types';

/** Footprint after rotation. 90° and 270° swap length and width; height never changes. */
export function rotatedFootprint(dimensions: Dimensions, rotation: Rotation): {
  lengthMm: Millimetres;
  widthMm: Millimetres;
  heightMm: Millimetres;
} {
  const swapped = rotation === 90 || rotation === 270;
  return {
    lengthMm: swapped ? dimensions.widthMm : dimensions.lengthMm,
    widthMm: swapped ? dimensions.lengthMm : dimensions.widthMm,
    heightMm: dimensions.heightMm,
  };
}

/** All cargo sections of a vehicle, primary first. */
export function cargoSections(vehicle: VehicleTemplate): CargoSection[] {
  return [
    { id: 'main', label: 'Principal', offsetMm: 0, cargo: vehicle.cargo },
    ...(vehicle.extraSections ?? []),
  ];
}

export function findSection(vehicle: VehicleTemplate, sectionId?: string): CargoSection {
  const sections = cargoSections(vehicle);
  return sections.find((s) => s.id === (sectionId ?? 'main')) ?? sections[0];
}

export function cargoVolumeM3(cargo: CargoArea): number {
  return (cargo.lengthMm * cargo.widthMm * cargo.heightMm) / 1_000_000_000;
}

export function vehicleVolumeM3(vehicle: VehicleTemplate): number {
  return cargoSections(vehicle).reduce((sum, s) => sum + cargoVolumeM3(s.cargo), 0);
}

/** Total drawn length of the vehicle including every section and the gap between them. */
export function vehicleSpanMm(vehicle: VehicleTemplate): Millimetres {
  return cargoSections(vehicle).reduce(
    (max, s) => Math.max(max, s.offsetMm + s.cargo.lengthMm),
    0
  );
}

/**
 * Turns a placement into the axis-aligned box the collision and weight engines work on.
 * Returns null when the placement points at a load unit that no longer exists.
 */
export function placementToBox(
  placement: Placement,
  loadUnitsById: Map<string, LoadUnit>
): Box | null {
  const unit = loadUnitsById.get(placement.loadUnitId);
  if (!unit) return null;
  const footprint = rotatedFootprint(unit.dimensions, placement.rotation);
  return {
    id: placement.id,
    x: placement.position.x,
    y: placement.position.y,
    z: placement.position.z,
    lengthMm: footprint.lengthMm,
    widthMm: footprint.widthMm,
    heightMm: footprint.heightMm,
    weightKg: unit.weightKg,
    loadUnitId: unit.id,
    stopNumber: unit.stopNumber,
    stackable: unit.stackable,
    maxStackWeightKg: unit.maxStackWeightKg,
  };
}

export function placementsToBoxes(
  placements: Placement[],
  loadUnitsById: Map<string, LoadUnit>
): Box[] {
  const boxes: Box[] = [];
  for (const placement of placements) {
    const box = placementToBox(placement, loadUnitsById);
    if (box) boxes.push(box);
  }
  return boxes;
}

export function indexLoadUnits(units: LoadUnit[]): Map<string, LoadUnit> {
  return new Map(units.map((u) => [u.id, u]));
}

/**
 * How many units of a given footprint fit on the floor of a cargo area.
 *
 * Pure geometry by default: both orientations are tried, plus the mixed layout where most of
 * the bay uses one orientation and the strip at the doors takes the other.
 *
 * A 13.6 m curtainsider comes out at 34 europallets this way (17 rows of 2, turned sideways),
 * not the 33 the trade quotes. Both are right: 34 is what fits edge to edge, 33 is what fits
 * once you leave room to get a pallet truck between them. `clearanceMm` is that allowance -
 * pass a few centimetres to get the conventional figure. Neither number is hardcoded.
 */
export function floorCapacity(
  cargo: CargoArea,
  unit: Dimensions,
  { clearanceMm = 0 }: { clearanceMm?: Millimetres } = {}
): number {
  const pad = Math.max(0, clearanceMm);
  const fitCount = (l: Millimetres, w: Millimetres): number => {
    if (l <= 0 || w <= 0) return 0;
    return Math.floor(cargo.lengthMm / (l + pad)) * Math.floor(cargo.widthMm / (w + pad));
  };

  const lengthwise = fitCount(unit.lengthMm, unit.widthMm);
  const crosswise = fitCount(unit.widthMm, unit.lengthMm);

  // Mixed: fill rows in one orientation, then use the remaining length for the other.
  const mixed = (aL: Millimetres, aW: Millimetres, bL: Millimetres, bW: Millimetres): number => {
    if (aL <= 0 || aW <= 0 || bL <= 0 || bW <= 0) return 0;
    const perRow = Math.floor(cargo.widthMm / (aW + pad));
    if (!perRow) return 0;
    const rows = Math.floor(cargo.lengthMm / (aL + pad));
    const leftover = cargo.lengthMm - rows * (aL + pad);
    const tail = Math.floor(leftover / (bL + pad)) * Math.floor(cargo.widthMm / (bW + pad));
    return rows * perRow + tail;
  };

  return Math.max(
    lengthwise,
    crosswise,
    mixed(unit.lengthMm, unit.widthMm, unit.widthMm, unit.lengthMm),
    mixed(unit.widthMm, unit.lengthMm, unit.lengthMm, unit.widthMm)
  );
}

/** Floor capacity across every section of the vehicle. */
export function vehicleFloorCapacity(
  vehicle: VehicleTemplate,
  unit: Dimensions,
  options?: { clearanceMm?: Millimetres }
): number {
  return cargoSections(vehicle).reduce((sum, s) => sum + floorCapacity(s.cargo, unit, options), 0);
}
