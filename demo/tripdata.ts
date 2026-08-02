/**
 * Trip data auto-fetch — when a captain plans a route, Black Flag pulls the
 * NOAA data that trip needs: NWS point forecast + wave grid at the route
 * midpoint, and tide predictions from the nearest CO-OPS station. All fetches
 * run in the captain's browser against free public NOAA APIs; every result
 * carries provenance, and failure degrades honestly (Explainability Standard —
 * Black Flag doesn't guess).
 *
 * Chart packs (ENC depth/shoreline) auto-select per route corridor the same
 * way once packs are CDN-hosted — that trigger lands with the server milestone.
 */
import { RouteWaypoint, haversineNm } from '../packages/core/src/index.js';

export interface TripWx {
  wind_kn: number;
  wind_from_deg: number;
  gust_kn: number | null;
  seas_ft: number | null;          // null = no marine wave grid here (e.g. inland lake)
  summary: string;
  detailed: string;
  provenance: string;
  fetched_at: string;
}

export interface TripTides {
  station: string;
  name: string;
  dist_nm: number;
  date: string;
  events: { t: string; v_ft: number; type: 'H' | 'L' }[];
  provenance: string;
}

const DIR: Record<string, number> = {
  N: 0, NNE: 22, NE: 45, ENE: 67, E: 90, ESE: 112, SE: 135, SSE: 157,
  S: 180, SSW: 202, SW: 225, WSW: 247, W: 270, WNW: 292, NW: 315, NNW: 337,
};
const mphToKn = (mph: number) => Math.round(mph * 0.869);

/** "5 to 10 mph" → max kn; "10 mph" → kn */
function parseWind(spd: string | undefined): number | null {
  if (!spd) return null;
  const nums = [...spd.matchAll(/(\d+(?:\.\d+)?)/g)].map(m => Number(m[1]));
  if (!nums.length) return null;
  return mphToKn(Math.max(...nums));
}

const get = async (url: string) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(9000), headers: { accept: 'application/geo+json, application/json' } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
};

function routeMidpoint(wps: RouteWaypoint[]): { lat: number; lon: number } {
  const total = wps.slice(1).reduce((s, p, i) => s + haversineNm(wps[i], p), 0);
  let acc = 0;
  for (let i = 0; i < wps.length - 1; i++) {
    const d = haversineNm(wps[i], wps[i + 1]);
    if (acc + d >= total / 2) {
      const t = d === 0 ? 0 : (total / 2 - acc) / d;
      return { lat: wps[i].lat + (wps[i + 1].lat - wps[i].lat) * t, lon: wps[i].lon + (wps[i + 1].lon - wps[i].lon) * t };
    }
    acc += d;
  }
  return { lat: wps[0].lat, lon: wps[0].lon };
}

export async function fetchTripWx(wps: RouteWaypoint[]): Promise<TripWx> {
  const mid = routeMidpoint(wps);
  const pt = await get(`https://api.weather.gov/points/${mid.lat.toFixed(4)},${mid.lon.toFixed(4)}`);
  const fcUrl = pt?.properties?.forecast;
  const gridUrl = pt?.properties?.forecastGridData;
  if (!fcUrl) throw new Error('no forecast for this point');
  const fc = await get(fcUrl);
  const periods = fc?.properties?.periods ?? [];
  if (!periods.length) throw new Error('no forecast periods');

  // Worst wind across the next ~24h of periods — planning is about the window,
  // not the prettiest hour in it.
  let wind = 0, gust: number | null = null, dir = 0;
  for (const p of periods.slice(0, 3)) {
    const w = parseWind(p.windSpeed);
    if (w !== null && w >= wind) { wind = w; dir = DIR[p.windDirection] ?? 0; }
    const g = parseWind(p.windGust);
    if (g !== null) gust = Math.max(gust ?? 0, g);
  }

  // Wave height from the marine grid when this point has one (coastal waters).
  let seas: number | null = null;
  if (gridUrl) {
    try {
      const grid = await get(gridUrl);
      const wv = grid?.properties?.waveHeight?.values ?? [];
      const vals = wv.slice(0, 10).map((v: any) => Number(v.value)).filter((v: number) => Number.isFinite(v));
      if (vals.length) seas = Math.round(Math.max(...vals) * 3.281 * 10) / 10;   // m → ft
    } catch { /* no wave grid — inland or grid outage; stays null, said honestly */ }
  }

  const office = pt?.properties?.relativeLocation?.properties;
  return {
    wind_kn: wind, wind_from_deg: dir, gust_kn: gust, seas_ft: seas,
    summary: periods[0].shortForecast,
    detailed: periods[0].detailedForecast,
    provenance: `NWS forecast near ${office?.city ?? mid.lat.toFixed(2) + ',' + mid.lon.toFixed(2)}${seas !== null ? ' · waves: NWS marine grid' : ' · no marine wave grid here (inland)'}`,
    fetched_at: new Date().toISOString(),
  };
}

let stationCache: { id: string; name: string; lat: number; lon: number }[] | null = null;

export async function fetchTripTides(wps: RouteWaypoint[], maxDistNm = 60): Promise<TripTides | null> {
  const mid = routeMidpoint(wps);
  if (!stationCache) {
    const js = await get('https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions');
    stationCache = (js?.stations ?? []).map((s: any) => ({ id: s.id, name: s.name, lat: Number(s.lat), lon: Number(s.lng) }));
  }
  let best: { id: string; name: string; lat: number; lon: number } | null = null;
  let bestD = Infinity;
  for (const s of stationCache!) {
    const d = haversineNm(mid, s);
    if (d < bestD) { bestD = d; best = s; }
  }
  if (!best || bestD > maxDistNm) return null;   // inland lake — honestly no tides

  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const js = await get(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=blackflag&begin_date=${ymd}&end_date=${ymd}&datum=MLLW&station=${best.id}&time_zone=lst_ldt&units=english&interval=hilo&format=json`);
  const events = (js?.predictions ?? []).map((p: any) => ({
    t: String(p.t).slice(11, 16), v_ft: Math.round(Number(p.v) * 100) / 100, type: (p.type === 'H' ? 'H' : 'L') as 'H' | 'L',
  }));
  if (!events.length) return null;
  return {
    station: best.id, name: best.name, dist_nm: Math.round(bestD * 10) / 10,
    date: today.toISOString().slice(0, 10), events,
    provenance: `CO-OPS ${best.id} (${Math.round(bestD)} nm from route)`,
  };
}
