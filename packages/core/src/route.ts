/**
 * Route safety checking — named rule "hazard_clearance".
 *
 * v1 scope, stated honestly: legs are checked against the captain's own marked
 * hazards, and detours are suggested around them. Land/shoal avoidance requires
 * chart-pack water polygons (ENC pipeline) and layers on top of this same code
 * when that data ships. Until then the captain verifies the path — the route
 * line never claims to know where the water is.
 */
import { LatLon, RouteWaypoint, haversineNm } from './distance.js';

export interface HazardMark extends LatLon {
  id: string;
  label: string;
  kind: string;
}

export interface RouteConflict {
  leg_index: number;        // between wps[i] and wps[i+1]
  hazard: HazardMark;
  dist_nm: number;
  closest: LatLon;
}

/** Local-flat projection around a latitude — accurate to well under 1% at leg scale. */
const flat = (p: LatLon, lat0: number): [number, number] => {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return [p.lon * k * 60, p.lat * 60];   // nm east, nm north
};

/** Distance (nm) from point p to segment a-b, plus the closest point on it. */
export function pointToLegNm(p: LatLon, a: LatLon, b: LatLon): { dist_nm: number; closest: LatLon } {
  const lat0 = (a.lat + b.lat + p.lat) / 3;
  const [ax, ay] = flat(a, lat0), [bx, by] = flat(b, lat0), [px, py] = flat(p, lat0);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx, cy = ay + t * dy;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const closest = { lon: cx / (60 * k), lat: cy / 60 };
  return { dist_nm: Math.hypot(px - cx, py - cy), closest };
}

/** Every leg that passes within `clearance_nm` of a hazard mark. */
export function routeConflicts(
  wps: RouteWaypoint[],
  hazards: HazardMark[],
  clearance_nm: number,
): RouteConflict[] {
  const out: RouteConflict[] = [];
  for (let i = 0; i < wps.length - 1; i++) {
    for (const h of hazards) {
      const { dist_nm, closest } = pointToLegNm(h, wps[i], wps[i + 1]);
      if (dist_nm < clearance_nm) out.push({ leg_index: i, hazard: h, dist_nm: Math.round(dist_nm * 100) / 100, closest });
    }
  }
  return out.sort((a, b) => a.dist_nm - b.dist_nm);
}

/**
 * Insert detour waypoints until no leg violates clearance (or iterations run
 * out — in which case the remaining conflicts are returned, never hidden).
 * Each detour point sits perpendicular to the leg, on the far side from the
 * hazard, at 1.6× clearance.
 */
export function suggestDetour(
  wps: RouteWaypoint[],
  hazards: HazardMark[],
  clearance_nm: number,
): { waypoints: RouteWaypoint[]; resolved: boolean; remaining: RouteConflict[]; added: number } {
  let route = [...wps];
  let added = 0;
  for (let iter = 0; iter < 24; iter++) {
    const conflicts = routeConflicts(route, hazards, clearance_nm);
    if (conflicts.length === 0) return { waypoints: route, resolved: true, remaining: [], added };
    const c = conflicts[0];
    const a = route[c.leg_index], b = route[c.leg_index + 1];
    const lat0 = c.closest.lat;
    const k = Math.cos((lat0 * Math.PI) / 180);
    // Unit vector along the leg (flat nm), then its perpendicular away from the hazard.
    const [ax, ay] = flat(a, lat0), [bx, by] = flat(b, lat0);
    const [hx, hy] = flat(c.hazard, lat0), [cx, cy] = flat(c.closest, lat0);
    const legLen = Math.hypot(bx - ax, by - ay) || 1;
    let px = -(by - ay) / legLen, py = (bx - ax) / legLen;
    // point the perpendicular away from the hazard
    if ((hx - cx) * px + (hy - cy) * py > 0) { px = -px; py = -py; }
    const off = clearance_nm * 1.6;
    const dx = cx + px * off, dy = cy + py * off;
    added += 1;
    const detour: RouteWaypoint = {
      name: `D${added}`,
      lat: Math.round((dy / 60) * 10000) / 10000,
      lon: Math.round((dx / (60 * k)) * 10000) / 10000,
    };
    route = [...route.slice(0, c.leg_index + 1), detour, ...route.slice(c.leg_index + 1)];
  }
  return { waypoints: route, resolved: false, remaining: routeConflicts(route, hazards, clearance_nm), added };
}

/** Reasonable default clearance by hazard kind, nm. */
export const HAZARD_CLEARANCE_NM: Record<string, number> = {
  hazard: 0.05, rock: 0.05, shoal: 0.08, shallow: 0.08,
  timber: 0.05, wreck: 0.05, bridge: 0.03, 'no-wake': 0.02, other: 0.05,
};

export const extraDistanceNm = (before: RouteWaypoint[], after: RouteWaypoint[]): number => {
  const d = (w: RouteWaypoint[]) => w.slice(1).reduce((s, p, i) => s + haversineNm(w[i], p), 0);
  return Math.round((d(after) - d(before)) * 100) / 100;
};
