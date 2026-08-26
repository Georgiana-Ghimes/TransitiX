import type { AxleLoad, Box, VehicleTemplate } from '../domain/types';

/**
 * Axle load distribution.
 *
 * Deliberately a static beam model: each box's mass acts at its own centre of gravity along
 * x, and is shared between the two nearest axles in inverse proportion to distance. Load
 * ahead of the first axle or behind the last is carried entirely by that end axle.
 *
 * This is not a suspension model — no roll, no load transfer, no fifth-wheel geometry. It is
 * accurate enough to catch the mistakes that matter in planning (all the weight at the nose,
 * all of it over the rear) and is structured so a real model can replace `distributeBox`
 * without touching anything else.
 */

function centreOfGravityX(box: Box): number {
  return box.x + box.lengthMm / 2;
}

/** Spreads one box's weight over the axle set. Returns kg per axle id. */
export function distributeBox(box: Box, vehicle: VehicleTemplate): Map<string, number> {
  const result = new Map<string, number>();
  const axles = [...vehicle.axles].sort((a, b) => a.positionMm - b.positionMm);
  if (!axles.length) return result;

  const cog = centreOfGravityX(box);

  if (axles.length === 1 || cog <= axles[0].positionMm) {
    result.set(axles[0].id, box.weightKg);
    return result;
  }
  const last = axles[axles.length - 1];
  if (cog >= last.positionMm) {
    result.set(last.id, box.weightKg);
    return result;
  }

  for (let i = 0; i < axles.length - 1; i += 1) {
    const left = axles[i];
    const right = axles[i + 1];
    if (cog < left.positionMm || cog > right.positionMm) continue;
    const span = right.positionMm - left.positionMm;
    if (span <= 0) {
      result.set(left.id, box.weightKg);
      return result;
    }
    const toRight = (cog - left.positionMm) / span;
    result.set(left.id, box.weightKg * (1 - toRight));
    result.set(right.id, box.weightKg * toRight);
    return result;
  }

  result.set(last.id, box.weightKg);
  return result;
}

/** Axle loads for a whole load, including each axle's unladen share. */
export function axleLoads(boxes: Box[], vehicle: VehicleTemplate): AxleLoad[] {
  const totals = new Map<string, number>();
  for (const axle of vehicle.axles) totals.set(axle.id, axle.tareShareKg ?? 0);

  for (const box of boxes) {
    for (const [axleId, kg] of distributeBox(box, vehicle)) {
      totals.set(axleId, (totals.get(axleId) ?? 0) + kg);
    }
  }

  return vehicle.axles.map((axle) => {
    const loadKg = Math.round((totals.get(axle.id) ?? 0) * 10) / 10;
    return {
      id: axle.id,
      label: axle.label,
      loadKg,
      maxWeightKg: axle.maxWeightKg,
      utilisation: axle.maxWeightKg > 0 ? loadKg / axle.maxWeightKg : 0,
      overloaded: loadKg > axle.maxWeightKg,
    };
  });
}

export function totalCargoWeightKg(boxes: Box[]): number {
  return Math.round(boxes.reduce((sum, b) => sum + b.weightKg, 0) * 10) / 10;
}

export function usedVolumeM3(boxes: Box[]): number {
  const mm3 = boxes.reduce((sum, b) => sum + b.lengthMm * b.widthMm * b.heightMm, 0);
  return Math.round((mm3 / 1_000_000_000) * 1000) / 1000;
}

/**
 * Which placed boxes contribute most to a given axle — the answer to "why is this overloaded".
 */
export function axleContributors(
  boxes: Box[],
  vehicle: VehicleTemplate,
  axleId: string,
  limit = 5
): Array<{ box: Box; kg: number }> {
  return boxes
    .map((box) => ({ box, kg: distributeBox(box, vehicle).get(axleId) ?? 0 }))
    .filter((entry) => entry.kg > 0)
    .sort((a, b) => b.kg - a.kg)
    .slice(0, limit);
}
