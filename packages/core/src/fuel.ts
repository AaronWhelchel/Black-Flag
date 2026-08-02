import { Explanation, Quantity, ReasoningStep, explanation } from './types.js';
import { EngineCurvePoint, burnAtSpeed, weatherAdjustment } from './engine.js';
import { headwindComponent, angleDiff } from './geo.js';

export interface Leg {
  name: string;
  dist_nm: number;
  course_deg: number;
}

export interface LegWeather {
  wind_kn: number;
  wind_from_deg: number;
  seas_ft: number;
  seas_from_deg: number;
}

export interface VesselFuelProfile {
  name: string;
  engine_curve: EngineCurvePoint[];
  usable_gal: number;
  /** Fraction of usable fuel held in reserve, captain-set (e.g. 0.2). */
  reserve_frac: number;
  profile_confirmed_days_ago: number;
}

export interface FuelEstimate {
  fuel_required: Quantity;
  fuel_available: Quantity;   // usable minus reserve
  margin: Quantity;
  margin_ok: boolean;
  hours_underway: Quantity;
}

export interface FuelInputs {
  legs: Leg[];
  cruise_kn: number;
  wx_by_leg: LegWeather[];
  vessel: VesselFuelProfile;
  data_vintage: Record<string, string>;
  forecast_age_hours: number;
}

function seasRelation(seasFromDeg: number, courseDeg: number): 'head' | 'beam' | 'follow' {
  const rel = angleDiff(seasFromDeg, courseDeg);
  if (rel <= 50) return 'head';
  if (rel <= 130) return 'beam';
  return 'follow';
}

/** Display precision capped by input uncertainty: fuel to the gallon (Standard §9). */
const gal = (v: number): Quantity => ({ value: Math.round(v), unit: 'gal' });

export function estimateFuel(inputs: FuelInputs): Explanation<FuelEstimate> {
  const { legs, cruise_kn, wx_by_leg, vessel } = inputs;
  if (legs.length !== wx_by_leg.length) throw new Error('legs and wx_by_leg must align');

  const reasoning: ReasoningStep[] = [];
  const degraded_reasons: string[] = [];
  let totalGal = 0;
  let totalHours = 0;
  let calmGal = 0;

  const base = burnAtSpeed(vessel.engine_curve, cruise_kn);
  if (!base.inEnvelope) degraded_reasons.push(`cruise speed ${cruise_kn} kn is outside the measured engine curve`);

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i], wx = wx_by_leg[i];
    const head = headwindComponent(wx.wind_kn, wx.wind_from_deg, leg.course_deg);
    const rel = seasRelation(wx.seas_from_deg, leg.course_deg);
    const adj = weatherAdjustment({ headwindKn: head, seasFt: wx.seas_ft, seasRelation: rel });
    if (!adj.inEnvelope) degraded_reasons.push(`leg "${leg.name}": conditions outside validated envelope`);

    // Speed made good erodes slightly into head seas; keep simple, documented.
    const sog = Math.max(cruise_kn - Math.max(0, head) * 0.06 - (rel === 'head' ? wx.seas_ft * 0.25 : 0), cruise_kn * 0.6);
    const hours = leg.dist_nm / sog;
    const legGal = base.gph * adj.factor * hours;
    totalGal += legGal;
    totalHours += hours;
    calmGal += base.gph * (leg.dist_nm / cruise_kn);

    const dirWord = head > 3 ? `${Math.round(head)} kn headwind component` : head < -3 ? `${Math.round(-head)} kn tailwind component` : 'little wind along course';
    reasoning.push({
      rule: 'leg_burn',
      detail: `${leg.name}: ${leg.dist_nm} nm at ~${sog.toFixed(1)} kn — ${Math.round(legGal)} gal (${dirWord}, seas ${wx.seas_ft} ft on the ${rel})`,
      source: `vessel:${vessel.name}/engine_curve · wx:leg_${i}`,
    });
  }

  const wxPenalty = totalGal - calmGal;
  if (Math.abs(wxPenalty) >= 1) {
    reasoning.unshift({
      rule: 'wx_adjustment',
      detail: `Forecast conditions ${wxPenalty >= 0 ? 'add' : 'save'} ~${Math.round(Math.abs(wxPenalty))} gal vs calm water`,
      source: inputs.data_vintage['weather'] ?? 'weather:unknown',
    });
  }

  const available = vessel.usable_gal * (1 - vessel.reserve_frac);
  const margin = available - totalGal;
  reasoning.push({
    rule: 'fuel_margin',
    detail: `${Math.round(totalGal)} gal required vs ${Math.round(available)} gal available under your ${Math.round(vessel.reserve_frac * 100)}% reserve`,
    source: `vessel:${vessel.name}/tankage+reserve_policy`,
  });

  const stale = inputs.forecast_age_hours > 12;
  if (stale) degraded_reasons.push(`forecast is ${Math.round(inputs.forecast_age_hours)} h old (SLO 12 h)`);

  const confidence = degraded_reasons.length > 0 ? 'low'
    : inputs.forecast_age_hours > 6 || vessel.profile_confirmed_days_ago > 60 ? 'medium'
    : 'high';

  return explanation<FuelEstimate>(inputs, {
    recommendation: {
      fuel_required: gal(totalGal),
      fuel_available: gal(available),
      margin: gal(margin),
      margin_ok: margin >= 0,
      hours_underway: { value: Math.round(totalHours * 10) / 10, unit: 'h' },
    },
    confidence,
    confidence_factors: [
      `forecast age ${Math.round(inputs.forecast_age_hours)} h`,
      `vessel profile confirmed ${vessel.profile_confirmed_days_ago} d ago`,
      ...(degraded_reasons.length ? ['inputs degraded'] : []),
    ],
    reasoning,
    alternatives: [],
    caveats: [
      'Currents along the route are not yet modeled (v1 limitation)',
      'Burn assumes the loaded displacement your profile states',
    ],
    data_vintage: inputs.data_vintage,
    degraded: degraded_reasons.length > 0,
    degraded_reasons,
  });
}
