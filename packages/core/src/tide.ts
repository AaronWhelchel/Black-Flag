import { angleDiff } from './geo.js';

/**
 * Named rule "tidal_gate": when an ebb current runs against a meaningful
 * onshore swell, an inlet stands up until slack water.
 * Validated envelope: swell period ≥ 6 s, height ≥ 2 ft; below that the
 * gate does not trigger.
 */

export interface TideEvent {
  /** ISO local time */
  time: string;
  type: 'slack' | 'max_ebb' | 'max_flood';
  current_kn?: number;
}

export interface Swell {
  from_deg: number;
  height_ft: number;
  period_s: number;
}

export interface RoughWindow {
  from: string;
  until: string;
  reason: string;
}

const toMin = (iso: string): number => {
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0;
};

/**
 * Compute rough-inlet windows for a day of tide events at an inlet.
 * `inlet_faces_deg` is the seaward direction the inlet mouth faces.
 * Swell "opposes" the ebb when it arrives from within 60° of that facing.
 */
export function roughInletWindows(
  events: TideEvent[],
  swell: Swell,
  inlet_faces_deg: number,
): RoughWindow[] {
  const opposed = angleDiff(swell.from_deg, inlet_faces_deg) <= 60;
  const significant = swell.height_ft >= 2 && swell.period_s >= 6;
  if (!opposed || !significant) return [];

  const out: RoughWindow[] = [];
  const sorted = [...events].sort((a, b) => toMin(a.time) - toMin(b.time));
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].type !== 'max_ebb') continue;
    // Rough from ~1.5h before max ebb until the following slack.
    const next = sorted.slice(i + 1).find(e => e.type === 'slack');
    if (!next) continue;
    const fromMin = Math.max(0, toMin(sorted[i].time) - 90);
    const hh = String(Math.floor(fromMin / 60)).padStart(2, '0');
    const mm = String(fromMin % 60).padStart(2, '0');
    const datePart = sorted[i].time.slice(0, 11);
    const tz = sorted[i].time.slice(16);
    out.push({
      from: `${datePart}${hh}:${mm}${tz}`,
      until: next.time,
      reason: `ebb (max ${sorted[i].current_kn ?? '?'} kn) against ${swell.height_ft} ft @ ${swell.period_s} s ${cardinal(swell.from_deg)} swell`,
    });
  }
  return out;
}

export function isRoughAt(windows: RoughWindow[], iso: string): RoughWindow | null {
  const t = toMin(iso);
  for (const w of windows) {
    if (t >= toMin(w.from) && t < toMin(w.until)) return w;
  }
  return null;
}

export function cardinal(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(((deg % 360) / 22.5)) % 16];
}
