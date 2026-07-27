/**
 * Incremental demo seed — safe to re-run.
 * Fills missing fleet/trips without wiping user data.
 */
import bcrypt from 'bcryptjs';
import { pool } from './db.js';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const company = await client.query(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    if (!company.rows[0]) throw new Error('No company — run npm run migrate && npm run seed first');
    const companyId = company.rows[0].id;

    // Ensure sofer user
    let sofer = await client.query(
      `SELECT id FROM users WHERE company_id = $1 AND LOWER(email) = 'sofer@transitix.ro'`,
      [companyId]
    );
    let soferId;
    if (sofer.rows[0]) {
      soferId = sofer.rows[0].id;
    } else {
      const hash = await bcrypt.hash('sofer123', 12);
      const created = await client.query(
        `INSERT INTO users (company_id, name, email, password_hash, role)
         VALUES ($1, 'Ion Popescu', 'sofer@transitix.ro', $2, 'driver') RETURNING id`,
        [companyId, hash]
      );
      soferId = created.rows[0].id;
    }

    // Ensure vehicle
    let vehicle = await client.query(
      `SELECT id, plate FROM vehicles WHERE company_id = $1 AND is_active = TRUE ORDER BY created_at ASC LIMIT 1`,
      [companyId]
    );
    if (!vehicle.rows[0]) {
      vehicle = await client.query(
        `INSERT INTO vehicles (company_id, plate, brand, model, year, capacity_kg, fuel_type, status, is_active)
         VALUES ($1, 'B-202-TRX', 'Scania', 'R450', 2022, 22000, 'diesel', 'in_trip', TRUE)
         RETURNING id, plate`,
        [companyId]
      );
    }
    const vehicleId = vehicle.rows[0].id;
    const vehiclePlate = vehicle.rows[0].plate;

    // Ensure driver linked to sofer account
    let driver = await client.query(
      `SELECT id, name FROM drivers WHERE company_id = $1 AND user_id = $2`,
      [companyId, soferId]
    );
    if (!driver.rows[0]) {
      // Prefer linking by email, else create
      const byEmail = await client.query(
        `SELECT id, name FROM drivers WHERE company_id = $1 AND LOWER(email) = 'sofer@transitix.ro'`,
        [companyId]
      );
      if (byEmail.rows[0]) {
        await client.query(`UPDATE drivers SET user_id = $1 WHERE id = $2`, [soferId, byEmail.rows[0].id]);
        driver = byEmail;
      } else {
        // Link first active driver if orphan, else create dedicated one
        const orphan = await client.query(
          `SELECT id, name FROM drivers WHERE company_id = $1 AND user_id IS NULL AND is_active = TRUE
           ORDER BY created_at ASC LIMIT 1`,
          [companyId]
        );
        if (orphan.rows[0]) {
          await client.query(
            `UPDATE drivers SET user_id = $1, email = COALESCE(email, 'sofer@transitix.ro') WHERE id = $2`,
            [soferId, orphan.rows[0].id]
          );
          driver = orphan;
        } else {
          driver = await client.query(
            `INSERT INTO drivers (company_id, user_id, name, email, phone, status, is_active)
             VALUES ($1, $2, 'Ion Popescu', 'sofer@transitix.ro', '+40 722 111 222', 'in_cursa', TRUE)
             RETURNING id, name`,
            [companyId, soferId]
          );
        }
      }
    }
    const driverId = driver.rows[0].id;
    const driverName = driver.rows[0].name;

    const tripCount = await client.query(
      `SELECT COUNT(*)::int AS c FROM trips WHERE company_id = $1`,
      [companyId]
    );

    if (tripCount.rows[0].c === 0) {
      await client.query(
        `INSERT INTO trips (
          company_id, driver_id, vehicle_id, cmr_number, driver_name, vehicle_plate,
          shipper_name, shipper_address, shipper_contact, shipper_phone,
          consignee_name, consignee_address, consignee_contact, consignee_phone,
          loading_date, loading_time, estimated_delivery_date, estimated_delivery_time,
          goods_description, weight_kg, package_count, volume_mc, distance_km,
          special_instructions, status
        ) VALUES
        ($1, $2, $3, 'CMR-2026-0727-1001', $4, $5,
          'SC Logistics Nord SRL', 'Cluj-Napoca, str. Fabricii 12', 'Andrei Vasile', '+40 264 000 111',
          'Depozit Sud SA', 'București, Șoseaua Olteniței 200', 'Elena Radu', '+40 21 000 222',
          CURRENT_DATE, '08:00', CURRENT_DATE + 1, '16:00',
          'Paleți cu componente electronice', 12500, 24, 48, 450,
          'Descărcare doar pe rampe. Contactați Elena înainte cu 30 min.', 'alocata'),
        ($1, $2, $3, 'CMR-2026-0727-1002', $4, $5,
          'Depozit Sud SA', 'București, Șoseaua Olteniței 200', 'Elena Radu', '+40 21 000 222',
          'SC Logistics Nord SRL', 'Cluj-Napoca, str. Fabricii 12', 'Andrei Vasile', '+40 264 000 111',
          CURRENT_DATE + 1, '09:00', CURRENT_DATE + 2, '18:00',
          'Retur ambalaje', 3200, 10, 20, 450, NULL, 'alocata'),
        ($1, NULL, NULL, 'CMR-2026-0728-2001', NULL, NULL,
          'SC Agro Vest SRL', 'Timișoara, Calea Aradului 50', NULL, NULL,
          'Magazin Profi Central', 'Oradea, str. Republicii 1', NULL, NULL,
          CURRENT_DATE + 2, NULL, CURRENT_DATE + 3, NULL,
          'Produse alimentare refrigerate', 8000, 40, NULL, 170, NULL, 'planificata'),
        ($1, $2, $3, 'CMR-2026-0720-0500', $4, $5,
          'SC Logistics Nord SRL', 'Cluj-Napoca', NULL, NULL,
          'Depozit Sud SA', 'București', NULL, NULL,
          CURRENT_DATE - 5, NULL, CURRENT_DATE - 4, NULL,
          'Marfă generală', 9000, 18, NULL, 450, NULL, 'livrata')`,
        [companyId, driverId, vehicleId, driverName, vehiclePlate]
      );

      await client.query(
        `INSERT INTO driver_notifications (company_id, title, message, type, cmr_number, is_read)
         VALUES
           ($1, 'Cursă nouă alocată', 'Ai o cursă nouă: CMR-2026-0727-1001 (Cluj → București).', 'trip_assigned', 'CMR-2026-0727-1001', FALSE),
           ($1, 'Cursă nouă alocată', 'Ai o cursă nouă: CMR-2026-0727-1002 (București → Cluj).', 'trip_assigned', 'CMR-2026-0727-1002', FALSE)`,
        [companyId]
      );

      // Ensure CRM clients exist
      const clientCount = await client.query(`SELECT COUNT(*)::int AS c FROM clients WHERE company_id = $1`, [companyId]);
      if (clientCount.rows[0].c === 0) {
        await client.query(
          `INSERT INTO clients (company_id, name, cui, address, phone, email, contact_person, is_active) VALUES
           ($1, 'SC Logistics Nord SRL', 'RO99887766', 'Cluj-Napoca, str. Fabricii 12', '+40 264 000 111', 'comenzi@logisticsnord.ro', 'Andrei Vasile', TRUE),
           ($1, 'Depozit Sud SA', 'RO11223344', 'București, Șoseaua Olteniței 200', '+40 21 000 222', 'receptie@depozitsud.ro', 'Elena Radu', TRUE)`,
          [companyId]
        );
      }

      console.log('Created 4 demo trips (2 active, 1 planned, 1 delivered).');
    } else {
      console.log(`Trips already exist (${tripCount.rows[0].c}) — skipped trip insert.`);
    }

    await client.query('COMMIT');
    console.log('Demo OK.');
    console.log(`  Driver linked: ${driverName} ← sofer@transitix.ro`);
    console.log('  Login șofer: sofer@transitix.ro / sofer123');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
