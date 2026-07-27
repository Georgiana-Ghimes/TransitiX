import bcrypt from 'bcryptjs';
import { pool } from './db.js';

async function seed() {
  const client = await pool.connect();
  try {
    const existing = await client.query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      ['admin@transitix.ro']
    );
    if (existing.rows.length > 0) {
      console.log('Seed skipped — admin already exists.');
      return;
    }

    const company = await client.query(
      `INSERT INTO companies (name, cui, email, phone, address)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      ['Transitix Demo', 'RO12345678', 'contact@transitix.ro', '+40 721 000 000', 'București, România']
    );

    const passwordHash = await bcrypt.hash('admin123', 12);
    await client.query(
      `INSERT INTO users (company_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)`,
      [company.rows[0].id, 'Admin Transitix', 'admin@transitix.ro', passwordHash, 'admin']
    );

    console.log('Seed completed.');
    console.log('  Email:    admin@transitix.ro');
    console.log('  Password: admin123');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
