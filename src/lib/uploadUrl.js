import { withApiOrigin } from '@/lib/apiOrigin';

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
  if (url.includes('access_token=')) return withApiOrigin(url);
  const token = readToken();
  if (!token) return withApiOrigin(url);
  const sep = url.includes('?') ? '&' : '?';
  return withApiOrigin(`${url}${sep}access_token=${encodeURIComponent(token)}`);
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
  const res = await fetch(withApiOrigin(clean), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  // A 200 HTML shell (SPA catch-all / wrong path) must not become a blob iframe —
  // that is what showed a UUID + „Încarcă” instead of the PDF.
  if (!isUploadFileResponse(res)) return null;
  const blob = await res.blob();
  // Some stacks omit Content-Type; Safari then refuses to render a typeless PDF blob.
  const declared = String(res.headers?.get?.('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (declared && declared !== blob.type) {
    return blob.slice(0, blob.size, declared);
  }
  return blob;
}

/**
 * Pick how the preview element should load bytes we already verified are a real upload.
 *
 * Both kinds stay a blob. PDF.js draws those bytes onto a canvas — an iframe/embed of the
 * token URL is what goes blank on the client's phones. Images stay a blob so the JWT is
 * not sitting in an <img src>. The token URL is only a fallback when the image fetch failed.
 *
 * @param {{ kind: string, fileUrl: string, tokenUrl: string, hasVerifiedFile: boolean }} args
 * @returns {{ mode: 'token' | 'blob' | 'none', url?: string }}
 */
export function resolvePreviewSource({ kind, fileUrl, tokenUrl, hasVerifiedFile }) {
  if (!hasVerifiedFile) {
    if (kind === 'image' && tokenUrl && tokenUrl !== fileUrl) {
      return { mode: 'token', url: tokenUrl };
    }
    return { mode: 'none' };
  }
  return { mode: 'blob' };
}
