/**
 * Vessel catalogue client — download once, search offline forever.
 *
 * The catalogue is tens of thousands of vessels, so it ships like a chart
 * pack: a compact index for searching (name, class, length, draft, power) and
 * 256 detail shards fetched only when a captain actually opens a record.
 * Everything is cached on the device, because the moment you need to know
 * your draft is usually the moment you have no signal.
 */
import { VesselIndexRow, VesselSpec, searchVessels, rowHaystack, VesselSearchHit } from '../packages/core/src/index.js';
import { saveKV, loadKV } from './store.js';

const BASE = 'https://raw.githubusercontent.com/AaronWhelchel/Black-Flag/pack/vessels';
const K_INDEX = 'vessels:index', K_MANIFEST = 'vessels:manifest', K_SHARD = 'vessels:shard:';

export interface VesselManifest { built_at: string; count: number; with_draft: number; by_category?: Record<string, number> }

export class VesselCatalog {
  rows: VesselIndexRow[] = [];
  manifest: VesselManifest | null = null;
  private haystacks: string[] = [];
  private shards = new Map<string, Record<string, VesselSpec>>();
  private loading: Promise<boolean> | null = null;
  /** null = not tried, true = ready, false = unavailable (said out loud) */
  state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  note = '';

  /** dbj2 low byte — must match tools/vessels/build.mjs */
  private shardOf(id: string): string {
    let h = 5381;
    for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0;
    return (h & 0xff).toString(16).padStart(2, '0');
  }

  async ensure(onProgress?: (msg: string) => void): Promise<boolean> {
    if (this.state === 'ready') return true;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      this.state = 'loading';
      // device copy first: instant, and works with no signal
      const cached = await loadKV<VesselIndexRow[]>(K_INDEX);
      if (cached?.length) {
        this.rows = cached;
        this.manifest = await loadKV<VesselManifest>(K_MANIFEST);
        this.reindex();
        this.state = 'ready';
        this.note = `${this.rows.length.toLocaleString()} vessels on this device`;
        void this.refreshInBackground();
        return true;
      }
      onProgress?.('Downloading the vessel catalogue…');
      try {
        const [mRes, iRes] = await Promise.all([
          fetch(`${BASE}/manifest.json`, { signal: AbortSignal.timeout(15000) }),
          fetch(`${BASE}/index.json`, { signal: AbortSignal.timeout(60000) }),
        ]);
        if (!mRes.ok || !iRes.ok) throw new Error(`HTTP ${mRes.status}/${iRes.status}`);
        this.manifest = await mRes.json();
        this.rows = await iRes.json();
        this.reindex();
        await saveKV(K_INDEX, this.rows);
        await saveKV(K_MANIFEST, this.manifest);
        this.state = 'ready';
        this.note = `${this.rows.length.toLocaleString()} vessels · stored on this device, works offline`;
        return true;
      } catch (e) {
        this.state = 'failed';
        this.note = `Couldn’t download the vessel catalogue (${String((e as Error).message).slice(0, 50)}). You can still add your boat by hand.`;
        return false;
      } finally { this.loading = null; }
    })();
    return this.loading;
  }

  /** A newer catalogue quietly replaces the cached one — vessels get added and
   *  corrected, and a captain shouldn't have to know that. */
  private async refreshInBackground() {
    try {
      const res = await fetch(`${BASE}/manifest.json`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const m: VesselManifest = await res.json();
      if (m.built_at === this.manifest?.built_at) return;
      const iRes = await fetch(`${BASE}/index.json`, { signal: AbortSignal.timeout(60000) });
      if (!iRes.ok) return;
      this.rows = await iRes.json();
      this.manifest = m;
      this.reindex();
      this.shards.clear();
      await saveKV(K_INDEX, this.rows);
      await saveKV(K_MANIFEST, m);
      this.note = `${this.rows.length.toLocaleString()} vessels · updated`;
    } catch { /* offline — the cached catalogue is still good */ }
  }

  private reindex() { this.haystacks = this.rows.map(rowHaystack); }

  search(q: string, limit = 30): VesselSearchHit[] {
    return searchVessels(this.rows, q, { limit, haystacks: this.haystacks });
  }

  /** Full record for one vessel — fetches (and caches) its shard on demand. */
  async get(id: string): Promise<VesselSpec | null> {
    const sh = this.shardOf(id);
    let map = this.shards.get(sh);
    if (!map) {
      map = (await loadKV<Record<string, VesselSpec>>(K_SHARD + sh)) ?? undefined;
      if (!map) {
        try {
          const res = await fetch(`${BASE}/v/${sh}.json`, { signal: AbortSignal.timeout(20000) });
          if (!res.ok) return null;
          map = await res.json();
          await saveKV(K_SHARD + sh, map);
        } catch { return null; }
      }
      this.shards.set(sh, map!);
    }
    return map![id] ?? null;
  }
}
