/**
 * NDBC ingester — SRC-06 in the Data Governance Register.
 * Fetches realtime2 station files, parses the fixed-column text format,
 * applies R4 quality gates (physical bounds), and emits provenance-stamped
 * observations. Runs in CI/production with plain fetch.
 */

export interface NdbcObs {
  station: string;
  obs_time: string;              // ISO UTC
  wind: { dir_deg: number; spd_ms: number; gst_ms: number | null } | null;
  wvht_m: number | null;
  dpd_s: number | null;
  apd_s: number | null;
  mwd_deg: number | null;
  pres_hpa: number | null;
  atmp_c: number | null;
  wtmp_c: number | null;
}

const num = (s: string): number | null => (s === 'MM' ? null : Number(s));

/** Parse an NDBC realtime2 file (newest row first after two header lines). */
export function parseRealtime2(text: string, station: string): NdbcObs[] {
  const lines = text.trim().split('\n');
  if (lines.length < 3 || !lines[0].startsWith('#YY')) {
    throw new Error(`ndbc:${station}: unrecognized realtime2 header`);
  }
  const out: NdbcObs[] = [];
  for (const line of lines.slice(2)) {
    const c = line.trim().split(/\s+/);
    if (c.length < 15) continue;
    const [yy, mo, dy, hh, mn, wdir, wspd, gst, wvht, dpd, apd, mwd, pres, atmp, wtmp] = c;
    const dir = num(wdir), spd = num(wspd);
    out.push({
      station,
      obs_time: `${yy}-${mo}-${dy}T${hh}:${mn}Z`,
      wind: dir !== null && spd !== null ? { dir_deg: dir, spd_ms: spd, gst_ms: num(gst) } : null,
      wvht_m: num(wvht), dpd_s: num(dpd), apd_s: num(apd), mwd_deg: num(mwd),
      pres_hpa: num(pres), atmp_c: num(atmp), wtmp_c: num(wtmp),
    });
  }
  return out;
}

/** R4 quality gate: physically impossible readings quarantine the record. */
export function gateObs(o: NdbcObs): { ok: boolean; violations: string[] } {
  const v: string[] = [];
  if (o.wind && (o.wind.spd_ms < 0 || o.wind.spd_ms > 103)) v.push(`wind ${o.wind.spd_ms} m/s out of bounds`);
  if (o.wind && (o.wind.dir_deg < 0 || o.wind.dir_deg > 360)) v.push(`wind dir ${o.wind.dir_deg} out of bounds`);
  if (o.wvht_m !== null && (o.wvht_m < 0 || o.wvht_m > 30)) v.push(`wvht ${o.wvht_m} m out of bounds`);
  if (o.pres_hpa !== null && (o.pres_hpa < 870 || o.pres_hpa > 1085)) v.push(`pressure ${o.pres_hpa} out of bounds`);
  if (o.wtmp_c !== null && (o.wtmp_c < -2.5 || o.wtmp_c > 40)) v.push(`water temp ${o.wtmp_c} out of bounds`);
  return { ok: v.length === 0, violations: v };
}

export async function fetchStation(station: string): Promise<NdbcObs> {
  const res = await fetch(`https://www.ndbc.noaa.gov/data/realtime2/${station}.txt`);
  if (!res.ok) throw new Error(`ndbc:${station}: HTTP ${res.status}`);
  const rows = parseRealtime2(await res.text(), station);
  if (rows.length === 0) throw new Error(`ndbc:${station}: no data rows`);
  const latest = rows[0];
  const gate = gateObs(latest);
  if (!gate.ok) throw new Error(`ndbc:${station}: quality gate: ${gate.violations.join('; ')}`);
  return latest;
}
