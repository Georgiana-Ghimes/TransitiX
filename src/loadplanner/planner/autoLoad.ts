import { cargoSections, rotatedFootprint } from '../domain/geometry';
import { nextId } from '../domain/loadUnits';
import type {
  Box,
  CargoSection,
  LoadUnit,
  Placement,
  Rotation,
  VehicleTemplate,
} from '../domain/types';
import { EPS, boxesCollide } from './collision';
import { restingHeight } from './snapping';

export type AutoLoadOptions = {
  /** Try stacking when the floor is full. */
  allowStacking?: boolean;
  /** Rotations the placer may use. */
  rotations?: Rotation[];
  /** Grid resolution for candidate positions. Smaller packs tighter but costs more time. */
  stepMm?: number;
};

export type AutoLoadResult = {
  placements: Placement[];
  /** Units that could not be placed, with how many were left over. */
  unplaced: Array<{ loadUnit: LoadUnit; quantity: number }>;
};

/**
 * First-fit auto loader.
 *
 * Order of business, deliberately simple and replaceable: goods for the last stop go in
 * first so they end up at the front wall and come out last. Within a stop, heavier and
 * bulkier units go first, which keeps mass low and forward.
 *
 * This is a baseline, not an optimiser. The signature is the seam: swap this function for a
 * real solver and nothing else in the module has to change.
 */
export function autoLoad(
  vehicle: VehicleTemplate,
  loadUnits: LoadUnit[],
  options: AutoLoadOptions = {}
): AutoLoadResult {
  const {
    allowStacking = true,
    rotations = [0, 90],
    stepMm = 100,
  } = options;

  const sections = cargoSections(vehicle);
  const placements: Placement[] = [];
  const placed: Box[] = [];
  const unplaced: AutoLoadResult['unplaced'] = [];

  const queue = [...loadUnits].sort(compareForLoading);

  for (const unit of queue) {
    let remaining = unit.quantity;

    while (remaining > 0) {
      const spot = findSpot(unit, sections, placed, { allowStacking, rotations, stepMm });
      if (!spot) break;

      const footprint = rotatedFootprint(unit.dimensions, spot.rotation);
      const placement: Placement = {
        id: nextId('pl'),
        loadUnitId: unit.id,
        position: { x: spot.x, y: spot.y, z: spot.z },
        rotation: spot.rotation,
        quantity: 1,
        sectionId: spot.sectionId,
      };
      placements.push(placement);
      placed.push({
        id: placement.id,
        x: spot.x,
        y: spot.y,
        z: spot.z,
        lengthMm: footprint.lengthMm,
        widthMm: footprint.widthMm,
        heightMm: footprint.heightMm,
        weightKg: unit.weightKg,
        loadUnitId: unit.id,
        stopNumber: unit.stopNumber,
        stackable: unit.stackable,
        maxStackWeightKg: unit.maxStackWeightKg,
      });
      remaining -= 1;
    }

    if (remaining > 0) unplaced.push({ loadUnit: unit, quantity: remaining });
  }

  return { placements, unplaced };
}

/** Later stops load first; then heavier, then bulkier. */
export function compareForLoading(a: LoadUnit, b: LoadUnit): number {
  const stopA = a.stopNumber ?? 0;
  const stopB = b.stopNumber ?? 0;
  if (stopA !== stopB) return stopB - stopA;
  if (a.weightKg !== b.weightKg) return b.weightKg - a.weightKg;
  return volumeOf(b) - volumeOf(a);
}

function volumeOf(unit: LoadUnit): number {
  return unit.dimensions.lengthMm * unit.dimensions.widthMm * unit.dimensions.heightMm;
}

type Spot = { x: number; y: number; z: number; rotation: Rotation; sectionId: string };

function findSpot(
  unit: LoadUnit,
  sections: CargoSection[],
  placed: Box[],
  options: Required<Pick<AutoLoadOptions, 'allowStacking' | 'rotations' | 'stepMm'>>
): Spot | null {
  for (const section of sections) {
    const inSection = placed.filter((b) => b.x >= section.offsetMm - EPS
      && b.x < section.offsetMm + section.cargo.lengthMm + EPS);

    for (const rotation of options.rotations) {
      const footprint = rotatedFootprint(unit.dimensions, rotation);
      const maxX = section.cargo.lengthMm - footprint.lengthMm;
      const maxY = section.cargo.widthMm - footprint.widthMm;
      if (maxX < -EPS || maxY < -EPS) continue;

      // Front wall to doors, driver side to kerb — the order a loader actually works in.
      for (let x = 0; x <= maxX + EPS; x += options.stepMm) {
        for (let y = 0; y <= maxY + EPS; y += options.stepMm) {
          const candidate: Box = {
            id: '__candidate__',
            x, y, z: 0,
            lengthMm: footprint.lengthMm,
            widthMm: footprint.widthMm,
            heightMm: footprint.heightMm,
            weightKg: unit.weightKg,
            loadUnitId: unit.id,
            stopNumber: unit.stopNumber,
            stackable: unit.stackable,
            maxStackWeightKg: unit.maxStackWeightKg,
          };

          candidate.z = options.allowStacking ? restingHeight(candidate, inSection) : 0;
          if (candidate.z > 0 && !canStackHere(candidate, inSection)) continue;
          if (candidate.z + footprint.heightMm > section.cargo.heightMm + EPS) continue;
          if (inSection.some((other) => boxesCollide(candidate, other))) continue;

          return { x, y, z: candidate.z, rotation, sectionId: section.id };
        }
      }
    }
  }
  return null;
}

/** Everything directly under the candidate must allow being stacked on. */
function canStackHere(candidate: Box, placed: Box[]): boolean {
  const below = placed.filter((other) => (
    Math.abs(other.z + other.heightMm - candidate.z) <= EPS
    && other.x < candidate.x + candidate.lengthMm && candidate.x < other.x + other.lengthMm
    && other.y < candidate.y + candidate.widthMm && candidate.y < other.y + other.widthMm
  ));
  if (!below.length) return false;
  return below.every((other) => other.stackable);
}
