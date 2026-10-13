const TOKEN_KEY = 'transitix_access_token';

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

/** Same-origin /uploads URLs need the JWT; <img> cannot send Authorization. */
export function withAccessToken(url) {
  if (!url || typeof url !== 'string') return url;
  if (!url.startsWith('/uploads/')) return url;
  if (url.includes('access_token=')) return url;
  const token = readToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}access_token=${encodeURIComponent(token)}`;
}

/** True when the response looks like an uploaded file, not an HTML SPA fallback. */
export function isUploadFileResponse(res) {
  if (!res?.ok) return false;
  const type = String(res.headers?.get?.('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!type) return true;
  if (type === 'text/html' || type === 'application/xhtml+xml') return false;
  if (type.startsWith('application/json')) return false;
  return true;
}

/** Fetch /uploads with Authorization so the JWT is not stored in the document URL. */
export async function fetchUploadBlob(url) {
  if (!url || typeof url !== 'string') return null;
  const clean = url.split('?')[0];
  const token = readToken();
  const res = await fetch(clean, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  // A 200 HTML shell (SPA catch-all / wrong path) must not become a blob iframe —
  // that is what showed a UUID + „Încarcă” instead of the PDF.
  if (!isUploadFileResponse(res)) return null;
  return res.blob();
}
