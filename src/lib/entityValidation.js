/**
 * Business validation for the office forms — Client, Șofer, Factură, Produs depozit.
 *
 * These rules exist twice on purpose: the API ships without `src/` (see `server/Dockerfile`), so
 * the server keeps its own copy in `server/src/lib/validation/entityInput.js`. The pair is held
 * together by `server/src/lib/validation/entityInput.parity.test.js`, which runs the same table
 * of inputs through both. Change one, change the other.
 *
 * Every validator returns a plain `{ field: message }` map, empty when the form is valid, and is
 * paired with a `normalize*` that trims text and turns blank optionals into null so the database
 * stores absence rather than a string of spaces.
 */

/** Anything the terminal or a corrupt paste can inject and a human cannot see. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const HAS_ALNUM = /[\p{L}\p{N}]/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+()\d][\d\s().-]{5,20}$/;
/**
 * Deliberately loose. A Romanian CUI is `RO` plus digits, but the same column holds the VAT id of
 * any EU partner — `ATU12345678` has three letters, `IE1234567FA` ends in them — so pinning the
 * shape would refuse real clients. This only rules out text that identifies nobody: it has to
 * carry at least one digit.
 */
const VAT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9 .-]*$/;
const SKU_RE = /^[A-Za-z0-9._-]+$/;
const CODE_RE = /^[A-Za-z0-9 ./-]+$/;
const LICENSE_CATEGORY_RE = /^[A-Za-z0-9]{1,3}(\+[A-Za-z0-9]{1,3})?(\s*,\s*[A-Za-z0-9]{1,3}(\+[A-Za-z0-9]{1,3})?)*$/;
const ADR_CLASS_RE = /^[1-9](\.[1-9])?[A-Za-z]?$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const YEAR_MIN = 1950;
const YEAR_MAX = new Date().getFullYear() + 50;

export function trimmed(value) {
  return typeof value === 'string' ? value.trim() : (value ?? '');
}

/** Blank optional text becomes null, so a card never renders a row of invisible spaces. */
export function blankToNull(value) {
  const text = trimmed(value);
  return text === '' ? null : text;
}

function isBlank(value) {
  return trimmed(value) === '';
}

function checkText(errors, field, value, label, { required = false, min = 0, max = Infinity } = {}) {
  const text = trimmed(value);
  if (text === '') {
    if (required) errors[field] = `Completează ${label}.`;
    return;
  }
  if (CONTROL_CHARS.test(text)) {
    errors[field] = `${capitalize(label)} conține caractere nepermise.`;
    return;
  }
  if (!HAS_ALNUM.test(text)) {
    errors[field] = `${capitalize(label)} trebuie să conțină litere sau cifre.`;
    return;
  }
  if (text.length < min) errors[field] = `${capitalize(label)}: minim ${min} caractere.`;
  else if (text.length > max) errors[field] = `${capitalize(label)}: maxim ${max} caractere.`;
}

function checkFreeText(errors, field, value, label, max) {
  const text = trimmed(value);
  if (text === '') return;
  if (CONTROL_CHARS.test(text)) errors[field] = `${capitalize(label)} conține caractere nepermise.`;
  else if (text.length > max) errors[field] = `${capitalize(label)}: maxim ${max} caractere.`;
}

function checkPattern(errors, field, value, label, regex, message, max = 64) {
  const text = trimmed(value);
  if (text === '') return;
  if (text.length > max) errors[field] = `${capitalize(label)}: maxim ${max} caractere.`;
  else if (!regex.test(text)) errors[field] = message;
}

function checkVatId(errors, field, value, label) {
  const text = trimmed(value);
  if (text === '') return;
  if (text.length > 20) errors[field] = `${capitalize(label)}: maxim 20 caractere.`;
  else if (!VAT_ID_RE.test(text) || !/\d/.test(text)) {
    errors[field] = `${capitalize(label)} invalid — litere și cifre (ex. RO12345678).`;
  }
}

function checkEmail(errors, field, value) {
  const text = trimmed(value);
  if (text === '') return;
  if (!EMAIL_RE.test(text)) errors[field] = 'Email invalid (ex. nume@firma.ro).';
}

function checkPhone(errors, field, value, { required = false } = {}) {
  const text = trimmed(value);
  if (text === '') {
    if (required) errors[field] = 'Completează numărul de telefon.';
    return;
  }
  const digits = text.replace(/\D/g, '');
  if (!PHONE_RE.test(text) || digits.length < 7 || digits.length > 15) {
    errors[field] = 'Telefon invalid (7–15 cifre, ex. 0722 123 456).';
  }
}

export function parseDateOnly(value) {
  const text = trimmed(value);
  if (text === '') return null;
  const iso = text.slice(0, 10);
  if (!ISO_DATE_RE.test(iso)) return NaN;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? NaN : d;
}

function checkDate(errors, field, value, label, { required = false } = {}) {
  const text = trimmed(value);
  if (text === '') {
    if (required) errors[field] = `Completează ${label}.`;
    return null;
  }
  const parsed = parseDateOnly(text);
  if (!parsed || Number.isNaN(parsed)) {
    errors[field] = `${capitalize(label)}: dată invalidă.`;
    return null;
  }
  const year = parsed.getUTCFullYear();
  if (year < YEAR_MIN || year > YEAR_MAX) {
    errors[field] = `${capitalize(label)}: an între ${YEAR_MIN} și ${YEAR_MAX}.`;
    return null;
  }
  return parsed;
}

function checkNumber(errors, field, value, label, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  if (value === '' || value == null) return;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    errors[field] = `${capitalize(label)}: valoare numerică invalidă.`;
    return;
  }
  if (integer && !Number.isInteger(n)) {
    errors[field] = `${capitalize(label)}: număr întreg.`;
    return;
  }
  if (n < min) errors[field] = `${capitalize(label)}: minim ${min}.`;
  else if (n > max) errors[field] = `${capitalize(label)}: maxim ${max.toLocaleString('ro-RO')}.`;
}

function checkTime(errors, field, value, label) {
  const text = trimmed(value);
  if (text === '') return;
  if (!TIME_RE.test(text.slice(0, 5))) errors[field] = `${capitalize(label)}: format HH:MM.`;
}

function capitalize(text) {
  return String(text).charAt(0).toUpperCase() + String(text).slice(1);
}

/* ------------------------------------------------------------------ Client */

export function validateClient(form = {}) {
  const errors = {};
  checkText(errors, 'name', form.name, 'denumirea clientului', { required: true, min: 2, max: 200 });
  checkVatId(errors, 'cui', form.cui, 'CUI-ul');
  checkFreeText(errors, 'address', form.address, 'adresa', 300);
  checkPhone(errors, 'phone', form.phone);
  checkEmail(errors, 'email', form.email);
  checkText(errors, 'contact_person', form.contact_person, 'persoana de contact', { max: 120 });
  checkFreeText(errors, 'notes', form.notes, 'notele', 2000);
  return errors;
}

export function normalizeClient(form = {}) {
  return {
    ...form,
    name: trimmed(form.name),
    cui: blankToNull(form.cui),
    address: blankToNull(form.address),
    phone: blankToNull(form.phone),
    email: blankToNull(form.email),
    contact_person: blankToNull(form.contact_person),
    notes: blankToNull(form.notes),
  };
}

/* ------------------------------------------------------------------ Driver */

export function validateDriver(form = {}) {
  const errors = {};
  checkText(errors, 'name', form.name, 'numele complet', { required: true, min: 3, max: 120 });
  checkPhone(errors, 'phone', form.phone, { required: true });
  checkEmail(errors, 'email', form.email);
  checkPattern(errors, 'license_number', form.license_number, 'numărul permisului', CODE_RE, 'Numărul permisului: doar litere, cifre, spațiu, . - /', 40);
  checkPattern(errors, 'license_category', form.license_category, 'categoria permisului', LICENSE_CATEGORY_RE, 'Categorie invalidă (ex. C, C+E, B, C1).', 40);
  checkPattern(errors, 'medical_certificate_number', form.medical_certificate_number, 'numărul certificatului medical', CODE_RE, 'Numărul certificatului medical: doar litere, cifre, spațiu, . - /', 40);
  checkPattern(errors, 'tachograph_card_number', form.tachograph_card_number, 'numărul cardului tahograf', CODE_RE, 'Numărul cardului tahograf: doar litere, cifre, spațiu, . - /', 40);

  const birth = checkDate(errors, 'birth_date', form.birth_date, 'data nașterii');
  if (birth && birth.getTime() > Date.now()) errors.birth_date = 'Data nașterii nu poate fi în viitor.';
  checkDate(errors, 'hire_date', form.hire_date, 'data angajării');
  checkDate(errors, 'license_expiry', form.license_expiry, 'expirarea permisului');
  checkDate(errors, 'medical_certificate_expiry', form.medical_certificate_expiry, 'expirarea certificatului medical');
  checkDate(errors, 'tachograph_card_expiry', form.tachograph_card_expiry, 'expirarea cardului tahograf');

  checkTime(errors, 'shift_start', form.shift_start, 'începutul turei');
  checkTime(errors, 'shift_end', form.shift_end, 'sfârșitul turei');
  if (!errors.shift_start && !errors.shift_end
    && !isBlank(form.shift_start) && !isBlank(form.shift_end)
    && trimmed(form.shift_start).slice(0, 5) === trimmed(form.shift_end).slice(0, 5)) {
    errors.shift_end = 'Tura nu poate începe și se termina la aceeași oră.';
  }

  // A document number with no expiry date is how a driver silently drops out of the expiry
  // alerts, which is the whole point of storing it.
  const pairs = [
    ['license_number', 'license_expiry', 'permisului'],
    ['medical_certificate_number', 'medical_certificate_expiry', 'certificatului medical'],
    ['tachograph_card_number', 'tachograph_card_expiry', 'cardului tahograf'],
  ];
  for (const [numberField, expiryField, label] of pairs) {
    if (!isBlank(form[numberField]) && isBlank(form[expiryField]) && !errors[expiryField]) {
      errors[expiryField] = `Completează expirarea ${label} — altfel nu intră în alerte.`;
    }
  }

  return errors;
}

export function normalizeDriver(form = {}) {
  const out = {
    ...form,
    name: trimmed(form.name),
    phone: trimmed(form.phone),
    email: blankToNull(form.email),
    license_number: blankToNull(form.license_number),
    license_category: blankToNull(form.license_category),
    medical_certificate_number: blankToNull(form.medical_certificate_number),
    tachograph_card_number: blankToNull(form.tachograph_card_number),
  };
  for (const key of [
    'hire_date', 'birth_date', 'license_expiry',
    'medical_certificate_expiry', 'tachograph_card_expiry', 'shift_start', 'shift_end',
  ]) {
    if (key in out) out[key] = blankToNull(out[key]);
  }
  return out;
}

/* ----------------------------------------------------------------- Invoice */

export function validateInvoice(form = {}) {
  const errors = {};
  checkText(errors, 'client_name', form.client_name, 'numele clientului', { required: true, min: 2, max: 200 });
  checkVatId(errors, 'client_cui', form.client_cui, 'CUI-ul clientului');
  checkFreeText(errors, 'client_address', form.client_address, 'adresa clientului', 300);
  checkFreeText(errors, 'description', form.description, 'descrierea', 2000);
  checkPattern(errors, 'series', form.series, 'seria', /^[A-Za-z0-9-]+$/, 'Seria: doar litere, cifre și -.', 12);

  const issue = checkDate(errors, 'issue_date', form.issue_date, 'data emiterii', { required: true });
  const due = checkDate(errors, 'due_date', form.due_date, 'scadența');
  if (issue && due && due.getTime() < issue.getTime()) {
    errors.due_date = 'Scadența nu poate fi înainte de data emiterii.';
  }
  checkDate(errors, 'payment_date', form.payment_date, 'data plății');

  checkNumber(errors, 'subtotal', form.subtotal, 'subtotalul', { min: 0, max: 1e12 });
  checkNumber(errors, 'vat_rate', form.vat_rate, 'cota TVA', { min: 0, max: 100 });
  return errors;
}

export function normalizeInvoice(form = {}) {
  return {
    ...form,
    client_name: trimmed(form.client_name),
    client_cui: blankToNull(form.client_cui),
    client_address: blankToNull(form.client_address),
    description: blankToNull(form.description),
    notes: blankToNull(form.notes),
    cmr_number: blankToNull(form.cmr_number),
  };
}

/* -------------------------------------------------------- WarehouseProduct */

export function validateWarehouseProduct(form = {}) {
  const errors = {};
  const sku = trimmed(form.sku);
  if (sku === '') errors.sku = 'Completează SKU-ul.';
  else if (sku.length > 64) errors.sku = 'SKU: maxim 64 caractere.';
  else if (!SKU_RE.test(sku)) errors.sku = 'SKU: doar litere, cifre, . _ - (fără spații sau simboluri).';

  checkText(errors, 'name', form.name, 'denumirea produsului', { required: true, min: 2, max: 200 });
  checkFreeText(errors, 'description', form.description, 'descrierea', 2000);
  checkPattern(errors, 'location', form.location, 'locația', CODE_RE, 'Locație invalidă (ex. A-12-03).', 32);
  checkPattern(errors, 'picking_zone', form.picking_zone, 'zona de picking', CODE_RE, 'Zonă invalidă (ex. A).', 32);
  checkPattern(errors, 'adr_class', form.adr_class, 'clasa ADR', ADR_CLASS_RE, 'Clasă ADR invalidă (ex. 3, 1.4, 6.1).', 8);

  checkNumber(errors, 'quantity', form.quantity, 'cantitatea', { min: 0, max: 1e9, integer: true });
  checkNumber(errors, 'min_quantity', form.min_quantity, 'stocul minim', { min: 0, max: 1e9, integer: true });
  checkNumber(errors, 'max_quantity', form.max_quantity, 'stocul maxim', { min: 0, max: 1e9, integer: true });
  checkNumber(errors, 'unit_price', form.unit_price, 'prețul unitar', { min: 0, max: 1e9 });
  checkNumber(errors, 'length_m', form.length_m, 'lungimea', { min: 0, max: 100 });
  checkNumber(errors, 'width_m', form.width_m, 'lățimea', { min: 0, max: 100 });
  checkNumber(errors, 'height_m', form.height_m, 'înălțimea', { min: 0, max: 100 });
  checkNumber(errors, 'unit_weight_kg', form.unit_weight_kg, 'greutatea unitară', { min: 0, max: 100000 });

  const min = Number(form.min_quantity);
  const max = Number(form.max_quantity);
  if (!errors.min_quantity && !errors.max_quantity
    && Number.isFinite(min) && Number.isFinite(max) && max > 0 && max < min) {
    errors.max_quantity = 'Stocul maxim nu poate fi sub stocul minim.';
  }
  return errors;
}

export function normalizeWarehouseProduct(form = {}) {
  return {
    ...form,
    sku: trimmed(form.sku),
    name: trimmed(form.name),
    description: blankToNull(form.description),
    location: blankToNull(form.location),
    picking_zone: blankToNull(form.picking_zone),
    adr_class: blankToNull(form.adr_class),
    warehouse_name: blankToNull(form.warehouse_name),
  };
}

export function firstErrorKey(errors) {
  const keys = Object.keys(errors || {});
  return keys.length > 0 ? keys[0] : null;
}

export const FORM_ERROR_BANNER = 'Corectează câmpurile evidențiate înainte de salvare.';
