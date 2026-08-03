/**
 * OSM island fetch — the honest answer to "no dataset ships every island."
 * Generalized base shorelines miss small islands entirely (Upper Matecumbe
 * is invisible to Natural Earth at any scale we can bundle), and a route
 * that crosses land is worse than no route. OpenStreetMap's coastline layer
 * has essentially every island on earth; at auto-route time Black Flag pulls
 * the coastline ways inside the route's search box from the Overpass API and
 * stitches them into island rings the water mask can treat as land.
 *
 * Register SRC-12 (provisional): ODbL, attribution rendered with the route
 * basis; public Overpass instance is rate-limited — fine for per-route
 * fetches, production wants a self-hosted instance. Failure is honest: no
 * reply → route computes without island data and SAYS SO.
 *
 * Only rings that close fully inside the box are kept — mainland segments
 * (already handled by the base shorelines) cross the box edge and never
 * close, so they drop out naturally.
 */

export interface IslandFetchResult {
  rings: number[][][];        // [ [ [lon,lat], ... ] ] closed island rings
  count: number;
  provenance: string;
}

interface OverpassWay { type: string; geometry?: { lat: number; lon: number }[] }

const cache = new Map<string, IslandFetchResult>();

/** Stitch coastline way segments into closed rings by matching endpoints. */
export function stitchRings(ways: { lat: number; lon: number }[][]): number[][][] {
  const key = (p: { lat: number; lon: number }) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
  const segs = ways.filter(w => w.length >= 2).map(w => [...w]);
  const rings: number[][][] = [];
  while (segs.length) {
    let chain = segs.shift()!;
    let extended = true;
    while (extended && key(chain[0]) !== key(chain[chain.length - 1])) {
      extended = false;
      const tail = key(chain[chain.length - 1]);
      const head = key(chain[0]);
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (key(s[0]) === tail) { chain = chain.concat(s.slice(1)); segs.splice(i, 1); extended = true; break; }
        if (key(s[s.length - 1]) === tail) { chain = chain.concat(s.slice(0, -1).reverse()); segs.splice(i, 1); extended = true; break; }
        if (key(s[s.length - 1]) === head) { chain = s.slice(0, -1).concat(chain); segs.splice(i, 1); extended = true; break; }
        if (key(s[0]) === head) { chain = s.slice(1).reverse().concat(chain); segs.splice(i, 1); extended = true; break; }
      }
    }
    // keep only rings that actually closed — open chains are mainland
    // segments clipped by the bbox, already covered by base shorelines
    if (chain.length >= 4 && key(chain[0]) === key(chain[chain.length - 1])) {
      rings.push(chain.map(p => [p.lon, p.lat]));
    }
  }
  return rings;
}

/** Fetch island rings inside a bbox. Times out fast and fails honest-empty. */
export async function fetchIslands(bb: { minLat: number; maxLat: number; minLon: number; maxLon: number }): Promise<IslandFetchResult | null> {
  const k = [bb.minLat, bb.minLon, bb.maxLat, bb.maxLon].map(v => v.toFixed(3)).join(',');
  if (cache.has(k)) return cache.get(k)!;
  // cap the area — island stitching is for route-scale boxes, not oceans
  if ((bb.maxLat - bb.minLat) * (bb.maxLon - bb.minLon) > 4) return null;
  const q = `[out:json][timeout:12];way["natural"="coastline"](${bb.minLat.toFixed(4)},${bb.minLon.toFixed(4)},${bb.maxLat.toFixed(4)},${bb.maxLon.toFixed(4)});out geom;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: 'data=' + encodeURIComponent(q),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`overpass ${res.status}`);
  const js = await res.json();
  const ways: { lat: number; lon: number }[][] = (js?.elements ?? [])
    .filter((e: OverpassWay) => e.type === 'way' && Array.isArray(e.geometry))
    .map((e: OverpassWay) => e.geometry!);
  const rings = stitchRings(ways);
  const out: IslandFetchResult = {
    rings,
    count: rings.length,
    provenance: `islands: OpenStreetMap coastline (ODbL, ${rings.length} island${rings.length === 1 ? '' : 's'} in route area)`,
  };
  cache.set(k, out);
  return out;
}
