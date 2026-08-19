export const APP_VERSION = __APP_VERSION__;

export function formatAppVersion(version = APP_VERSION) {
  const raw = String(version || '').trim();
  if (!raw) return 'v0.0.0';
  return raw.startsWith('v') ? raw : `v${raw}`;
}
