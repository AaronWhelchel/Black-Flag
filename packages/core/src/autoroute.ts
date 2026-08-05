/**
 * Auto-routing — named rule "water_route".
 *
 * A* over a walkability grid supplied by the caller (water mask minus hazard
 * clearance), then line-of-sight smoothing so the result is a handful of
 * draggable waypoints, not a staircase. The core stays pure: it never knows
 * where the water data came from — generalized shorelines today, ENC depth
 * areas when packs land. Honesty contract: if no safe path exists at this
 * data's resolution, say so; never return a path that crosses a blocked cell.
 */
import { LatLon, RouteWaypoint, haversineNm } from './distance.js';

export interface AutoRouteResult {
  ok: boolean;
  reason?: string;
  waypoints: RouteWaypoint[];
  dist_nm?: number;
  snapped_start?: boolean;
  snapped_end?: boolean;
}

export interface AutoRouteOpts {
  /** Grid cells across the longer bbox axis. Default 160. */
  resolution?: number;
  /** Padding around the endpoints' bbox, fraction. Default 0.35. */
  pad?: number;
  /** Max cells to search before giving up. Default 200k. */
  maxExpand?: number;
  /**
   * Per-position travel cost multiplier, ≥ 1 (1 = no penalty). This is how a
   * preference is expressed rather than a rule: water close to the beach is
   * still water, it just costs more to use, so the search buys its offing
   * wherever the water is wide enough to afford it and spends the penalty
   * only where the channel leaves no choice. Must never return < 1, or the
   * octile heuristic stops being admissible.
   */
  cost?: (lat: number, lon: number) => number;
}

export function autoRoute(
  a: LatLon,
  b: LatLon,
  isWalkable: (lat: number, lon: number) => boolean,
  opts: AutoRouteOpts = {},
): AutoRouteResult {
  const res = opts.resolution ?? 160;
  const pad = opts.pad ?? 0.35;
  const maxExpand = opts.maxExpand ?? 200_000;

  const minLat0 = Math.min(a.lat, b.lat), maxLat0 = Math.max(a.lat, b.lat);
  const minLon0 = Math.min(a.lon, b.lon), maxLon0 = Math.max(a.lon, b.lon);
  // Pad BOTH axes by the larger span — a straight east-west route still needs
  // room to detour north or south (and vice versa).
  const spanLat = Math.max(maxLat0 - minLat0, 0.01), spanLon = Math.max(maxLon0 - minLon0, 0.01);
  const padDist = Math.max(spanLat, spanLon) * pad;
  const minLat = minLat0 - padDist, maxLat = maxLat0 + padDist;
  const minLon = minLon0 - padDist, maxLon = maxLon0 + padDist;

  const aspect = (maxLon - minLon) / (maxLat - minLat);
  const W = aspect >= 1 ? res : Math.max(24, Math.round(res * aspect));
  const H = aspect >= 1 ? Math.max(24, Math.round(res / aspect)) : res;

  const toCell = (p: LatLon) => ({
    x: Math.min(W - 1, Math.max(0, Math.round(((p.lon - minLon) / (maxLon - minLon)) * (W - 1)))),
    y: Math.min(H - 1, Math.max(0, Math.round(((p.lat - minLat) / (maxLat - minLat)) * (H - 1)))),
  });
  const toLatLon = (x: number, y: number): LatLon => ({
    lon: minLon + (x / (W - 1)) * (maxLon - minLon),
    lat: minLat + (y / (H - 1)) * (maxLat - minLat),
  });

  // Rasterize walkability (and travel cost) once.
  const costFn = opts.cost;
  const walk = new Uint8Array(W * H);
  const cost = new Float32Array(W * H).fill(1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = toLatLon(x, y);
      const ok = isWalkable(p.lat, p.lon);
      walk[y * W + x] = ok ? 1 : 0;
      if (ok && costFn) cost[y * W + x] = Math.max(1, costFn(p.lat, p.lon));
    }
  }

  /** Endpoints may fall on a blocked cell at this resolution — snap to the
   *  nearest walkable cell within a small radius, and report that we did. */
  const snap = (c: { x: number; y: number }) => {
    if (walk[c.y * W + c.x]) return { c, snapped: false };
    for (let r = 1; r <= Math.max(6, Math.round(res / 25)); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = c.x + dx, y = c.y + dy;
          if (x >= 0 && y >= 0 && x < W && y < H && walk[y * W + x]) return { c: { x, y }, snapped: true };
        }
      }
    }
    return null;
  };

  const sa = snap(toCell(a));
  const sb = snap(toCell(b));
  if (!sa) return { ok: false, reason: 'start is not on navigable water at this data resolution', waypoints: [] };
  if (!sb) return { ok: false, reason: 'destination is not on navigable water at this data resolution', waypoints: [] };

  // A* (8-connected, octile heuristic).
  const start = sa.c.y * W + sa.c.x, goal = sb.c.y * W + sb.c.x;
  const g = new Float64Array(W * H).fill(Infinity);
  const from = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const hx = (i: number) => {
    const dx = Math.abs((i % W) - (goal % W)), dy = Math.abs(Math.floor(i / W) - Math.floor(goal / W));
    return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
  };
  // Simple binary heap.
  const heap: number[] = [];
  const f = new Float64Array(W * H).fill(Infinity);
  const push = (i: number) => {
    heap.push(i);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f[heap[p]] <= f[heap[k]]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]]; k = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
        if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
      }
    }
    return top;
  };

  g[start] = 0; f[start] = hx(start); push(start);
  let expanded = 0, found = false;
  while (heap.length) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) { found = true; break; }
    if (++expanded > maxExpand) break;
    const cx = cur % W, cy = Math.floor(cur / W);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (!walk[ni] || closed[ni]) continue;
        // no corner-cutting through blocked diagonals
        if (dx && dy && (!walk[cy * W + nx] || !walk[ny * W + cx])) continue;
        const step = dx && dy ? 1.4142 : 1;
        const ng = g[cur] + step * ((cost[cur] + cost[ni]) / 2);
        if (ng < g[ni]) { g[ni] = ng; from[ni] = cur; f[ni] = ng + hx(ni); push(ni); }
      }
    }
  }
  if (!found) return { ok: false, reason: 'no navigable path at this data resolution (try plotting manually, or the water here is narrower than the shoreline data can see)', waypoints: [] };

  // Reconstruct, then smooth with line-of-sight checks against the same grid.
  const cells: number[] = [];
  for (let i = goal; i !== -1; i = from[i]) cells.push(i);
  cells.reverse();
  /** Cost profile of the stretch of found path a shortcut would replace. */
  const segStats = (from: number, to: number) => {
    let mx = 1, sum = 0;
    for (let k = from; k <= to; k++) { const c = cost[cells[k]]; if (c > mx) mx = c; sum += c; }
    return { mx, mean: sum / (to - from + 1) };
  };
  const clearLine = (i: number, j: number, mx = Infinity, mean = Infinity) => {
    const x0 = i % W, y0 = Math.floor(i / W), x1 = j % W, y1 = Math.floor(j / W);
    // Validate the segment against the CONTINUOUS mask, not the coarse grid:
    // the caller's isWalkable is finer than the routing grid, and a sliver of
    // land between two walkable cell centers is exactly what makes a smoothed
    // leg visually touch a beach. Sub-cell sampling at ~¼ cell.
    const steps = Math.max(4, Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 4);
    let sum = 0, n = 0;
    for (let s = 1; s < steps; s++) {
      const xf = x0 + ((x1 - x0) * s) / steps, yf = y0 + ((y1 - y0) * s) / steps;
      const p = toLatLon(xf, yf);
      if (!isWalkable(p.lat, p.lon)) return false;
      if (costFn) {
        const c = Math.max(1, costFn(p.lat, p.lon));
        // Straightening must not buy distance with the captain's offing — but
        // the guard has to leave room to actually straighten. Held too tight
        // (max + ε, mean × 1.05) it refused nearly every shortcut in close
        // water and the line came out as a staircase of 100-yard legs, which
        // is not a course anyone can steer.
        if (c > mx + 0.3) return false;
        sum += c; n++;
      }
    }
    // In water tight enough that the whole corridor is already inside the
    // offing, there is no offing left to protect — walkability is the real
    // constraint, and holding the tight guard there just produces a bend
    // every hundred yards up a winding creek.
    const slack = mean > 1.8 ? 1.45 : 1.2;
    return !(costFn && n && sum / n > mean * slack + 0.05);
  };
  const keep: number[] = [cells[0]];
  let anchor = 0;
  for (let i = 2; i < cells.length; i++) {
    const st = segStats(anchor, i);
    if (!clearLine(cells[anchor], cells[i], st.mx, st.mean)) { keep.push(cells[i - 1]); anchor = i - 1; }
  }
  keep.push(cells[cells.length - 1]);

  // Second pass: a single forward sweep leaves corners it couldn't see past.
  // Drop any waypoint whose neighbours can see each other on the same terms,
  // repeatedly, until the line stops getting simpler. A captain steers legs,
  // not pixels.
  const idxOf = new Map(cells.map((c, i) => [c, i]));
  for (let pass = 0; pass < 4; pass++) {
    let dropped = false;
    for (let k = 1; k < keep.length - 1; k++) {
      const a0 = idxOf.get(keep[k - 1]) ?? 0, b0 = idxOf.get(keep[k + 1]) ?? cells.length - 1;
      const st = segStats(Math.min(a0, b0), Math.max(a0, b0));
      if (clearLine(keep[k - 1], keep[k + 1], st.mx, st.mean)) { keep.splice(k, 1); dropped = true; k--; }
    }
    if (!dropped) break;
  }
  // Finally, collapse waypoints closer together than half a grid cell — those
  // are quantisation, not turns.
  for (let k = keep.length - 2; k > 0; k--) {
    const dx = (keep[k] % W) - (keep[k + 1] % W), dy = Math.floor(keep[k] / W) - Math.floor(keep[k + 1] / W);
    if (Math.hypot(dx, dy) < 0.5) keep.splice(k, 1);
  }

  const waypoints: RouteWaypoint[] = keep.map((i, n) => {
    const p = toLatLon(i % W, Math.floor(i / W));
    return {
      name: n === 0 ? 'Start' : n === keep.length - 1 ? 'End' : `A${n}`,
      lat: Math.round(p.lat * 100000) / 100000,   // 5 dp ≈ 1 m — 4 dp (~11 m) could round a point onto the beach
      lon: Math.round(p.lon * 100000) / 100000,
    };
  });
  // Pin exact endpoints when they weren't snapped.
  if (!sa.snapped) { waypoints[0] = { ...waypoints[0], lat: a.lat, lon: a.lon }; }
  if (!sb.snapped) { waypoints[waypoints.length - 1] = { ...waypoints[waypoints.length - 1], lat: b.lat, lon: b.lon }; }

  const dist = waypoints.slice(1).reduce((s, p, i) => s + haversineNm(waypoints[i], p), 0);
  return { ok: true, waypoints, dist_nm: Math.round(dist * 10) / 10, snapped_start: sa.snapped, snapped_end: sb.snapped };
}
