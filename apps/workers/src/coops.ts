/**
 * CO-OPS ingester — SRC-05 in the Data Governance Register.
 * Tide predictions (hilo) per station per day, validated and stamped.
 */

export interface TideEvent { t: string; v_ft: number; type: 'H' | 'L'; }

export function parsePredictions(json: any, station: string): TideEvent[] {
  if (!json || !Array.isArray(json.predictions)) throw new Error(`coops:${station}: bad payload`);
  const events = json.predictions.map((p: any) => ({
    t: String(p.t).slice(11, 16),
    v_ft: Number(p.v),
    type: p.type === 'H' ? 'H' as const : 'L' as const,
  }));
  // R4 gates: plausible count and levels for a coastal station
  if (events.length < 2 || events.length > 6) throw new Error(`coops:${station}: ${events.length} events — implausible`);
  for (const e of events) {
    if (!Number.isFinite(e.v_ft) || e.v_ft < -15 || e.v_ft > 55) throw new Error(`coops:${station}: level ${e.v_ft} ft out of bounds`);
  }
  return events;
}

export async function fetchPredictions(station: string, yyyymmdd: string): Promise<TideEvent[]> {
  const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=blackflag&begin_date=${yyyymmdd}&end_date=${yyyymmdd}&datum=MLLW&station=${station}&time_zone=lst_ldt&units=english&interval=hilo&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`coops:${station}: HTTP ${res.status}`);
  return parsePredictions(await res.json(), station);
}
