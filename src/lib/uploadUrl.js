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

/** Fetch /uploads with Authorization so the JWT is not stored in the document URL. */
export async function fetchUploadBlob(url) {
  if (!url || typeof url !== 'string') return null;
  const clean = url.split('?')[0];
  const token = readToken();
  const res = await fetch(clean, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return null;
  return res.blob();
}
