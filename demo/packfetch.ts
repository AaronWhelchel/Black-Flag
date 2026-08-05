/**
 * Per-trip chart-pack auto-download — the end of "load files".
 *
 * CI publishes each region's pack to a pack/<region> branch; with the repo
 * public, GitHub's CDN serves those files anonymously with CORS. When a
 * captain plans a route, Black Flag finds the region covering it, downloads
 * the pack once (a few MB), activates it, and stores it in IndexedDB — from
 * then on that region works offline. No servers, no accounts.
 *
 * Honesty: download progress and failures show in the chart-pack card; a
 * failed download degrades to the OSM/base routing tiers, which say so.
 */

export interface PackRegion { key: string; name: string; bbox: [number, number, number, number] }  // w,s,e,n

/** Static index of published regions — keep in sync with tools/packs/regions.json. */
export const PACK_REGIONS: PackRegion[] = [
  { key: 'fl-key-west', name: 'Key West & lower Keys', bbox: [-81.95, 24.42, -81.55, 24.72] },
  { key: 'fl-keys-bimini', name: 'Upper Keys / Biscayne', bbox: [-80.6, 24.9, -79.9, 25.9] },
  { key: 'nj-manasquan', name: 'New Jersey — Sandy Hook to Barnegat', bbox: [-74.35, 39.9, -73.7, 40.55] },
  { key: 'ky-barkley-lakes', name: 'Kentucky Lake & Lake Barkley', bbox: [-88.6, 34.9, -87.2, 37.15] },
  { key: 'in-patoka', name: 'Patoka Lake (OSM shoreline)', bbox: [-86.78, 38.36, -86.55, 38.5] },
];

const BASE = 'https://raw.githubusercontent.com/AaronWhelchel/Black-Flag';

/** Best-overlap published region for a route bbox, or null. */
export function regionForRoute(bb: { minLat: number; maxLat: number; minLon: number; maxLon: number }): PackRegion | null {
  let best: PackRegion | null = null;
  let bestA = 0;
  for (const r of PACK_REGIONS) {
    const [w, s, e, n] = r.bbox;
    const iw = Math.min(bb.maxLon, e) - Math.max(bb.minLon, w);
    const ih = Math.min(bb.maxLat, n) - Math.max(bb.minLat, s);
    if (iw <= 0 || ih <= 0) continue;
    const a = iw * ih;
    if (a > bestA) { bestA = a; best = r; }
  }
  return best;
}

/** Failed downloads get a short cooldown, NOT a permanent session ban: a
 *  captain who plans Patoka and then Key West in one sitting must get the
 *  Key West chart. (A once-and-never-again guard is how a route silently ran
 *  on the wrong region's pack.) */
const failedAt = new Map<string, number>();
const COOLDOWN_MS = 45_000;

/** Is a newer build of this region published than what's active? Cheap
 *  manifest-only check — chart packs get FIXED (a Patoka rebuild corrected
 *  its coverage), and a captain must not be stranded on a stale one. */
export async function newerPackAvailable(region: PackRegion, activeBuiltAt: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/pack/${region.key}/manifest.json`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const man = await res.json();
    return !!man.built_at && man.built_at !== activeBuiltAt;
  } catch { return false; }
}

/** Download a region's pack files. Returns files ready for EncPack, or null
 *  (fetch failed, or failed moments ago — caller stays honest either way). */
export async function downloadPack(
  region: PackRegion,
  onProgress: (msg: string) => void,
  force = false,
): Promise<{ name: string; blob: Blob }[] | null> {
  const failed = failedAt.get(region.key);
  if (!force && failed && Date.now() - failed < COOLDOWN_MS) {
    onProgress(`No ${region.name} chart pack on this device and the download just failed — routing on shoreline data only. Retry in a moment, or use Load Files.`);
    return null;
  }
  const base = `${BASE}/pack/${region.key}`;
  try {
    onProgress(`Auto-downloading the ${region.name} chart pack for this trip…`);
    const manRes = await fetch(`${base}/manifest.json`, { signal: AbortSignal.timeout(15000) });
    if (!manRes.ok) throw new Error(`manifest ${manRes.status}`);
    const manText = await manRes.text();
    const man = JSON.parse(manText);
    const layerFiles: string[] = Object.values(man.layers ?? {});
    if (!layerFiles.length) throw new Error('empty manifest');
    const files: { name: string; blob: Blob }[] = [{ name: 'manifest.json', blob: new Blob([manText]) }];
    let done = 0;
    for (const f of layerFiles) {
      const res = await fetch(`${base}/${f}`, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`${f}: ${res.status}`);
      files.push({ name: f, blob: await res.blob() });
      done++;
      onProgress(`Auto-downloading the ${region.name} chart pack… ${done}/${layerFiles.length} layers`);
    }
    failedAt.delete(region.key);
    return files;
  } catch (e) {
    failedAt.set(region.key, Date.now());
    onProgress(`Couldn’t auto-download the ${region.name} pack (${String((e as Error).message).slice(0, 60)}) — routing continues on shoreline data; retry with the refresh button or Load Files.`);
    return null;
  }
}

/** Allow an immediate retry after a failed attempt (e.g. captain hits refresh). */
export function resetAttempt(key: string) { failedAt.delete(key); }
