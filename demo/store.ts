/**
 * Device store for the demo — IndexedDB when the host allows it (the PWA and
 * any normal browser), honest in-memory fallback when it doesn't (some
 * embedded webviews). The engine doesn't care which executes it (Design D4).
 */
import type { EngineSnapshot } from '../packages/sync/src/index.js';

const DB = 'blackflag', STORE = 'engine', KEY = 'snapshot', PACKS = 'packs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(PACKS)) db.createObjectStore(PACKS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}

export interface StoredPackFile { name: string; buf: ArrayBuffer }

/** Persist the loaded ENC pack so it survives reloads (offline-first). */
export async function savePackFiles(files: StoredPackFile[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(PACKS, 'readwrite').objectStore(PACKS).put(files, 'current');
      tx.onsuccess = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* in-memory host — pack lives for the session only */ }
}

export async function loadPackFiles(): Promise<StoredPackFile[] | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(PACKS, 'readonly').objectStore(PACKS).get('current');
      tx.onsuccess = () => resolve(tx.result ?? null);
      tx.onerror = () => resolve(null);
    });
  } catch { return null; }
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
