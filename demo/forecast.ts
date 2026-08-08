/**
 * Point forecast for a day plan — "what will it be like there, when I go?"
 *
 * Different from the route forecast: this is one place, one departure hour,
 * and the hours either side of it, because a captain leaves at nine and comes
 * home at four and the afternoon is usually the part that gets them.
 *
 * NWS hourly where it exists (all of the US), Open-Meteo everywhere else and
 * as a fallback. Lakes have no wave grid anywhere, so chop is estimated from
 * fetch-limited wave physics and labelled as an estimate, never as forecast.
 */
import { estimateFetchLimitedWaves } from '../packages/core/src/index.js';
import type { DayConditions } from '../packages/core/src/dayplan.js';

export interface HourPoint {
  time: string;            // ISO
  wind_kn: number;
  gust_kn: number | null;
  wind_from_deg: number | null;
  temp_f: number | null;
  precip_pct: number | null;
  thunder: boolean;
  summary: string;
}

export interface PlaceForecast {
  hours: HourPoint[];
  /** conditions at the chosen departure hour, chop already estimated */
  at: DayConditions;
  /** worst of the planned window (departure → +8 h) */
  window: DayConditions;
  now: DayConditions | null;
  provenance: string;
  fetched_at: string;
}

const DIRS: Record<string, number> = { N: 0, NNE: 22, NE: 45, ENE: 67, E: 90, ESE: 112, SE: 135, SSE: 157, S: 180, SSW: 202, SW: 225, WSW: 247, W: 270, WNW: 292, NW: 315, NNW: 337 };
const MPH_TO_KN = 0.868976;

async function get(url: string, ms = 12000): Promise<any> {
  const res = await fetch(url, { headers: { accept: 'application/geo+json' }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const parseWind = (s?: string | null): { kn: number | null; gust: number | null } => {
  if (!s) return { kn: null, gust: null };
  const nums = String(s).match(/\d+/g)?.map(Number) ?? [];
  if (!nums.length) return { kn: null, gust: null };
  // "10 to 15 mph" — plan on the top of the range, not the bottom
  const top = Math.max(...nums);
  return { kn: Math.round(top * MPH_TO_KN), gust: null };
};

const isThunder = (s?: string | null) => /thunder|t-storm|tstm|lightning/i.test(s ?? '');
const isFog = (s?: string | null) => /fog|mist/i.test(s ?? '');

/** Lake chop: no forecast exists anywhere, so it's physics from wind + fetch. */
function chopFor(wind_kn: number, fetchNm: number): number {
  return estimateFetchLimitedWaves(wind_kn, Math.max(0.4, Math.min(12, fetchNm))).seas_ft;
}

function toConditions(h: HourPoint, fetchNm: number, waterTempF?: number | null): DayConditions {
  return {
    wind_kn: h.wind_kn,
    gust_kn: h.gust_kn,
    wind_from_deg: h.wind_from_deg,
    chop_ft: chopFor(Math.max(h.wind_kn, (h.gust_kn ?? 0) * 0.8), fetchNm),
    air_temp_f: h.temp_f,
    water_temp_f: waterTempF ?? null,
    precip_pct: h.precip_pct,
    thunder: h.thunder,
    fog: isFog(h.summary),
    summary: h.summary,
  };
}

/** Worst case across a set of hours — planning is about the window, not the prettiest hour in it. */
function worst(list: DayConditions[]): DayConditions {
  const base = { ...list[0] };
  for (const c of list.slice(1)) {
    if (c.wind_kn > base.wind_kn) { base.wind_kn = c.wind_kn; base.wind_from_deg = c.wind_from_deg; }
    if ((c.gust_kn ?? 0) > (base.gust_kn ?? 0)) base.gust_kn = c.gust_kn;
    if ((c.chop_ft ?? 0) > (base.chop_ft ?? 0)) base.chop_ft = c.chop_ft;
    if ((c.precip_pct ?? 0) > (base.precip_pct ?? 0)) base.precip_pct = c.precip_pct;
    if (c.thunder) base.thunder = true;
    if (c.fog) base.fog = true;
    if (c.air_temp_f != null && base.air_temp_f != null) base.air_temp_f = Math.min(base.air_temp_f, c.air_temp_f);
  }
  return base;
}

async function nwsHourly(lat: number, lon: number): Promise<{ hours: HourPoint[]; place: string }> {
  const pt = await get(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
  const url = pt?.properties?.forecastHourly;
  if (!url) throw new Error('no hourly grid');
  const fc = await get(url, 15000);
  const periods = fc?.properties?.periods ?? [];
  const hours: HourPoint[] = periods.slice(0, 60).map((p: any) => {
    const w = parseWind(p.windSpeed);
    const g = parseWind(p.windGust);
    return {
      time: p.startTime,
      wind_kn: w.kn ?? 0,
      gust_kn: g.kn,
      wind_from_deg: DIRS[p.windDirection] ?? null,
      temp_f: p.temperatureUnit === 'F' ? p.temperature : p.temperature != null ? Math.round(p.temperature * 9 / 5 + 32) : null,
      precip_pct: p.probabilityOfPrecipitation?.value ?? null,
      thunder: isThunder(p.shortForecast),
      summary: p.shortForecast ?? '',
    };
  });
  if (!hours.length) throw new Error('empty hourly');
  const rl = pt?.properties?.relativeLocation?.properties;
  return { hours, place: rl?.city ? `${rl.city}, ${rl.state}` : `${lat.toFixed(2)},${lon.toFixed(2)}` };
}

async function openMeteoHourly(lat: number, lon: number): Promise<{ hours: HourPoint[]; place: string }> {
  const js = await get(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
    `&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code` +
    `&temperature_unit=fahrenheit&wind_speed_unit=kn&forecast_days=3&timezone=UTC`, 15000);
  const h = js?.hourly;
  if (!h?.time?.length) throw new Error('no open-meteo hours');
  const hours: HourPoint[] = h.time.map((t: string, i: number) => {
    const code = h.weather_code?.[i];
    return {
      time: `${t}Z`,
      wind_kn: Math.round(h.wind_speed_10m?.[i] ?? 0),
      gust_kn: h.wind_gusts_10m?.[i] != null ? Math.round(h.wind_gusts_10m[i]) : null,
      wind_from_deg: h.wind_direction_10m?.[i] ?? null,
      temp_f: h.temperature_2m?.[i] != null ? Math.round(h.temperature_2m[i]) : null,
      precip_pct: h.precipitation_probability?.[i] ?? null,
      thunder: code >= 95,                 // WMO 95/96/99 = thunderstorm
      summary: code >= 95 ? 'Thunderstorms' : code >= 80 ? 'Showers' : code >= 51 ? 'Rain' : code >= 45 ? 'Fog' : code >= 2 ? 'Cloudy' : 'Clear',
    };
  });
  return { hours, place: `${lat.toFixed(2)},${lon.toFixed(2)}` };
}

/**
 * Forecast for a place at a departure time.
 * `fetchNm` is the open-water fetch used to estimate chop — roughly how far
 * the wind gets to blow across the lake before it reaches you.
 */
export async function fetchPlaceForecast(
  lat: number, lon: number, departISO: string, fetchNm = 2, hoursOut = 8,
): Promise<PlaceForecast> {
  let src: { hours: HourPoint[]; place: string };
  let provenance: string;
  try {
    src = await nwsHourly(lat, lon);
    provenance = `NWS hourly forecast for ${src.place}`;
  } catch {
    src = await openMeteoHourly(lat, lon);
    provenance = `Open-Meteo model forecast for ${src.place} (outside NWS hourly, or NWS unavailable)`;
  }

  const depart = new Date(departISO).getTime();
  let idx = src.hours.findIndex(h => new Date(h.time).getTime() + 3600_000 > depart);
  if (idx < 0) idx = 0;
  const windowHours = src.hours.slice(idx, idx + hoursOut);
  const at = toConditions(src.hours[idx] ?? src.hours[0], fetchNm);
  const window = worst((windowHours.length ? windowHours : [src.hours[idx] ?? src.hours[0]]).map(h => toConditions(h, fetchNm)));

  const nowTs = Date.now();
  const nowIdx = src.hours.findIndex(h => new Date(h.time).getTime() + 3600_000 > nowTs);
  const now = nowIdx >= 0 ? toConditions(src.hours[nowIdx], fetchNm) : null;

  return {
    hours: src.hours.slice(idx, idx + Math.max(hoursOut, 12)),
    at, window, now,
    provenance: `${provenance} · chop estimated from wind over ~${fetchNm.toFixed(1)} nm of fetch (physics, not a wave forecast)`,
    fetched_at: new Date().toISOString(),
  };
}
