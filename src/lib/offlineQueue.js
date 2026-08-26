/**
 * A durable outbox for the driver app.
 *
 * The driver is the one user guaranteed to lose signal — in a warehouse, at a ramp, on a village
 * road. Before this, pressing "Sign" without coverage threw away both finger-drawn signatures and
 * whatever reservations had been written at the ramp, with nothing to recover from. Work is now
 * written to a local store first and sent when there is a connection.
 *
 * The queue logic lives here over an injected store so it can be tested without IndexedDB;
 * `offlineStore.js` is the real adapter.
 */

/** An entry the server rejected on its own terms. Retrying it forever would never help. */
export const PARKED = 'parked';
export const PENDING = 'pending';

/**
 * Statuses a retry cannot fix.
 *
 * A 409 ("already signed at delivery") or a 422 ("weight missing") is the server's considered
 * answer, not a transport failure. Replaying it every time the phone finds signal would spam the
 * API and never succeed, so it is parked and shown to the driver instead.
 */
export function isPermanentFailure(status) {
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

let seq = 0;

/** Monotonic within a session, so entries queued in the same millisecond keep their order. */
function nextId() {
  seq += 1;
  return `${Date.now()}-${String(seq).padStart(4, '0')}`;
}

/**
 * Adds one action to the outbox.
 *
 * `userId` is part of the entry because a phone can be handed to another driver: flushing one
 * person's unsent signatures under someone else's session would attach them to the wrong trip.
 */
export async function enqueue(store, { userId, kind, label, run }) {
  const entry = {
    id: nextId(),
    user_id: String(userId ?? ''),
    kind,
    label: label ?? kind,
    payload: run,
    status: PENDING,
    attempts: 0,
    queued_at: new Date().toISOString(),
    error: null,
  };
  await store.put(entry);
  return entry;
}

export async function pendingEntries(store, userId) {
  const all = await store.all();
  return all
    .filter((e) => e.user_id === String(userId ?? '') && e.status === PENDING)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export async function parkedEntries(store, userId) {
  const all = await store.all();
  return all.filter((e) => e.user_id === String(userId ?? '') && e.status === PARKED);
}

/**
 * Sends what is waiting, oldest first, and stops at the first transport failure.
 *
 * Order matters and the stop is deliberate: a signature depends on the draft queued before it,
 * so skipping ahead after a network error would send them out of sequence. A rejection the
 * server owns (4xx) is parked and the queue moves on, because that one will never succeed.
 *
 * @param {object} store
 * @param {string} userId
 * @param {(entry) => Promise<any>} send  performs one entry; throws with `.status` on an HTTP error
 */
export async function flush(store, userId, send) {
  const queue = await pendingEntries(store, userId);
  const result = { sent: 0, parked: 0, remaining: 0, stopped: false };

  for (const entry of queue) {
    try {
      await send(entry);
      await store.remove(entry.id);
      result.sent += 1;
    } catch (err) {
      const status = err?.status;
      if (isPermanentFailure(status)) {
        await store.put({
          ...entry,
          status: PARKED,
          attempts: entry.attempts + 1,
          error: err?.message || `Respins de server (${status})`,
        });
        result.parked += 1;
        continue;
      }
      // Transport failure: leave it pending, keep the order, and try again next time.
      await store.put({ ...entry, attempts: entry.attempts + 1, error: err?.message ?? null });
      result.stopped = true;
      break;
    }
  }

  result.remaining = (await pendingEntries(store, userId)).length;
  return result;
}

export async function discard(store, id) {
  await store.remove(id);
}

/** Drops every parked entry for a driver, once they have seen why each one failed. */
export async function clearParked(store, userId) {
  for (const entry of await parkedEntries(store, userId)) {
    await store.remove(entry.id);
  }
}

/** One line for the banner: what is waiting and what will not go on its own. */
export function queueSummary({ pending = 0, parked = 0 }) {
  if (!pending && !parked) return null;
  const parts = [];
  if (pending) parts.push(`${pending} ${pending === 1 ? 'acțiune netrimisă' : 'acțiuni netrimise'}`);
  if (parked) parts.push(`${parked} respins${parked === 1 ? 'ă' : 'e'} de server`);
  return parts.join(' · ');
}

// ------------------------------------------------------------------ drafts

/**
 * The half-written form, kept apart from the outbox.
 *
 * A draft is not an action to replay — it is what the driver has typed so far, and it must
 * survive the app being closed, the phone dying, or a page reload at the ramp. It is overwritten
 * freely; the outbox is not.
 */
export function draftKey(userId, tripId) {
  return `draft:${String(userId ?? '')}:${String(tripId ?? '')}`;
}

export async function saveDraft(store, userId, tripId, data) {
  await store.putDraft({
    key: draftKey(userId, tripId),
    user_id: String(userId ?? ''),
    trip_id: String(tripId ?? ''),
    data,
    saved_at: new Date().toISOString(),
  });
}

export async function readDraft(store, userId, tripId) {
  return store.getDraft(draftKey(userId, tripId));
}

export async function dropDraft(store, userId, tripId) {
  await store.removeDraft(draftKey(userId, tripId));
}

/**
 * Whether a stored draft still has something the server does not.
 *
 * Offering to restore a draft that matches what is already saved would train drivers to dismiss
 * the prompt, and then they would dismiss the one that mattered.
 */
export function draftDiffers(draft, serverData) {
  if (!draft?.data) return false;
  const server = serverData ?? {};
  return Object.entries(draft.data).some(([key, value]) => {
    const a = value === undefined || value === null ? '' : String(value);
    const b = server[key] === undefined || server[key] === null ? '' : String(server[key]);
    return a !== b;
  });
}
