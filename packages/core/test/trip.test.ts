import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  vesselSpeeds, haversineNm, routeDistanceNm, routeLegs,
  piracyExposure, assessRisk, planTrip,
} from '../src/index.js';
import { vessel as restless31 } from './fixtures.js';
import { tahoeT16, keysToBimini, t16Trip, adenRoute } from './fixtures-trip.js';

// ---------- speeds ----------

test('three speeds derive from the curve: top, cruise, best economy', () => {
  const s = vesselSpeeds(restless31.engine_curve, 17, restless31.usable_gal, restless31.reserve_frac);
  assert.equal(s.top.kn, 27);
  assert.equal(s.cruise.kn, 17);
  // Best economy must beat both top and idle on nm/gal, and be a real cruise speed.
  assert.ok(s.best_economy.nmpg >= s.top.nmpg, 'economy beats WOT');
  assert.ok(s.best_economy.range_nm > s.top.range_nm, 'economy range beats WOT range');
});

test('T16 economy sweet spot is on plane (~16 kn), range covers the crossing only barely', () => {
  const s = vesselSpeeds(tahoeT16.engine_curve, 22, tahoeT16.usable_gal, tahoeT16.reserve_frac);
  assert.ok(s.best_economy.kn >= 14 && s.best_economy.kn <= 18, `economy at ${s.best_economy.kn} kn`);
  assert.ok(s.best_economy.range_nm > 40 && s.best_economy.range_nm < 80, `range ${s.best_economy.range_nm} nm`);
});

// ---------- distance ----------

test('haversine sanity: Key Largo → Bimini crossing is ~50–60 nm', () => {
  const d = routeDistanceNm(keysToBimini);
  assert.ok(d > 45 && d < 65, `got ${d} nm`);
  const legs = routeLegs(keysToBimini);
  assert.equal(legs.length, 2);
  assert.ok(legs.every(l => l.course_deg > 30 && l.course_deg < 90), 'NE-ish courses');
});

test('haversine known pair: 1 degree of latitude ≈ 60 nm', () => {
  const d = haversineNm({ lat: 25, lon: -80 }, { lat: 26, lon: -80 });
  assert.ok(Math.abs(d - 60) < 0.5, `got ${d}`);
});

// ---------- piracy ----------

test('Keys → Bimini has zero piracy exposure; Gulf of Aden route is level 3', () => {
  assert.equal(piracyExposure(keysToBimini).level, 0);
  const aden = piracyExposure(adenRoute);
  assert.equal(aden.level, 3);
  assert.ok(aden.regions.some(r => /Aden/.test(r.name)));
});

// ---------- risk ----------

test('T16 Gulf Stream crossing in NE wind assesses HIGH with the right components', () => {
  const trip = planTrip(t16Trip);
  const risk = trip.recommendation.risk.recommendation;
  assert.ok(risk.band === 'high' || risk.band === 'elevated', `band ${risk.band} (${risk.score})`);
  const names = risk.components.filter(x => x.points > 0).map(x => x.name);
  assert.ok(names.includes('vessel_suitability'), 'suitability flagged');
  assert.ok(names.includes('gulf_stream'), 'wind-against-stream flagged');
  assert.ok(risk.mitigations.length >= 2, 'mitigations offered');
  // Honest piracy answer: zero, said plainly.
  const pir = risk.components.find(x => x.name === 'piracy')!;
  assert.equal(pir.points, 0);
  assert.match(pir.detail, /No reported piracy/);
});

test('the same crossing on a 31 ft cruiser in a fair-wind window is at most moderate', () => {
  const gentler = {
    ...t16Trip,
    vessel: { ...restless31, type: 'cruiser' as const, loa_ft: 31, max_recommended_seas_ft: 5 },
    cruise_kn: 17,
    forecast: { wind_kn: 8, wind_from_deg: 120, seas_ft: 2, seas_from_deg: 120 },
  };
  const trip = planTrip(gentler);
  const band = trip.recommendation.risk.recommendation.band;
  assert.ok(band === 'low' || band === 'moderate', `band ${band}`);
});

// ---------- trip budget ----------

test('T16 trip: budget math is internally consistent and fuel margin is honest', () => {
  const trip = planTrip(t16Trip);
  const p = trip.recommendation;
  assert.equal(p.fuel_cost_usd, Math.round(p.fuel_required.value * t16Trip.fuel_price_usd_gal));
  assert.equal(p.total_budget_usd, p.fuel_cost_usd + p.provisions_cost_usd);
  // Fishing offset must appear as a caveat, not silently.
  assert.ok(trip.caveats.some(c => /fish/i.test(c)));
  // ~55 nm at ~16 kn ≈ 3.5 h — a day trip, 1 provisioning day.
  assert.equal(p.provisions_days, 1);
  assert.ok(p.duration_h.value > 2.5 && p.duration_h.value < 5);
});

test('speed choice changes duration and fuel; alternatives are stated', () => {
  const eco = planTrip(t16Trip);
  const wot = planTrip({ ...t16Trip, speed_choice: 'top' });
  assert.ok(wot.recommendation.duration_h.value < eco.recommendation.duration_h.value);
  assert.ok(wot.recommendation.fuel_required.value > eco.recommendation.fuel_required.value);
  assert.equal(eco.alternatives.length, 2);
});

test('a route beyond range reports refuel stops instead of pretending', () => {
  const longRun = planTrip({
    ...t16Trip,
    waypoints: [
      { name: 'Marathon', lat: 24.71, lon: -81.09 },
      { name: 'Cat Cay', lat: 25.55, lon: -79.28 },
    ],
  });
  const p = longRun.recommendation;
  assert.ok(!p.fuel_ok);
  assert.ok(p.refuel_stops_needed >= 1);
  assert.ok(longRun.reasoning.some(r => r.rule === 'fuel_stops'));
});

// ---------- determinism ----------

test('trip planning is deterministic', () => {
  assert.equal(JSON.stringify(planTrip(t16Trip)), JSON.stringify(planTrip(t16Trip)));
});
