import type { VehicleTemplate } from '../domain/types';

/**
 * Vehicle templates for load planning.
 *
 * These are planning approximations, not homologation data. Real cargo areas, payloads and
 * axle limits vary by manufacturer, body builder and registration — always check the actual
 * vehicle papers before relying on a plan for a road-legal decision.
 *
 * Axle `positionMm` is on the cargo x axis, so a steer axle ahead of the front wall is
 * negative. `tareShareKg` is the unladen weight already on that axle.
 */
export const VEHICLE_TEMPLATES: VehicleTemplate[] = [
  {
    id: 'van_l1',
    name: 'Van L1 (compact)',
    category: 'van',
    cargo: { lengthMm: 2600, widthMm: 1700, heightMm: 1400, floorHeightMm: 550 },
    maxPayloadKg: 800,
    axles: [
      { id: 'front', label: 'Față', positionMm: -900, maxWeightKg: 1500, tareShareKg: 900 },
      { id: 'rear', label: 'Spate', positionMm: 2100, maxWeightKg: 1600, tareShareKg: 700 },
    ],
    visualization: { type: 'parametric', cabStyle: 'van', bodyStyle: 'box', wheelPositionsMm: [-900, 2100] },
    note: 'Livrări urbane mici, paleți doar dacă sunt încărcați cu transpaleta din spate.',
  },
  {
    id: 'van_l2',
    name: 'Van L2 (lung)',
    category: 'van',
    cargo: { lengthMm: 3200, widthMm: 1780, heightMm: 1900, floorHeightMm: 570 },
    maxPayloadKg: 1200,
    axles: [
      { id: 'front', label: 'Față', positionMm: -1000, maxWeightKg: 1850, tareShareKg: 1100 },
      { id: 'rear', label: 'Spate', positionMm: 2600, maxWeightKg: 2000, tareShareKg: 800 },
    ],
    visualization: { type: 'parametric', cabStyle: 'van', bodyStyle: 'box', wheelPositionsMm: [-1000, 2600] },
  },
  {
    id: 'rigid_7_5t',
    name: 'Rigid 7.5t',
    category: 'rigid',
    cargo: { lengthMm: 6100, widthMm: 2400, heightMm: 2300, floorHeightMm: 1100 },
    maxPayloadKg: 3000,
    axles: [
      { id: 'front', label: 'Față', positionMm: -800, maxWeightKg: 3100, tareShareKg: 2100 },
      { id: 'rear', label: 'Spate', positionMm: 4200, maxWeightKg: 5000, tareShareKg: 2400 },
    ],
    visualization: { type: 'parametric', cabStyle: 'rigid', bodyStyle: 'box', wheelPositionsMm: [-800, 4200] },
  },
  {
    id: 'rigid_12t',
    name: 'Rigid 12t',
    category: 'rigid',
    cargo: { lengthMm: 7200, widthMm: 2480, heightMm: 2500, floorHeightMm: 1150 },
    maxPayloadKg: 5800,
    axles: [
      { id: 'front', label: 'Față', positionMm: -900, maxWeightKg: 4500, tareShareKg: 2800 },
      { id: 'rear', label: 'Spate', positionMm: 5000, maxWeightKg: 8000, tareShareKg: 3000 },
    ],
    visualization: { type: 'parametric', cabStyle: 'rigid', bodyStyle: 'box', wheelPositionsMm: [-900, 5000] },
  },
  {
    id: 'rigid_18t',
    name: 'Rigid 18t',
    category: 'rigid',
    cargo: { lengthMm: 8200, widthMm: 2480, heightMm: 2650, floorHeightMm: 1200 },
    maxPayloadKg: 9500,
    axles: [
      { id: 'front', label: 'Față', positionMm: -1000, maxWeightKg: 7500, tareShareKg: 4200 },
      { id: 'rear', label: 'Spate', positionMm: 5600, maxWeightKg: 11500, tareShareKg: 4300 },
    ],
    visualization: { type: 'parametric', cabStyle: 'rigid', bodyStyle: 'curtain', wheelPositionsMm: [-1000, 5600] },
  },
  {
    id: 'rigid_26t',
    name: 'Rigid 26t (3 axe)',
    category: 'rigid',
    cargo: { lengthMm: 9000, widthMm: 2480, heightMm: 2700, floorHeightMm: 1250 },
    maxPayloadKg: 15000,
    axles: [
      { id: 'front', label: 'Față', positionMm: -1000, maxWeightKg: 8000, tareShareKg: 4800 },
      { id: 'drive', label: 'Motoare', positionMm: 5400, maxWeightKg: 11500, tareShareKg: 3600 },
      { id: 'tag', label: 'Suplimentară', positionMm: 6700, maxWeightKg: 8000, tareShareKg: 2600 },
    ],
    visualization: { type: 'parametric', cabStyle: 'rigid', bodyStyle: 'curtain', wheelPositionsMm: [-1000, 5400, 6700] },
  },
  {
    id: 'city_rigid_10m',
    name: 'City rigid 10m',
    category: 'rigid',
    cargo: { lengthMm: 10000, widthMm: 2480, heightMm: 2600, floorHeightMm: 1150 },
    maxPayloadKg: 12000,
    axles: [
      { id: 'front', label: 'Față', positionMm: -1000, maxWeightKg: 7500, tareShareKg: 4200 },
      { id: 'rear', label: 'Spate', positionMm: 6800, maxWeightKg: 11500, tareShareKg: 4000 },
    ],
    visualization: { type: 'parametric', cabStyle: 'rigid', bodyStyle: 'box', wheelPositionsMm: [-1000, 6800] },
  },
  {
    id: 'curtainsider_13_6',
    name: 'Curtainsider 13.6m',
    category: 'semi',
    cargo: { lengthMm: 13620, widthMm: 2480, heightMm: 2700, floorHeightMm: 1150 },
    maxPayloadKg: 24000,
    axles: [
      { id: 'steer', label: 'Direcție', positionMm: -3200, maxWeightKg: 7500, tareShareKg: 5600 },
      { id: 'drive', label: 'Motoare', positionMm: -800, maxWeightKg: 11500, tareShareKg: 4200 },
      { id: 'trailer', label: 'Remorcă', positionMm: 10200, maxWeightKg: 24000, tareShareKg: 4800 },
    ],
    visualization: { type: 'parametric', cabStyle: 'tractor', bodyStyle: 'curtain', wheelPositionsMm: [-3200, -800, 9600, 10200, 10800] },
    note: 'Standardul european. 33 europaleți pe podea, încărcare laterală și prin spate.',
  },
  {
    id: 'mega_13_6',
    name: 'Mega 13.6m',
    category: 'mega',
    cargo: { lengthMm: 13620, widthMm: 2480, heightMm: 3000, floorHeightMm: 950 },
    maxPayloadKg: 24000,
    axles: [
      { id: 'steer', label: 'Direcție', positionMm: -3200, maxWeightKg: 7500, tareShareKg: 5600 },
      { id: 'drive', label: 'Motoare', positionMm: -800, maxWeightKg: 11500, tareShareKg: 4300 },
      { id: 'trailer', label: 'Remorcă', positionMm: 10200, maxWeightKg: 24000, tareShareKg: 5100 },
    ],
    visualization: { type: 'parametric', cabStyle: 'tractor', bodyStyle: 'curtain', wheelPositionsMm: [-3200, -800, 9600, 10200, 10800] },
    note: 'Podea coborâtă pentru 3 m înălțime utilă — volum, nu tonaj.',
  },
  {
    id: 'reefer_13_6',
    name: 'Reefer 13.6m',
    category: 'reefer',
    cargo: { lengthMm: 13320, widthMm: 2450, heightMm: 2600, floorHeightMm: 1200 },
    maxPayloadKg: 22000,
    axles: [
      { id: 'steer', label: 'Direcție', positionMm: -3200, maxWeightKg: 7500, tareShareKg: 5800 },
      { id: 'drive', label: 'Motoare', positionMm: -800, maxWeightKg: 11500, tareShareKg: 4600 },
      { id: 'trailer', label: 'Remorcă', positionMm: 10000, maxWeightKg: 24000, tareShareKg: 6200 },
    ],
    visualization: { type: 'parametric', cabStyle: 'tractor', bodyStyle: 'reefer', wheelPositionsMm: [-3200, -800, 9400, 10000, 10600] },
    note: 'Pereți izolați — cutie utilă mai mică decât un curtainsider.',
  },
  {
    id: 'box_trailer_13_6',
    name: 'Box trailer 13.6m',
    category: 'box',
    cargo: { lengthMm: 13500, widthMm: 2460, heightMm: 2680, floorHeightMm: 1150 },
    maxPayloadKg: 23500,
    axles: [
      { id: 'steer', label: 'Direcție', positionMm: -3200, maxWeightKg: 7500, tareShareKg: 5600 },
      { id: 'drive', label: 'Motoare', positionMm: -800, maxWeightKg: 11500, tareShareKg: 4400 },
      { id: 'trailer', label: 'Remorcă', positionMm: 10100, maxWeightKg: 24000, tareShareKg: 5200 },
    ],
    visualization: { type: 'parametric', cabStyle: 'tractor', bodyStyle: 'box', wheelPositionsMm: [-3200, -800, 9500, 10100, 10700] },
  },
  {
    id: 'lowdeck_13_6',
    name: 'Low-deck 13.6m',
    category: 'semi',
    cargo: { lengthMm: 13620, widthMm: 2480, heightMm: 3050, floorHeightMm: 850 },
    maxPayloadKg: 23000,
    axles: [
      { id: 'steer', label: 'Direcție', positionMm: -3000, maxWeightKg: 7500, tareShareKg: 5500 },
      { id: 'drive', label: 'Motoare', positionMm: -700, maxWeightKg: 11500, tareShareKg: 4400 },
      { id: 'trailer', label: 'Remorcă', positionMm: 10200, maxWeightKg: 24000, tareShareKg: 5300 },
    ],
    visualization: { type: 'parametric', cabStyle: 'tractor', bodyStyle: 'curtain', wheelPositionsMm: [-3000, -700, 9600, 10200, 10800] },
  },
  {
    id: 'container_40ft',
    name: 'Șasiu container 40ft',
    category: 'container',
    cargo: { lengthMm: 12030, widthMm: 2350, heightMm: 2390, floorHeightMm: 1350 },
    maxPayloadKg: 26500,
    axles: [
      { id: 'steer', label: 'Direcție', positionMm: -3200, maxWeightKg: 7500, tareShareKg: 5600 },
      { id: 'drive', label: 'Motoare', positionMm: -800, maxWeightKg: 11500, tareShareKg: 4200 },
      { id: 'trailer', label: 'Remorcă', positionMm: 9000, maxWeightKg: 24000, tareShareKg: 4200 },
    ],
    visualization: { type: 'parametric', cabStyle: 'tractor', bodyStyle: 'container', wheelPositionsMm: [-3200, -800, 8400, 9000, 9600] },
    note: 'Interior container 40ft standard. Ușile doar în spate.',
  },
  {
    id: 'swap_body_7_45',
    name: 'Swap body 7.45m',
    category: 'swap',
    cargo: { lengthMm: 7450, widthMm: 2480, heightMm: 2700, floorHeightMm: 1250 },
    maxPayloadKg: 15000,
    axles: [
      { id: 'front', label: 'Față', positionMm: -1000, maxWeightKg: 7500, tareShareKg: 4200 },
      { id: 'rear', label: 'Spate', positionMm: 5200, maxWeightKg: 11500, tareShareKg: 3600 },
    ],
    visualization: { type: 'parametric', cabStyle: 'rigid', bodyStyle: 'box', wheelPositionsMm: [-1000, 5200] },
    note: 'Caroserie detașabilă — 18 europaleți pe podea.',
  },
  {
    id: 'drawbar_2x7_45',
    name: 'Drawbar 2×7.45m',
    category: 'drawbar',
    cargo: { lengthMm: 7450, widthMm: 2480, heightMm: 2700, floorHeightMm: 1250 },
    extraSections: [
      {
        id: 'trailer',
        label: 'Remorcă',
        offsetMm: 9200,
        cargo: { lengthMm: 7450, widthMm: 2480, heightMm: 2700, floorHeightMm: 1150 },
      },
    ],
    maxPayloadKg: 25000,
    axles: [
      { id: 'front', label: 'Față camion', positionMm: -1000, maxWeightKg: 7500, tareShareKg: 4200 },
      { id: 'rear', label: 'Spate camion', positionMm: 5200, maxWeightKg: 11500, tareShareKg: 3800 },
      { id: 'trailer_front', label: 'Față remorcă', positionMm: 10400, maxWeightKg: 10000, tareShareKg: 2400 },
      { id: 'trailer_rear', label: 'Spate remorcă', positionMm: 14800, maxWeightKg: 10000, tareShareKg: 2400 },
    ],
    visualization: { type: 'parametric', cabStyle: 'rigid', bodyStyle: 'curtain', wheelPositionsMm: [-1000, 5200, 10400, 14800] },
    note: 'Două compartimente separate — marfa nu se poate așeza peste cuplaj.',
  },
];

export const DEFAULT_VEHICLE_ID = 'curtainsider_13_6';

export function getVehicleTemplate(id: string): VehicleTemplate | undefined {
  return VEHICLE_TEMPLATES.find((v) => v.id === id);
}

export function requireVehicleTemplate(id: string): VehicleTemplate {
  const template = getVehicleTemplate(id);
  if (!template) throw new Error(`Vehicul necunoscut: ${id}`);
  return template;
}
