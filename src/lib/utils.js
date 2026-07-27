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
