import { Explanation, ReasoningStep, explanation, Confidence } from './types.js';
import { estimateFuel, FuelInputs, FuelEstimate, Leg, LegWeather, VesselFuelProfile } from './fuel.js';
import { RoughWindow, TideEvent, Swell, roughInletWindows, isRoughAt } from './tide.js';
import { fmtTime } from './geo.js';

/** One hour of forecast at the route's start area. ISO local times. */
export interface HourlyWx {
  time: string;
  wind_kn: number;
  wind_from_deg: number;
  gust_kn: number;
  seas_ft: number;
  seas_from_deg: number;
}

export interface CaptainLimits {
  max_wind_kn: number;
  max_seas_ft: number;
  /** Latest acceptable arrival, ISO local (daylight, crew, dinner reservations…) */
  arrive_by: string;
}

export interface DepartureInputs {
  candidates: string[];            // ISO local times to evaluate
  forecast: HourlyWx[];
  forecast_issued: string;
  forecast_age_hours: number;
  tide_events: TideEvent[];
  swell: Swell;
  inlet_faces_deg: number;
  inlet_transit_minutes: number;
  legs: Leg[];
  cruise_kn: number;
  vessel: VesselFuelProfile;
  limits: CaptainLimits;
  data_vintage: Record<string, string>;
}

export interface DepartureWindow {
  depart_at: string;
  arrive_at: string;
  fuel: Explanation<FuelEstimate>;
  inlet_state: 'settled' | 'rough';
  max_wind_underway_kn: number;
  max_seas_underway_ft: number;
  within_limits: boolean;
  score: number;
}

const toMin = (iso: string): number => {
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0;
};
const addMinutes = (iso: string, mins: number): string => {
  const t = toMin(iso) + mins;
  const hh = String(Math.floor(t / 60) % 24).padStart(2, '0');
  const mm = String(t % 60).padStart(2, '0');
  return `${iso.slice(0, 11)}${hh}:${mm}${iso.slice(16)}`;
};

function wxAt(forecast: HourlyWx[], iso: string): HourlyWx {
  const t = toMin(iso);
  let best = forecast[0];
  for (const h of forecast) if (Math.abs(toMin(h.time) - t) < Math.abs(toMin(best.time) - t)) best = h;
  return best;
}

export function evaluateDeparture(inputs: DepartureInputs, departAt: string): DepartureWindow {
  const rough = roughInletWindows(inputs.tide_events, inputs.swell, inputs.inlet_faces_deg);
  const inletHit = isRoughAt(rough, addMinutes(departAt, Math.round(inputs.inlet_transit_minutes / 2)));

  // Sample conditions across the passage for each leg (legs assumed sequential).
  const totalNm = inputs.legs.reduce((s, l) => s + l.dist_nm, 0);
  const hoursTotal = totalNm / inputs.cruise_kn;
  let elapsedNm = 0;
  const wxByLeg: LegWeather[] = inputs.legs.map(l => {
    const midNm = elapsedNm + l.dist_nm / 2;
    elapsedNm += l.dist_nm;
    const at = addMinutes(departAt, Math.round((midNm / inputs.cruise_kn) * 60));
    const w = wxAt(inputs.forecast, at);
    return { wind_kn: w.wind_kn, wind_from_deg: w.wind_from_deg, seas_ft: w.seas_ft, seas_from_deg: w.seas_from_deg };
  });

  const fuelInputs: FuelInputs = {
    legs: inputs.legs, cruise_kn: inputs.cruise_kn, wx_by_leg: wxByLeg,
    vessel: inputs.vessel, data_vintage: inputs.data_vintage, forecast_age_hours: inputs.forecast_age_hours,
  };
  const fuel = estimateFuel(fuelInputs);

  const arriveAt = addMinutes(departAt, Math.round(hoursTotal * 60) + inputs.inlet_transit_minutes);
  const under = inputs.forecast.filter(h => toMin(h.time) >= toMin(departAt) && toMin(h.time) <= toMin(arriveAt));
  const maxWind = Math.max(...under.map(h => h.wind_kn), 0);
  const maxSeas = Math.max(...under.map(h => h.seas_ft), 0);

  const withinLimits =
    !inletHit &&
    maxWind <= inputs.limits.max_wind_kn &&
    maxSeas <= inputs.limits.max_seas_ft &&
    toMin(arriveAt) <= toMin(inputs.limits.arrive_by) &&
    fuel.recommendation.margin_ok;

  // Score: lower is better. Weighted, documented, deterministic.
  let score = 0;
  if (inletHit) score += 100;
  score += Math.max(0, maxWind - inputs.limits.max_wind_kn) * 8;
  score += Math.max(0, maxSeas - inputs.limits.max_seas_ft) * 12;
  score += Math.max(0, toMin(arriveAt) - toMin(inputs.limits.arrive_by)) * 0.5;
  score += Math.max(0, -fuel.recommendation.margin.value) * 2;
  score += fuel.recommendation.fuel_required.value * 0.05;  // mild preference for cheaper windows
  score += maxWind * 0.4 + maxSeas * 1.5;                    // mild comfort preference

  return {
    depart_at: departAt, arrive_at: arriveAt, fuel,
    inlet_state: inletHit ? 'rough' : 'settled',
    max_wind_underway_kn: maxWind, max_seas_underway_ft: maxSeas,
    within_limits: withinLimits, score: Math.round(score * 10) / 10,
  };
}

export function recommendDeparture(inputs: DepartureInputs): Explanation<DepartureWindow> {
  const rough = roughInletWindows(inputs.tide_events, inputs.swell, inputs.inlet_faces_deg);
  const evaluated = inputs.candidates.map(c => evaluateDeparture(inputs, c));
  const viable = evaluated.filter(e => e.within_limits);
  const pool = viable.length > 0 ? viable : evaluated;
  const best = [...pool].sort((a, b) => a.score - b.score)[0];

  const reasoning: ReasoningStep[] = [];
  if (rough.length > 0) {
    const w = rough[0];
    reasoning.push({
      rule: 'tidal_gate',
      detail: `Ebb runs against the swell — the inlet will be rough ${fmtTime(w.from)}–${fmtTime(w.until)} (${w.reason}); settled after slack`,
      source: inputs.data_vintage['tides'] ?? 'tides:unknown',
    });
  }
  const wAtDep = wxAt(inputs.forecast, best.depart_at);
  const later = wxAt(inputs.forecast, addMinutes(best.depart_at, 300));
  reasoning.push({
    rule: 'wind_trend',
    detail: `Wind ${wAtDep.wind_kn} kt at departure, ${later.wind_kn >= wAtDep.wind_kn ? 'building to' : 'easing to'} ${later.wind_kn} kt later in the passage`,
    source: inputs.data_vintage['weather'] ?? 'weather:unknown',
  });
  reasoning.push(...best.fuel.reasoning.filter(r => r.rule === 'fuel_margin'));
  reasoning.push({
    rule: 'limits_check',
    detail: best.within_limits
      ? `Max underway: ${best.max_wind_underway_kn} kt / ${best.max_seas_underway_ft} ft seas — within the limits you set (${inputs.limits.max_wind_kn} kt / ${inputs.limits.max_seas_ft} ft); arrival ${fmtTime(best.arrive_at)} before your ${fmtTime(inputs.limits.arrive_by)} cutoff`
      : `No candidate stayed within your limits — showing the least-bad option as analysis, not a recommendation`,
    source: 'captain:limits',
  });

  // Alternatives answer the captain's real questions — including "why not the
  // tempting dawn start?" — so a rejected-rough candidate is always shown when
  // one exists, even if it scored far from the top.
  const others = evaluated.filter(e => e !== best).sort((a, b) => a.score - b.score);
  const picked = others.slice(0, 3);
  const earliestRough = others
    .filter(e => e.inlet_state === 'rough')
    .sort((a, b) => toMin(a.depart_at) - toMin(b.depart_at))[0];
  if (earliestRough && !picked.includes(earliestRough)) picked[picked.length - 1] = earliestRough;
  const alternatives = picked
    .map(e => ({
      option: { depart_at: e.depart_at, score: e.score } as Partial<DepartureWindow>,
      rejected_because: e.inlet_state === 'rough'
        ? `inlet rough at transit (${fmtTime(e.depart_at)})`
        : !e.fuel.recommendation.margin_ok
          ? 'fuel margin negative under your reserve policy'
          : toMin(e.arrive_at) > toMin(inputs.limits.arrive_by)
            ? `arrives ${fmtTime(e.arrive_at)}, past your cutoff`
            : `scores worse on wind/seas comfort (${e.max_wind_underway_kn} kt / ${e.max_seas_underway_ft} ft)`,
    }));

  const degraded_reasons: string[] = [...best.fuel.degraded_reasons];
  if (inputs.forecast_age_hours > 12) degraded_reasons.push(`forecast is ${Math.round(inputs.forecast_age_hours)} h old (SLO 12 h)`);

  const horizonH = (toMin(best.arrive_at) - toMin(inputs.candidates[0])) / 60 + inputs.forecast_age_hours;
  let confidence: Confidence =
    degraded_reasons.length > 0 || !best.within_limits ? 'low'
    : horizonH > 12 || inputs.vessel.profile_confirmed_days_ago > 60 ? 'medium'
    : 'high';

  return explanation<DepartureWindow>(inputs, {
    recommendation: best,
    confidence,
    confidence_factors: [
      `forecast horizon ~${Math.round(horizonH)} h`,
      `forecast age ${Math.round(inputs.forecast_age_hours)} h`,
      `vessel profile confirmed ${inputs.vessel.profile_confirmed_days_ago} d ago`,
      ...(best.within_limits ? [] : ['no candidate met captain limits']),
    ],
    reasoning,
    alternatives,
    caveats: [
      'Local squall and thermal-gust activity is not resolved by this forecast model',
      'Inlet state estimate assumes typical shoaling; recent dredging or storms change it',
      ...best.fuel.caveats,
    ],
    data_vintage: inputs.data_vintage,
    degraded: degraded_reasons.length > 0,
    degraded_reasons,
  });
}
