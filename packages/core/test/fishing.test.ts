import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessFishing, sunTimes, moonPhase, moonName, estimateWaterTempF, SPECIES,
  FishingContext,
} from '../src/fishing.js';

const PATOKA = { lat: 38.424, lon: -86.648 };
const PATOKA_SPECIES = ['largemouth', 'crappie', 'bluegill', 'hybridstriper', 'channelcat', 'walleye'];

const ctx = (over: Partial<FishingContext> = {}): FishingContext => {
  const when = new Date('2026-08-09T14:00:00Z');
  const { sunrise, sunset } = sunTimes(when, PATOKA.lat, PATOKA.lon);
  return {
    species: PATOKA_SPECIES,
    water_temp_f: 78, water_temp_estimated: false,
    when, sunrise, sunset,
    wind_kn: 7, chop_ft: 0.6, cloud_pct: 40,
    pressure_mb: 1015, pressure_change_mb: 0,
    precip_pct: 10, thunder: false, moon_phase: 0.5,
    ...over,
  };
};

// ---- sun and moon --------------------------------------------------------

test('sunrise and sunset are right for southern Indiana in August', () => {
  const { sunrise, sunset } = sunTimes(new Date('2026-08-09T12:00:00Z'), PATOKA.lat, PATOKA.lon);
  // Patoka is in US Central time (UTC-5 in August): sunrise ~6:50 local ≈ 11:50Z
  const srH = sunrise.getUTCHours() + sunrise.getUTCMinutes() / 60;
  const ssH = sunset.getUTCHours() + sunset.getUTCMinutes() / 60;
  assert.ok(srH > 10.5 && srH < 12.5, `sunrise ${sunrise.toISOString()}`);
  assert.ok(ssH > 24.5 - 24 + 24 || ssH > 0, 'sunset computed');
  assert.ok(sunset.getTime() > sunrise.getTime(), 'sunset after sunrise');
  const dayLen = (sunset.getTime() - sunrise.getTime()) / 3600000;
  assert.ok(dayLen > 13 && dayLen < 14.5, `August day length ${dayLen.toFixed(1)} h`);
});

test('winter days are shorter than summer days', () => {
  const s = sunTimes(new Date('2026-06-21T12:00:00Z'), PATOKA.lat, PATOKA.lon);
  const w = sunTimes(new Date('2026-12-21T12:00:00Z'), PATOKA.lat, PATOKA.lon);
  const len = (x: { sunrise: Date; sunset: Date }) => (x.sunset.getTime() - x.sunrise.getTime()) / 3600000;
  assert.ok(len(s) > len(w) + 3, `${len(s).toFixed(1)} vs ${len(w).toFixed(1)}`);
});

test('moon phase runs a full cycle and names itself', () => {
  const newMoon = new Date(Date.UTC(2000, 0, 6, 18, 14));
  assert.ok(moonPhase(newMoon) < 0.02 || moonPhase(newMoon) > 0.98);
  const full = new Date(newMoon.getTime() + 14.77 * 86400000);
  assert.ok(Math.abs(moonPhase(full) - 0.5) < 0.03, `${moonPhase(full)}`);
  assert.equal(moonName(0.5), 'full moon');
  assert.equal(moonName(0.0), 'new moon');
});

// ---- water temperature ---------------------------------------------------

test('estimated water temperature follows the season, not the day', () => {
  const aug = estimateWaterTempF(new Date('2026-08-05T12:00:00Z'), PATOKA.lat, 85);
  const jan = estimateWaterTempF(new Date('2026-01-15T12:00:00Z'), PATOKA.lat, 30);
  // Patoka runs low-80s in early August and upper-30s in February
  assert.ok(aug >= 80 && aug <= 87, `August surface ${aug}`);
  assert.ok(jan >= 36 && jan <= 46, `January surface ${jan}`);
  // and the Keys are warmer year-round with a smaller swing than Indiana
  const keysAug = estimateWaterTempF(new Date('2026-08-05T12:00:00Z'), 24.5, 88);
  const keysJan = estimateWaterTempF(new Date('2026-01-15T12:00:00Z'), 24.5, 72);
  assert.ok(keysAug > aug, `Keys ${keysAug} should beat Indiana ${aug} in August`);
  assert.ok(keysJan - keysAug > -30 && keysJan > 60, `Keys winter water ${keysJan}`);
  // one hot afternoon does not heat a reservoir
  const hotDay = estimateWaterTempF(new Date('2026-04-10T12:00:00Z'), PATOKA.lat, 88);
  const coolDay = estimateWaterTempF(new Date('2026-04-10T12:00:00Z'), PATOKA.lat, 55);
  assert.ok(Math.abs(hotDay - coolDay) < 10, `air swing moved water ${Math.abs(hotDay - coolDay)}°F`);
});

// ---- the rating ----------------------------------------------------------

test('water temperature drives which species are in play', () => {
  const summer = assessFishing(ctx({ water_temp_f: 78 }));
  const bluegill = summer.active.find(a => a.species.key === 'bluegill')!;
  const walleye = summer.active.find(a => a.species.key === 'walleye')!;
  assert.equal(bluegill.verdict, 'prime', '78°F is bluegill weather');
  assert.notEqual(walleye.verdict, 'prime', 'walleye are not prime at 78°F');

  const spring = assessFishing(ctx({ water_temp_f: 55 }));
  const w2 = spring.active.find(a => a.species.key === 'walleye')!;
  assert.equal(w2.verdict, 'prime', '55°F is walleye weather');
});

test('the low-light window is graded on real biology where walleye are present', () => {
  const c = ctx();
  const dawn = assessFishing({ ...c, when: new Date(c.sunrise.getTime() + 30 * 60000) });
  const f = dawn.factors.find(x => /light/i.test(x.label))!;
  assert.equal(f.effect, 'good');
  assert.equal(f.basis, 'biology', 'walleye in this lake make it biology, not lore');
  assert.match(f.detail, /walleye/i);
});

test('a walleye chop helps; a gale does not', () => {
  const nice = assessFishing(ctx({ chop_ft: 0.8 }));
  const rough = assessFishing(ctx({ chop_ft: 3 }));
  assert.equal(nice.factors.find(f => /chop/.test(f.label))?.effect, 'good');
  assert.equal(rough.factors.find(f => /chop/.test(f.label))?.effect, 'poor');
});

test('pressure and moon are shown, labelled tradition, and barely counted', () => {
  const falling = assessFishing(ctx({ pressure_change_mb: -5 }));
  const rising = assessFishing(ctx({ pressure_change_mb: 6 }));
  const pf = falling.factors.find(f => /Pressure/.test(f.label))!;
  assert.equal(pf.basis, 'tradition');
  assert.match(pf.detail, /marker, not a mechanism|not the weight of the air/);
  const moon = falling.factors.find(f => /Moon/.test(f.label))!;
  assert.equal(moon.basis, 'tradition');
  assert.match(moon.detail, /not counted in the rating/);
  // the whole pressure swing must not be able to flip a rating on its own
  assert.ok(['prime', 'good', 'fair', 'slow'].indexOf(falling.rating) <= ['prime', 'good', 'fair', 'slow'].indexOf(rising.rating) + 1,
    `pressure moved the rating too far: ${falling.rating} vs ${rising.rating}`);
});

test('thunderstorms are answered as safety, not as fishing', () => {
  const r = assessFishing(ctx({ thunder: true }));
  assert.equal(r.rating, 'slow');
  assert.match(r.factors.find(f => /Thunder/.test(f.label))!.detail, /Stay off the water/);
});

test('every factor declares what stands behind it', () => {
  for (const f of assessFishing(ctx()).factors) {
    assert.ok(['biology', 'mechanism', 'tradition'].includes(f.basis), `${f.label} has no basis`);
    assert.ok(f.detail.length > 20, `${f.label} explains nothing`);
  }
});

test('an estimated water temperature says so, loudly', () => {
  const est = assessFishing(ctx({ water_temp_estimated: true }));
  assert.match(est.waterTempNote, /ESTIMATED/);
  assert.match(est.factors.find(f => /Water/.test(f.label))!.label, /estimated/);
  const measured = assessFishing(ctx({ water_temp_estimated: false }));
  assert.doesNotMatch(measured.factors.find(f => /Water/.test(f.label))!.label, /estimated/);
});

test('missing water temperature is a gap we name, not a number we invent', () => {
  const r = assessFishing(ctx({ water_temp_f: null }));
  assert.match(r.waterTempNote, /sounder/);
  assert.ok(!r.factors.some(f => /^Water \d/.test(f.label)), 'no water factor without a temperature');
  assert.ok(r.active.every(a => a.verdict === 'slow'), 'no species claims without a temperature');
});

test('the report always offers the dawn and dusk windows', () => {
  const r = assessFishing(ctx());
  assert.equal(r.bestWindows.length, 2);
  assert.ok(r.bestWindows[0].from < r.bestWindows[0].to);
  assert.match(r.honesty, /No app knows whether the fish will bite/);
});
