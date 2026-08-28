import bcrypt from 'bcryptjs';
import { pool } from './db.js';

/**
 * Demo accounts with published passwords, and `upsertUser` resets the password, role and
 * is_active of anyone whose email already matches. Pointed at a database holding real users,
 * that is an account takeover, not a seed. `SEED_ALLOW_PRODUCTION=1` is the deliberate override.
 */
function assertSeedableDatabase() {
  if (process.env.SEED_ALLOW_PRODUCTION === '1') return;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed with NODE_ENV=production (set SEED_ALLOW_PRODUCTION=1 to override).');
  }
  const name = String(process.env.DATABASE_URL || '').split('/').pop()?.split('?')[0] ?? '';
  if (/prod|live/i.test(name)) {
    throw new Error(`Refusing to seed "${name}" (set SEED_ALLOW_PRODUCTION=1 to override).`);
  }
}

async function upsertUser(client, { companyId, name, email, password, role }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await client.query(
    `SELECT id FROM users WHERE company_id = $1 AND LOWER(email) = LOWER($2)`,
    [companyId, email]
  );
  if (existing.rows[0]) {
    // Dev seed accounts must stay login-able after a re-run — never skip password refresh.
    await client.query(
      `UPDATE users
       SET name = $1, password_hash = $2, role = $3, is_active = TRUE, updated_at = NOW()
       WHERE id = $4`,
      [name, passwordHash, role, existing.rows[0].id]
    );
    return existing.rows[0].id;
  }
  const result = await client.query(
    `INSERT INTO users (company_id, name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [companyId, name, email, passwordHash, role]
  );
  return result.rows[0].id;
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let companyId;
    const company = await client.query(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    if (company.rows[0]) {
      companyId = company.rows[0].id;
    } else {
      const created = await client.query(
        `INSERT INTO companies (name, cui, email, phone, address)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        ['Transitix Demo', 'RO12345678', 'contact@transitix.ro', '+40 721 000 000', 'București, România']
      );
      companyId = created.rows[0].id;
    }

    await upsertUser(client, {
      companyId,
      name: 'Admin Transitix',
      email: 'admin@transitix.ro',
      password: 'admin123',
      role: 'admin',
    });

    const driverUserId = await upsertUser(client, {
      companyId,
      name: 'Ion Popescu',
      email: 'sofer@transitix.ro',
      password: 'sofer123',
      role: 'driver',
    });

    // Demo fleet — only if empty
    const vehicleCount = await client.query(
      `SELECT COUNT(*)::int AS c FROM vehicles WHERE company_id = $1`,
      [companyId]
    );

    let vehicle1Id;
    let vehicle2Id;
    let driverId;

    if (vehicleCount.rows[0].c === 0) {
      const v1 = await client.query(
        `INSERT INTO vehicles (company_id, plate, brand, model, year, capacity_kg, capacity_mc, fuel_consumption, fuel_type, mileage, status, is_active,
          itp_expiry, rca_expiry, rovinieta_expiry)
         VALUES ($1, 'B-101-TRX', 'Volvo', 'FH16', 2021, 24000, 90, 32.5, 'diesel', 185000, 'available', TRUE,
          CURRENT_DATE + 120, CURRENT_DATE + 200, CURRENT_DATE + 40)
         RETURNING id`,
        [companyId]
      );
      const v2 = await client.query(
        `INSERT INTO vehicles (company_id, plate, brand, model, year, capacity_kg, capacity_mc, fuel_consumption, fuel_type, mileage, status, is_active,
          itp_expiry, rca_expiry, rovinieta_expiry)
         VALUES ($1, 'B-202-TRX', 'Scania', 'R450', 2022, 22000, 85, 30.0, 'diesel', 92000, 'in_trip', TRUE,
          CURRENT_DATE + 60, CURRENT_DATE + 90, CURRENT_DATE + 15)
         RETURNING id`,
        [companyId]
      );
      vehicle1Id = v1.rows[0].id;
      vehicle2Id = v2.rows[0].id;

      const d1 = await client.query(
        `INSERT INTO drivers (company_id, user_id, name, email, phone, hire_date, license_number, license_category, license_expiry,
          medical_certificate_expiry, tachograph_card_expiry, status, is_active)
         VALUES ($1, $2, 'Ion Popescu', 'sofer@transitix.ro', '+40 722 111 222', CURRENT_DATE - 800,
          'B123456', 'C+E', CURRENT_DATE + 400, CURRENT_DATE + 180, CURRENT_DATE + 250, 'in_cursa', TRUE)
         RETURNING id`,
        [companyId, driverUserId]
      );
      driverId = d1.rows[0].id;

      await client.query(
        `INSERT INTO drivers (company_id, name, email, phone, hire_date, license_number, license_category, license_expiry, status, is_active)
         VALUES ($1, 'Maria Ionescu', 'maria.ionescu@transitix.ro', '+40 723 333 444', CURRENT_DATE - 400,
          'B654321', 'C', CURRENT_DATE + 200, 'disponibil', TRUE)`,
        [companyId]
      );

      const clientRow = await client.query(
        `INSERT INTO clients (company_id, name, cui, address, phone, email, contact_person, is_active)
         VALUES ($1, 'SC Logistics Nord SRL', 'RO99887766', 'Cluj-Napoca, str. Fabricii 12', '+40 264 000 111', 'comenzi@logisticsnord.ro', 'Andrei Vasile', TRUE)
         RETURNING id`,
        [companyId]
      );

      await client.query(
        `INSERT INTO clients (company_id, name, cui, address, phone, email, contact_person, is_active)
         VALUES ($1, 'Depozit Sud SA', 'RO11223344', 'București, Șoseaua Olteniței 200', '+40 21 000 222', 'receptie@depozitsud.ro', 'Elena Radu', TRUE)`,
        [companyId]
      );

      // Active trip assigned to demo driver
      await client.query(
        `INSERT INTO trips (
          company_id, driver_id, vehicle_id, cmr_number, driver_name, vehicle_plate,
          shipper_name, shipper_address, shipper_contact, shipper_phone,
          consignee_name, consignee_address, consignee_contact, consignee_phone,
          loading_date, loading_time, estimated_delivery_date, estimated_delivery_time,
          goods_description, weight_kg, package_count, volume_mc, distance_km,
          special_instructions, status
        ) VALUES (
          $1, $2, $3, 'CMR-2026-0727-1001', 'Ion Popescu', 'B-202-TRX',
          'SC Logistics Nord SRL', 'Cluj-Napoca, str. Fabricii 12', 'Andrei Vasile', '+40 264 000 111',
          'Depozit Sud SA', 'București, Șoseaua Olteniței 200', 'Elena Radu', '+40 21 000 222',
          CURRENT_DATE, '08:00', CURRENT_DATE + 1, '16:00',
          'Paleți cu componente electronice', 12500, 24, 48, 450,
          'Descărcare doar pe rampe. Contactați Elena înainte cu 30 min.', 'alocata'
        )`,
        [companyId, driverId, vehicle2Id]
      );

      // Second active trip
      await client.query(
        `INSERT INTO trips (
          company_id, driver_id, vehicle_id, cmr_number, driver_name, vehicle_plate,
          shipper_name, shipper_address, consignee_name, consignee_address,
          loading_date, estimated_delivery_date, goods_description, weight_kg, package_count, distance_km, status
        ) VALUES (
          $1, $2, $3, 'CMR-2026-0727-1002', 'Ion Popescu', 'B-202-TRX',
          'Depozit Sud SA', 'București, Șoseaua Olteniței 200',
          'SC Logistics Nord SRL', 'Cluj-Napoca, str. Fabricii 12',
          CURRENT_DATE + 1, CURRENT_DATE + 2, 'Retur ambalaje', 3200, 10, 450, 'alocata'
        )`,
        [companyId, driverId, vehicle2Id]
      );

      // Planned (unassigned) trip for dispatcher
      await client.query(
        `INSERT INTO trips (
          company_id, cmr_number, shipper_name, shipper_address, consignee_name, consignee_address,
          loading_date, estimated_delivery_date, goods_description, weight_kg, package_count, distance_km, status
        ) VALUES (
          $1, 'CMR-2026-0728-2001', 'SC Agro Vest SRL', 'Timișoara, Calea Aradului 50',
          'Magazin Profi Central', 'Oradea, str. Republicii 1',
          CURRENT_DATE + 2, CURRENT_DATE + 3, 'Produse alimentare refrigerate', 8000, 40, 170, 'planificata'
        )`,
        [companyId]
      );

      // Completed trip for history
      await client.query(
        `INSERT INTO trips (
          company_id, driver_id, vehicle_id, cmr_number, driver_name, vehicle_plate,
          shipper_name, consignee_name, loading_date, actual_delivery_date,
          goods_description, weight_kg, package_count, distance_km, status
        ) VALUES (
          $1, $2, $3, 'CMR-2026-0720-0500', 'Ion Popescu', 'B-101-TRX',
          'SC Logistics Nord SRL', 'Depozit Sud SA', CURRENT_DATE - 5, CURRENT_DATE - 4,
          'Marfă generală', 9000, 18, 450, 'livrata'
        )`,
        [companyId, driverId, vehicle1Id]
      );

      await client.query(
        `INSERT INTO driver_notifications (company_id, title, message, type, cmr_number, is_read)
         VALUES
           ($1, 'Cursă nouă alocată', 'Ai o cursă nouă: CMR-2026-0727-1001 (Cluj → București).', 'trip_assigned', 'CMR-2026-0727-1001', FALSE),
           ($1, 'Atenție documente', 'Verifică rovinieta pe B-202-TRX — expiră în curând.', 'warning', NULL, FALSE)`,
        [companyId]
      );

      await client.query(
        `INSERT INTO warehouse_products (company_id, warehouse_name, sku, name, quantity, min_quantity, max_quantity, unit, location, unit_price)
         VALUES
           ($1, 'Depozit Central', 'PAL-EUR-01', 'Palet EUR', 120, 30, 200, 'piece', 'A-01', 45),
           ($1, 'Depozit Central', 'FOL-STR-01', 'Folie stretch', 40, 10, 80, 'piece', 'B-12', 28.5)`,
        [companyId]
      );

      console.log('Demo fleet + trips seeded.');
    } else {
      // Ensure driver user is linked to Ion Popescu if present
      await client.query(
        `UPDATE drivers SET user_id = $1
         WHERE company_id = $2 AND LOWER(email) = 'sofer@transitix.ro' AND user_id IS NULL`,
        [driverUserId, companyId]
      );
      console.log('Fleet already present — ensured driver user link.');
    }

    await client.query('COMMIT');
    console.log('Seed completed.');
    console.log('  Admin:  admin@transitix.ro / admin123');
    console.log('  Șofer:  sofer@transitix.ro / sofer123');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

assertSeedableDatabase();

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
