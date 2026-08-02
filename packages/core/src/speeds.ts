import { EngineCurvePoint, burnAtSpeed } from './engine.js';

/**
 * The three speeds every captain plans around, derived from the measured
 * engine curve — never asserted:
 *  - top: fastest point on the curve
 *  - cruise: the captain's stated cruise (validated against the curve)
 *  - best_economy: the speed that maximizes nautical miles per gallon
 */

export interface SpeedPoint {
  kn: number;
  rpm: number;
  gph: number;
  nmpg: number;      // nautical miles per gallon at this speed
  range_nm: number;  // on the given usable fuel under the given reserve
}

export interface VesselSpeeds {
  top: SpeedPoint;
  cruise: SpeedPoint;
  best_economy: SpeedPoint;
}

function point(curve: EngineCurvePoint[], kn: number, availableGal: number): SpeedPoint {
  const b = burnAtSpeed(curve, kn);
  const nmpg = kn / b.gph;
  return {
    kn: Math.round(kn * 10) / 10,
    rpm: b.rpm,
    gph: Math.round(b.gph * 10) / 10,
    nmpg: Math.round(nmpg * 100) / 100,
    range_nm: Math.round(nmpg * availableGal),
  };
}

export function vesselSpeeds(
  curve: EngineCurvePoint[],
  cruise_kn: number,
  usable_gal: number,
  reserve_frac: number,
): VesselSpeeds {
  const available = usable_gal * (1 - reserve_frac);
  const sorted = [...curve].sort((a, b) => a.kn - b.kn);
  const top = sorted[sorted.length - 1];

  // Best economy: max nmpg at *passage-making* speed. A planing hull's raw
  // nmpg optimum is often the displacement idle (~4–5 kn) — technically true,
  // useless for a crossing, and exactly the kind of misleading number the
  // Explainability Standard bans as false precision of intent. So: on planing
  // hulls (top > 12 kn) we search only ≥ 40% of top speed; slower hulls
  // search the whole curve.
  const minEcoKn = top.kn > 12 ? top.kn * 0.4 : sorted[0].kn;
  let bestKn = minEcoKn;
  let bestNmpg = 0;
  for (let kn = minEcoKn; kn <= top.kn; kn += 0.25) {
    const b = burnAtSpeed(curve, kn);
    const nmpg = kn / b.gph;
    if (nmpg > bestNmpg) { bestNmpg = nmpg; bestKn = kn; }
  }

  return {
    top: point(curve, top.kn, available),
    cruise: point(curve, Math.min(cruise_kn, top.kn), available),
    best_economy: point(curve, bestKn, available),
  };
}
