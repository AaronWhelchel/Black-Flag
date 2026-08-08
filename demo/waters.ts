/**
 * Known waters — the places a captain plans a day on.
 *
 * A destination needs a name people actually use, a point to ask the weather
 * about, and (where we have one) the chart pack that covers it. `nearby()` is
 * what makes "it's blown out at Patoka, where else?" answerable: the other
 * lakes within a sensible drive, so the app can go and check them too.
 *
 * Distances shown are straight-line. We say so — a captain knows the roads
 * better than we do, and a bearing plus a mileage is enough to judge whether
 * an alternative is worth the drive.
 */
export interface Water {
  key: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  kind: 'lake' | 'river' | 'coastal';
  /** chart pack region, when one is published for it */
  region?: string;
  /** rough size, for "is this worth the drive" context */
  acres?: number;
  note?: string;
  /** Species keys from core/fishing SPECIES, in the order locals name them. */
  species?: string[];
  /** Local rules a captain planning a day would want in front of them.
   *  Verify against the state guide each season — limits change annually. */
  fishingRules?: string[];
}

export const KNOWN_WATERS: Water[] = [
  { key: 'patoka', name: 'Patoka Lake', state: 'IN', lat: 38.424, lon: -86.648, kind: 'lake', region: 'in-patoka', acres: 8800, note: 'Indiana’s second-largest reservoir',
    species: ['largemouth', 'spotted', 'crappie', 'bluegill', 'hybridstriper', 'channelcat', 'flathead', 'walleye', 'whitebass'],
    fishingRules: [
      'Bass here have a 15" minimum — a Patoka exception to Indiana\'s statewide 14". 5/day combined.',
      'Hybrid striped bass & white bass: 12/day combined, no more than 2 over 17".',
      'Crappie 25/day, bluegill 25/day, no size limit. Channel cat 10/day; flathead 5/day.',
      'Walleye 6/day, 14" minimum. Stocked annually along with hybrid stripers.',
    ] },
  { key: 'monroe', name: 'Monroe Lake', state: 'IN', lat: 39.028, lon: -86.420, kind: 'lake', region: 'in-monroe', acres: 10750, note: 'Indiana’s largest lake',
    species: ['largemouth', 'spotted', 'crappie', 'bluegill', 'channelcat', 'flathead', 'whitebass', 'muskie'] },
  { key: 'rough-river', name: 'Rough River Lake', state: 'KY', lat: 37.617, lon: -86.462, kind: 'lake', region: 'ky-rough-river', acres: 5100,
    species: ['largemouth', 'crappie', 'bluegill', 'channelcat', 'flathead', 'whitebass'] },
  { key: 'nolin', name: 'Nolin River Lake', state: 'KY', lat: 37.300, lon: -86.250, kind: 'lake', region: 'ky-nolin', acres: 5795,
    species: ['largemouth', 'spotted', 'crappie', 'bluegill', 'channelcat', 'whitebass'] },
  { key: 'cumberland', name: 'Lake Cumberland', state: 'KY', lat: 36.930, lon: -85.050, kind: 'lake', region: 'ky-cumberland', acres: 63530, note: 'one of the largest man-made lakes in the US',
    species: ['largemouth', 'spotted', 'crappie', 'bluegill', 'hybridstriper', 'whitebass', 'channelcat', 'walleye'] },
  { key: 'barkley-kentucky', name: 'Kentucky Lake & Lake Barkley', state: 'KY', lat: 36.800, lon: -88.050, kind: 'lake', region: 'ky-barkley-lakes', acres: 218000,
    species: ['largemouth', 'crappie', 'bluegill', 'channelcat', 'whitebass', 'hybridstriper'] },
  { key: 'key-west', name: 'Key West & the lower Keys', state: 'FL', lat: 24.560, lon: -81.780, kind: 'coastal', region: 'fl-key-west' },
  { key: 'keys-biscayne', name: 'Upper Keys / Biscayne Bay', state: 'FL', lat: 25.300, lon: -80.250, kind: 'coastal', region: 'fl-keys-bimini' },
  { key: 'manasquan', name: 'Manasquan / Barnegat', state: 'NJ', lat: 40.100, lon: -74.030, kind: 'coastal', region: 'nj-manasquan' },
];

export const waterByKey = (k: string) => KNOWN_WATERS.find(w => w.key === k) ?? null;

const R_MI = 3958.8;
export function distanceMi(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.sqrt(s));
}

export function bearingFrom(a: { lat: number; lon: number }, b: { lat: number; lon: number }): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  const deg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

/** Other waters within a plausible redirect of this one, nearest first. */
export function nearby(w: Water, maxMi = 120, limit = 5): { water: Water; miles: number; bearing: string }[] {
  return KNOWN_WATERS
    .filter(o => o.key !== w.key && o.kind === w.kind)
    .map(o => ({ water: o, miles: distanceMi(w, o), bearing: bearingFrom(w, o) }))
    .filter(o => o.miles <= maxMi)
    .sort((a, b) => a.miles - b.miles)
    .slice(0, limit);
}

/** Free-text match for the destination box. */
export function searchWaters(q: string, limit = 8): Water[] {
  const s = q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!s) return [];
  return KNOWN_WATERS
    .map(w => {
      const name = `${w.name} ${w.state}`.toLowerCase();
      const score = name.startsWith(s) ? 3 : name.includes(s) ? 2 : s.split(' ').every(t => name.includes(t)) ? 1 : 0;
      return { w, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.w.name.localeCompare(b.w.name))
    .slice(0, limit)
    .map(x => x.w);
}
