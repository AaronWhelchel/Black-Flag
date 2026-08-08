/**
 * Day plan — "should I take the boat out today?"
 *
 * This is the question a captain actually asks, and the whole reason to open
 * the app before the truck is hitched. It is NOT a decision the app makes.
 * The app's job is to put everything on one page, in plain language, so the
 * captain decides — and doesn't drive two hours to find out.
 *
 * Three rules govern everything here:
 *
 *  1. The verdict is about a SPECIFIC BOAT doing SPECIFIC THINGS. Two feet of
 *     chop is a pleasant afternoon on a 31 ft cruiser, a miserable one on a
 *     16 ft runabout, and the end of tubing on either.
 *  2. Every verdict states its reason in numbers a captain can check. "Poor"
 *     with no reason is astrology.
 *  3. Lightning is the one hard stop. Everything else is the captain's call,
 *     stated honestly.
 */

export type Activity =
  | 'cruising' | 'skiing' | 'tubing' | 'wakeboarding' | 'fishing'
  | 'swimming' | 'paddling' | 'sailing' | 'raft-up' | 'overnighting';

export type Verdict = 'good' | 'marginal' | 'poor' | 'unsafe';

export const VERDICT_RANK: Record<Verdict, number> = { good: 3, marginal: 2, poor: 1, unsafe: 0 };

export interface DayConditions {
  wind_kn: number;
  gust_kn?: number | null;
  wind_from_deg?: number | null;
  /** Wave/chop height in feet — measured seas offshore, estimated fetch-limited chop on a lake. */
  chop_ft?: number | null;
  air_temp_f?: number | null;
  water_temp_f?: number | null;
  precip_pct?: number | null;
  /** Thunder in the planned window. The one hard stop. */
  thunder?: boolean;
  fog?: boolean;
  summary?: string;
}

export interface DayVessel {
  name?: string;
  loa_ft?: number;
  /** Captain-set comfortable limit; otherwise derived from length. */
  max_seas_ft?: number;
  category?: string;
}

/** What a boat can comfortably take. A captain's own number always wins; the
 *  fallback is length-derived and deliberately conservative for small hulls. */
export function comfortableSeasFt(v: DayVessel): number {
  if (v.max_seas_ft && v.max_seas_ft > 0) return v.max_seas_ft;
  const loa = v.loa_ft ?? 18;
  if (loa <= 12) return 0.8;            // kayak, jon boat
  return Math.max(1, Math.min(8, loa / 8));
}

interface ActivityRule {
  label: string;
  /** Wind (kn) at which it stops being fun / stops being sensible. */
  windGood: number; windMarginal: number;
  /** Chop (ft) likewise. */
  chopGood: number; chopMarginal: number;
  /** Below this air temperature it's a cold day for this activity (°F). */
  coldF?: number;
  /** Needs wind rather than merely tolerating it. */
  needsWind?: { min: number; over: number };
  /** Rain matters more to some plans than others. */
  rainSensitive?: boolean;
}

const RULES: Record<Activity, ActivityRule> = {
  cruising:     { label: 'Cruising',      windGood: 15, windMarginal: 22, chopGood: 1.2, chopMarginal: 2.2 },
  skiing:       { label: 'Skiing',        windGood: 8,  windMarginal: 13, chopGood: 0.5, chopMarginal: 1.0, coldF: 68 },
  tubing:       { label: 'Tubing',        windGood: 10, windMarginal: 15, chopGood: 0.6, chopMarginal: 1.2, coldF: 65 },
  wakeboarding: { label: 'Wakeboarding',  windGood: 9,  windMarginal: 14, chopGood: 0.5, chopMarginal: 1.0, coldF: 65 },
  fishing:      { label: 'Fishing',       windGood: 12, windMarginal: 18, chopGood: 1.0, chopMarginal: 1.8, rainSensitive: false },
  swimming:     { label: 'Swimming',      windGood: 12, windMarginal: 18, chopGood: 1.0, chopMarginal: 1.8, coldF: 70 },
  paddling:     { label: 'Paddling',      windGood: 8,  windMarginal: 12, chopGood: 0.6, chopMarginal: 1.0, coldF: 60 },
  sailing:      { label: 'Sailing',       windGood: 18, windMarginal: 24, chopGood: 2.0, chopMarginal: 3.0, needsWind: { min: 5, over: 22 } },
  'raft-up':    { label: 'Raft-up',       windGood: 10, windMarginal: 15, chopGood: 0.8, chopMarginal: 1.5, coldF: 68 },
  overnighting: { label: 'Overnighting',  windGood: 15, windMarginal: 22, chopGood: 1.5, chopMarginal: 2.5, rainSensitive: true },
};

export const ALL_ACTIVITIES = Object.keys(RULES) as Activity[];
export const activityLabel = (a: Activity) => RULES[a]?.label ?? a;

export interface ActivityAssessment { activity: Activity; label: string; verdict: Verdict; reasons: string[] }

export interface DayAssessment {
  verdict: Verdict;
  headline: string;
  reasons: string[];
  perActivity: ActivityAssessment[];
  /** How the boat itself fares in the forecast chop, independent of plans. */
  vesselNote?: string;
  score: number;
}

const kn = (n: number) => `${Math.round(n)} kn`;
const ft = (n: number) => `${Math.round(n * 10) / 10} ft`;

/** Assess ONE activity. Reasons carry the numbers, always. */
function assessActivity(a: Activity, c: DayConditions, v: DayVessel): ActivityAssessment {
  const r = RULES[a];
  const reasons: string[] = [];
  let verdict: Verdict = 'good';
  const worsen = (to: Verdict) => { if (VERDICT_RANK[to] < VERDICT_RANK[verdict]) verdict = to; };

  if (c.thunder) {
    return { activity: a, label: r.label, verdict: 'unsafe', reasons: ['Thunderstorms in the window — nothing else matters until that clears.'] };
  }

  const wind = Math.max(c.wind_kn, (c.gust_kn ?? 0) * 0.8);   // gusts are what actually spoils a tow
  if (wind > r.windMarginal) { worsen('poor'); reasons.push(`Wind ${kn(c.wind_kn)}${c.gust_kn ? ` gusting ${kn(c.gust_kn)}` : ''} — past what ${r.label.toLowerCase()} is worth.`); }
  else if (wind > r.windGood) { worsen('marginal'); reasons.push(`Wind ${kn(c.wind_kn)}${c.gust_kn ? ` gusting ${kn(c.gust_kn)}` : ''} — workable but not pleasant.`); }

  if (r.needsWind) {
    if (c.wind_kn < r.needsWind.min) { worsen('poor'); reasons.push(`Only ${kn(c.wind_kn)} — not enough to sail.`); }
    else if (c.wind_kn > r.needsWind.over) { worsen('marginal'); reasons.push(`${kn(c.wind_kn)} is a reefed day.`); }
  }

  const chop = c.chop_ft ?? null;
  if (chop != null) {
    if (chop > r.chopMarginal) { worsen('poor'); reasons.push(`${ft(chop)} chop — too rough for ${r.label.toLowerCase()}.`); }
    else if (chop > r.chopGood) { worsen('marginal'); reasons.push(`${ft(chop)} chop — choppy for ${r.label.toLowerCase()}.`); }
  }

  if (r.coldF != null && c.air_temp_f != null) {
    if (c.air_temp_f < r.coldF - 12) { worsen('poor'); reasons.push(`${Math.round(c.air_temp_f)}°F — too cold to be wet.`); }
    else if (c.air_temp_f < r.coldF) { worsen('marginal'); reasons.push(`${Math.round(c.air_temp_f)}°F — cold once you're wet.`); }
  }
  if (a === 'swimming' && c.water_temp_f != null && c.water_temp_f < 65) {
    worsen(c.water_temp_f < 58 ? 'poor' : 'marginal');
    reasons.push(`Water ${Math.round(c.water_temp_f)}°F.`);
  }

  if (c.precip_pct != null && c.precip_pct >= 60) {
    worsen(r.rainSensitive ? 'poor' : 'marginal');
    reasons.push(`${Math.round(c.precip_pct)}% chance of rain.`);
  }
  if (c.fog) { worsen('marginal'); reasons.push('Fog — visibility is the problem, not the water.'); }

  if (!reasons.length) reasons.push(`Wind ${kn(c.wind_kn)}${chop != null ? `, ${ft(chop)} chop` : ''} — fine for ${r.label.toLowerCase()}.`);
  return { activity: a, label: r.label, verdict, reasons };
}

/**
 * The whole-day answer. The overall verdict is the WORST of what the captain
 * plans to do, because a day where the fishing is fine but the kids can't
 * tube is not the day they pictured — but the per-activity breakdown says
 * exactly which part is the problem, so they can drop one plan and still go.
 */
export function assessDay(
  conditions: DayConditions,
  vessel: DayVessel,
  activities: Activity[],
): DayAssessment {
  const acts = activities.length ? activities : (['cruising'] as Activity[]);
  const perActivity = acts.map(a => assessActivity(a, conditions, vessel));

  const reasons: string[] = [];
  let verdict: Verdict = perActivity.reduce<Verdict>(
    (w, p) => (VERDICT_RANK[p.verdict] < VERDICT_RANK[w] ? p.verdict : w), 'good');

  // The boat itself, regardless of plans.
  const limit = comfortableSeasFt(vessel);
  let vesselNote: string | undefined;
  const chop = conditions.chop_ft ?? null;
  if (chop != null) {
    const boat = vessel.name ?? (vessel.loa_ft ? `your ${Math.round(vessel.loa_ft)} ft boat` : 'your boat');
    if (chop > limit) {
      verdict = VERDICT_RANK['poor'] < VERDICT_RANK[verdict] ? 'poor' : verdict;
      vesselNote = `${ft(chop)} chop is past the ${ft(limit)} ${boat} is comfortable in.`;
      reasons.push(vesselNote);
    } else if (chop > limit * 0.7) {
      verdict = VERDICT_RANK['marginal'] < VERDICT_RANK[verdict] ? 'marginal' : verdict;
      vesselNote = `${ft(chop)} chop is a lively ride in ${boat} (comfortable to about ${ft(limit)}).`;
      reasons.push(vesselNote);
    } else {
      vesselNote = `${ft(chop)} chop — easy water for ${boat}.`;
    }
  }

  if (conditions.thunder) {
    verdict = 'unsafe';
    reasons.length = 0;
    reasons.push('Thunderstorms forecast in your window. Open water is the worst place to be in lightning — there is no version of this that is worth it.');
  }

  // Reasons from whichever activities are actually limiting the day.
  for (const p of perActivity) {
    if (p.verdict === verdict && VERDICT_RANK[p.verdict] < 3) {
      for (const rr of p.reasons) if (!reasons.includes(rr)) reasons.push(`${p.label}: ${rr}`);
    }
  }
  if (!reasons.length) {
    reasons.push(`Wind ${kn(conditions.wind_kn)}${chop != null ? `, ${ft(chop)} chop` : ''}${conditions.air_temp_f != null ? `, ${Math.round(conditions.air_temp_f)}°F` : ''}.`);
  }

  const headline =
    verdict === 'unsafe' ? 'Not today — lightning'
    : verdict === 'poor' ? 'Rough day for what you have planned'
    : verdict === 'marginal' ? 'Doable, but you should know what you\'re getting'
    : 'Good day on the water';

  // A single number so alternatives can be ranked; lower chop and wind break ties.
  const score = VERDICT_RANK[verdict] * 1000
    - Math.min(400, conditions.wind_kn * 12)
    - Math.min(400, (chop ?? 0) * 120);

  return { verdict, headline, reasons, perActivity, vesselNote, score };
}

// ---- checklists ----------------------------------------------------------

export interface ChecklistItem { id: string; text: string; group: string }

const UNIVERSAL: ChecklistItem[] = [
  { id: 'drain-plug', text: 'Drain plug in', group: 'Before the ramp' },
  { id: 'reg', text: 'Registration aboard', group: 'Before the ramp' },
  { id: 'straps', text: 'Tie-downs off, trailer lights checked', group: 'Before the ramp' },
  { id: 'pfd', text: 'A life jacket that fits everyone aboard', group: 'Safety' },
  { id: 'throwable', text: 'Throwable flotation', group: 'Safety' },
  { id: 'ext', text: 'Fire extinguisher, charged', group: 'Safety' },
  { id: 'whistle', text: 'Whistle or horn', group: 'Safety' },
  { id: 'firstaid', text: 'First aid kit', group: 'Safety' },
  { id: 'phone', text: 'Phone charged, in a dry bag', group: 'Safety' },
  { id: 'floatplan', text: 'Someone ashore knows where you\'re going and when you\'re back', group: 'Safety' },
  { id: 'fuel', text: 'Fuel — enough for the day plus reserve', group: 'Boat' },
  { id: 'battery', text: 'Battery charged', group: 'Boat' },
  { id: 'anchor', text: 'Anchor and rode', group: 'Boat' },
  { id: 'lines', text: 'Dock lines and fenders', group: 'Boat' },
  { id: 'water', text: 'Drinking water', group: 'Comfort' },
  { id: 'food', text: 'Food / cooler', group: 'Comfort' },
  { id: 'sun', text: 'Sunscreen, hats, sunglasses', group: 'Comfort' },
  { id: 'trash', text: 'Trash bag — carry it back out', group: 'Comfort' },
];

const PER_ACTIVITY: Record<Activity, ChecklistItem[]> = {
  cruising: [],
  skiing: [
    { id: 'ski-flag', text: 'Skier-down flag', group: 'Towing' },
    { id: 'ski-observer', text: 'An observer besides the driver', group: 'Towing' },
    { id: 'ski-rope', text: 'Ski rope and handle, checked for frays', group: 'Towing' },
    { id: 'ski-skis', text: 'Skis', group: 'Towing' },
    { id: 'ski-vest', text: 'Impact vests for riders', group: 'Towing' },
    { id: 'towels', text: 'Towels and a change of clothes', group: 'Comfort' },
  ],
  tubing: [
    { id: 'ski-flag', text: 'Skier-down flag', group: 'Towing' },
    { id: 'ski-observer', text: 'An observer besides the driver', group: 'Towing' },
    { id: 'tube', text: 'Tube, inflated, and the pump', group: 'Towing' },
    { id: 'tube-rope', text: 'Tow rope rated for the tube', group: 'Towing' },
    { id: 'ski-vest', text: 'Impact vests for riders', group: 'Towing' },
    { id: 'towels', text: 'Towels and a change of clothes', group: 'Comfort' },
  ],
  wakeboarding: [
    { id: 'ski-flag', text: 'Skier-down flag', group: 'Towing' },
    { id: 'ski-observer', text: 'An observer besides the driver', group: 'Towing' },
    { id: 'wake-board', text: 'Board and bindings', group: 'Towing' },
    { id: 'ski-rope', text: 'Tow rope and handle, checked for frays', group: 'Towing' },
    { id: 'ski-vest', text: 'Impact vests for riders', group: 'Towing' },
    { id: 'ballast', text: 'Ballast filled / wake set', group: 'Towing' },
    { id: 'towels', text: 'Towels and a change of clothes', group: 'Comfort' },
  ],
  fishing: [
    { id: 'license', text: 'Fishing licence — current, for THIS state', group: 'Fishing' },
    { id: 'rods', text: 'Rods and reels', group: 'Fishing' },
    { id: 'tackle', text: 'Tackle box', group: 'Fishing' },
    { id: 'bait', text: 'Bait', group: 'Fishing' },
    { id: 'net', text: 'Landing net', group: 'Fishing' },
    { id: 'pliers', text: 'Pliers and line cutters', group: 'Fishing' },
    { id: 'livewell', text: 'Livewell / cooler with ice', group: 'Fishing' },
    { id: 'measure', text: 'Measuring board — know the size limits here', group: 'Fishing' },
  ],
  swimming: [
    { id: 'ladder', text: 'Boarding ladder down and working', group: 'Swimming' },
    { id: 'towels', text: 'Towels and a change of clothes', group: 'Comfort' },
    { id: 'kids-pfd', text: 'Life jackets on non-swimmers, on deck and in the water', group: 'Safety' },
  ],
  paddling: [
    { id: 'paddle', text: 'Paddle (and a spare)', group: 'Paddling' },
    { id: 'bilge', text: 'Bilge pump or bailer', group: 'Paddling' },
    { id: 'leash', text: 'Paddle leash', group: 'Paddling' },
    { id: 'drybag', text: 'Dry bag for anything that must stay dry', group: 'Paddling' },
  ],
  sailing: [
    { id: 'sails', text: 'Sails bent on, reefing gear ready', group: 'Sailing' },
    { id: 'winch', text: 'Winch handles aboard', group: 'Sailing' },
    { id: 'harness', text: 'Harness / tether if it pipes up', group: 'Sailing' },
  ],
  'raft-up': [
    { id: 'fenders-extra', text: 'Extra fenders — you\'ll want more than you think', group: 'Raft-up' },
    { id: 'raft-lines', text: 'Long lines for rafting', group: 'Raft-up' },
    { id: 'shade', text: 'Bimini or shade', group: 'Comfort' },
  ],
  overnighting: [
    { id: 'bedding', text: 'Bedding', group: 'Overnight' },
    { id: 'lights', text: 'Anchor light working', group: 'Overnight' },
    { id: 'headlamp', text: 'Headlamps / flashlights', group: 'Overnight' },
    { id: 'bugs', text: 'Bug spray', group: 'Overnight' },
    { id: 'water-extra', text: 'Extra water for overnight', group: 'Overnight' },
  ],
};

const GROUP_ORDER = ['Before the ramp', 'Safety', 'Boat', 'Towing', 'Fishing', 'Swimming', 'Paddling', 'Sailing', 'Raft-up', 'Overnight', 'Comfort', 'Conditions'];

/**
 * One checklist for the whole day. Items shared between activities appear
 * ONCE — you don't need to be told about fuel twice because you're fishing
 * and tubing — and gear for things you're not doing never appears at all.
 */
export function buildChecklist(activities: Activity[], conditions?: DayConditions): ChecklistItem[] {
  const byId = new Map<string, ChecklistItem>();
  for (const it of UNIVERSAL) byId.set(it.id, it);
  for (const a of activities) for (const it of PER_ACTIVITY[a] ?? []) if (!byId.has(it.id)) byId.set(it.id, it);

  // A few items the forecast itself earns a place for.
  if (conditions) {
    if ((conditions.precip_pct ?? 0) >= 40) byId.set('rain', { id: 'rain', text: 'Rain gear', group: 'Conditions' });
    if ((conditions.air_temp_f ?? 99) < 65) byId.set('layers', { id: 'layers', text: 'Warm layers — it\'s cooler on the water', group: 'Conditions' });
    if (conditions.wind_kn >= 12) byId.set('wind-secure', { id: 'wind-secure', text: 'Secure loose gear — it\'s breezy', group: 'Conditions' });
    if (conditions.fog) byId.set('fog-nav', { id: 'fog-nav', text: 'Nav lights and horn — fog is forecast', group: 'Conditions' });
  }

  return [...byId.values()].sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(a.group), gb = GROUP_ORDER.indexOf(b.group);
    return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb) || a.text.localeCompare(b.text);
  });
}
