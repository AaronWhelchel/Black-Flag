import { Explanation, ReasoningStep, Quantity, explanation } from './types.js';
import { VesselFuelProfile } from './fuel.js';
import { burnAtSpeed, weatherAdjustment } from './engine.js';
import { headwindComponent } from './geo.js';
import { RouteWaypoint, routeLegs, routeDistanceNm, RouteLeg } from './distance.js';
import { vesselSpeeds, VesselSpeeds } from './speeds.js';
import { RiskVessel, RiskAssessment, assessRisk } from './risk.js';

/**
 * Trip planner & budget — "how much will this passage actually take?"
 * Fuel, time, provisions, money, and an honest risk assessment, in one
 * Explanation the captain can interrogate line by line.
 */

export interface TripVessel extends VesselFuelProfile, RiskVessel {}

export type SpeedChoice = 'top' | 'cruise' | 'best_economy';

export interface TripInputs {
  waypoints: RouteWaypoint[];
  vessel: TripVessel;
  cruise_kn: number;
  speed_choice: SpeedChoice;
  crew: number;
  fuel_price_usd_gal: number;
  provisions_usd_person_day: number;
  /** Plan to fish underway — offsets provisions, never fuel. */
  fishing_offset: boolean;
  forecast: { wind_kn: number; wind_from_deg: number; seas_ft: number; seas_from_deg: number };
  forecast_age_hours: number;
  gulf_stream_crossing: boolean;
  longest_exposed_leg_nm?: number;
  data_vintage: Record<string, string>;
}

export interface TripPlan {
  distance_nm: number;
  legs: RouteLeg[];
  speeds: VesselSpeeds;
  chosen_speed_kn: number;
  duration_h: Quantity;
  fuel_required: Quantity;
  fuel_available: Quantity;
  fuel_ok: boolean;
  refuel_stops_needed: number;
  fuel_cost_usd: number;
  provisions_days: number;
  provisions_cost_usd: number;
  total_budget_usd: number;
  risk: Explanation<RiskAssessment>;
}

const usd = (v: number) => Math.round(v);

export function planTrip(inputs: TripInputs): Explanation<TripPlan> {
  const { vessel, waypoints } = inputs;
  const legs = routeLegs(waypoints);
  const distance = routeDistanceNm(waypoints);
  const speeds = vesselSpeeds(vessel.engine_curve, inputs.cruise_kn, vessel.usable_gal, vessel.reserve_frac);
  const chosen = speeds[inputs.speed_choice];

  const reasoning: ReasoningStep[] = [];
  const degraded_reasons: string[] = [];

  reasoning.push({
    rule: 'route_distance',
    detail: `${distance} nm over ${legs.length} leg${legs.length > 1 ? 's' : ''}: ${legs.map(l => `${l.from}→${l.to} ${l.dist_nm} nm (${String(l.course_deg).padStart(3, '0')}°)`).join(' · ')}`,
    source: 'route:waypoints (great-circle)',
  });
  reasoning.push({
    rule: 'speed_choice',
    detail: `${inputs.speed_choice.replace('_', ' ')}: ${chosen.kn} kn @ ${chosen.gph} gph (${chosen.nmpg} nm/gal) — top ${speeds.top.kn} kn · cruise ${speeds.cruise.kn} kn · best economy ${speeds.best_economy.kn} kn`,
    source: `vessel:${vessel.name}/engine_curve`,
  });

  // Fuel with weather adjustment across the whole route (route-average wx v1).
  const avgCourse = legs.reduce((s, l) => s + l.course_deg * l.dist_nm, 0) / Math.max(distance, 1);
  const head = headwindComponent(inputs.forecast.wind_kn, inputs.forecast.wind_from_deg, avgCourse);
  const adj = weatherAdjustment({
    headwindKn: head, seasFt: inputs.forecast.seas_ft,
    seasRelation: 'head',
  });
  if (!adj.inEnvelope) degraded_reasons.push('forecast conditions outside the fuel model envelope');
  const hours = distance / chosen.kn;
  const required = burnAtSpeed(vessel.engine_curve, chosen.kn).gph * adj.factor * hours;
  const available = vessel.usable_gal * (1 - vessel.reserve_frac);
  const fuelOk = required <= available;
  const refuels = fuelOk ? 0 : Math.ceil(required / available) - 1;

  reasoning.push({
    rule: 'fuel_calc',
    detail: `${Math.round(hours * 10) / 10} h underway · ${Math.round(required)} gal required (weather ${adj.factor >= 1 ? '+' : ''}${Math.round((adj.factor - 1) * 100)}%) vs ${Math.round(available)} gal available under your ${Math.round(vessel.reserve_frac * 100)}% reserve`,
    source: inputs.data_vintage['weather'] ?? 'weather:unknown',
  });
  if (!fuelOk) {
    reasoning.push({
      rule: 'fuel_stops',
      detail: `Range at ${chosen.kn} kn is ~${chosen.range_nm} nm — this route needs ${refuels} refuel stop${refuels > 1 ? 's' : ''} (or auxiliary fuel) to keep your reserve intact`,
      source: `vessel:${vessel.name}/tankage+reserve_policy`,
    });
  }

  // Budget — costs derive from the *displayed* gallons so the captain can
  // reproduce every number on screen with her own calculator (Standard §9).
  const fuelCost = Math.round(required) * inputs.fuel_price_usd_gal;
  const days = Math.max(1, Math.ceil(hours / 8));
  const fishFactor = inputs.fishing_offset ? 0.7 : 1.0;
  const provisions = inputs.crew * days * inputs.provisions_usd_person_day * fishFactor;
  const total = fuelCost + provisions;
  reasoning.push({
    rule: 'budget',
    detail: `Fuel $${usd(fuelCost)} (${Math.round(required)} gal × $${inputs.fuel_price_usd_gal.toFixed(2)}) + provisions $${usd(provisions)} (${inputs.crew} crew × ${days} day${days > 1 ? 's' : ''}${inputs.fishing_offset ? ', fishing offsets ~30% of food' : ''}) = $${usd(total)}`,
    source: 'captain:budget_inputs',
  });

  // Risk (computed always; display is the captain's choice)
  const longestLeg = inputs.longest_exposed_leg_nm ?? Math.max(...legs.map(l => l.dist_nm));
  const risk = assessRisk({
    vessel, waypoints,
    longest_exposed_leg_nm: longestLeg,
    forecast_seas_ft: inputs.forecast.seas_ft,
    forecast_wind_kn: inputs.forecast.wind_kn,
    wind_from_deg: inputs.forecast.wind_from_deg,
    gulf_stream_crossing: inputs.gulf_stream_crossing,
    fuel_margin_ratio: available / Math.max(required, 1),
    data_vintage: inputs.data_vintage,
  });
  reasoning.push({
    rule: 'risk_summary',
    detail: `Risk ${risk.recommendation.band.toUpperCase()} (${risk.recommendation.score}/100) — ${risk.recommendation.components.filter(x => x.points > 0).map(x => x.name).join(', ') || 'no elevated components'}`,
    source: 'core:risk_assessment',
  });

  const stale = inputs.forecast_age_hours > 12;
  if (stale) degraded_reasons.push(`forecast is ${Math.round(inputs.forecast_age_hours)} h old (SLO 12 h)`);

  const confidence = degraded_reasons.length > 0 ? 'low'
    : hours > 12 || inputs.forecast_age_hours > 6 ? 'medium' : 'high';

  const caveats = [
    'Provisioning is an estimate at your stated daily rate — dockage, bait, ice, and customs fees are not yet modeled',
    'Fuel price is your input; marina prices vary widely (a fuel-price data source is on the register roadmap)',
    ...(inputs.fishing_offset ? ['The fishing offset assumes fish cooperate. They are under no obligation to (plan full provisions for safety).'] : []),
    ...risk.caveats.slice(0, 1),
  ];

  return explanation<TripPlan>(inputs, {
    recommendation: {
      distance_nm: distance, legs, speeds, chosen_speed_kn: chosen.kn,
      duration_h: { value: Math.round(hours * 10) / 10, unit: 'h' },
      fuel_required: { value: Math.round(required), unit: 'gal' },
      fuel_available: { value: Math.round(available), unit: 'gal' },
      fuel_ok: fuelOk, refuel_stops_needed: refuels,
      fuel_cost_usd: usd(fuelCost),
      provisions_days: days, provisions_cost_usd: usd(provisions),
      total_budget_usd: usd(total),
      risk,
    },
    confidence,
    confidence_factors: [
      `forecast age ${Math.round(inputs.forecast_age_hours)} h`,
      `passage length ${Math.round(hours)} h`,
      'route-average weather model (per-leg forecast sampling lands with real chart packs)',
    ],
    reasoning,
    alternatives: (['top', 'cruise', 'best_economy'] as SpeedChoice[])
      .filter(s => s !== inputs.speed_choice)
      .map(s => ({
        option: { chosen_speed_kn: speeds[s].kn } as Partial<TripPlan>,
        rejected_because: `${s.replace('_', ' ')} (${speeds[s].kn} kn): ${Math.round(distance / speeds[s].kn * 10) / 10} h, ~${Math.round(burnAtSpeed(vessel.engine_curve, speeds[s].kn).gph * adj.factor * (distance / speeds[s].kn))} gal — not selected`,
      })),
    caveats,
    data_vintage: inputs.data_vintage,
    degraded: degraded_reasons.length > 0,
    degraded_reasons,
  });
}
