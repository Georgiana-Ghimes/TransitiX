import { describe, expect, it } from 'vitest';
import {
  PARKED,
  PENDING,
  clearParked,
  discard,
  draftDiffers,
  draftKey,
  dropDraft,
  enqueue,
  flush,
  isPermanentFailure,
  parkedEntries,
  pendingEntries,
  queueSummary,
  readDraft,
  saveDraft,
} from './offlineQueue.js';

/** In-memory stand-in for the IndexedDB adapter. */
function memoryStore() {
  const entries = new Map();
  const drafts = new Map();
  return {
    entries,
    drafts,
    async put(entry) { entries.set(entry.id, entry); },
    async remove(id) { entries.delete(id); },
    async all() { return [...entries.values()]; },
    async putDraft(draft) { drafts.set(draft.key, draft); },
    async getDraft(key) { return drafts.get(key) ?? null; },
    async removeDraft(key) { drafts.delete(key); },
  };
}

const httpError = (status, message = 'nu') => Object.assign(new Error(message), { status });

describe('isPermanentFailure', () => {
  it('treats the server’s own rejections as permanent', () => {
    // A 409 "already signed" or a 422 "weight missing" will never succeed on retry.
    expect(isPermanentFailure(409)).toBe(true);
    expect(isPermanentFailure(422)).toBe(true);
    expect(isPermanentFailure(404)).toBe(true);
  });

  it('keeps retrying what a retry could fix', () => {
    expect(isPermanentFailure(500)).toBe(false);
    expect(isPermanentFailure(503)).toBe(false);
    expect(isPermanentFailure(429)).toBe(false);
    expect(isPermanentFailure(408)).toBe(false);
    expect(isPermanentFailure(undefined)).toBe(false);
  });
});

describe('enqueue', () => {
  it('stores the action with what it needs to be replayed', async () => {
    const store = memoryStore();
    const entry = await enqueue(store, {
      userId: 'u1', kind: 'cmr_sign', label: 'Semnătură încărcare', run: { stage: 'incarcare' },
    });
    expect(entry.status).toBe(PENDING);
    expect(entry.payload).toEqual({ stage: 'incarcare' });
    expect(await pendingEntries(store, 'u1')).toHaveLength(1);
  });

  it('keeps the order of actions queued in the same millisecond', async () => {
    const store = memoryStore();
    await enqueue(store, { userId: 'u1', kind: 'a', run: {} });
    await enqueue(store, { userId: 'u1', kind: 'b', run: {} });
    await enqueue(store, { userId: 'u1', kind: 'c', run: {} });
    expect((await pendingEntries(store, 'u1')).map((e) => e.kind)).toEqual(['a', 'b', 'c']);
  });

  it('keeps one driver’s outbox away from another’s', async () => {
    // A phone gets handed over. Flushing someone else's unsent signatures under this session
    // would attach them to the wrong trip.
    const store = memoryStore();
    await enqueue(store, { userId: 'u1', kind: 'a', run: {} });
    await enqueue(store, { userId: 'u2', kind: 'b', run: {} });
    expect(await pendingEntries(store, 'u1')).toHaveLength(1);
    expect((await pendingEntries(store, 'u2'))[0].kind).toBe('b');
  });
});

describe('flush', () => {
  it('sends everything when the connection is back', async () => {
    const store = memoryStore();
    await enqueue(store, { userId: 'u1', kind: 'a', run: {} });
    await enqueue(store, { userId: 'u1', kind: 'b', run: {} });

    const sent = [];
    const res = await flush(store, 'u1', async (e) => { sent.push(e.kind); });

    expect(sent).toEqual(['a', 'b']);
    expect(res).toMatchObject({ sent: 2, parked: 0, remaining: 0, stopped: false });
    expect(await pendingEntries(store, 'u1')).toEqual([]);
  });

  it('stops at the first transport failure instead of skipping ahead', async () => {
    // A signature depends on the draft queued before it. Sending them out of order would put a
    // signature on a note that has not been written yet.
    const store = memoryStore();
    await enqueue(store, { userId: 'u1', kind: 'draft', run: {} });
    await enqueue(store, { userId: 'u1', kind: 'sign', run: {} });

    const tried = [];
    const res = await flush(store, 'u1', async (e) => {
      tried.push(e.kind);
      if (e.kind === 'draft') throw new Error('Failed to fetch');
    });

    expect(tried).toEqual(['draft']);
    expect(res.stopped).toBe(true);
    expect(res.remaining).toBe(2);
  });

  it('parks what the server refused and carries on with the rest', async () => {
    const store = memoryStore();
    await enqueue(store, { userId: 'u1', kind: 'bad', run: {} });
    await enqueue(store, { userId: 'u1', kind: 'good', run: {} });

    const res = await flush(store, 'u1', async (e) => {
      if (e.kind === 'bad') throw httpError(422, 'Greutate brută lipsă');
    });

    expect(res).toMatchObject({ sent: 1, parked: 1, remaining: 0 });
    const parked = await parkedEntries(store, 'u1');
    expect(parked[0].kind).toBe('bad');
    expect(parked[0].error).toContain('Greutate brută');
  });

  it('retries a transport failure on the next flush', async () => {
    const store = memoryStore();
    await enqueue(store, { userId: 'u1', kind: 'a', run: {} });

    let attempt = 0;
    await flush(store, 'u1', async () => { attempt += 1; throw new Error('offline'); });
    expect((await pendingEntries(store, 'u1'))[0].attempts).toBe(1);

    const res = await flush(store, 'u1', async () => { attempt += 1; });
    expect(attempt).toBe(2);
    expect(res.sent).toBe(1);
  });

  it('never sends a parked entry again on its own', async () => {
    const store = memoryStore();
    await enqueue(store, { userId: 'u1', kind: 'bad', run: {} });
    await flush(store, 'u1', async () => { throw httpError(409); });

    const tried = [];
    await flush(store, 'u1', async (e) => { tried.push(e.kind); });
    expect(tried).toEqual([]);
  });

  it('does nothing on an empty outbox', async () => {
    const store = memoryStore();
    expect(await flush(store, 'u1', async () => {})).toMatchObject({ sent: 0, remaining: 0 });
  });
});

describe('discard and clearParked', () => {
  it('drops one entry', async () => {
    const store = memoryStore();
    const entry = await enqueue(store, { userId: 'u1', kind: 'a', run: {} });
    await discard(store, entry.id);
    expect(await pendingEntries(store, 'u1')).toEqual([]);
  });

  it('clears only this driver’s parked entries', async () => {
    const store = memoryStore();
    await enqueue(store, { userId: 'u1', kind: 'a', run: {} });
    await enqueue(store, { userId: 'u2', kind: 'b', run: {} });
    await flush(store, 'u1', async () => { throw httpError(422); });
    await flush(store, 'u2', async () => { throw httpError(422); });

    await clearParked(store, 'u1');
    expect(await parkedEntries(store, 'u1')).toEqual([]);
    expect(await parkedEntries(store, 'u2')).toHaveLength(1);
  });
});

describe('queueSummary', () => {
  it('says nothing when there is nothing waiting', () => {
    expect(queueSummary({ pending: 0, parked: 0 })).toBeNull();
  });

  it('counts what is waiting', () => {
    expect(queueSummary({ pending: 1 })).toBe('1 acțiune netrimisă');
    expect(queueSummary({ pending: 3 })).toBe('3 acțiuni netrimise');
  });

  it('mentions rejections separately, because those need a person', () => {
    expect(queueSummary({ pending: 2, parked: 1 }))
      .toBe('2 acțiuni netrimise · 1 respinsă de server');
  });
});

describe('drafts', () => {
  it('keeps what the driver typed, per trip and per driver', async () => {
    const store = memoryStore();
    await saveDraft(store, 'u1', 't1', { natura_marfii: 'Mortar' });
    await saveDraft(store, 'u2', 't1', { natura_marfii: 'Adeziv' });

    expect((await readDraft(store, 'u1', 't1')).data.natura_marfii).toBe('Mortar');
    expect((await readDraft(store, 'u2', 't1')).data.natura_marfii).toBe('Adeziv');
  });

  it('overwrites freely, unlike the outbox', async () => {
    const store = memoryStore();
    await saveDraft(store, 'u1', 't1', { a: '1' });
    await saveDraft(store, 'u1', 't1', { a: '2' });
    expect(store.drafts.size).toBe(1);
    expect((await readDraft(store, 'u1', 't1')).data.a).toBe('2');
  });

  it('is dropped once the work has landed', async () => {
    const store = memoryStore();
    await saveDraft(store, 'u1', 't1', { a: '1' });
    await dropDraft(store, 'u1', 't1');
    expect(await readDraft(store, 'u1', 't1')).toBeNull();
  });

  it('keys by driver and trip', () => {
    expect(draftKey('u1', 't1')).toBe('draft:u1:t1');
  });
});

describe('draftDiffers', () => {
  it('is quiet when the draft matches what the server already has', () => {
    // Offering to restore an identical draft trains drivers to dismiss the prompt, and then they
    // dismiss the one that mattered.
    const draft = { data: { natura_marfii: 'Mortar', numar_colete: 18 } };
    expect(draftDiffers(draft, { natura_marfii: 'Mortar', numar_colete: 18 })).toBe(false);
  });

  it('notices a value the server does not have', () => {
    const draft = { data: { rezerve_incarcare: 'Doi saci rupți' } };
    expect(draftDiffers(draft, {})).toBe(true);
  });

  it('compares loosely enough that 18 and "18" are the same answer', () => {
    expect(draftDiffers({ data: { numar_colete: 18 } }, { numar_colete: '18' })).toBe(false);
  });

  it('treats null and empty as the same emptiness', () => {
    expect(draftDiffers({ data: { a: null } }, { a: '' })).toBe(false);
  });

  it('handles no draft at all', () => {
    expect(draftDiffers(null, {})).toBe(false);
  });
});

describe('statuses', () => {
  it('names the two the UI branches on', () => {
    expect(PENDING).toBe('pending');
    expect(PARKED).toBe('parked');
  });
});

describe('isOfflineError', () => {
  it('calls a dropped connection offline', async () => {
    const { isOfflineError } = await import('./useOffline.js');
    expect(isOfflineError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isOfflineError(new Error('NetworkError when attempting to fetch'))).toBe(true);
  });

  it('does not call a server rejection offline', async () => {
    // A 422 arrived, so the tunnel is fine — the server simply said no.
    const { isOfflineError } = await import('./useOffline.js');
    expect(isOfflineError(Object.assign(new Error('Greutate lipsă'), { status: 422 }))).toBe(false);
    expect(isOfflineError(Object.assign(new Error('boom'), { status: 500 }))).toBe(false);
  });

  it('handles nothing', async () => {
    const { isOfflineError } = await import('./useOffline.js');
    expect(isOfflineError(null)).toBe(false);
  });
});
