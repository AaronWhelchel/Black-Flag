import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoRoute, estimateFetchLimitedWaves, haversineNm } from '../src/index.js';

// ---------- fetch-limited waves ----------

test('lake chop estimate matches hand-computed SMB values and scales sanely', () => {
  // 19 kt over ~1.6 nm of open water ≈ 1.3 ft (hand-computed)
  const e = estimateFetchLimitedWaves(19, 1.62);
  assert.ok(Math.abs(e.seas_ft - 1.3) <= 0.2, `got ${e.seas_ft}`);
  // more wind or more fetch → more wave, always
  assert.ok(estimateFetchLimitedWaves(30, 1.62).seas_ft > e.seas_ft);
  assert.ok(estimateFetchLimitedWaves(19, 5).seas_ft > e.seas_ft);
  // envelope honesty
  assert.equal(estimateFetchLimitedWaves(50, 1).in_envelope, false);
  assert.match(e.detail, /estimate, not a forecast/);
});

// ---------- auto-routing over synthetic water masks ----------

/** Water everywhere except a vertical wall at lon≈0 with a gap at lat≈0.05. */
const wallWithGap = (lat: number, lon: number) => {
  const inWall = Math.abs(lon) < 0.01;
  const inGap = Math.abs(lat - 0.05) < 0.012;
  return !inWall || inGap;
};

test('routes through the only gap in a wall, never through the wall', () => {
  const r = autoRoute({ lat: 0, lon: -0.1 }, { lat: 0, lon: 0.1 }, wallWithGap, { resolution: 140 });
  assert.equal(r.ok, true, r.reason ?? 'failed');
  // Every densely-sampled point along every leg must be walkable.
  for (let i = 0; i < r.waypoints.length - 1; i++) {
    const a = r.waypoints[i], b = r.waypoints[i + 1];
    for (let s = 0; s <= 40; s++) {
      const lat = a.lat + ((b.lat - a.lat) * s) / 40;
      const lon = a.lon + ((b.lon - a.lon) * s) / 40;
      assert.ok(wallWithGap(lat, lon), `leg ${i} crosses the wall at ${lat},${lon}`);
    }
  }
  // The path must actually deviate north toward the gap.
  assert.ok(r.waypoints.some(w => w.lat > 0.03), 'expected detour via the gap');
});

test('an island in the way costs extra distance; open water does not', () => {
  const island = (lat: number, lon: number) => !(Math.abs(lat) < 0.03 && Math.abs(lon) < 0.03);
  const around = autoRoute({ lat: 0, lon: -0.1 }, { lat: 0, lon: 0.1 }, island, { resolution: 140 });
  const open = autoRoute({ lat: 0, lon: -0.1 }, { lat: 0, lon: 0.1 }, () => true, { resolution: 140 });
  assert.ok(around.ok && open.ok);
  const direct = haversineNm({ lat: 0, lon: -0.1 }, { lat: 0, lon: 0.1 });
  assert.ok(open.dist_nm! <= direct * 1.05, `open ${open.dist_nm} vs direct ${direct}`);
  assert.ok(around.dist_nm! > open.dist_nm!, 'island detour must cost distance');
});

test('fully blocked water reports honestly instead of inventing a path', () => {
  const blockedWall = (lat: number, lon: number) => Math.abs(lon) >= 0.01; // wall, no gap
  const r = autoRoute({ lat: 0, lon: -0.1 }, { lat: 0, lon: 0.1 }, blockedWall, { resolution: 120 });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /no navigable path/);
});

test('endpoint on a blocked cell snaps to nearby water and says so', () => {
  const shore = (lat: number, lon: number) => lon > -0.095;   // start sits just on land
  const r = autoRoute({ lat: 0, lon: -0.1 }, { lat: 0, lon: 0.1 }, shore, { resolution: 120 });
  assert.equal(r.ok, true);
  assert.equal(r.snapped_start, true);
});

test('auto-routing is deterministic', () => {
  const a = autoRoute({ lat: 0, lon: -0.1 }, { lat: 0, lon: 0.1 }, wallWithGap, { resolution: 140 });
  const b = autoRoute({ lat: 0, lon: -0.1 }, { lat: 0, lon: 0.1 }, wallWithGap, { resolution: 140 });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
