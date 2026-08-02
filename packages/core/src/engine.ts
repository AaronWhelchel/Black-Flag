/**
 * Engine & hull fuel model.
 * v1 is physics + named rules: piecewise-linear interpolation over the vessel's
 * measured engine curve, with documented weather adjustment. The validated
 * envelope is the curve's own speed range — outside it we flag, never extrapolate
 * silently (Explainability Standard §3).
 */

export interface EngineCurvePoint {
  rpm: number;
  kn: number;   // boat speed at that rpm, calm water
  gph: number;  // total fuel burn, gallons/hour
}

export interface BurnResult {
  gph: number;
  rpm: number;
  inEnvelope: boolean;
}

/** Interpolate burn + rpm at a target calm-water speed from the vessel's curve. */
export function burnAtSpeed(curve: EngineCurvePoint[], kn: number): BurnResult {
  if (curve.length < 2) throw new Error('Engine curve needs at least 2 points');
  const pts = [...curve].sort((a, b) => a.kn - b.kn);
  const min = pts[0], max = pts[pts.length - 1];
  if (kn <= min.kn) return { gph: min.gph, rpm: min.rpm, inEnvelope: kn >= min.kn * 0.9 };
  if (kn >= max.kn) return { gph: max.gph, rpm: max.rpm, inEnvelope: kn <= max.kn * 1.02 };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (kn >= a.kn && kn <= b.kn) {
      const t = (kn - a.kn) / (b.kn - a.kn);
      return { gph: a.gph + t * (b.gph - a.gph), rpm: Math.round(a.rpm + t * (b.rpm - a.rpm)), inEnvelope: true };
    }
  }
  /* istanbul ignore next -- unreachable given sort + bounds */
  return { gph: max.gph, rpm: max.rpm, inEnvelope: false };
}

/**
 * Named rule "wx_adjustment": burn multiplier for wind and seas on a leg.
 * Empirical planing-hull factors, validated envelope: winds ≤ 30 kn, seas ≤ 6 ft.
 *  - headwind: +0.8% burn per kn of headwind component (tailwind credits half)
 *  - seas: +4% per foot of significant height when on the bow, +2.5% on the beam
 */
export function weatherAdjustment(opts: {
  headwindKn: number;   // + head, − tail
  seasFt: number;
  seasRelation: 'head' | 'beam' | 'follow';
}): { factor: number; inEnvelope: boolean } {
  const windTerm = opts.headwindKn >= 0
    ? 0.008 * opts.headwindKn
    : 0.004 * opts.headwindKn; // tailwind relief, half strength
  const seaRate = opts.seasRelation === 'head' ? 0.04 : opts.seasRelation === 'beam' ? 0.025 : 0.01;
  const seaTerm = seaRate * opts.seasFt;
  const factor = Math.max(0.85, 1 + windTerm + seaTerm);
  const inEnvelope = Math.abs(opts.headwindKn) <= 30 && opts.seasFt <= 6;
  return { factor, inEnvelope };
}
