import { Explanation, ReasoningStep, explanation } from './types.js';
import { LatLon, RouteWaypoint, routeLegs, haversineNm } from './distance.js';

/**
 * Voyage risk assessment — named rules, transparent weights, honest sources.
 * Per Vision & Principles: Black Flag assesses risk against the captain's
 * vessel and stated limits; it never declares "safe", and the captain decides.
 * The display of this assessment is toggleable in the UI; its computation and
 * logging are not — we do not un-know things (Safety Before Convenience).
 */

export type VesselType = 'open_bow' | 'center_console' | 'cruiser' | 'sportfish' | 'sailboat' | 'pwc';

export interface RiskVessel {
  name: string;
  type: VesselType;
  loa_ft: number;
  max_recommended_seas_ft: number;
}

/**
 * Piracy & armed-robbery regions — demo snapshot in the shape of the ICC IMB
 * Piracy Reporting Centre annual data (a future registered source, Governance
 * Register §7). Bounding boxes, level 1–3.
 */
export interface PiracyRegion {
  name: string;
  level: 1 | 2 | 3;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  note: string;
}

export const PIRACY_REGIONS: PiracyRegion[] = [
  { name: 'Gulf of Guinea', level: 3, bbox: [-6, -2, 10, 7], note: 'kidnap-for-ransom incidents; armed boardings offshore' },
  { name: 'Gulf of Aden / Somali Basin', level: 3, bbox: [43, 4, 60, 16], note: 'historic hijacking zone; naval patrols active' },
  { name: 'Singapore Strait / Malacca approaches', level: 2, bbox: [100, -1, 105.5, 4], note: 'opportunistic boardings of vessels underway' },
  { name: 'Sulu / Celebes Seas', level: 2, bbox: [117, 3, 123, 9], note: 'periodic kidnap incidents' },
  { name: 'Venezuela / Trinidad offshore', level: 2, bbox: [-66, 9, -60, 12], note: 'armed robbery of yachts and fishing vessels' },
  { name: 'Haiti coastal waters', level: 1, bbox: [-75, 17.5, -71.5, 20.5], note: 'isolated armed robbery reports at anchor' },
];

const inBbox = (p: LatLon, b: [number, number, number, number]) =>
  p.lon >= b[0] && p.lat >= b[1] && p.lon <= b[2] && p.lat <= b[3];

/** Sample each leg at ~10 nm intervals and test against region boxes. */
export function piracyExposure(wps: RouteWaypoint[]): { level: 0 | 1 | 2 | 3; regions: PiracyRegion[] } {
  const hit = new Set<PiracyRegion>();
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i], b = wps[i + 1];
    const n = Math.max(2, Math.ceil(haversineNm(a, b) / 10));
    for (let s = 0; s <= n; s++) {
      const p = { lat: a.lat + (b.lat - a.lat) * (s / n), lon: a.lon + (b.lon - a.lon) * (s / n) };
      for (const r of PIRACY_REGIONS) if (inBbox(p, r.bbox)) hit.add(r);
    }
  }
  const regions = [...hit];
  const level = regions.length === 0 ? 0 : (Math.max(...regions.map(r => r.level)) as 1 | 2 | 3);
  return { level, regions };
}

// ---- Overall assessment ----

export interface RiskInputs {
  vessel: RiskVessel;
  waypoints: RouteWaypoint[];
  /** Longest single leg with no bail-out harbor, nm. */
  longest_exposed_leg_nm: number;
  forecast_seas_ft: number;
  forecast_wind_kn: number;
  wind_from_deg: number;
  gulf_stream_crossing: boolean;
  /** available gal under reserve ÷ required gal — <1 means short. */
  fuel_margin_ratio: number;
  data_vintage: Record<string, string>;
}

export interface RiskComponent {
  name: string;
  points: number;   // 0–25
  max: number;
  detail: string;
}

export type RiskBand = 'low' | 'moderate' | 'elevated' | 'high';

export interface RiskAssessment {
  score: number;          // 0–100
  band: RiskBand;
  components: RiskComponent[];
  mitigations: string[];
}

const OPEN_WATER_LIMIT_NM: Record<VesselType, number> = {
  pwc: 3, open_bow: 8, center_console: 30, cruiser: 60, sportfish: 80, sailboat: 100,
};

export function assessRisk(inputs: RiskInputs): Explanation<RiskAssessment> {
  const c: RiskComponent[] = [];
  const mitigations: string[] = [];
  const v = inputs.vessel;

  // 1) Vessel suitability vs exposure
  const limit = OPEN_WATER_LIMIT_NM[v.type];
  const over = inputs.longest_exposed_leg_nm / limit;
  const suitPts = Math.min(25, Math.round(Math.max(0, (over - 0.5)) * 12));
  c.push({
    name: 'vessel_suitability', points: suitPts, max: 25,
    detail: `${v.loa_ft} ft ${v.type.replace('_', ' ')} on a ${Math.round(inputs.longest_exposed_leg_nm)} nm exposed leg (typical open-water comfort for this class: ~${limit} nm)`,
  });
  if (suitPts >= 15) mitigations.push('A buddy boat or a larger vessel changes this component more than anything else');

  // 2) Forecast vs vessel seakeeping
  const seaOver = inputs.forecast_seas_ft / v.max_recommended_seas_ft;
  const seaPts = Math.min(25, Math.round(Math.max(0, seaOver - 0.6) * 20));
  c.push({
    name: 'conditions', points: seaPts, max: 25,
    detail: `forecast ${inputs.forecast_seas_ft} ft seas vs ~${v.max_recommended_seas_ft} ft recommended for this hull; wind ${inputs.forecast_wind_kn} kt`,
  });
  if (seaPts >= 10) mitigations.push(`Wait for a window with seas ≤ ${v.max_recommended_seas_ft} ft — small-craft windows exist most weeks in season`);

  // 3) Gulf Stream interaction (named rule: wind against current stands the sea up)
  let gsPts = 0;
  if (inputs.gulf_stream_crossing) {
    const northerly = inputs.wind_from_deg >= 315 || inputs.wind_from_deg <= 45;
    gsPts = northerly ? Math.min(25, 10 + Math.round(inputs.forecast_wind_kn * 0.8)) : Math.min(12, Math.round(inputs.forecast_wind_kn * 0.4));
    c.push({
      name: 'gulf_stream', points: gsPts, max: 25,
      detail: northerly
        ? `northerly component wind (${inputs.forecast_wind_kn} kt) opposing the north-setting Stream — seas steepen well beyond the open-water forecast`
        : `Stream crossing in non-opposing wind — add ~2.5 kt set to navigation, moderate chop`,
    });
    if (northerly) mitigations.push('Never cross the Stream in wind with any northerly component — wait for E–SE ≤ 10 kt');
  }

  // 4) Fuel margin
  const fm = inputs.fuel_margin_ratio;
  const fuelPts = fm >= 1.5 ? 0 : fm >= 1.2 ? 5 : fm >= 1.0 ? 12 : 25;
  c.push({
    name: 'fuel_margin', points: fuelPts, max: 25,
    detail: fm >= 10 ? `ample fuel — over 10× this route's requirement on board`
      : fm >= 1 ? `${Math.round((fm - 1) * 100)}% fuel beyond requirement under your reserve policy`
      : `SHORT: only ${Math.round(fm * 100)}% of required fuel available under reserve`,
  });
  if (fuelPts >= 12) mitigations.push('Carry certified auxiliary fuel or plan a refuel stop — running the reserve is not a plan');

  // 5) Piracy
  const pir = piracyExposure(inputs.waypoints);
  const pirPts = pir.level * 8;
  c.push({
    name: 'piracy', points: pirPts, max: 24,
    detail: pir.level === 0
      ? 'No reported piracy or armed-robbery activity on this route (IMB annual data, demo snapshot) — normal vigilance'
      : `Route crosses: ${pir.regions.map(r => `${r.name} (level ${r.level})`).join('; ')}`,
  });
  if (pir.level >= 2) mitigations.push('Reroute or join a convoy; register with local reporting authorities; review IMB live alerts before departure');

  const score = Math.min(100, c.reduce((s, x) => s + x.points, 0));
  const band: RiskBand = score <= 15 ? 'low' : score <= 35 ? 'moderate' : score <= 60 ? 'elevated' : 'high';

  const reasoning: ReasoningStep[] = c.map(x => ({
    rule: `risk:${x.name}`,
    detail: `${x.detail} → ${x.points}/${x.max} pts`,
    source: x.name === 'piracy' ? 'imb:2025-annual (demo snapshot)' : x.name === 'conditions' || x.name === 'gulf_stream' ? (inputs.data_vintage['weather'] ?? 'weather:unknown') : `vessel:${v.name}/profile`,
  }));

  return explanation<RiskAssessment>(inputs, {
    recommendation: { score, band, components: c, mitigations },
    confidence: 'medium',
    confidence_factors: ['risk weights are v1 heuristics pending calibration against outcome data (Trust Metrics §2)'],
    reasoning,
    alternatives: [],
    caveats: [
      'Risk scoring is a structured judgment, not a probability — it cannot see local knowledge, crew experience, or vessel condition',
      'Piracy data is a demo snapshot shaped like IMB annual reporting; live IMB alerts are a future registered source',
      'The captain decides. This assessment informs the decision; it never makes it',
    ],
    data_vintage: inputs.data_vintage,
    degraded: false,
    degraded_reasons: [],
  });
}
