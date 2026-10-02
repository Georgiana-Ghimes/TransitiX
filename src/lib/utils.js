import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export const isIframe = typeof window !== 'undefined' && window.self !== window.top;

/** Format YYYY-MM-DD (or ISO) safely for RO locale without timezone shift */
export function formatDate(value) {
  if (!value) return '-';
  const raw = String(value);
  const ymd = raw.length >= 10 ? raw.slice(0, 10) : raw;
  const [y, m, d] = ymd.split('-');
  if (!y || !m || !d) return raw;
  return `${d}.${m}.${y}`;
}

/**
 * Keep only a calendar day as YYYY-MM-DD (API/DB shape).
 * Accepts ISO datetimes from pg without shifting the day via UTC.
 */
export function toDateIso(value) {
  if (value == null || value === '') return '';
  const raw = String(value).trim();
  const ymd = raw.length >= 10 ? raw.slice(0, 10) : raw;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return '';
  return ymd;
}

/**
 * Parse operator-typed RO dates into YYYY-MM-DD.
 * Prefers DD.MM.YYYY / DD/MM/YYYY (never US MM/DD). Also accepts ISO YYYY-MM-DD.
 */
export function parseRoDateInput(text) {
  if (text == null) return null;
  const raw = String(text).trim();
  if (!raw) return '';
  const iso = toDateIso(raw);
  if (iso) return iso;
  const m = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Local Date from YYYY-MM-DD without UTC shift (for calendar pickers). */
export function isoToLocalDate(iso) {
  const ymd = toDateIso(iso);
  if (!ymd) return undefined;
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function localDateToIso(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Number() that tells "not set" apart from zero.
 *
 * Number(null), Number(undefined) and Number('') are all 0, and 0 passes Number.isFinite,
 * so the obvious guard silently turns a missing value into a real one, a null coordinate
 * renders as 0.000000, a missing duration as "0m", an unset service time as no service time.
 * Returns null when there is genuinely no number.
 */
export function toFiniteNumber(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export const ACTIVE_TRIP_STATUSES = ['alocata', 'incarcata', 'in_tranzit', 'problema'];

export function isActiveTripStatus(status) {
  return ACTIVE_TRIP_STATUSES.includes(status);
}

/** Resolve driver profile for current user (by user_id or email) */
export function findDriverForUser(drivers, user) {
  if (!user || !Array.isArray(drivers)) return null;
  return (
    drivers.find((d) => d.user_id && d.user_id === user.id) ||
    drivers.find((d) => d.email && user.email && d.email.toLowerCase() === user.email.toLowerCase()) ||
    null
  );
}

export function openNavigation(address) {
  if (!address) return;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
