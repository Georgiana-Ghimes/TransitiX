import type { LoadPlan, LoadUnit, Placement, Rotation } from './types';

export const PLAN_VERSION = 1 as const;

export function emptyPlan(vehicleId: string, loadUnits: LoadUnit[] = []): LoadPlan {
  return { vehicleId, placements: [], loadUnits, version: PLAN_VERSION };
}

export function exportPlan(plan: LoadPlan): LoadPlan {
  return {
    version: PLAN_VERSION,
    vehicleId: plan.vehicleId,
    loadUnits: plan.loadUnits.map((u) => ({ ...u, dimensions: { ...u.dimensions } })),
    placements: plan.placements.map((p) => ({ ...p, position: { ...p.position } })),
    savedAt: new Date().toISOString(),
  };
}

export function exportPlanJson(plan: LoadPlan, pretty = true): string {
  return JSON.stringify(exportPlan(plan), null, pretty ? 2 : 0);
}

export class PlanImportError extends Error {}

const VALID_ROTATIONS: Rotation[] = [0, 90, 180, 270];

function asRotation(value: unknown): Rotation {
  const num = Number(value);
  return (VALID_ROTATIONS as number[]).includes(num) ? (num as Rotation) : 0;
}

function asNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Parses an exported plan back into the domain model.
 *
 * Deliberately strict about structure and forgiving about individual values: a file that is
 * not a plan must fail loudly, but a plan missing an optional field should still open.
 * Placements referring to load units that are not in the file are dropped rather than left
 * dangling — a placement with no unit cannot be drawn, measured or weighed.
 */
export function importPlan(input: unknown): LoadPlan {
  const raw = typeof input === 'string' ? safeParse(input) : input;
  if (!raw || typeof raw !== 'object') throw new PlanImportError('Fișierul nu conține un plan valid');

  const candidate = raw as Partial<LoadPlan>;
  if (typeof candidate.vehicleId !== 'string' || !candidate.vehicleId) {
    throw new PlanImportError('Planul nu specifică vehiculul');
  }
  if (!Array.isArray(candidate.loadUnits) || !Array.isArray(candidate.placements)) {
    throw new PlanImportError('Planul nu conține unități de încărcare și poziții');
  }
  if (candidate.version != null && Number(candidate.version) !== PLAN_VERSION) {
    throw new PlanImportError(`Versiune de plan nesuportată: ${String(candidate.version)}`);
  }

  const loadUnits: LoadUnit[] = candidate.loadUnits
    .filter((u): u is LoadUnit => Boolean(u) && typeof (u as LoadUnit).id === 'string')
    .map((u) => ({
      ...u,
      dimensions: {
        lengthMm: asNumber(u.dimensions?.lengthMm, 1200),
        widthMm: asNumber(u.dimensions?.widthMm, 800),
        heightMm: asNumber(u.dimensions?.heightMm, 1000),
      },
      weightKg: asNumber(u.weightKg),
      quantity: Math.max(1, Math.trunc(asNumber(u.quantity, 1))),
      stackable: u.stackable !== false,
    }));

  const knownUnits = new Set(loadUnits.map((u) => u.id));

  const placements: Placement[] = candidate.placements
    .filter((p): p is Placement => Boolean(p) && typeof (p as Placement).loadUnitId === 'string')
    .filter((p) => knownUnits.has(p.loadUnitId))
    .map((p, index) => ({
      id: typeof p.id === 'string' && p.id ? p.id : `imported-${index}`,
      loadUnitId: p.loadUnitId,
      position: {
        x: asNumber(p.position?.x),
        y: asNumber(p.position?.y),
        z: asNumber(p.position?.z),
      },
      rotation: asRotation(p.rotation),
      quantity: Math.max(1, Math.trunc(asNumber(p.quantity, 1))),
      sectionId: typeof p.sectionId === 'string' ? p.sectionId : undefined,
    }));

  return {
    version: PLAN_VERSION,
    vehicleId: candidate.vehicleId,
    loadUnits,
    placements,
    savedAt: typeof candidate.savedAt === 'string' ? candidate.savedAt : undefined,
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new PlanImportError('Fișierul nu este JSON valid');
  }
}

/** How many instances of a load unit are currently placed. */
export function placedCountFor(plan: LoadPlan, loadUnitId: string): number {
  return plan.placements.reduce((n, p) => (p.loadUnitId === loadUnitId ? n + 1 : n), 0);
}
