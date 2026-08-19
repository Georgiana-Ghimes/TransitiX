const TOKEN_KEY = 'transitix_access_token';

/** Same-origin /uploads URLs need the JWT; <img> cannot send Authorization. */
export function withAccessToken(url) {
  if (!url || typeof url !== 'string') return url;
  if (!url.startsWith('/uploads/')) return url;
  if (url.includes('access_token=')) return url;
  let token = '';
  try {
    token = localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    token = '';
  }
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}access_token=${encodeURIComponent(token)}`;
}
