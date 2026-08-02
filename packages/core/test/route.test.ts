import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointToLegNm, routeConflicts, suggestDetour, routeDistanceNm } from '../src/index.js';

const wps = [
  { name: 'A', lat: 38.40, lon: -86.70 },
  { name: 'B', lat: 38.40, lon: -86.60 },   // ~4.7 nm due east
];
const midHazard = { id: 'h1', label: 'Low bridge', kind: 'bridge', lat: 38.401, lon: -86.65 };
const farHazard = { id: 'h2', label: 'Far rock', kind: 'rock', lat: 38.46, lon: -86.65 };

test('pointToLegNm: perpendicular distance is honest at leg scale', () => {
  // Hazard 0.001° north of the leg ≈ 0.06 nm
  const { dist_nm } = pointToLegNm(midHazard, wps[0], wps[1]);
  assert.ok(Math.abs(dist_nm - 0.06) < 0.01, `got ${dist_nm}`);
  // Endpoint clamping: a point beyond B measures to B, not to the infinite line
  const past = { lat: 38.40, lon: -86.55 };
  const d2 = pointToLegNm(past, wps[0], wps[1]).dist_nm;
  assert.ok(Math.abs(d2 - 2.35) < 0.1, `got ${d2}`);
});

test('routeConflicts flags near hazards and ignores far ones', () => {
  const conflicts = routeConflicts(wps, [midHazard, farHazard], 0.1);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].hazard.label, 'Low bridge');
  assert.ok(conflicts[0].dist_nm < 0.1);
});

test('suggestDetour clears the hazard, keeps endpoints, and costs little extra distance', () => {
  const res = suggestDetour(wps, [midHazard], 0.1);
  assert.equal(res.resolved, true);
  assert.equal(routeConflicts(res.waypoints, [midHazard], 0.1).length, 0);
  assert.equal(res.waypoints[0].name, 'A');
  assert.equal(res.waypoints[res.waypoints.length - 1].name, 'B');
  assert.ok(res.added >= 1);
  const extra = routeDistanceNm(res.waypoints) - routeDistanceNm(wps);
  assert.ok(extra > 0 && extra < 1, `detour cost ${extra} nm`);
});

test('unresolvable clutter is reported, never hidden', () => {
  // A wall of hazards across every possible detour corridor
  const wall = Array.from({ length: 40 }, (_, i) => ({
    id: `w${i}`, label: `wall${i}`, kind: 'rock',
    lat: 38.34 + (i % 20) * 0.006, lon: -86.65 + Math.floor(i / 20) * 0.004,
  }));
  const res = suggestDetour(wps, wall, 0.4);
  if (!res.resolved) assert.ok(res.remaining.length > 0, 'remaining conflicts must be reported');
  else assert.equal(routeConflicts(res.waypoints, wall, 0.4).length, 0);
});

test('detour is deterministic', () => {
  const a = suggestDetour(wps, [midHazard], 0.1);
  const b = suggestDetour(wps, [midHazard], 0.1);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
