/**
 * Ingestion runner: builds the live-obs pack (buoys + tides) with provenance.
 * Scheduled in production (4×/day obs, daily tides). Every pack it emits
 * is registered — no unregistered source ships (Governance Register R1).
 */
import { writeFileSync } from 'node:fs';
import { fetchStation } from './ndbc.js';
import { fetchPredictions } from './coops.js';

const STATIONS = [
  { id: '44025', name: 'Long Island 33 nm S', lat: 40.251, lon: -73.164 },
  { id: '44091', name: 'Barnegat NJ', lat: 39.778, lon: -73.769 },
  { id: 'VAKF1', name: 'Virginia Key FL', lat: 25.731, lon: -80.162 },
];
const TIDE_STATIONS = [
  { id: '8533051', name: 'Manasquan area (NJ)' },
  { id: '8723214', name: 'Virginia Key, Miami FL' },
];

export async function buildLiveObsPack(outPath: string, forDate: string): Promise<void> {
  const now = new Date().toISOString();
  const buoys = [];
  for (const s of STATIONS) {
    try {
      const obs = await fetchStation(s.id);
      buoys.push({ ...s, ...obs });
    } catch (e) {
      // A dead buoy renders as missing, never as calm (Register SRC-06).
      buoys.push({ ...s, error: String(e) });
    }
  }
  const tides = [];
  for (const t of TIDE_STATIONS) {
    tides.push({ station: t.id, name: t.name, date: forDate, datum: 'MLLW', events: await fetchPredictions(t.id, forDate.replaceAll('-', '')) });
  }
  const pack = {
    pack: 'live-obs-tides',
    built_at: now,
    provenance: {
      ndbc: { source: 'NOAA NDBC realtime2', license: 'public-domain/noaa', fetched_at: now, freshness_slo: 'PT15M' },
      coops: { source: 'NOAA CO-OPS predictions API', license: 'public-domain/noaa', fetched_at: now },
    },
    buoys, tides,
  };
  writeFileSync(outPath, JSON.stringify(pack, null, 2));
  console.log(`wrote ${outPath}: ${buoys.length} stations, ${tides.length} tide stations`);
}

if (process.argv[2]) {
  buildLiveObsPack(process.argv[2], process.argv[3] ?? new Date().toISOString().slice(0, 10));
}
