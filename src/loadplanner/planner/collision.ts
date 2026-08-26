import type { Box, CargoArea, Millimetres } from '../domain/types';

/** Sub-millimetre slack, so floating point does not invent overlaps between touching boxes. */
export const EPS = 0.5;

export function overlaps1d(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  return aFrom < bTo - EPS && bFrom < aTo - EPS;
}

/** True when two boxes share volume. Boxes that merely touch do not collide. */
export function boxesCollide(a: Box, b: Box): boolean {
  return (
    overlaps1d(a.x, a.x + a.lengthMm, b.x, b.x + b.lengthMm)
    && overlaps1d(a.y, a.y + a.widthMm, b.y, b.y + b.widthMm)
    && overlaps1d(a.z, a.z + a.heightMm, b.z, b.z + b.heightMm)
  );
}

/** Every other box the candidate collides with. */
export function findCollisions(candidate: Box, others: Box[]): Box[] {
  return others.filter((other) => other.id !== candidate.id && boxesCollide(candidate, other));
}

export type BoundsViolation = {
  axis: 'length' | 'width' | 'height';
  overBy: Millimetres;
};

/** Which cargo dimensions the box exceeds, and by how much. */
export function boundsViolations(box: Box, cargo: CargoArea): BoundsViolation[] {
  const out: BoundsViolation[] = [];
  const checks: Array<{ axis: BoundsViolation['axis']; from: number; to: number; limit: number }> = [
    { axis: 'length', from: box.x, to: box.x + box.lengthMm, limit: cargo.lengthMm },
    { axis: 'width', from: box.y, to: box.y + box.widthMm, limit: cargo.widthMm },
    { axis: 'height', from: box.z, to: box.z + box.heightMm, limit: cargo.heightMm },
  ];
  for (const check of checks) {
    if (check.from < -EPS) out.push({ axis: check.axis, overBy: Math.round(-check.from) });
    else if (check.to > check.limit + EPS) out.push({ axis: check.axis, overBy: Math.round(check.to - check.limit) });
  }
  return out;
}

export function isWithinBounds(box: Box, cargo: CargoArea): boolean {
  return boundsViolations(box, cargo).length === 0;
}

/** Boxes whose top face lies directly under this one — what it rests on. */
export function supportingBoxes(box: Box, others: Box[]): Box[] {
  if (box.z <= EPS) return [];
  return others.filter((other) => (
    other.id !== box.id
    && Math.abs(other.z + other.heightMm - box.z) <= EPS
    && overlaps1d(box.x, box.x + box.lengthMm, other.x, other.x + other.lengthMm)
    && overlaps1d(box.y, box.y + box.widthMm, other.y, other.y + other.widthMm)
  ));
}

/** Fraction of the box footprint resting on something solid, 0..1. */
export function supportRatio(box: Box, others: Box[]): number {
  if (box.z <= EPS) return 1;
  const area = box.lengthMm * box.widthMm;
  if (area <= 0) return 0;
  let supported = 0;
  for (const other of supportingBoxes(box, others)) {
    const dx = Math.max(0, Math.min(box.x + box.lengthMm, other.x + other.lengthMm) - Math.max(box.x, other.x));
    const dy = Math.max(0, Math.min(box.y + box.widthMm, other.y + other.widthMm) - Math.max(box.y, other.y));
    supported += dx * dy;
  }
  return Math.min(1, supported / area);
}

/** Total weight bearing down on a box from everything stacked above it. */
export function weightAbove(box: Box, others: Box[]): number {
  let total = 0;
  for (const other of others) {
    if (other.id === box.id) continue;
    if (other.z + EPS < box.z + box.heightMm) continue;
    if (!overlaps1d(box.x, box.x + box.lengthMm, other.x, other.x + other.lengthMm)) continue;
    if (!overlaps1d(box.y, box.y + box.widthMm, other.y, other.y + other.widthMm)) continue;
    total += other.weightKg;
  }
  return total;
}
