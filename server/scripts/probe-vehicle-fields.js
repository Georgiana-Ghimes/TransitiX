/**
 * Probe which Vehicle fields cause integer / numeric overflow.
 * Run: node server/scripts/probe-vehicle-fields.js
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const API = process.env.PROBE_API || 'http://localhost:3001/api';
const OVERFLOW_INT = '3213213213'; // > INT32 max 2147483647

const base = {
  plate: 'TEST-PROBE',
  brand: 'Probe',
  model: 'Mix',
  fuel_type: 'diesel',
  status: 'available',
  is_active: true,
};

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@transitix.ro', password: 'admin123' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Login failed: ${data.message || res.status}`);
  return data.access_token || data.token;
}

async function create(token, payload) {
  const res = await fetch(`${API}/entities/Vehicle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, ok: res.ok, data };
}

async function cleanup(token, id) {
  if (!id) return;
  await fetch(`${API}/entities/Vehicle/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

const cases = [
  // Baseline expected
  {
    name: 'expected_minimal',
    payload: { ...base, plate: `OK-${Date.now()}-1`, year: 2022, capacity_kg: 24000, fuel_consumption: 32.5, mileage: 120000 },
  },
  // Integer overflow suspects (same value as UI error)
  {
    name: 'overflow_capacity_kg',
    payload: { ...base, plate: `OV-${Date.now()}-kg`, capacity_kg: Number(OVERFLOW_INT) },
  },
  {
    name: 'overflow_capacity_mc',
    payload: { ...base, plate: `OV-${Date.now()}-mc`, capacity_mc: Number(OVERFLOW_INT) },
  },
  {
    name: 'overflow_mileage',
    payload: { ...base, plate: `OV-${Date.now()}-mi`, mileage: Number(OVERFLOW_INT) },
  },
  {
    name: 'overflow_year',
    payload: { ...base, plate: `OV-${Date.now()}-yr`, year: Number(OVERFLOW_INT) },
  },
  {
    name: 'overflow_last_maintenance_mileage',
    payload: { ...base, plate: `OV-${Date.now()}-lm`, last_maintenance_mileage: Number(OVERFLOW_INT) },
  },
  // NUMERIC(5,2) overflow for fuel_consumption
  {
    name: 'overflow_fuel_consumption_numeric52',
    payload: { ...base, plate: `OV-${Date.now()}-fc`, fuel_consumption: 10000.5 },
  },
  // Unexpected / wrong types (as form might coerce)
  {
    name: 'string_in_capacity_kg_coerced',
    payload: { ...base, plate: `WR-${Date.now()}-s`, capacity_kg: Number('abc') }, // NaN
  },
  {
    name: 'negative_year',
    payload: { ...base, plate: `WR-${Date.now()}-ny`, year: -2 },
  },
  {
    name: 'plate_looks_numeric_only',
    payload: { ...base, plate: OVERFLOW_INT, brand: '3213', model: '3321', year: -2 },
  },
  {
    name: 'rca_number_long_text_ok',
    payload: { ...base, plate: `TX-${Date.now()}-rca`, rca_number: OVERFLOW_INT },
  },
  {
    name: 'chassis_long_text_ok',
    payload: { ...base, plate: `TX-${Date.now()}-ch`, chassis_number: OVERFLOW_INT },
  },
  // Mix: overflow in capacity_kg + otherwise valid
  {
    name: 'mix_overflow_kg_with_docs',
    payload: {
      ...base,
      plate: `MX-${Date.now()}`,
      brand: 'Volvo',
      model: 'FH16',
      year: 2021,
      capacity_kg: Number(OVERFLOW_INT),
      fuel_consumption: 30,
      rca_number: '3213213',
      rca_expiry: '2026-08-14',
    },
  },
];

async function main() {
  const token = await login();
  console.log('Logged in. Probing', cases.length, 'cases against', API);
  console.log('INT32 max = 2147483647; probe value =', OVERFLOW_INT, '\n');

  const results = [];
  for (const c of cases) {
    const { status, ok, data } = await create(token, c.payload);
    const msg = data?.message || data?.raw || '';
    const row = {
      case: c.name,
      status,
      ok,
      message: String(msg).slice(0, 160),
      createdId: ok ? data?.id : null,
    };
    results.push(row);
    const mark = ok ? 'OK ' : 'FAIL';
    console.log(`${mark} [${status}] ${c.name}`);
    if (!ok) console.log(`      → ${row.message}`);
    if (ok && data?.id) await cleanup(token, data.id);
  }

  console.log('\n=== SUMMARY: cases matching integer range error ===');
  const hits = results.filter((r) => /out of range for type integer/i.test(r.message));
  if (hits.length === 0) {
    console.log('(none — check numeric overflow or other messages above)');
  } else {
    hits.forEach((h) => console.log('-', h.case, '→', h.message));
  }

  console.log('\n=== SUMMARY: fuel_consumption / numeric overflow ===');
  results
    .filter((r) => /numeric field overflow|out of range/i.test(r.message))
    .forEach((h) => console.log('-', h.case, '→', h.message));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
