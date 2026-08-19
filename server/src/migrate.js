import { pool } from './db.js';

const sql = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  cui TEXT UNIQUE,
  vat_regime TEXT DEFAULT 'platitor',
  address TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  logo_url TEXT,
  default_currency TEXT DEFAULT 'RON',
  fiscal_code TEXT,
  bank_account TEXT,
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin'
    CHECK (role IN ('admin', 'dispatcher', 'driver', 'finance')),
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login TIMESTAMPTZ,
  two_factor_secret TEXT,
  two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, email)
);

CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plate TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  year INT,
  capacity_kg INT,
  capacity_mc INT,
  fuel_consumption NUMERIC(5,2),
  fuel_type TEXT DEFAULT 'diesel'
    CHECK (fuel_type IN ('diesel', 'gasoline', 'electric', 'hybrid')),
  chassis_number TEXT,
  engine_number TEXT,
  mileage INT DEFAULT 0,
  last_maintenance_mileage INT DEFAULT 0,
  itp_number TEXT,
  itp_expiry DATE,
  rca_number TEXT,
  rca_expiry DATE,
  rovinieta_number TEXT,
  rovinieta_expiry DATE,
  casco_number TEXT,
  casco_expiry DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT DEFAULT 'available'
    CHECK (status IN ('available', 'in_trip', 'maintenance', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, plate)
);

CREATE TABLE IF NOT EXISTS drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT NOT NULL,
  hire_date DATE,
  birth_date DATE,
  license_number TEXT,
  license_category TEXT,
  license_expiry DATE,
  medical_certificate_number TEXT,
  medical_certificate_expiry DATE,
  tachograph_card_number TEXT,
  tachograph_card_expiry DATE,
  status TEXT DEFAULT 'disponibil'
    CHECK (status IN ('disponibil', 'in_cursa', 'in_concediu', 'indisponibil')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cui TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  contact_person TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  cmr_number TEXT NOT NULL,
  driver_name TEXT,
  vehicle_plate TEXT,
  shipper_name TEXT NOT NULL,
  shipper_address TEXT,
  shipper_cui TEXT,
  shipper_contact TEXT,
  shipper_phone TEXT,
  shipper_email TEXT,
  consignee_name TEXT NOT NULL,
  consignee_address TEXT,
  consignee_cui TEXT,
  consignee_contact TEXT,
  consignee_phone TEXT,
  consignee_email TEXT,
  loading_date DATE NOT NULL,
  loading_time TIME,
  estimated_delivery_date DATE,
  estimated_delivery_time TIME,
  actual_delivery_date DATE,
  goods_description TEXT,
  weight_kg NUMERIC(10,2),
  package_count INT,
  volume_mc NUMERIC(10,2),
  special_instructions TEXT,
  internal_notes TEXT,
  status TEXT NOT NULL DEFAULT 'planificata'
    CHECK (status IN ('planificata', 'alocata', 'incarcata', 'in_tranzit', 'livrata', 'problema', 'anulata')),
  distance_km INT,
  estimated_fuel_consumption NUMERIC(10,2),
  actual_fuel_consumption NUMERIC(10,2),
  start_mileage INT,
  end_mileage INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, cmr_number)
);

CREATE TABLE IF NOT EXISTS trip_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  cmr_number TEXT,
  original_image_url TEXT,
  ocr_extracted_data JSONB,
  ocr_verified_by TEXT,
  ocr_verified_at TIMESTAMPTZ,
  is_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  ocr_edited_manually BOOLEAN NOT NULL DEFAULT FALSE,
  final_pdf_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS client_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  cmr_number TEXT,
  token TEXT NOT NULL UNIQUE,
  client_name TEXT,
  client_email TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  confirmed_at TIMESTAMPTZ,
  confirmed_by_name TEXT,
  confirmed_by_ip TEXT,
  observations TEXT,
  has_damage BOOLEAN NOT NULL DEFAULT FALSE,
  damage_description TEXT,
  damage_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  series TEXT DEFAULT 'TRX',
  number TEXT NOT NULL,
  cmr_number TEXT,
  client_name TEXT NOT NULL,
  client_cui TEXT,
  client_address TEXT,
  issue_date DATE NOT NULL,
  due_date DATE,
  payment_date DATE,
  description TEXT,
  subtotal NUMERIC(10,2),
  vat_rate NUMERIC(5,2) DEFAULT 19,
  vat_amount NUMERIC(10,2),
  total_amount NUMERIC(10,2),
  currency TEXT DEFAULT 'RON',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  efactura_status TEXT DEFAULT 'not_sent'
    CHECK (efactura_status IN ('pending', 'sent', 'accepted', 'rejected', 'not_sent')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warehouse_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  warehouse_name TEXT DEFAULT 'Depozit Central',
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  quantity INT NOT NULL DEFAULT 0,
  min_quantity INT DEFAULT 0,
  max_quantity INT DEFAULT 0,
  unit TEXT DEFAULT 'piece'
    CHECK (unit IN ('kg', 'mc', 'piece', 'pallet')),
  location TEXT,
  unit_price NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, sku)
);

CREATE TABLE IF NOT EXISTS gps_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  vehicle_plate TEXT,
  trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
  latitude NUMERIC(10,7) NOT NULL,
  longitude NUMERIC(10,7) NOT NULL,
  speed NUMERIC(8,2),
  heading NUMERIC(8,2),
  ignition BOOLEAN DEFAULT TRUE,
  is_current BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL DEFAULT 'driver'
    CHECK (sender_role IN ('driver', 'dispatcher')),
  sender_name TEXT,
  message TEXT NOT NULL,
  trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS driver_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'system'
    CHECK (type IN ('trip_assigned', 'status_update', 'system', 'warning')),
  trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
  cmr_number TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS optimization_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type TEXT NOT NULL
    CHECK (type IN ('backhaul', 'vehicle_allocation', 'route', 'consolidation', 'fuel')),
  title TEXT NOT NULL,
  suggestion TEXT NOT NULL,
  potential_savings_eur NUMERIC(10,2) DEFAULT 0,
  potential_savings_km NUMERIC(10,2) DEFAULT 0,
  priority TEXT DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high')),
  is_applied BOOLEAN NOT NULL DEFAULT FALSE,
  trip_ids TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_company ON vehicles(company_id);
CREATE INDEX IF NOT EXISTS idx_drivers_company ON drivers(company_id);
CREATE INDEX IF NOT EXISTS idx_trips_company ON trips(company_id);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(company_id, status);
CREATE INDEX IF NOT EXISTS idx_client_confirmations_token ON client_confirmations(token);
CREATE INDEX IF NOT EXISTS idx_gps_logs_current ON gps_logs(company_id, is_current);

ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS office_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'system'
    CHECK (type IN (
      'trip_status', 'trip_problem', 'trip_unassigned', 'cmr_pending',
      'client_confirmed', 'client_damage', 'document_expiry', 'system'
    )),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
  cmr_number TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_office_notifications_company ON office_notifications(company_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS office_notification_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  notification_key TEXT NOT NULL,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, notification_key)
);

CREATE INDEX IF NOT EXISTS idx_office_notification_dismissals_company
  ON office_notification_dismissals(company_id);

CREATE INDEX IF NOT EXISTS idx_trips_company_driver ON trips(company_id, driver_id);
CREATE INDEX IF NOT EXISTS idx_trips_company_created ON trips(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trip_documents_company_trip ON trip_documents(company_id, trip_id);
CREATE INDEX IF NOT EXISTS idx_clients_company ON clients(company_id);
CREATE INDEX IF NOT EXISTS idx_clients_company_created ON clients(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_company_created ON invoices(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_warehouse_products_company ON warehouse_products(company_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_company_created ON chat_messages(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_notifications_company_read ON driver_notifications(company_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_office_notifications_trip_pending
  ON office_notifications(company_id, trip_id)
  WHERE type = 'cmr_pending' AND is_read = FALSE;

ALTER TABLE office_notification_dismissals ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE office_notification_dismissals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
UPDATE office_notification_dismissals
SET read_at = COALESCE(read_at, dismissed_at)
WHERE read_at IS NULL AND dismissed_at IS NOT NULL;
UPDATE office_notification_dismissals SET deleted_at = NULL WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS report_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_templates_company ON report_templates(company_id);

CREATE TABLE IF NOT EXISTS aviz_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  original_filename TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'extracted', 'confirmed')),
  extracted_data JSONB DEFAULT '{}'::jsonb,
  numar_tpo TEXT,
  data_efectuare_cursa DATE,
  valoare_tpo NUMERIC(12,2) DEFAULT 0,
  numar_auto TEXT,
  ruta_transport TEXT,
  tip_marfa TEXT,
  cantitate_marfa NUMERIC(12,3),
  numar_document_marfa TEXT,
  numar_curse INT DEFAULT 1,
  taxe_suplimentare NUMERIC(12,2) DEFAULT 0,
  km_parcursi NUMERIC(10,2) DEFAULT 0,
  tarif_km NUMERIC(10,4) DEFAULT 0,
  observatii TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aviz_documents_company ON aviz_documents(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aviz_documents_status ON aviz_documents(company_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uniq ON users (LOWER(email));

UPDATE report_templates t SET is_default = FALSE
WHERE t.is_default = TRUE
  AND t.id NOT IN (
    SELECT kept.id FROM (
      SELECT DISTINCT ON (company_id) id
      FROM report_templates
      WHERE is_default = TRUE
      ORDER BY company_id, created_at ASC
    ) kept
  );
CREATE UNIQUE INDEX IF NOT EXISTS report_templates_one_default
  ON report_templates (company_id) WHERE is_default;

UPDATE gps_logs g SET is_current = FALSE
WHERE g.is_current = TRUE
  AND g.id NOT IN (
    SELECT kept.id FROM (
      SELECT DISTINCT ON (company_id, vehicle_id) id
      FROM gps_logs
      WHERE is_current = TRUE
      ORDER BY company_id, vehicle_id, created_at DESC
    ) kept
  );
CREATE UNIQUE INDEX IF NOT EXISTS gps_logs_one_current
  ON gps_logs (company_id, vehicle_id) WHERE is_current;

DELETE FROM client_confirmations a
  USING client_confirmations b
WHERE a.ctid < b.ctid
  AND a.trip_id = b.trip_id
  AND a.status = 'pending'
  AND b.status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS client_confirmations_one_pending
  ON client_confirmations (trip_id) WHERE status = 'pending';

DELETE FROM office_notifications a
  USING office_notifications b
WHERE a.ctid < b.ctid
  AND a.company_id = b.company_id
  AND a.trip_id IS NOT NULL
  AND a.trip_id = b.trip_id
  AND a.type = 'cmr_pending' AND b.type = 'cmr_pending'
  AND a.is_read = FALSE AND b.is_read = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS office_notif_one_cmr_pending
  ON office_notifications (company_id, trip_id)
  WHERE type = 'cmr_pending' AND is_read = FALSE;
`;

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('Migration completed successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
