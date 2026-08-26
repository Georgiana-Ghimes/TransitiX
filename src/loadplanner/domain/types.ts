/**
 * Core domain types for the load planner.
 *
 * Units are millimetres and kilograms everywhere in this module. Pixels exist only inside
 * the renderer, which is the single place allowed to convert. Any business rule expressed
 * in pixels would silently change meaning the moment the viewport resizes.
 *
 * Coordinate system (right-handed, origin at the front-left floor corner of the cargo area):
 *   x — along the vehicle length, 0 = front wall (behind the cab), growing toward the doors
 *   y — across the width, 0 = driver side (left, right-hand traffic), growing to the kerb
 *   z — height above the floor, 0 = deck
 */

export type Millimetres = number;
export type Kilograms = number;

export type VehicleCategory =
  | 'van'
  | 'rigid'
  | 'semi'
  | 'mega'
  | 'reefer'
  | 'box'
  | 'container'
  | 'swap'
  | 'drawbar';

/**
 * One axle (or axle group treated as one) with its position along the vehicle.
 *
 * `positionMm` is measured on the same x axis as cargo, so it may be negative for a steer
 * axle that sits ahead of the cargo area's front wall.
 */
export type AxleDefinition = {
  id: string;
  label: string;
  positionMm: Millimetres;
  maxWeightKg: Kilograms;
  /** Weight the axle carries with an empty vehicle, before any cargo is added. */
  tareShareKg?: Kilograms;
};

export type CargoArea = {
  lengthMm: Millimetres;
  widthMm: Millimetres;
  heightMm: Millimetres;
  /**
   * Height of the deck above ground. Only used for drawing; it does not affect placement.
   */
  floorHeightMm?: Millimetres;
};

/**
 * A separately loadable compartment. Most vehicles have exactly one; a drawbar combination
 * has two (truck body + trailer body) which cannot be loaded across.
 */
export type CargoSection = {
  id: string;
  label: string;
  /** Offset of this section's front wall from the vehicle origin. */
  offsetMm: Millimetres;
  cargo: CargoArea;
};

export type VehicleVisualization = {
  type: 'parametric';
  /** Cab silhouette; `none` draws a bare trailer with a kingpin. */
  cabStyle: 'none' | 'van' | 'rigid' | 'tractor';
  bodyStyle: 'box' | 'curtain' | 'reefer' | 'container' | 'platform';
  /** Wheel positions along x, in mm. Purely cosmetic. */
  wheelPositionsMm?: Millimetres[];
};

export type VehicleTemplate = {
  id: string;
  name: string;
  category: VehicleCategory;
  cargo: CargoArea;
  /** Extra sections beyond the primary one (drawbar combinations). */
  extraSections?: CargoSection[];
  chassis?: {
    lengthMm: Millimetres;
    widthMm: Millimetres;
  };
  axles: AxleDefinition[];
  maxPayloadKg: Kilograms;
  visualization: VehicleVisualization;
  /** Free-text note shown in the UI, e.g. typical use or a caveat. */
  note?: string;
};

export type LoadUnitType =
  | 'euro_pallet'
  | 'industrial_pallet'
  | 'box'
  | 'parcel'
  | 'roll'
  | 'custom';

export type Dimensions = {
  lengthMm: Millimetres;
  widthMm: Millimetres;
  heightMm: Millimetres;
};

export type LoadUnit = {
  id: string;
  type: LoadUnitType;
  dimensions: Dimensions;
  weightKg: Kilograms;
  /** How many identical units this record represents. */
  quantity: number;
  stackable: boolean;
  maxStackWeightKg?: Kilograms;
  orderNumber?: string;
  stopNumber?: number;
  customer?: string;
  /** Overrides the stop-derived colour when set. */
  color?: string;
  label?: string;
};

export type Rotation = 0 | 90 | 180 | 270;

export type Placement = {
  loadUnitId: string;
  /** Stable id for this specific placed instance — a LoadUnit of quantity 8 yields 8 of these. */
  id: string;
  position: {
    x: Millimetres;
    y: Millimetres;
    z: Millimetres;
  };
  rotation: Rotation;
  quantity: number;
  /** Which cargo section it sits in; defaults to the primary one. */
  sectionId?: string;
};

export type LoadPlan = {
  vehicleId: string;
  placements: Placement[];
  loadUnits: LoadUnit[];
  /** Schema version, so an old exported file can be migrated rather than silently misread. */
  version: 1;
  savedAt?: string;
};

export type ValidationSeverity = 'error' | 'warning';

export type ValidationCode =
  | 'out_of_bounds_length'
  | 'out_of_bounds_width'
  | 'out_of_bounds_height'
  | 'collision'
  | 'payload_exceeded'
  | 'axle_overloaded'
  | 'not_stackable'
  | 'stack_weight_exceeded'
  | 'unsupported_stack'
  | 'unloading_order';

export type ValidationError = {
  code: ValidationCode;
  severity: ValidationSeverity;
  message: string;
  /** Placements this finding refers to, so the renderer can highlight them. */
  placementIds: string[];
  axleId?: string;
  /** How far past the limit, in the unit that limit is expressed in. */
  overBy?: number;
};

export type ValidationResult = {
  ok: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
};

export type AxleLoad = {
  id: string;
  label: string;
  loadKg: Kilograms;
  maxWeightKg: Kilograms;
  utilisation: number;
  overloaded: boolean;
};

export type VehicleStatistics = {
  volume: {
    usedM3: number;
    capacityM3: number;
    ratio: number;
  };
  weight: {
    usedKg: Kilograms;
    maxPayloadKg: Kilograms;
    ratio: number;
  };
  palletSpaces: {
    used: number;
    capacity: number;
    ratio: number;
  };
  placedCount: number;
  axles: AxleLoad[];
};

/** An axis-aligned box in vehicle space — the shape collision and bounds checks work on. */
export type Box = {
  id: string;
  x: Millimetres;
  y: Millimetres;
  z: Millimetres;
  lengthMm: Millimetres;
  widthMm: Millimetres;
  heightMm: Millimetres;
  weightKg: Kilograms;
  loadUnitId: string;
  stopNumber?: number;
  stackable: boolean;
  maxStackWeightKg?: Kilograms;
};
