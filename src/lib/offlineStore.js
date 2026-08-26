/**
 * Where the driver's unsent work actually lives.
 *
 * IndexedDB rather than `localStorage` because the outbox holds photographs: a phone camera file
 * is two to four megabytes and `localStorage` caps out around five for everything combined. It
 * also stores Blobs natively, so a picture taken at the ramp survives without being turned into
 * a base64 string that would be a third larger again.
 *
 * The queue logic is in `offlineQueue.js`; this is only the adapter, deliberately thin.
 */

const DB_NAME = 'transitix-offline';
const DB_VERSION = 1;
const ENTRIES = 'entries';
const DRAFTS = 'drafts';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponibil'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function run(storeName, mode, work) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = work(store);
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

/**
 * The store the queue talks to.
 *
 * Every method resolves rather than throwing when IndexedDB is unavailable — a private window or
 * a browser with storage disabled must degrade to "no offline support", never to a driver app
 * that will not open.
 */
export const offlineStore = {
  async put(entry) {
    try {
      await run(ENTRIES, 'readwrite', (store) => store.put(entry));
    } catch {
      // Nothing to do: without storage there is no outbox, and the caller reports the send.
    }
  },
  async remove(id) {
    try {
      await run(ENTRIES, 'readwrite', (store) => store.delete(id));
    } catch { /* ignore */ }
  },
  async all() {
    try {
      return (await run(ENTRIES, 'readonly', (store) => store.getAll())) ?? [];
    } catch {
      return [];
    }
  },
  async putDraft(draft) {
    try {
      await run(DRAFTS, 'readwrite', (store) => store.put(draft));
    } catch { /* ignore */ }
  },
  async getDraft(key) {
    try {
      return (await run(DRAFTS, 'readonly', (store) => store.get(key))) ?? null;
    } catch {
      return null;
    }
  },
  async removeDraft(key) {
    try {
      await run(DRAFTS, 'readwrite', (store) => store.delete(key));
    } catch { /* ignore */ }
  },
};

export function offlineStorageAvailable() {
  return typeof indexedDB !== 'undefined';
}
