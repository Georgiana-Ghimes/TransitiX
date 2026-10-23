/**
 * Server-side company module gates (feature_flags.modules).
 * UI hides menus; this is what actually stops curl / forged clients.
 */

import { materializeFeatureFlags } from './ensureProductCompanies.js';

/** Mount prefix → module key (applied in app.js). */
export const API_MODULE_BY_MOUNT = {
  '/api/avize': 'avize',
  '/api/tpo': 'avize',
  '/api/reports': 'reports',
  '/api/fleet': 'fleet',
  '/api/trips': 'trips',
  '/api/cmr': 'trips',
  '/api/orders': 'dispatch',
  '/api/routes': 'dispatch',
  '/api/loading': 'loading',
  '/api/planning': 'planning',
  '/api/telematics': 'gps',
  '/api/invoices': 'finance',
  // Aviz OCR HITL (batches, corrections, approve-review) — not fleet „Documente expirare”.
  '/api/documents': 'avize',
  // /api/commercial: per-route in commercial.js (zones → zone_map|avize|commercial)
  '/api/audit': 'audit',
  '/api/territories': 'territories',
  '/api/analytics': 'planning',
  '/api/tachograph': 'fleet',
  '/api/maintenance': 'fleet',
  '/api/driver-documents': 'driver_upload',
};

/** Generic /api/entities/:Entity → module (null = always allowed for authenticated users). */
export const ENTITY_MODULE = {
  Vehicle: 'fleet',
  Driver: 'fleet',
  Client: 'trips',
  Location: 'locations',
  Order: 'dispatch',
  Route: 'dispatch',
  RouteStop: 'dispatch',
  Contract: 'commercial',
  ContractTariff: 'commercial',
  // zone_map alone is enough for Harta zonelor; commercial keeps Tarifare. Not avize —
  // otherwise GOD cannot lock zones while Avize stays on.
  TaxZone: ['zone_map', 'commercial'],
  TaxZoneRate: ['zone_map', 'commercial'],
  SurchargeType: 'commercial',
  SurchargeRate: 'commercial',
  Trip: 'trips',
  TripLeg: 'trips',
  TripCharge: 'trips',
  TripDocument: 'trips',
  ClientConfirmation: 'trips',
  Invoice: 'finance',
  WarehouseProduct: 'warehouse',
  Territory: 'territories',
  GPSLog: 'gps',
  ChatMessage: null,
  DriverNotification: null,
  OptimizationSuggestion: 'planning',
  ObservationCode: ['avize', 'commercial'],
  DocumentBatch: 'avize',
  DocumentEvent: 'avize',
  ReportTemplate: 'reports',
  AvizDocument: 'avize',
};

export function isCompanyModuleEnabled(rawFlags, moduleKey) {
  if (!moduleKey) return true;
  const { modules } = materializeFeatureFlags(rawFlags || {});
  return modules[moduleKey] !== false;
}

export function moduleForEntity(entityName) {
  if (!Object.prototype.hasOwnProperty.call(ENTITY_MODULE, entityName)) {
    return null;
  }
  return ENTITY_MODULE[entityName];
}
