import { findSection, indexLoadUnits, placementToBox, placementsToBoxes } from '../domain/geometry';
import type {
  Box,
  LoadPlan,
  LoadUnit,
  Placement,
  ValidationError,
  ValidationResult,
  VehicleTemplate,
} from '../domain/types';
import { boundsViolations, findCollisions, supportRatio, weightAbove } from '../planner/collision';
import { axleLoads, totalCargoWeightKg } from '../planner/weight';

/** Below this share of the footprint resting on something, a stack is unstable. */
const MIN_SUPPORT_RATIO = 0.6;

const BOUNDS_CODE = {
  length: 'out_of_bounds_length',
  width: 'out_of_bounds_width',
  height: 'out_of_bounds_height',
} as const;

const BOUNDS_LABEL = { length: 'lungime', width: 'lățime', height: 'înălțime' } as const;

function empty(): ValidationResult {
  return { ok: true, errors: [], warnings: [] };
}

function collect(findings: ValidationError[]): ValidationResult {
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Validates a single placement against the vehicle and everything already loaded.
 *
 * This is the check the drag interaction runs on every drop, so it deliberately looks at one
 * candidate rather than re-validating the whole plan.
 */
export function validatePlacement(
  vehicle: VehicleTemplate,
  loadUnits: LoadUnit[],
  placement: Placement,
  existing: Placement[] = []
): ValidationResult {
  const byId = indexLoadUnits(loadUnits);
  const box = placementToBox(placement, byId);
  if (!box) return empty();

  const section = findSection(vehicle, placement.sectionId);
  const others = placementsToBoxes(
    existing.filter((p) => p.id !== placement.id && (p.sectionId ?? 'main') === (placement.sectionId ?? 'main')),
    byId
  );

  const findings: ValidationError[] = [];

  for (const violation of boundsViolations(box, section.cargo)) {
    findings.push({
      code: BOUNDS_CODE[violation.axis],
      severity: 'error',
      message: `Depășire ${BOUNDS_LABEL[violation.axis]} cu ${violation.overBy} mm`,
      placementIds: [placement.id],
      overBy: violation.overBy,
    });
  }

  for (const hit of findCollisions(box, others)) {
    findings.push({
      code: 'collision',
      severity: 'error',
      message: 'Se suprapune cu altă unitate încărcată',
      placementIds: [placement.id, hit.id],
    });
  }

  findings.push(...stackingFindings(box, others));

  return collect(findings);
}

/** Stacking rules for one box resting on others. */
function stackingFindings(box: Box, others: Box[]): ValidationError[] {
  const findings: ValidationError[] = [];
  if (box.z <= 0) return findings;

  const support = supportRatio(box, others);
  if (support < MIN_SUPPORT_RATIO) {
    findings.push({
      code: 'unsupported_stack',
      severity: support === 0 ? 'error' : 'warning',
      message: support === 0
        ? 'Unitatea plutește — nu are nimic dedesubt'
        : `Sprijin insuficient: doar ${Math.round(support * 100)}% din bază este susținută`,
      placementIds: [box.id],
    });
  }

  for (const below of others) {
    const restsOn = Math.abs(below.z + below.heightMm - box.z) <= 1
      && below.x < box.x + box.lengthMm && box.x < below.x + below.lengthMm
      && below.y < box.y + box.widthMm && box.y < below.y + below.widthMm;
    if (!restsOn) continue;

    if (!below.stackable) {
      findings.push({
        code: 'not_stackable',
        severity: 'error',
        message: 'Unitatea de dedesubt nu suportă stivuire',
        placementIds: [box.id, below.id],
      });
    }

    if (below.maxStackWeightKg != null) {
      const carried = weightAbove(below, [...others.filter((o) => o.id !== below.id), box]);
      if (carried > below.maxStackWeightKg) {
        findings.push({
          code: 'stack_weight_exceeded',
          severity: 'error',
          message: `Greutate stivuită depășită cu ${Math.round(carried - below.maxStackWeightKg)} kg`,
          placementIds: [box.id, below.id],
          overBy: Math.round(carried - below.maxStackWeightKg),
        });
      }
    }
  }

  return findings;
}

/**
 * Validates a whole plan: every placement, plus the vehicle-wide limits that only make sense
 * in aggregate (payload, axle loads, unloading order).
 */
export function validatePlan(vehicle: VehicleTemplate, plan: LoadPlan): ValidationResult {
  const byId = indexLoadUnits(plan.loadUnits);
  const findings: ValidationError[] = [];
  const seenPairs = new Set<string>();

  for (const placement of plan.placements) {
    const single = validatePlacement(vehicle, plan.loadUnits, placement, plan.placements);
    for (const finding of [...single.errors, ...single.warnings]) {
      // A collision is symmetric; report it once rather than from both sides.
      if (finding.code === 'collision') {
        const key = [...finding.placementIds].sort().join('|');
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
      }
      findings.push(finding);
    }
  }

  const boxes = placementsToBoxes(plan.placements, byId);

  const cargoKg = totalCargoWeightKg(boxes);
  if (cargoKg > vehicle.maxPayloadKg) {
    findings.push({
      code: 'payload_exceeded',
      severity: 'error',
      message: `Sarcină utilă depășită cu ${Math.round(cargoKg - vehicle.maxPayloadKg)} kg`,
      placementIds: [],
      overBy: Math.round(cargoKg - vehicle.maxPayloadKg),
    });
  }

  for (const axle of axleLoads(boxes, vehicle)) {
    if (!axle.overloaded) continue;
    findings.push({
      code: 'axle_overloaded',
      severity: 'error',
      message: `Axa „${axle.label}" depășită cu ${Math.round(axle.loadKg - axle.maxWeightKg)} kg`,
      placementIds: [],
      axleId: axle.id,
      overBy: Math.round(axle.loadKg - axle.maxWeightKg),
    });
  }

  findings.push(...unloadingOrderFindings(boxes));

  return collect(findings);
}

/**
 * Last-in-first-out check: goods for an early stop must not be buried behind goods for a
 * later one. "Behind" means further from the doors, which sit at the high end of x.
 *
 * A warning rather than an error — a dispatcher may knowingly accept double handling.
 */
export function unloadingOrderFindings(boxes: Box[]): ValidationError[] {
  const findings: ValidationError[] = [];
  const withStop = boxes.filter((b) => b.stopNumber != null);

  for (const box of withStop) {
    for (const other of withStop) {
      if (other.id === box.id) continue;
      if (other.stopNumber == null || box.stopNumber == null) continue;
      // `other` is unloaded later but sits nearer the doors, blocking `box`.
      if (other.stopNumber <= box.stopNumber) continue;
      const blocks = other.x > box.x
        && other.y < box.y + box.widthMm && box.y < other.y + other.widthMm;
      if (!blocks) continue;
      findings.push({
        code: 'unloading_order',
        severity: 'warning',
        message: `Marfa pentru oprirea ${box.stopNumber} este blocată de marfa pentru oprirea ${other.stopNumber}`,
        placementIds: [box.id, other.id],
      });
      break;
    }
  }

  return findings;
}
