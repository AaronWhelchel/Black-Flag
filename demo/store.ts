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

/** Chart packs are stored PER REGION — a captain who ran Patoka last week and
 *  is in Key West today keeps both, and each works offline. (The old build
 *  kept one 'current' pack, so switching regions silently threw the other
 *  away and needed a network to come back.) 'last' records which region was
 *  active, so a cold start restores the chart you were last using. */
const packKey = (region: string) => `pack:${region}`;

export async function savePackFiles(region: string, files: StoredPackFile[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const os = db.transaction(PACKS, 'readwrite').objectStore(PACKS);
      os.put(files, packKey(region));
      const tx = os.put(region, 'last');
      tx.onsuccess = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* in-memory host — pack lives for the session only */ }
}

const getKey = async (key: string): Promise<any> => {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(PACKS, 'readonly').objectStore(PACKS).get(key);
      tx.onsuccess = () => resolve(tx.result ?? null);
      tx.onerror = () => resolve(null);
    });
  } catch { return null; }
};

/** Stored copy of one region's pack, or null. Falls back to the legacy
 *  single-slot entry so devices that stored a pack under the old build
 *  don't have to re-download it. */
export async function loadPackFiles(region?: string): Promise<StoredPackFile[] | null> {
  if (region) return (await getKey(packKey(region))) ?? null;
  const last = await getKey('last');
  if (last) {
    const files = await getKey(packKey(String(last)));
    if (files) return files;
  }
  return (await getKey('current')) ?? null;   // legacy slot
}

/** Is this region's pack already on the device? (offline region switch) */
export async function havePackFor(region: string): Promise<boolean> {
  return !!(await getKey(packKey(region)));
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
