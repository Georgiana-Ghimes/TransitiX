/**
 * Server-side business validation for the office entities the forms write: Client, Driver,
 * Invoice, WarehouseProduct.
 *
 * The API image ships only `server/src` (see `server/Dockerfile`), so this cannot import the
 * browser copy in `src/lib/entityValidation.js`. The two are kept in step by
 * `entityInput.parity.test.js`, which runs one table of inputs through both and asserts the same
 * verdict. Change one, change the other.
 *
 * The forms are not the only caller — the generic `/api/entities/:entity` routes are reachable
 * directly — so a value rejected in the UI has to be rejected here as well.
 */

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const HAS_ALNUM = /[\p{L}\p{N}]/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+()\d][\d\s().-]{5,20}$/;
/** Person names: letters (incl. diacritics), spaces between words, hyphen only as punctuation. */
const PERSON_NAME_RE = /^[\p{L}]+(?:[\s-]+[\p{L}]+)*$/u;
const SKU_RE = /^[A-Za-z0-9._-]+$/;
const CODE_RE = /^[A-Za-z0-9 ./-]+$/;
/**
 * Deliberately loose. A Romanian CUI is `RO` plus digits, but the same column holds the VAT id of
 * any EU partner — `ATU12345678` has three letters, `IE1234567FA` ends in them — so pinning the
 * shape would refuse real clients. This only rules out text that identifies nobody: it has to
 * carry at least one digit.
 */
const VAT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9 .-]*$/;
const LICENSE_CATEGORY_RE = /^[A-Za-z0-9]{1,3}(\+[A-Za-z0-9]{1,3})?(\s*,\s*[A-Za-z0-9]{1,3}(\+[A-Za-z0-9]{1,3})?)*$/;
const ADR_CLASS_RE = /^[1-9](\.[1-9])?[A-Za-z]?$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const YEAR_MIN = 1950;
const YEAR_MAX = new Date().getFullYear() + 50;

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : (value ?? '');
}

function blankToNull(value) {
  const text = trimmed(value);
  return text === '' ? null : text;
}

function isBlank(value) {
  return trimmed(value) === '';
}

function capitalize(text) {
  return String(text).charAt(0).toUpperCase() + String(text).slice(1);
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
  if (value == null || value === '') return;
  const raw = String(value);
  // Reject before trim — optional blank is fine; spaces-only or "a @b.ro" must fail visibly.
  if (/\s/.test(raw)) {
    errors[field] = 'Emailul nu poate conține spații.';
    return;
  }
  if (!EMAIL_RE.test(raw)) errors[field] = 'Email invalid (ex. nume@firma.ro).';
}

function checkPersonName(errors, field, value, label, { required = false, min = 3, max = 120 } = {}) {
  const text = trimmed(value);
  if (text === '') {
    if (required) errors[field] = `Completează ${label}.`;
    return;
  }
  if (CONTROL_CHARS.test(text)) {
    errors[field] = `${capitalize(label)} conține caractere nepermise.`;
    return;
  }
  if (text.length < min) {
    errors[field] = `${capitalize(label)}: minim ${min} caractere.`;
    return;
  }
  if (text.length > max) {
    errors[field] = `${capitalize(label)}: maxim ${max} caractere.`;
    return;
  }
  if (!PERSON_NAME_RE.test(text)) {
    errors[field] = `${capitalize(label)}: doar litere, spații și cratimă (-).`;
  }
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

function parseDateOnly(value) {
  const text = trimmed(value);
  if (text === '') return null;
  const iso = String(text).slice(0, 10);
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
  if (!TIME_RE.test(String(text).slice(0, 5))) errors[field] = `${capitalize(label)}: format HH:MM.`;
}

function validateClient(form) {
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

function normalizeClient(form) {
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

function validateDriver(form) {
  const errors = {};
  checkPersonName(errors, 'name', form.name, 'numele complet', { required: true, min: 3, max: 120 });
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
    && String(trimmed(form.shift_start)).slice(0, 5) === String(trimmed(form.shift_end)).slice(0, 5)) {
    errors.shift_end = 'Tura nu poate începe și se termina la aceeași oră.';
  }

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

function normalizeDriver(form) {
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

function validateInvoice(form) {
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

function normalizeInvoice(form) {
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

function validateWarehouseProduct(form) {
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

function normalizeWarehouseProduct(form) {
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

const VALIDATORS = {
  Client: { validate: validateClient, normalize: normalizeClient },
  Driver: { validate: validateDriver, normalize: normalizeDriver },
  Invoice: { validate: validateInvoice, normalize: normalizeInvoice },
  WarehouseProduct: { validate: validateWarehouseProduct, normalize: normalizeWarehouseProduct },
};

export const VALIDATED_ENTITIES = Object.keys(VALIDATORS);

export function validatorFor(entity) {
  return VALIDATORS[entity] || null;
}

/**
 * A PUT carries only the fields that changed, so validating the whole shape would reject a
 * status-only update for a driver whose phone predates these rules. Only what was sent is judged;
 * required-field checks are skipped for keys the request left out.
 */
export function validateEntityInput(entity, body, { partial = false } = {}) {
  const validator = validatorFor(entity);
  if (!validator) return { errors: null, data: body };

  const sent = (key) => Object.prototype.hasOwnProperty.call(body ?? {}, key);
  const raw = body ?? {};
  // Validate the payload as sent (before trim) so leading spaces in email cannot be
  // silently accepted the way a post-normalize check would.
  const errors = validator.validate(raw);
  const normalized = validator.normalize(raw);

  // The normalizers fill in every field they know about, which on a partial write would send
  // `null` for columns the caller never mentioned and blank them in the database.
  const data = partial
    ? Object.fromEntries(Object.entries(normalized).filter(([key]) => sent(key)))
    : normalized;
  const scoped = partial
    ? Object.fromEntries(Object.entries(errors).filter(([key]) => sent(key)))
    : errors;

  if (Object.keys(scoped).length === 0) return { errors: null, data };
  return { errors: scoped, data };
}

/** First message, so the API answers with something a person can act on. */
export function firstErrorMessage(errors) {
  const values = Object.values(errors || {});
  return values.length > 0 ? values[0] : 'Date invalide.';
}
