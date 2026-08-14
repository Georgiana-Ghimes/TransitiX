/**
 * Incremental dummy data for Flotă, Șoferi, and Clienți.
 * Safe to re-run — skips rows that already exist (plate / email / CUI).
 *
 * Usage:
 *   npm run seed:fleet --prefix server
 *   npm run db:seed:fleet   (from repo root)
 */
import { pool } from './db.js';

const VEHICLES = [
  { plate: 'B-301-TRX', brand: 'Mercedes-Benz', model: 'Actros', year: 2020, capacity_kg: 26000, capacity_mc: 95, fuel_consumption: 31.2, fuel_type: 'diesel', mileage: 210000, status: 'available', is_active: true, itp_days: 90, rca_days: 180, rovinieta_days: 30 },
  { plate: 'B-302-TRX', brand: 'MAN', model: 'TGX', year: 2019, capacity_kg: 24000, capacity_mc: 88, fuel_consumption: 33.0, fuel_type: 'diesel', mileage: 305000, status: 'in_trip', is_active: true, itp_days: 45, rca_days: 120, rovinieta_days: 10 },
  { plate: 'B-303-TRX', brand: 'DAF', model: 'XF', year: 2021, capacity_kg: 25000, capacity_mc: 92, fuel_consumption: 30.5, fuel_type: 'diesel', mileage: 145000, status: 'available', is_active: true, itp_days: 200, rca_days: 250, rovinieta_days: 60 },
  { plate: 'CJ-12-LOG', brand: 'Iveco', model: 'S-Way', year: 2022, capacity_kg: 23000, capacity_mc: 86, fuel_consumption: 29.8, fuel_type: 'diesel', mileage: 78000, status: 'maintenance', is_active: true, itp_days: 15, rca_days: 90, rovinieta_days: 5 },
  { plate: 'CJ-34-LOG', brand: 'Renault', model: 'T High', year: 2018, capacity_kg: 22000, capacity_mc: 82, fuel_consumption: 34.1, fuel_type: 'diesel', mileage: 420000, status: 'inactive', is_active: false, itp_days: -10, rca_days: 30, rovinieta_days: -5 },
  { plate: 'TM-88-AGRO', brand: 'Volvo', model: 'FM', year: 2023, capacity_kg: 20000, capacity_mc: 75, fuel_consumption: 28.0, fuel_type: 'diesel', mileage: 52000, status: 'available', is_active: true, itp_days: 300, rca_days: 365, rovinieta_days: 90 },
  { plate: 'IS-45-NRD', brand: 'Scania', model: 'G410', year: 2020, capacity_kg: 24500, capacity_mc: 90, fuel_consumption: 31.8, fuel_type: 'diesel', mileage: 198000, status: 'in_trip', is_active: true, itp_days: 75, rca_days: 150, rovinieta_days: 20 },
  { plate: 'BV-77-EXP', brand: 'Mercedes-Benz', model: 'Atego', year: 2017, capacity_kg: 12000, capacity_mc: 45, fuel_consumption: 22.5, fuel_type: 'diesel', mileage: 510000, status: 'available', is_active: true, itp_days: 60, rca_days: 100, rovinieta_days: 25 },
  { plate: 'CT-09-PRT', brand: 'Ford', model: 'F-Max', year: 2021, capacity_kg: 18000, capacity_mc: 68, fuel_consumption: 27.3, fuel_type: 'diesel', mileage: 132000, status: 'available', is_active: true, itp_days: 110, rca_days: 200, rovinieta_days: 40 },
  { plate: 'GL-56-TRX', brand: 'Volvo', model: 'FH', year: 2024, capacity_kg: 25500, capacity_mc: 96, fuel_consumption: 29.5, fuel_type: 'diesel', mileage: 18000, status: 'available', is_active: true, itp_days: 365, rca_days: 400, rovinieta_days: 120 },
  { plate: 'B-404-ELC', brand: 'Mercedes-Benz', model: 'eActros', year: 2023, capacity_kg: 19000, capacity_mc: 70, fuel_consumption: 0, fuel_type: 'electric', mileage: 35000, status: 'available', is_active: true, itp_days: 240, rca_days: 300, rovinieta_days: 80 },
  { plate: 'B-505-OLD', brand: 'Mercedes-Benz', model: 'Axor', year: 2012, capacity_kg: 20000, capacity_mc: 78, fuel_consumption: 36.0, fuel_type: 'diesel', mileage: 890000, status: 'inactive', is_active: false, itp_days: -30, rca_days: -5, rovinieta_days: -20 },
];

const DRIVERS = [
  { name: 'Andrei Munteanu', email: 'andrei.munteanu@transitix.ro', phone: '+40 721 100 201', license_category: 'C+E', license_number: 'B201001', status: 'disponibil', is_active: true, hire_days_ago: 900, license_days: 500, medical_days: 200, tacho_days: 300 },
  { name: 'Cristian Dobre', email: 'cristian.dobre@transitix.ro', phone: '+40 722 100 202', license_category: 'C+E', license_number: 'B202002', status: 'in_cursa', is_active: true, hire_days_ago: 650, license_days: 350, medical_days: 120, tacho_days: 180 },
  { name: 'Florin Stan', email: 'florin.stan@transitix.ro', phone: '+40 723 100 203', license_category: 'C', license_number: 'B203003', status: 'disponibil', is_active: true, hire_days_ago: 400, license_days: 280, medical_days: 90, tacho_days: 220 },
  { name: 'Gabriel Enache', email: 'gabriel.enache@transitix.ro', phone: '+40 724 100 204', license_category: 'C+E', license_number: 'B204004', status: 'in_concediu', is_active: true, hire_days_ago: 1200, license_days: 600, medical_days: 300, tacho_days: 400 },
  { name: 'Horia Pavel', email: 'horia.pavel@transitix.ro', phone: '+40 725 100 205', license_category: 'C+E', license_number: 'B205005', status: 'indisponibil', is_active: false, hire_days_ago: 500, license_days: -15, medical_days: 45, tacho_days: 60 },
  { name: 'Iulian Radu', email: 'iulian.radu@transitix.ro', phone: '+40 726 100 206', license_category: 'C', license_number: 'B206006', status: 'disponibil', is_active: true, hire_days_ago: 200, license_days: 700, medical_days: 365, tacho_days: 500 },
  { name: 'Marian Toma', email: 'marian.toma@transitix.ro', phone: '+40 727 100 207', license_category: 'C+E', license_number: 'B207007', status: 'in_cursa', is_active: true, hire_days_ago: 800, license_days: 400, medical_days: 150, tacho_days: 250 },
  { name: 'Nicolae Voicu', email: 'nicolae.voicu@transitix.ro', phone: '+40 728 100 208', license_category: 'C+E', license_number: 'B208008', status: 'disponibil', is_active: true, hire_days_ago: 350, license_days: 320, medical_days: 100, tacho_days: 140 },
  { name: 'Octavian Barbu', email: 'octavian.barbu@transitix.ro', phone: '+40 729 100 209', license_category: 'C', license_number: 'B209009', status: 'disponibil', is_active: true, hire_days_ago: 150, license_days: 800, medical_days: 400, tacho_days: 600 },
  { name: 'Petru Moldovan', email: 'petru.moldovan@transitix.ro', phone: '+40 730 100 210', license_category: 'C+E', license_number: 'B210010', status: 'indisponibil', is_active: false, hire_days_ago: 1000, license_days: 50, medical_days: -10, tacho_days: 30 },
  { name: 'Răzvan Cojocaru', email: 'razvan.cojocaru@transitix.ro', phone: '+40 731 100 211', license_category: 'C+E', license_number: 'B211011', status: 'disponibil', is_active: true, hire_days_ago: 450, license_days: 450, medical_days: 180, tacho_days: 270 },
  { name: 'Sorin Neagu', email: 'sorin.neagu@transitix.ro', phone: '+40 732 100 212', license_category: 'C', license_number: 'B212012', status: 'in_cursa', is_active: true, hire_days_ago: 700, license_days: 260, medical_days: 80, tacho_days: 110 },
];

const CLIENTS = [
  { name: 'SC TransCargo Est SRL', cui: 'RO44556677', address: 'Constanța, B-dul Mamaia 120', phone: '+40 241 300 401', email: 'operatiuni@transcargo-est.ro', contact_person: 'Vlad Mocanu', is_active: true },
  { name: 'AgroDistribuție Vest SA', cui: 'RO55667788', address: 'Timișoara, Calea Torontalului 88', phone: '+40 256 300 402', email: 'logistica@agrovest.ro', contact_person: 'Diana Pop', is_active: true },
  { name: 'EuroPack Solutions SRL', cui: 'RO66778899', address: 'Ploiești, str. Industriilor 5', phone: '+40 244 300 403', email: 'comenzi@europack.ro', contact_person: 'Mihai Georgescu', is_active: true },
  { name: 'FrigoLine Express SRL', cui: 'RO77889900', address: 'Brașov, str. Muncii 44', phone: '+40 268 300 404', email: 'dispatch@frigoline.ro', contact_person: 'Ana Marinescu', is_active: true },
  { name: 'MetalPro Industries SA', cui: 'RO88990011', address: 'Galați, Zona Industrială Est', phone: '+40 236 300 405', email: 'transport@metalpro.ro', contact_person: 'Costel Dumitru', is_active: true },
  { name: 'Retail Hub Nord SRL', cui: 'RO99001122', address: 'Iași, Șoseaua Națională 210', phone: '+40 232 300 406', email: 'receptie@retailhubnord.ro', contact_person: 'Ioana Suciu', is_active: true },
  { name: 'Construct All Trans SRL', cui: 'RO10112233', address: 'Craiova, str. Caracalului 17', phone: '+40 251 300 407', email: 'office@constructall.ro', contact_person: 'George Ilie', is_active: true },
  { name: 'PharmaDistrib Rom SA', cui: 'RO21223344', address: 'București, Șos. Pipera 1', phone: '+40 21 300 408', email: 'livrari@pharmadistrib.ro', contact_person: 'Laura Preda', is_active: true },
  { name: 'SC MobilaPlus Export SRL', cui: 'RO32334455', address: 'Sibiu, str. Hermann Oberth 3', phone: '+40 269 300 409', email: 'export@mobiaplusexport.ro', contact_person: 'Teodor Ardelean', is_active: true },
  { name: 'GreenFields Agro SRL', cui: 'RO43445566', address: 'Arad, Calea Radnei 55', phone: '+40 257 300 410', email: 'depozit@greenfields.ro', contact_person: 'Carmen Badea', is_active: true },
  { name: 'TechParts Distribution SA', cui: 'RO54556677', address: 'Cluj-Napoca, str. Fabricii de Zahăr 9', phone: '+40 264 300 411', email: 'parts@techparts.ro', contact_person: 'Robert Chiriac', is_active: true },
  { name: 'OldClient Inactiv SRL', cui: 'RO65667788', address: 'Buzău, str. Unirii 2', phone: '+40 238 300 412', email: 'archiv@oldclient.ro', contact_person: 'N/A', is_active: false },
];

async function getCompanyId(client) {
  const company = await client.query(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
  if (!company.rows[0]) {
    throw new Error('No company found — run npm run migrate && npm run seed first.');
  }
  return company.rows[0].id;
}

async function seedVehicles(client, companyId) {
  let inserted = 0;
  let skipped = 0;

  for (const v of VEHICLES) {
    const result = await client.query(
      `INSERT INTO vehicles (
        company_id, plate, brand, model, year, capacity_kg, capacity_mc, fuel_consumption,
        fuel_type, mileage, status, is_active, itp_expiry, rca_expiry, rovinieta_expiry
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        CURRENT_DATE + $13::int, CURRENT_DATE + $14::int, CURRENT_DATE + $15::int
      )
      ON CONFLICT (company_id, plate) DO NOTHING
      RETURNING id`,
      [
        companyId, v.plate, v.brand, v.model, v.year, v.capacity_kg, v.capacity_mc,
        v.fuel_consumption || null, v.fuel_type, v.mileage, v.status, v.is_active,
        v.itp_days, v.rca_days, v.rovinieta_days,
      ]
    );
    if (result.rows[0]) inserted += 1;
    else skipped += 1;
  }

  return { inserted, skipped };
}

async function seedDrivers(client, companyId) {
  let inserted = 0;
  let skipped = 0;

  for (const d of DRIVERS) {
    const existing = await client.query(
      `SELECT id FROM drivers
       WHERE company_id = $1 AND (LOWER(email) = LOWER($2) OR phone = $3)
       LIMIT 1`,
      [companyId, d.email, d.phone]
    );
    if (existing.rows[0]) {
      skipped += 1;
      continue;
    }

    await client.query(
      `INSERT INTO drivers (
        company_id, name, email, phone, hire_date, license_number, license_category,
        license_expiry, medical_certificate_expiry, tachograph_card_expiry, status, is_active
      ) VALUES (
        $1, $2, $3, $4, CURRENT_DATE - $5::int, $6, $7,
        CURRENT_DATE + $8::int, CURRENT_DATE + $9::int, CURRENT_DATE + $10::int, $11, $12
      )`,
      [
        companyId, d.name, d.email, d.phone, d.hire_days_ago, d.license_number,
        d.license_category, d.license_days, d.medical_days, d.tacho_days, d.status, d.is_active,
      ]
    );
    inserted += 1;
  }

  return { inserted, skipped };
}

async function seedClients(client, companyId) {
  let inserted = 0;
  let skipped = 0;

  for (const c of CLIENTS) {
    const existing = await client.query(
      `SELECT id FROM clients
       WHERE company_id = $1 AND (cui = $2 OR LOWER(name) = LOWER($3))
       LIMIT 1`,
      [companyId, c.cui, c.name]
    );
    if (existing.rows[0]) {
      skipped += 1;
      continue;
    }

    await client.query(
      `INSERT INTO clients (company_id, name, cui, address, phone, email, contact_person, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [companyId, c.name, c.cui, c.address, c.phone, c.email, c.contact_person, c.is_active]
    );
    inserted += 1;
  }

  return { inserted, skipped };
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const companyId = await getCompanyId(client);

    const vehicles = await seedVehicles(client, companyId);
    const drivers = await seedDrivers(client, companyId);
    const clients = await seedClients(client, companyId);

    await client.query('COMMIT');

    console.log('Fleet dummy data seed completed.');
    console.log(`  Vehicule: +${vehicles.inserted} noi, ${vehicles.skipped} existente`);
    console.log(`  Șoferi:   +${drivers.inserted} noi, ${drivers.skipped} existente`);
    console.log(`  Clienți:  +${clients.inserted} noi, ${clients.skipped} existente`);
    console.log('Refresh Flotă / Șoferi / Clienți in the app to see the new cards.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('seed-fleet-data failed:', err);
  process.exit(1);
});
