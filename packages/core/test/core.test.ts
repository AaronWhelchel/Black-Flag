import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  burnAtSpeed, weatherAdjustment, headwindComponent,
  estimateFuel, roughInletWindows, isRoughAt, recommendDeparture, evaluateDeparture,
  inputsHash,
} from '../src/index.js';
import { scenario, vessel } from './fixtures.js';

// ---------- engine curve ----------

test('burnAtSpeed is exact at curve points and monotonic between', () => {
  assert.equal(burnAtSpeed(vessel.engine_curve, 14.0).gph, 13.5);
  assert.equal(burnAtSpeed(vessel.engine_curve, 22.0).gph, 22.5);
  const mid = burnAtSpeed(vessel.engine_curve, 16.0).gph;
  assert.ok(mid > 13.5 && mid < 17.0, `interpolated ${mid} out of bounds`);
});

test('burnAtSpeed flags out-of-envelope speeds instead of extrapolating', () => {
  const r = burnAtSpeed(vessel.engine_curve, 35);
  assert.equal(r.inEnvelope, false);
  assert.equal(r.gph, 30.0); // clamped to curve max, never invented
});

// ---------- weather physics ----------

test('headwind raises burn, tailwind relieves it, envelope enforced', () => {
  const head = weatherAdjustment({ headwindKn: 15, seasFt: 3, seasRelation: 'head' });
  const tail = weatherAdjustment({ headwindKn: -15, seasFt: 3, seasRelation: 'follow' });
  assert.ok(head.factor > 1.1, `head factor ${head.factor}`);
  assert.ok(tail.factor < 1.0, `tail factor ${tail.factor}`);
  assert.equal(weatherAdjustment({ headwindKn: 35, seasFt: 3, seasRelation: 'head' }).inEnvelope, false);
});

test('headwindComponent geometry', () => {
  assert.ok(Math.abs(headwindComponent(10, 68, 68) - 10) < 1e-9);   // dead on the nose
  assert.ok(Math.abs(headwindComponent(10, 248, 68) + 10) < 1e-9);  // dead astern
  assert.ok(Math.abs(headwindComponent(10, 158, 68)) < 1e-9);       // pure beam
});

// ---------- fuel ----------

test('fuel estimate: weather costs fuel vs calm, and explanation is complete', () => {
  const calmWx = scenario.legs.map(() => ({ wind_kn: 0, wind_from_deg: 0, seas_ft: 0, seas_from_deg: 0 }));
  const windyWx = scenario.legs.map(l => ({ wind_kn: 18, wind_from_deg: l.course_deg, seas_ft: 4, seas_from_deg: l.course_deg }));
  const base = { legs: scenario.legs, cruise_kn: 17, vessel, data_vintage: scenario.data_vintage, forecast_age_hours: 1 };
  const calm = estimateFuel({ ...base, wx_by_leg: calmWx });
  const windy = estimateFuel({ ...base, wx_by_leg: windyWx });
  assert.ok(windy.recommendation.fuel_required.value > calm.recommendation.fuel_required.value);
  for (const e of [calm, windy]) {
    assert.ok(e.caveats.length > 0, 'caveats required');
    assert.ok(e.reasoning.some(r => r.rule === 'fuel_margin'));
    assert.equal(e.recommendation.fuel_required.unit, 'gal');
    assert.ok(Number.isInteger(e.recommendation.fuel_required.value), 'no false precision (Standard §9)');
  }
});

// ---------- tidal gate ----------

test('ebb against SE swell closes the inlet until slack; flood does not', () => {
  const windows = roughInletWindows(scenario.tide_events, scenario.swell, scenario.inlet_faces_deg);
  assert.ok(windows.length >= 1);
  assert.match(windows[0].until, /09:20/);
  assert.ok(isRoughAt(windows, '2026-08-04T08:00-04:00'), 'mid-ebb should be rough');
  assert.equal(isRoughAt(windows, '2026-08-04T10:00-04:00'), null, 'after slack should be settled');
  // Small, short-period chop from the same direction does not trigger the gate.
  const calm = roughInletWindows(scenario.tide_events, { from_deg: 135, height_ft: 1.5, period_s: 5 }, scenario.inlet_faces_deg);
  assert.equal(calm.length, 0);
});

// ---------- departure recommendation (the Dana scenario) ----------

test('recommends a post-slack departure over the rough-inlet dawn options', () => {
  const rec = recommendDeparture(scenario);
  const dep = rec.recommendation.depart_at;
  assert.match(dep, /T(09:30|10:00)/, `expected post-slack departure, got ${dep}`);
  assert.equal(rec.recommendation.inlet_state, 'settled');
  assert.equal(rec.recommendation.within_limits, true);
  assert.ok(rec.recommendation.fuel.recommendation.margin_ok);
  // The tidal gate must be part of the stated reasoning, sourced to CO-OPS.
  const gate = rec.reasoning.find(r => r.rule === 'tidal_gate');
  assert.ok(gate, 'tidal_gate reasoning step required');
  assert.match(gate!.source, /co-ops/);
  // Early options must appear as alternatives with the inlet named as the reason.
  assert.ok(rec.alternatives.some(a => /inlet rough/.test(a.rejected_because)));
});

test('early departure is individually evaluated as rough at the inlet', () => {
  const early = evaluateDeparture(scenario, '2026-08-04T06:30-04:00');
  assert.equal(early.inlet_state, 'rough');
  assert.equal(early.within_limits, false);
});

// ---------- confidence & degradation ----------

test('stale forecast degrades the answer and lowers confidence — honestly', () => {
  const stale = { ...scenario, forecast_age_hours: 15 };
  const rec = recommendDeparture(stale);
  assert.equal(rec.degraded, true);
  assert.equal(rec.confidence, 'low');
  assert.ok(rec.degraded_reasons.some(r => /15 h old/.test(r)));
});

test('fresh scenario earns at most its horizon: medium for a passage this long', () => {
  const rec = recommendDeparture(scenario);
  assert.ok(['high', 'medium'].includes(rec.confidence));
  assert.ok(rec.confidence_factors.length >= 3);
});

// ---------- determinism & the ledger contract ----------

test('same inputs → identical output, bit for bit (reproducibility, Standard §5)', () => {
  const a = recommendDeparture(scenario);
  const b = recommendDeparture(scenario);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.inputs_hash, inputsHash(scenario));
  assert.equal(a.core_version, '0.1.0');
});

test('every explanation carries vintage for every declared source', () => {
  const rec = recommendDeparture(scenario);
  for (const k of ['weather', 'tides', 'vessel']) assert.ok(rec.data_vintage[k], `missing vintage: ${k}`);
});
