/**
 * Where the browser should send /api and /uploads.
 *
 * Local Vite leaves this empty and proxies to the API. On Vercel the FE is on another host, so
 * set `VITE_API_ORIGIN` to the public URL of the PC API (e.g. a cloudflared quick tunnel).
 */
export function apiOrigin() {
  return String(import.meta.env.VITE_API_ORIGIN || '').replace(/\/$/, '');
}

/** Prefix a same-origin path with `VITE_API_ORIGIN` when set; leave absolute URLs alone. */
export function withApiOrigin(path) {
  if (!path || typeof path !== 'string') return path;
  if (/^https?:\/\//i.test(path)) return path;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${apiOrigin()}${p}`;
}
