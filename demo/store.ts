/**
 * Device store for the demo — IndexedDB when the host allows it (the PWA and
 * any normal browser), honest in-memory fallback when it doesn't (some
 * embedded webviews). The engine doesn't care which executes it (Design D4).
 */
import type { EngineSnapshot } from '../packages/sync/src/index.js';

const DB = 'blackflag', STORE = 'engine', KEY = 'snapshot';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}

export interface DeviceStore {
  persistent: boolean;
  load(): Promise<EngineSnapshot | null>;
  save(snap: EngineSnapshot): Promise<void>;
}

export async function makeStore(): Promise<DeviceStore> {
  try {
    const db = await openDb();
    return {
      persistent: true,
      load: () => new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
        tx.onsuccess = () => resolve(tx.result ?? null);
        tx.onerror = () => resolve(null);
      }),
      save: (snap) => new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(snap, KEY);
        tx.onsuccess = () => resolve();
        tx.onerror = () => resolve();
      }),
    };
  } catch {
    let mem: EngineSnapshot | null = null;
    return {
      persistent: false,
      load: async () => mem,
      save: async (s) => { mem = s; },
    };
  }
}
