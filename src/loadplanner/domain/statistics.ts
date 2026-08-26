import { indexLoadUnits, placementsToBoxes, vehicleFloorCapacity, vehicleVolumeM3 } from './geometry';
import { UNIT_PRESETS } from './loadUnits';
import type { LoadPlan, VehicleStatistics, VehicleTemplate } from './types';
import { axleLoads, totalCargoWeightKg, usedVolumeM3 } from '../planner/weight';

/**
 * "Pallet spaces" is measured in europallet floor positions, because that is the unit the
 * trade quotes capacity in. It is derived from the cargo geometry, never hardcoded — a
 * 13.6 m curtainsider comes out at 33 because 33 is what fits, not because someone typed it.
 */
export function palletSpaceCapacity(vehicle: VehicleTemplate): number {
  const euro = UNIT_PRESETS.euro_pallet;
  return vehicleFloorCapacity(vehicle, {
    lengthMm: euro.lengthMm,
    widthMm: euro.widthMm,
    heightMm: euro.heightMm,
  });
}

/** Floor footprint of the load expressed in europallet equivalents. */
export function usedPalletSpaces(plan: LoadPlan): number {
  const byId = indexLoadUnits(plan.loadUnits);
  const euro = UNIT_PRESETS.euro_pallet;
  const euroArea = euro.lengthMm * euro.widthMm;
  const boxes = placementsToBoxes(plan.placements, byId);
  // Only what touches the floor consumes a pallet space; stacked units ride along.
  const floorArea = boxes
    .filter((b) => b.z <= 1)
    .reduce((sum, b) => sum + b.lengthMm * b.widthMm, 0);
  return Math.round((floorArea / euroArea) * 10) / 10;
}

export function computeStatistics(vehicle: VehicleTemplate, plan: LoadPlan): VehicleStatistics {
  const byId = indexLoadUnits(plan.loadUnits);
  const boxes = placementsToBoxes(plan.placements, byId);

  const capacityM3 = Math.round(vehicleVolumeM3(vehicle) * 100) / 100;
  const usedM3 = usedVolumeM3(boxes);
  const usedKg = totalCargoWeightKg(boxes);
  const spaceCapacity = palletSpaceCapacity(vehicle);
  const spacesUsed = usedPalletSpaces(plan);

  return {
    volume: {
      usedM3,
      capacityM3,
      ratio: capacityM3 > 0 ? usedM3 / capacityM3 : 0,
    },
    weight: {
      usedKg,
      maxPayloadKg: vehicle.maxPayloadKg,
      ratio: vehicle.maxPayloadKg > 0 ? usedKg / vehicle.maxPayloadKg : 0,
    },
    palletSpaces: {
      used: spacesUsed,
      capacity: spaceCapacity,
      ratio: spaceCapacity > 0 ? spacesUsed / spaceCapacity : 0,
    },
    placedCount: boxes.length,
    axles: axleLoads(boxes, vehicle),
  };
}
