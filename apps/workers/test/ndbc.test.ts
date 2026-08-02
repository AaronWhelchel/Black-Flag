import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRealtime2, gateObs } from '../src/ndbc.js';
import { parsePredictions } from '../src/coops.js';

/** Exact format captured live from ndbc.noaa.gov on 2026-08-02. */
const SAMPLE = `#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft
2026 06 01 04 20  MM   MM   MM   1.8     6   4.9 222 1013.0    MM  13.3    MM   MM   MM    MM
2026 05 22 08 42 120  5.1  6.2    MM    MM    MM  MM 1015.9    MM    MM    MM   MM   MM    MM`;

test('parses realtime2 with MM missing values; newest row first', () => {
  const rows = parseRealtime2(SAMPLE, '44025');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].obs_time, '2026-06-01T04:20Z');
  assert.equal(rows[0].wind, null);                 // sensors down ≠ calm
  assert.equal(rows[0].wvht_m, 1.8);
  assert.equal(rows[0].pres_hpa, 1013.0);
  assert.deepEqual(rows[1].wind, { dir_deg: 120, spd_ms: 5.1, gst_ms: 6.2 });
});

test('quality gate rejects physically impossible readings', () => {
  const rows = parseRealtime2(SAMPLE, 'x');
  assert.equal(gateObs(rows[0]).ok, true);
  assert.equal(gateObs({ ...rows[0], wvht_m: 45 }).ok, false);
  assert.equal(gateObs({ ...rows[1], wind: { dir_deg: 120, spd_ms: 200, gst_ms: null } }).ok, false);
});

test('rejects unrecognized headers instead of guessing', () => {
  assert.throws(() => parseRealtime2('junk\nmore junk\n1 2 3', 'x'));
});

/** Exact payload captured live from api.tidesandcurrents.noaa.gov on 2026-08-02. */
const COOPS = { predictions: [
  { t: '2026-08-04 04:06', v: '1.012', type: 'H' },
  { t: '2026-08-04 10:43', v: '0.284', type: 'L' },
  { t: '2026-08-04 16:40', v: '0.969', type: 'H' },
  { t: '2026-08-04 23:06', v: '0.396', type: 'L' },
] };

test('parses CO-OPS hilo predictions and gates implausible levels', () => {
  const ev = parsePredictions(COOPS, '8533051');
  assert.equal(ev.length, 4);
  assert.deepEqual(ev[1], { t: '10:43', v_ft: 0.284, type: 'L' });
  assert.throws(() => parsePredictions({ predictions: [{ t: '2026-08-04 04:06', v: '99', type: 'H' }, { t: '2026-08-04 10:43', v: '0.2', type: 'L' }] }, 'x'));
});
