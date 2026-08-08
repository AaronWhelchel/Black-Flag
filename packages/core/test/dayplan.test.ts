import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessDay, buildChecklist, comfortableSeasFt, VERDICT_RANK,
  DayConditions, DayVessel, Activity,
} from '../src/dayplan.js';

const t16: DayVessel = { name: 'Tahoe T16', loa_ft: 16 };
const cruiser: DayVessel = { name: 'Restless-31', loa_ft: 31, max_seas_ft: 5 };

const calm: DayConditions = { wind_kn: 4, chop_ft: 0.2, air_temp_f: 84, precip_pct: 5 };

test('a calm summer day is a good day, and says why in numbers', () => {
  const a = assessDay(calm, t16, ['skiing', 'tubing', 'fishing']);
  assert.equal(a.verdict, 'good');
  assert.match(a.headline, /Good day/);
  assert.ok(a.reasons.join(' ').match(/\d/), 'reasons must carry numbers');
  assert.equal(a.perActivity.length, 3);
});

test('lightning is the one hard stop, whatever else is true', () => {
  const a = assessDay({ ...calm, thunder: true }, cruiser, ['cruising']);
  assert.equal(a.verdict, 'unsafe');
  assert.match(a.reasons.join(' '), /[Tt]hunderstorm/);
  // and it overrides a perfect forecast in every other respect
  assert.ok(a.perActivity.every(p => p.verdict === 'unsafe'));
});

test('the same day is different for a 16 ft runabout and a 31 ft cruiser', () => {
  const blowy: DayConditions = { wind_kn: 16, gust_kn: 22, chop_ft: 2.2, air_temp_f: 78 };
  const small = assessDay(blowy, t16, ['cruising']);
  const big = assessDay(blowy, cruiser, ['cruising']);
  assert.ok(VERDICT_RANK[small.verdict] < VERDICT_RANK[big.verdict],
    `small boat should fare worse: ${small.verdict} vs ${big.verdict}`);
  assert.match(small.vesselNote ?? '', /Tahoe T16|16 ft/);
});

test('the day is judged by what you actually plan to do', () => {
  const breezy: DayConditions = { wind_kn: 12, chop_ft: 0.9, air_temp_f: 80 };
  const skiing = assessDay(breezy, t16, ['skiing']);
  const fishing = assessDay(breezy, t16, ['fishing']);
  assert.ok(VERDICT_RANK[skiing.verdict] < VERDICT_RANK[fishing.verdict],
    'chop that spoils skiing is fine for fishing');
});

test('the breakdown says which plan is the problem, so one can be dropped', () => {
  const breezy: DayConditions = { wind_kn: 12, chop_ft: 0.9, air_temp_f: 80 };
  const a = assessDay(breezy, t16, ['fishing', 'skiing']);
  const ski = a.perActivity.find(p => p.activity === 'skiing')!;
  const fish = a.perActivity.find(p => p.activity === 'fishing')!;
  assert.ok(VERDICT_RANK[ski.verdict] < VERDICT_RANK[fish.verdict]);
  assert.equal(a.verdict, ski.verdict, 'the day is as good as its worst plan');
});

test('sailing needs wind rather than merely tolerating it', () => {
  const glass = assessDay({ wind_kn: 2, chop_ft: 0.1, air_temp_f: 80 }, cruiser, ['sailing']);
  assert.ok(VERDICT_RANK[glass.verdict] < 3);
  assert.match(glass.reasons.join(' '), /not enough to sail/i);
  const nice = assessDay({ wind_kn: 12, chop_ft: 1, air_temp_f: 78 }, cruiser, ['sailing']);
  assert.equal(nice.verdict, 'good');
});

test('cold water and cold air matter when the plan gets you wet', () => {
  const cold: DayConditions = { wind_kn: 5, chop_ft: 0.2, air_temp_f: 52, water_temp_f: 55 };
  assert.ok(VERDICT_RANK[assessDay(cold, t16, ['swimming']).verdict] < 3);
  assert.equal(assessDay(cold, t16, ['fishing']).verdict, 'good', 'fishing in a jacket is fine');
});

test('a better day scores higher, so alternatives can be ranked', () => {
  const here = assessDay({ wind_kn: 18, chop_ft: 1.8, air_temp_f: 80 }, t16, ['tubing']);
  const there = assessDay({ wind_kn: 6, chop_ft: 0.3, air_temp_f: 80 }, t16, ['tubing']);
  assert.ok(there.score > here.score);
});

test('comfortable seas come from the captain first, length second', () => {
  assert.equal(comfortableSeasFt({ loa_ft: 31, max_seas_ft: 5 }), 5);
  assert.ok(comfortableSeasFt({ loa_ft: 16 }) < comfortableSeasFt({ loa_ft: 31 }));
  assert.ok(comfortableSeasFt({ loa_ft: 10 }) <= 1, 'a kayak is not a boat for chop');
});

// ---- checklists ----------------------------------------------------------

test('shared items appear once, and gear you do not need never appears', () => {
  const list = buildChecklist(['tubing', 'fishing']);
  const ids = list.map(i => i.id);
  assert.equal(ids.filter(i => i === 'fuel').length, 1, 'fuel listed once');
  assert.equal(ids.filter(i => i === 'ski-flag').length, 1, 'the flag both tows need, once');
  assert.ok(ids.includes('bait'), 'fishing brings bait');
  assert.ok(ids.includes('tube'));
  const tubingOnly = buildChecklist(['tubing']).map(i => i.id);
  assert.ok(!tubingOnly.includes('bait'), 'no bait if nobody is fishing');
  assert.ok(!tubingOnly.includes('license'));
});

test('the boring universal items are always there — the drain plug especially', () => {
  for (const acts of [[], ['fishing'], ['skiing', 'swimming']] as Activity[][]) {
    const ids = buildChecklist(acts).map(i => i.id);
    for (const must of ['drain-plug', 'pfd', 'ext', 'fuel', 'floatplan']) {
      assert.ok(ids.includes(must), `${must} missing for ${JSON.stringify(acts)}`);
    }
  }
});

test('the forecast earns its own items', () => {
  const wet = buildChecklist(['fishing'], { wind_kn: 5, precip_pct: 70, air_temp_f: 58 }).map(i => i.id);
  assert.ok(wet.includes('rain'));
  assert.ok(wet.includes('layers'));
  const dry = buildChecklist(['fishing'], { wind_kn: 5, precip_pct: 0, air_temp_f: 85 }).map(i => i.id);
  assert.ok(!dry.includes('rain'));
  assert.ok(!dry.includes('layers'));
});

test('checklist groups come out in the order you use them', () => {
  const list = buildChecklist(['fishing']);
  const first = list[0].group;
  assert.equal(first, 'Before the ramp', `got ${first}`);
});
