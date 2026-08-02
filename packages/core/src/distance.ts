/** Great-circle distance and courses. Pure math, WGS-84 mean radius. */

export interface LatLon { lat: number; lon: number; }
export interface RouteWaypoint extends LatLon { name: string; }

const R_NM = 3440.065; // earth mean radius in nautical miles
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => ((r * 180) / Math.PI + 360) % 360;

export function haversineNm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.sqrt(s));
}

export function initialCourseDeg(a: LatLon, b: LatLon): number {
  const dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  return deg(Math.atan2(y, x));
}

export interface RouteLeg {
  from: string;
  to: string;
  dist_nm: number;
  course_deg: number;
}

export function routeLegs(wps: RouteWaypoint[]): RouteLeg[] {
  const legs: RouteLeg[] = [];
  for (let i = 0; i < wps.length - 1; i++) {
    legs.push({
      from: wps[i].name,
      to: wps[i + 1].name,
      dist_nm: Math.round(haversineNm(wps[i], wps[i + 1]) * 10) / 10,
      course_deg: Math.round(initialCourseDeg(wps[i], wps[i + 1])),
    });
  }
  return legs;
}

export const routeDistanceNm = (wps: RouteWaypoint[]): number =>
  Math.round(routeLegs(wps).reduce((s, l) => s + l.dist_nm, 0) * 10) / 10;
