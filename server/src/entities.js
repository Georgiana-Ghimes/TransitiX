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
      'capacity_pallets', 'capabilities', 'home_location_id', 'cost_per_km', 'cost_per_hour',
      'cargo_length_m', 'cargo_width_m', 'cargo_height_m',
      'axle_front_m', 'axle_rear_m', 'axle_front_max_kg', 'axle_rear_max_kg',
      'fuel_price_per_l', 'wage_per_hour', 'toll_per_km', 'depreciation_per_km', 'maintenance_per_km',
    ],
  },
  Driver: {
    table: 'drivers',
    companyScoped: true,
    writable: [
      'name', 'email', 'phone', 'hire_date', 'birth_date', 'license_number', 'license_category',
      'license_expiry', 'medical_certificate_number', 'medical_certificate_expiry',
      'tachograph_card_number', 'tachograph_card_expiry', 'status', 'is_active', 'user_id',
      'shift_start', 'shift_end',
    ],
  },
  Client: {
    table: 'clients',
    companyScoped: true,
    writable: ['name', 'cui', 'address', 'phone', 'email', 'contact_person', 'notes', 'is_active'],
  },
  Location: {
    table: 'locations',
    companyScoped: true,
    writable: [
      'client_id', 'name', 'kind', 'address', 'city', 'county', 'postcode', 'country',
      'address_key', 'latitude', 'longitude', 'geocode_source', 'geocode_confidence',
      'geocode_verified', 'geocoded_at', 'default_service_time_min', 'window_start', 'window_end',
      'max_vehicle_length_m', 'max_vehicle_weight_t', 'access_notes', 'contact_person',
      'phone', 'is_active', 'territory_id',
    ],
  },
  Order: {
    table: 'orders',
    companyScoped: true,
    writable: [
      'client_id', 'location_id', 'order_number', 'type', 'requested_date',
      'window_start', 'window_end', 'service_time_min', 'weight_kg', 'volume_mc', 'pallets',
      'requires', 'goods_description', 'notes', 'status', 'product_id',
    ],
  },
  Route: {
    table: 'routes',
    companyScoped: true,
    writable: [
      'route_date', 'code', 'vehicle_id', 'driver_id', 'depot_location_id', 'starts_at',
      'status', 'notes', 'uit_code',
    ],
  },
  RouteStop: {
    table: 'route_stops',
    companyScoped: true,
    writable: [
      'route_id', 'seq', 'location_id', 'order_id', 'kind', 'service_time_min',
      'actual_arrival', 'actual_departure', 'status', 'notes',
    ],
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
      'uit_code', 'agreed_revenue', 'estimated_cost', 'route_id',
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
      'length_m', 'width_m', 'height_m', 'unit_weight_kg', 'stackable',
      'adr_class', 'pallet_type', 'picking_zone',
    ],
  },
  Territory: {
    table: 'territories',
    companyScoped: true,
    writable: ['name', 'color', 'polygon', 'sort_order', 'is_active'],
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
  ReportTemplate: {
    table: 'report_templates',
    companyScoped: true,
    jsonFields: ['columns'],
    writable: ['name', 'columns', 'is_default'],
  },
  AvizDocument: {
    table: 'aviz_documents',
    companyScoped: true,
    jsonFields: ['extracted_data'],
    writable: [
      'file_url', 'original_filename', 'status', 'extracted_data',
      'numar_tpo', 'data_efectuare_cursa', 'valoare_tpo', 'numar_auto',
      'ruta_transport', 'tip_marfa', 'cantitate_marfa', 'numar_document_marfa',
      'numar_curse', 'taxe_suplimentare', 'km_parcursi', 'tarif_km', 'observatii',
      'ruta_display', 'trip_id',
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

function isDateOnlyField(key) {
  return /(_date|_expiry)$/.test(key) || key === 'hire_date' || key === 'birth_date'
    || key === 'issue_date' || key === 'due_date' || key === 'payment_date'
    || key === 'data_efectuare_cursa';
}

function formatDateOnly(val) {
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
  if (!(val instanceof Date) || Number.isNaN(val.getTime())) return val;
  if (val.getUTCHours() === 0 && val.getUTCMinutes() === 0) {
    return val.toISOString().slice(0, 10);
  }
  const y = val.getFullYear();
  const m = String(val.getMonth() + 1).padStart(2, '0');
  const d = String(val.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

  for (const key of Object.keys(out)) {
    const val = out[key];
    if (val instanceof Date) {
      // Keep date-only fields as YYYY-MM-DD (avoid TZ shift in UI)
      if (isDateOnlyField(key)) {
        out[key] = formatDateOnly(val);
      } else if (/(_time)$/.test(key)) {
        out[key] = val.toISOString().slice(11, 16);
      } else {
        out[key] = val.toISOString();
      }
      continue;
    }
    // pg may return DATE as string already
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val) && isDateOnlyField(key)) {
      out[key] = formatDateOnly(val);
    }
    if (typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val) &&
        (key.includes('kg') || key.includes('amount') || key.includes('price') ||
         key.includes('cost') || key.includes('rate') || key.includes('revenue') || key.includes('consumption') ||
         key.includes('latitude') || key.includes('longitude') || key.includes('speed') ||
         key.includes('heading') || key.includes('savings') || key.includes('volume') ||
         key.includes('confidence') || key.startsWith('max_vehicle_') ||
         key === 'valoare_tpo' || key === 'cantitate_marfa' || key === 'numar_curse' ||
         key === 'taxe_suplimentare' || key === 'km_parcursi' || key === 'tarif_km')) {
      out[key] = Number(val);
    }
  }
  return out;
}

export function pickWritable(entity, data) {
  const allowed = new Set(entity.writable);
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (allowed.has(k) && v !== undefined) {
      if (entity.jsonFields?.includes(k) && v && typeof v === 'object') {
        out[k] = JSON.stringify(v);
      } else {
        out[k] = v === '' ? null : v;
      }
    }
  }
  return out;
}
