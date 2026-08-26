import type { Box, CargoArea, Millimetres } from '../domain/types';
import { EPS, boxesCollide, overlaps1d } from './collision';

/** Anything closer than this to an edge snaps to it. Roughly a finger-width on screen. */
export const SNAP_TOLERANCE_MM = 220;

/**
 * Snaps a dragged box against the cargo walls and the faces of everything already loaded,
 * so pallets end up flush instead of leaving unusable slivers between them.
 *
 * Each axis snaps independently to the nearest candidate within tolerance.
 */
export function snapPosition(
  box: Box,
  others: Box[],
  cargo: CargoArea,
  tolerance: Millimetres = SNAP_TOLERANCE_MM
): { x: Millimetres; y: Millimetres } {
  const xCandidates: number[] = [0, cargo.lengthMm - box.lengthMm];
  const yCandidates: number[] = [0, cargo.widthMm - box.widthMm];

  for (const other of others) {
    if (other.id === box.id) continue;

    // Butt up against another box along x when the two overlap across the width.
    if (overlaps1d(box.y, box.y + box.widthMm, other.y, other.y + other.widthMm)) {
      xCandidates.push(other.x + other.lengthMm, other.x - box.lengthMm);
    }
    // …and along y when they overlap along the length.
    if (overlaps1d(box.x, box.x + box.lengthMm, other.x, other.x + other.lengthMm)) {
      yCandidates.push(other.y + other.widthMm, other.y - box.widthMm);
    }
    // Align edges even when the boxes are not adjacent — keeps rows tidy.
    xCandidates.push(other.x);
    yCandidates.push(other.y);
  }

  return {
    x: snapAxis(box.x, xCandidates, tolerance, 0, cargo.lengthMm - box.lengthMm),
    y: snapAxis(box.y, yCandidates, tolerance, 0, cargo.widthMm - box.widthMm),
  };
}

function snapAxis(
  value: number,
  candidates: number[],
  tolerance: number,
  min: number,
  max: number
): number {
  let best = value;
  let bestDistance = tolerance;
  for (const candidate of candidates) {
    if (candidate < min - EPS || candidate > max + EPS) continue;
    const distance = Math.abs(candidate - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return clamp(Math.round(best), min, max);
}

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

/** Keeps a box fully inside the cargo area without changing its size. */
export function clampToCargo(box: Box, cargo: CargoArea): { x: Millimetres; y: Millimetres } {
  return {
    x: clamp(box.x, 0, Math.max(0, cargo.lengthMm - box.lengthMm)),
    y: clamp(box.y, 0, Math.max(0, cargo.widthMm - box.widthMm)),
  };
}

/**
 * Lowest free height at this footprint — what a dropped box should rest on.
 * Returns 0 for the floor, or the top of whatever it lands on.
 */
export function restingHeight(box: Box, others: Box[]): Millimetres {
  let top = 0;
  for (const other of others) {
    if (other.id === box.id) continue;
    if (!overlaps1d(box.x, box.x + box.lengthMm, other.x, other.x + other.lengthMm)) continue;
    if (!overlaps1d(box.y, box.y + box.widthMm, other.y, other.y + other.widthMm)) continue;
    top = Math.max(top, other.z + other.heightMm);
  }
  return top;
}

/**
 * Nearest free spot for a box that would otherwise collide.
 * Scans outward along x then y on a coarse grid; returns null when nothing fits.
 */
export function findFreeSpot(
  box: Box,
  others: Box[],
  cargo: CargoArea,
  step: Millimetres = 100
): { x: Millimetres; y: Millimetres } | null {
  const maxX = cargo.lengthMm - box.lengthMm;
  const maxY = cargo.widthMm - box.widthMm;
  if (maxX < 0 || maxY < 0) return null;

  for (let x = 0; x <= maxX; x += step) {
    for (let y = 0; y <= maxY; y += step) {
      const candidate = { ...box, x, y, z: 0 };
      candidate.z = restingHeight(candidate, others);
      if (candidate.z + candidate.heightMm > cargo.heightMm + EPS) continue;
      if (others.some((other) => other.id !== box.id && boxesCollide(candidate, other))) continue;
      return { x, y };
    }
  }
  return null;
}
