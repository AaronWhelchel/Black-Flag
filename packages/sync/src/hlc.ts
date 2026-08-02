/**
 * Hybrid logical clock — Offline & Sync Design §5.
 * Each new op stamps max(wall clock, last seen HLC + 1 tick), so one device's
 * own history can never be reordered by a bad clock, and cross-device ties
 * break deterministically by device id.
 *
 * Encoding is lexicographically comparable: "<ms 15 digits>:<counter 5>:<device>"
 */

export interface Clock { now(): number; }

export class HLC {
  private lastMs = 0;
  private counter = 0;

  constructor(private deviceId: string, private clock: Clock) {}

  /** Stamp a new local event. */
  tick(): string {
    const wall = this.clock.now();
    if (wall > this.lastMs) { this.lastMs = wall; this.counter = 0; }
    else { this.counter += 1; }
    return encode(this.lastMs, this.counter, this.deviceId);
  }

  /** Witness a remote timestamp so future local events sort after it. */
  witness(hlc: string): void {
    const { ms, counter } = decode(hlc);
    if (ms > this.lastMs || (ms === this.lastMs && counter >= this.counter)) {
      this.lastMs = ms;
      this.counter = counter + 1;
    }
  }

  snapshot(): { lastMs: number; counter: number } { return { lastMs: this.lastMs, counter: this.counter }; }
  restore(s: { lastMs: number; counter: number }): void { this.lastMs = s.lastMs; this.counter = s.counter; }
}

export function encode(ms: number, counter: number, deviceId: string): string {
  return `${String(ms).padStart(15, '0')}:${String(counter).padStart(5, '0')}:${deviceId}`;
}

export function decode(hlc: string): { ms: number; counter: number; deviceId: string } {
  const [ms, counter, ...rest] = hlc.split(':');
  return { ms: Number(ms), counter: Number(counter), deviceId: rest.join(':') };
}

/** Total order: timestamp, then counter, then device id — never a tie. */
export const compareHlc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
