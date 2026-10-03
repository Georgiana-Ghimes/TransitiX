/**
 * Which office-bell rows the documents companion should show.
 *
 * The inbox API is shared with full TMS, so trip / CMR / route noise still arrives.
 * Companion has no Curse menu — those alerts would open dead links. Filtering is a UI
 * concern (same rule as hidden routes), not a second authorization path.
 */
import { isCompanionOfficePath, isDocumentsProfile } from './appProfile.js';

/** Types that can matter on companion once the link is rewritten. */
const COMPANION_TYPES = new Set([
  'driver_upload',
  'document_expiry',
  'data_issue',
  'system',
]);

function pathOf(link) {
  return String(link || '').split('?')[0];
}

/**
 * Map full-TMS paths onto screens companion actually has.
 * `/vehicles` → Autoturisme (`/fleet`).
 */
export function companionNotificationLink(link) {
  const path = pathOf(link);
  if (path === '/vehicles' || path.startsWith('/vehicles/')) return '/fleet';
  return link || null;
}

/**
 * True when this inbox row is useful on the documents companion.
 */
export function isCompanionRelevantNotification(item) {
  if (!item || !COMPANION_TYPES.has(item.type)) return false;

  const link = companionNotificationLink(item.link);
  const path = pathOf(link);

  // No destination (or only dead full-TMS destinations) → drop.
  if (!path) return item.type === 'system';
  if (path === '/drivers' || path.startsWith('/drivers/')) return false;
  if (path === '/checks' || path.startsWith('/checks/')) return false;
  if (path === '/trips' || path.startsWith('/trips/')) return false;

  return isCompanionOfficePath(path);
}

/**
 * Filter + rewrite links for the active office profile.
 * Full TMS keeps the inbox unchanged.
 */
export function filterNotificationsForProfile(items, { companion = isDocumentsProfile() } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!companion) return list;
  return list
    .filter(isCompanionRelevantNotification)
    .map((n) => ({ ...n, link: companionNotificationLink(n.link) }));
}
