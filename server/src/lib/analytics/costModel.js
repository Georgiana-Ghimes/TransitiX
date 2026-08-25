/**
 * Vehicle operating cost model — lei per km / hour / stop / kg.
 * Vehicle fields override company defaults; missing pieces stay null (never invent).
 */

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve effective rates for one vehicle.
 * @param {object} vehicle
 * @param {object} [company]
 */
export function resolveCostRates(vehicle = {}, company = {}) {
  const fuelPerL = num(vehicle.fuel_price_per_l) ?? num(company.default_fuel_price_per_l);
  const consumption = num(vehicle.fuel_consumption); // l/100km
  const fuelPerKm = fuelPerL != null && consumption != null
    ? Math.round((fuelPerL * consumption) / 100 * 10000) / 10000
    : null;

  const wage = num(vehicle.wage_per_hour) ?? num(company.default_wage_per_hour) ?? num(vehicle.cost_per_hour);
  const toll = num(vehicle.toll_per_km) ?? num(company.default_toll_per_km);
  const depreciation = num(vehicle.depreciation_per_km) ?? num(company.default_depreciation_per_km);
  const maintenance = num(vehicle.maintenance_per_km) ?? num(company.default_maintenance_per_km);
  const explicitPerKm = num(vehicle.cost_per_km);

  const parts = [fuelPerKm, toll, depreciation, maintenance].filter((v) => v != null);
  const composedPerKm = parts.length
    ? Math.round(parts.reduce((a, b) => a + b, 0) * 10000) / 10000
    : null;

  return {
    fuel_per_l: fuelPerL,
    fuel_per_km: fuelPerKm,
    wage_per_hour: wage,
    toll_per_km: toll,
    depreciation_per_km: depreciation,
    maintenance_per_km: maintenance,
    /** Prefer explicit solver rate; else sum of components. */
    per_km: explicitPerKm ?? composedPerKm,
    per_hour: wage,
  };
}

/**
 * Cost a single activity slice.
 * @returns {{ total, per_km_part, per_hour_part, breakdown } | null} null if no rates
 */
export function costActivity({
  distance_km = 0,
  duration_min = 0,
  stops = 0,
  weight_kg = 0,
  rates,
} = {}) {
  if (!rates || (rates.per_km == null && rates.per_hour == null)) {
    return null;
  }
  const km = Math.max(0, Number(distance_km) || 0);
  const hours = Math.max(0, (Number(duration_min) || 0) / 60);
  const perKmPart = rates.per_km != null ? rates.per_km * km : 0;
  const perHourPart = rates.per_hour != null ? rates.per_hour * hours : 0;
  const total = Math.round((perKmPart + perHourPart) * 100) / 100;

  return {
    total,
    per_km_part: Math.round(perKmPart * 100) / 100,
    per_hour_part: Math.round(perHourPart * 100) / 100,
    per_stop: stops > 0 ? Math.round((total / stops) * 100) / 100 : null,
    per_kg: weight_kg > 0 ? Math.round((total / weight_kg) * 1000) / 1000 : null,
    breakdown: {
      fuel: rates.fuel_per_km != null ? Math.round(rates.fuel_per_km * km * 100) / 100 : null,
      toll: rates.toll_per_km != null ? Math.round(rates.toll_per_km * km * 100) / 100 : null,
      depreciation: rates.depreciation_per_km != null
        ? Math.round(rates.depreciation_per_km * km * 100) / 100
        : null,
      maintenance: rates.maintenance_per_km != null
        ? Math.round(rates.maintenance_per_km * km * 100) / 100
        : null,
      wage: rates.wage_per_hour != null
        ? Math.round(rates.wage_per_hour * hours * 100) / 100
        : null,
    },
  };
}
