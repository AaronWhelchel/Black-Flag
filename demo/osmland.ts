/**
 * OSM coastline fetch — the honest answer to "no dataset ships every island."
 * Generalized base shorelines miss small islands entirely (Upper Matecumbe
 * is invisible to Natural Earth at any scale we can bundle), and a route
 * that crosses land is worse than no route. OpenStreetMap's coastline layer
 * has essentially every island on earth; at auto-route time Black Flag pulls
 * the coastline ways inside the route's search box from the Overpass API.
 *
 * Two shapes come back and BOTH matter:
 * - closed rings (islands that fit in the box) — masked as filled land;
 * - open chains (an island BIGGER than the box, or one mapped as several
 *   ways of which only some intersect the box) — a coastline is uncrossable
 *   whether or not we can see it close, so open chains are masked as
 *   blocked LINES. Dropping them was the v1.1 bug: a route crossed Windley
 *   Key because its ring never closed inside the search box.
 *
 * Register SRC-12 (provisional): ODbL, attribution rendered with the route
 * basis; public Overpass instance is rate-limited — fine for per-route
 * fetches, production wants a self-hosted instance. Failure is honest: no
 * reply → route computes without island data and SAYS SO.
 */

export interface CoastFetchResult {
  rings: number[][][];        // closed island rings [ [ [lon,lat], ... ] ]
  lines: number[][][];        // every coastline chain incl. unclosed (barriers)
  count: number;
  provenance: string;
}

interface OverpassWay { type: string; geometry?: { lat: number; lon: number }[] }

const cache: { bb: { minLat: number; maxLat: number; minLon: number; maxLon: number }; result: CoastFetchResult }[] = [];

/** Public Overpass instances — tried in order. The main instance rate-limits
 *  (429) under playful route-tweaking; the mirror usually answers. Production
 *  wants a self-hosted instance (register SRC-12 condition). */
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** Stitch coastline way segments into chains; closed ones become rings. */
export function stitchCoast(ways: { lat: number; lon: number }[][]): { rings: number[][][]; lines: number[][][] } {
  const key = (p: { lat: number; lon: number }) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
  const segs = ways.filter(w => w.length >= 2).map(w => [...w]);
  const rings: number[][][] = [];
  const lines: number[][][] = [];
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
    const coords = chain.map(p => [p.lon, p.lat]);
    lines.push(coords);
    if (chain.length >= 4 && key(chain[0]) === key(chain[chain.length - 1])) rings.push(coords);
  }
  return { rings, lines };
}

/** Fetch coastline for a bbox. Times out fast and fails honest-empty. */
export async function fetchIslands(bb: { minLat: number; maxLat: number; minLon: number; maxLon: number }): Promise<CoastFetchResult | null> {
  // a previously fetched box that CONTAINS this one answers from cache —
  // dragging waypoints inside the same water must not re-query the service
  for (const c of cache) {
    if (bb.minLat >= c.bb.minLat && bb.maxLat <= c.bb.maxLat && bb.minLon >= c.bb.minLon && bb.maxLon <= c.bb.maxLon) return c.result;
  }
  // cap the area — coastline stitching is for route-scale boxes, not oceans
  if ((bb.maxLat - bb.minLat) * (bb.maxLon - bb.minLon) > 4) return null;
  const q = `[out:json][timeout:12];way["natural"="coastline"](${bb.minLat.toFixed(4)},${bb.minLon.toFixed(4)},${bb.maxLat.toFixed(4)},${bb.maxLon.toFixed(4)});out geom;`;
  let lastErr: unknown = new Error('overpass unavailable');
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) { lastErr = new Error(`overpass ${res.status}`); continue; }   // 429 → try the mirror
      const js = await res.json();
      const ways: { lat: number; lon: number }[][] = (js?.elements ?? [])
        .filter((e: OverpassWay) => e.type === 'way' && Array.isArray(e.geometry))
        .map((e: OverpassWay) => e.geometry!);
      const { rings, lines } = stitchCoast(ways);
      const out: CoastFetchResult = {
        rings, lines,
        count: lines.length,
        provenance: `islands/coastline: OpenStreetMap (ODbL, ${lines.length} coastline chain${lines.length === 1 ? '' : 's'} in route area)`,
      };
      cache.push({ bb, result: out });
      if (cache.length > 12) cache.shift();
      return out;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/** Does the leg a→b cross any coastline chain (or start/end on island land)?
 *  Used to flag a hand-plotted route immediately, before any auto-routing. */
export function legCrossesCoast(
  a: { lat: number; lon: number }, b: { lat: number; lon: number },
  coast: { rings: number[][][]; lines: number[][][] },
): boolean {
  const inter = (p1: number[], p2: number[], p3: number[], p4: number[]) => {
    const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
    if (Math.abs(d) < 1e-12) return false;
    const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
    const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  const A = [a.lon, a.lat], B = [b.lon, b.lat];
  for (const line of coast.lines) {
    for (let i = 0; i < line.length - 1; i++) {
      if (inter(A, B, line[i], line[i + 1])) return true;
    }
  }
  return false;
}
