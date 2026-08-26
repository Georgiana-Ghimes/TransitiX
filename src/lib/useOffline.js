import { useCallback, useEffect, useRef, useState } from 'react';
import { offlineStore } from './offlineStore';
import {
  clearParked,
  enqueue,
  flush,
  parkedEntries,
  pendingEntries,
} from './offlineQueue';

/**
 * Connectivity as the driver app needs to know it.
 *
 * `navigator.onLine` only says whether the device has *a* network, not whether the API is
 * reachable — a truck stop's captive portal reports online while nothing gets through. So a
 * failed send also flips this to offline, and a successful one flips it back. The browser events
 * are a hint, not the truth.
 */
export function useOnline() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return [online, setOnline];
}

/**
 * The outbox, wired to a user.
 *
 * `send` performs one queued entry and is supplied by the caller, because only the caller knows
 * how to turn a stored payload back into an API call.
 */
export function useOutbox(userId, send) {
  const [online, setOnline] = useOnline();
  const [counts, setCounts] = useState({ pending: 0, parked: 0 });
  const [flushing, setFlushing] = useState(false);
  const sendRef = useRef(send);
  sendRef.current = send;

  const refresh = useCallback(async () => {
    if (!userId) return;
    const [pending, parked] = await Promise.all([
      pendingEntries(offlineStore, userId),
      parkedEntries(offlineStore, userId),
    ]);
    setCounts({ pending: pending.length, parked: parked.length });
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  const flushNow = useCallback(async () => {
    if (!userId || flushing) return null;
    setFlushing(true);
    try {
      const result = await flush(offlineStore, userId, (entry) => sendRef.current(entry));
      // A completed send is the only proof the API is actually reachable.
      if (result.sent > 0) setOnline(true);
      else if (result.stopped) setOnline(false);
      await refresh();
      return result;
    } finally {
      setFlushing(false);
    }
  }, [userId, flushing, refresh, setOnline]);

  // Coming back into coverage is the moment the queue matters; drain it without being asked.
  // Held in a ref so the effect fires on the transition itself, not every time the callback is
  // rebuilt — otherwise a re-render mid-flush would start a second one over the same entries.
  const flushRef = useRef(flushNow);
  flushRef.current = flushNow;
  const wasOnline = useRef(online);
  useEffect(() => {
    const cameBack = online && !wasOnline.current;
    wasOnline.current = online;
    if (cameBack) flushRef.current();
  }, [online]);

  /**
   * Drain once when the app opens with work already waiting.
   *
   * The commonest case has no offline-to-online transition at all: the driver closes the app in
   * a dead spot and reopens it in town, so the session never observes going offline and the
   * transition effect above never fires. Without this the outbox would sit full until something
   * else happened to toggle connectivity.
   */
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current || !userId) return;
    bootstrapped.current = true;
    (async () => {
      const waiting = await pendingEntries(offlineStore, userId);
      if (waiting.length && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        flushRef.current();
      }
    })();
  }, [userId]);

  const queue = useCallback(async (action) => {
    const entry = await enqueue(offlineStore, { userId, ...action });
    await refresh();
    return entry;
  }, [userId, refresh]);

  const dismissParked = useCallback(async () => {
    await clearParked(offlineStore, userId);
    await refresh();
  }, [userId, refresh]);

  return { online, setOnline, counts, flushing, flushNow, queue, refresh, dismissParked };
}

/**
 * Whether a thrown error means "no connection" rather than "the server said no".
 *
 * `fetch` rejects with a TypeError for a dropped connection and never sets a status, which is the
 * only reliable way to tell a tunnel from a rejection.
 */
export function isOfflineError(err) {
  if (!err) return false;
  if (typeof err.status === 'number') return false;
  return err instanceof TypeError || /fetch|network|failed to fetch|load failed/i.test(err.message ?? '');
}
