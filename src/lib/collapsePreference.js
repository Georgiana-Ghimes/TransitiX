/**
 * Remembering that somebody closed a panel.
 *
 * A legend is read once and then it is in the way. Reopening it on every refresh means the same
 * dismissal has to be repeated all day, which is how a helpful panel turns into an irritation.
 *
 * Storage is per browser, wrapped in try/catch throughout: a private window or blocked site data
 * throws on access, and a help panel is never worth breaking a screen over. When it cannot be
 * read, the caller's default stands.
 */
const PREFIX = 'transitix_collapsed_';

export function collapseStorageKey(id) {
  return `${PREFIX}${String(id || '').trim()}`;
}

/**
 * Whether a panel was left open, or `fallback` when nothing is stored.
 *
 * Only the two values written here count as an answer. Anything else, a key from an older
 * version, something another script left behind, is treated as absent, so a stray value cannot
 * pin a panel shut with no way to tell why.
 */
export function readCollapsed(id, fallback = false) {
  if (!id) return fallback;
  try {
    const raw = localStorage.getItem(collapseStorageKey(id));
    if (raw === '1') return true;
    if (raw === '0') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

export function writeCollapsed(id, collapsed) {
  if (!id) return;
  try {
    localStorage.setItem(collapseStorageKey(id), collapsed ? '1' : '0');
  } catch {
    // A preference that cannot be saved is not a failure worth reporting.
  }
}
