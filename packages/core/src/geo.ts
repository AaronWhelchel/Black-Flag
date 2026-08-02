/** Small, dependable geo/angle helpers. Pure functions only. */

/** Smallest absolute angular difference between two bearings, degrees [0, 180]. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** Component of wind (kn) acting along the course as a headwind (+) or tailwind (−). */
export function headwindComponent(windKn: number, windFromDeg: number, courseDeg: number): number {
  // Wind FROM dead ahead of the course = pure headwind.
  const rel = angleDiff(windFromDeg, courseDeg);
  return windKn * Math.cos((rel * Math.PI) / 180);
}

/** Crosswind/beam component magnitude (kn). */
export function beamComponent(windKn: number, windFromDeg: number, courseDeg: number): number {
  const rel = angleDiff(windFromDeg, courseDeg);
  return Math.abs(windKn * Math.sin((rel * Math.PI) / 180));
}

export function fmtTime(isoLocal: string): string {
  // "2026-08-04T09:30-04:00" -> "09:30"
  const m = isoLocal.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : isoLocal;
}
