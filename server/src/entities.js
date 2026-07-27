/** Map entity names to DB tables and config */
export const ENTITY_MAP = {
  Vehicle: {
    table: 'vehicles',
    companyScoped: true,
    writable: [
      'plate', 'brand', 'model', 'year', 'capacity_kg', 'capacity_mc', 'fuel_consumption',
      'fuel_type', 'chassis_number', 'engine_number', 'mileage', 'last_maintenance_mileage',
      'itp_number', 'itp_expiry', 'rca_number', 'rca_expiry', 'rovinieta_number', 'rovinieta_expiry',
      'casco_number', 'casco_expiry', 'is_active', 'status',
    ],
  },
  Driver: {
    table: 'drivers',
    companyScoped: true,
    writable: [
      'name', 'email', 'phone', 'hire_date', 'birth_date', 'license_number', 'license_category',
      'license_expiry', 'medical_certificate_number', 'medical_certificate_expiry',
      'tachograph_card_number', 'tachograph_card_expiry', 'status', 'is_active', 'user_id',
    ],
  },
  Client: {
    table: 'clients',
    companyScoped: true,
    writable: ['name', 'cui', 'address', 'phone', 'email', 'contact_person', 'notes', 'is_active'],
  },
  Trip: {
    table: 'trips',
    companyScoped: true,
    writable: [
      'driver_id', 'vehicle_id', 'cmr_number', 'driver_name', 'vehicle_plate',
      'shipper_name', 'shipper_address', 'shipper_cui', 'shipper_contact', 'shipper_phone', 'shipper_email',
      'consignee_name', 'consignee_address', 'consignee_cui', 'consignee_contact', 'consignee_phone', 'consignee_email',
      'loading_date', 'loading_time', 'estimated_delivery_date', 'estimated_delivery_time', 'actual_delivery_date',
      'goods_description', 'weight_kg', 'package_count', 'volume_mc', 'special_instructions', 'internal_notes',
      'status', 'distance_km', 'estimated_fuel_consumption', 'actual_fuel_consumption', 'start_mileage', 'end_mileage',
    ],
  },
  TripDocument: {
    table: 'trip_documents',
    companyScoped: true,
    writable: [
      'trip_id', 'cmr_number', 'original_image_url', 'ocr_extracted_data', 'ocr_verified_by',
      'ocr_verified_at', 'is_confirmed', 'ocr_edited_manually', 'final_pdf_url', 'notes',
    ],
  },
  ClientConfirmation: {
    table: 'client_confirmations',
    companyScoped: true,
    writable: [
      'trip_id', 'cmr_number', 'token', 'client_name', 'client_email', 'expires_at',
      'confirmed_at', 'confirmed_by_name', 'confirmed_by_ip', 'observations',
      'has_damage', 'damage_description', 'damage_image_url', 'status',
    ],
  },
  Invoice: {
    table: 'invoices',
    companyScoped: true,
    writable: [
      'trip_id', 'client_id', 'series', 'number', 'cmr_number', 'client_name', 'client_cui', 'client_address',
      'issue_date', 'due_date', 'payment_date', 'description', 'subtotal', 'vat_rate', 'vat_amount',
      'total_amount', 'currency', 'status', 'efactura_status', 'notes',
    ],
  },
  WarehouseProduct: {
    table: 'warehouse_products',
    companyScoped: true,
    writable: [
      'warehouse_name', 'sku', 'name', 'description', 'quantity', 'min_quantity', 'max_quantity',
      'unit', 'location', 'unit_price',
    ],
  },
  GPSLog: {
    table: 'gps_logs',
    companyScoped: true,
    writable: [
      'vehicle_id', 'vehicle_plate', 'trip_id', 'latitude', 'longitude', 'speed',
      'heading', 'ignition', 'is_current',
    ],
  },
  ChatMessage: {
    table: 'chat_messages',
    companyScoped: true,
    writable: ['sender_role', 'sender_name', 'message', 'trip_id', 'is_read'],
  },
  DriverNotification: {
    table: 'driver_notifications',
    companyScoped: true,
    writable: ['title', 'message', 'type', 'trip_id', 'cmr_number', 'is_read'],
  },
  OptimizationSuggestion: {
    table: 'optimization_suggestions',
    companyScoped: true,
    writable: [
      'type', 'title', 'suggestion', 'potential_savings_eur', 'potential_savings_km',
      'priority', 'is_applied', 'trip_ids',
    ],
  },
};

/** Convert order string (-created_date) to SQL ORDER BY */
export function parseOrder(order) {
  if (!order || typeof order !== 'string') return 'created_at DESC';
  const desc = order.startsWith('-');
  let col = desc ? order.slice(1) : order;
  if (col === 'created_date') col = 'created_at';
  if (col === 'updated_date') col = 'updated_at';
  // whitelist
  if (!/^[a-z_]+$/i.test(col)) return 'created_at DESC';
  return `${col} ${desc ? 'DESC' : 'ASC'}`;
}

/** Serialize row for frontend (aliases created_date / updated_date) */
export function serializeRow(row) {
  if (!row) return row;
  const out = { ...row };
  if (out.created_at) {
    out.created_date = out.created_at;
  }
  if (out.updated_at) {
    out.updated_date = out.updated_at;
  }
  // numeric strings from pg
  for (const key of Object.keys(out)) {
    if (typeof out[key] === 'string' && /^-?\d+(\.\d+)?$/.test(out[key]) &&
        (key.includes('kg') || key.includes('amount') || key.includes('price') ||
         key.includes('cost') || key.includes('rate') || key.includes('consumption') ||
         key.includes('latitude') || key.includes('longitude') || key.includes('speed') ||
         key.includes('heading') || key.includes('savings') || key.includes('volume'))) {
      out[key] = Number(out[key]);
    }
  }
  return out;
}

export function pickWritable(entity, data) {
  const allowed = new Set(entity.writable);
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (allowed.has(k) && v !== undefined) {
      out[k] = v === '' ? null : v;
    }
  }
  return out;
}
