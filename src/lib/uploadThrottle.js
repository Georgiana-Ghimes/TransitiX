/**
 * A client-side brake in front of the server's rate limit.
 *
 * `POST /api/driver-documents` allows 30 uploads a minute per driver and answers 429 past that.
 * Reaching that as the first feedback means a driver tapping through a stack of avize is told
 * "too many requests" by a server they cannot see. The brake trips earlier, on the phone, and
 * says when to try again — the server limit stays as the backstop it should be.
 */

/** Below the server's 30/min, so this is what a driver meets first. */
export const CLIENT_UPLOAD_MAX = 20;
export const CLIENT_UPLOAD_WINDOW_MS = 60_000;

/**
 * @param {number[]} times  epoch ms of recent sends, newest order irrelevant
 * @returns {{ allowed: boolean, retryInSeconds: number, recent: number[] }}
 *   `recent` is the window-trimmed list, to be kept for the next call.
 */
export function throttleState(times, now = Date.now(), {
  max = CLIENT_UPLOAD_MAX,
  windowMs = CLIENT_UPLOAD_WINDOW_MS,
} = {}) {
  const recent = (times || []).filter((t) => now - t < windowMs);
  if (recent.length < max) return { allowed: true, retryInSeconds: 0, recent };

  // When the oldest send leaves the window there is room again — that is the honest wait.
  const oldest = Math.min(...recent);
  const retryInSeconds = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
  return { allowed: false, retryInSeconds, recent };
}
