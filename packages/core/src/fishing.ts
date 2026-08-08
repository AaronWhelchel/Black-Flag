/**
 * Fishing conditions — and an honest account of what we actually know.
 *
 * Every fishing app on the market sells solunar tables as gospel and dresses
 * barometric pressure up as science. The research doesn't support that. Dr.
 * David Ross of Woods Hole put the pressure claim in perspective: the entire
 * pressure swing of a HURRICANE is about 0.09 atmospheres — less than what a
 * fish experiences swimming down three and a half feet. A fish crossing your
 * boat's shadow changes its own pressure more than the weather does.
 *
 * So this module grades every factor by what stands behind it:
 *
 *   'biology'   — established fisheries science. Water temperature governs
 *                 metabolism and spawning. Walleye really do have a tapetum
 *                 lucidum and really are low-light specialists.
 *   'mechanism' — a physical chain that makes sense and anglers observe:
 *                 chop cuts light penetration, wind stacks bait on a bank.
 *   'tradition' — anglers believe it, the evidence is thin or absent.
 *                 Pressure trends. Solunar periods. Wind direction rhymes.
 *
 * Tradition still gets shown, because a captain who fishes by the moon should
 * see the moon — but it is LABELLED, and it barely moves the rating. If Black
 * Flag ever tells someone the fish will bite, it should be for a reason that
 * survives being asked "says who?".
 */

export type FishingRating = 'prime' | 'good' | 'fair' | 'slow';
export type FactorBasis = 'biology' | 'mechanism' | 'tradition';
export type FactorEffect = 'good' | 'neutral' | 'poor';

export interface FishingFactor {
  label: string;
  effect: FactorEffect;
  detail: string;
  basis: FactorBasis;
}

export interface Species {
  key: string;
  name: string;
  /** Water temperature band where this fish is active and findable (°F). */
  activeF: [number, number];
  /** Best band inside that (°F). */
  primeF?: [number, number];
  /** 'documented' = published physiology (walleye's tapetum lucidum);
   *  'believed' = anglers observe it and it is plausible. */
  lowLight?: 'documented' | 'believed';
  note?: string;
}

/** Species profiles — temperature bands from fisheries guidance. */
export const SPECIES: Record<string, Species> = {
  largemouth: { key: 'largemouth', name: 'Largemouth bass', activeF: [50, 88], primeF: [60, 78], note: 'Spawns around 60–65°F; post-spawn 65–70°F is the aggressive feed. Over 75°F they hold deeper structure and feed at the edges of the day.' },
  spotted: { key: 'spotted', name: 'Spotted bass', activeF: [48, 86], primeF: [58, 76], note: 'Holds deeper than largemouth; stays catchable near the dam through winter on finesse presentations.' },
  crappie: { key: 'crappie', name: 'Crappie', activeF: [45, 82], primeF: [55, 70], lowLight: 'believed', note: 'Pre-spawn pushes shallow in the 50s; spawns low 60s. Deep timber in summer and winter.' },
  bluegill: { key: 'bluegill', name: 'Bluegill', activeF: [55, 88], primeF: [68, 80], note: 'Spawns in the 70s and beds repeatedly through summer — the most forgiving fish on the lake.' },
  walleye: { key: 'walleye', name: 'Walleye', activeF: [38, 76], primeF: [45, 62], lowLight: 'documented', note: 'Genuinely a low-light feeder — walleye have a tapetum lucidum, a reflective eye layer that gives real low-light vision. Dawn, dusk, night and chop are their conditions, not folklore.' },
  channelcat: { key: 'channelcat', name: 'Channel catfish', activeF: [50, 90], primeF: [65, 82], note: 'Spawns around 65°F along riprap. Opportunistic across a wide range; nights are strong in summer heat.' },
  flathead: { key: 'flathead', name: 'Flathead catfish', activeF: [55, 88], primeF: [65, 80], lowLight: 'believed', note: 'Largely nocturnal and live-bait selective; stacks on points at 60–70°F in late spring.' },
  hybridstriper: { key: 'hybridstriper', name: 'Hybrid striped bass', activeF: [50, 85], primeF: [55, 72], note: 'Stocked, and bred to take warm water better than pure stripers. Chase shad — watch for surface activity and working birds.' },
  whitebass: { key: 'whitebass', name: 'White bass', activeF: [48, 84], primeF: [55, 75], note: 'Schools on shad; spring runs up the creek arms.' },
  muskie: { key: 'muskie', name: 'Muskellunge', activeF: [40, 78], primeF: [50, 68], note: 'Cool water; a fish of a thousand casts on any day.' },
};

export interface FishingContext {
  /** Species present in this water, in the order locals would name them. */
  species: string[];
  /** Measured if the captain has a sounder reading; otherwise estimated. */
  water_temp_f: number | null;
  water_temp_estimated: boolean;
  /** Local time of the planned departure. */
  when: Date;
  sunrise: Date;
  sunset: Date;
  wind_kn: number;
  chop_ft: number | null;
  cloud_pct: number | null;
  /** Sea-level pressure now and ~6 h before, mb. */
  pressure_mb?: number | null;
  pressure_change_mb?: number | null;
  precip_pct?: number | null;
  thunder?: boolean;
  /** 0 = new, 0.5 = full. */
  moon_phase?: number | null;
}

export interface FishingReport {
  rating: FishingRating;
  headline: string;
  factors: FishingFactor[];
  /** Which species the water temperature actually suits today. */
  active: { species: Species; verdict: 'prime' | 'active' | 'slow' }[];
  bestWindows: { label: string; from: Date; to: Date; why: string }[];
  waterTempNote: string;
  honesty: string;
}

// ---- sun and moon, computed locally (no network, no API key) -------------

const rad = Math.PI / 180;

/** NOAA solar position — sunrise/sunset for a date and place, local Date objects. */
export function sunTimes(date: Date, lat: number, lon: number): { sunrise: Date; sunset: Date } {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const jDate = day.getTime() / 86400000 + 2440587.5;
  const n = Math.round(jDate - 2451545.0 + 0.0008);
  const jStar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  const decl = Math.asin(Math.sin(lambda * rad) * Math.sin(23.44 * rad));
  const cosOmega = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
  // Polar day/night — no sunrise or sunset to give.
  const clamped = Math.max(-1, Math.min(1, cosOmega));
  const omega = Math.acos(clamped) / rad;
  const toDate = (j: number) => new Date((j - 2440587.5) * 86400000);
  return { sunrise: toDate(jTransit - omega / 360), sunset: toDate(jTransit + omega / 360) };
}

const SYNODIC = 29.53058867;
/** 0 = new moon, 0.5 = full. Reference new moon 2000-01-06 18:14 UTC. */
export function moonPhase(date: Date): number {
  const days = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
  const p = (days % SYNODIC) / SYNODIC;
  return p < 0 ? p + 1 : p;
}
export function moonName(phase: number): string {
  const p = phase;
  if (p < 0.03 || p > 0.97) return 'new moon';
  if (p < 0.22) return 'waxing crescent';
  if (p < 0.28) return 'first quarter';
  if (p < 0.47) return 'waxing gibbous';
  if (p < 0.53) return 'full moon';
  if (p < 0.72) return 'waning gibbous';
  if (p < 0.78) return 'last quarter';
  return 'waning crescent';
}

/**
 * Estimated lake surface temperature, from the season and the air.
 *
 * A reservoir's surface follows the year in a lazy sine wave that lags the
 * air by weeks, and no public gauge reports Patoka's water temperature. So
 * this is an ESTIMATE and is labelled as one everywhere it appears — the
 * captain's own sounder reading always replaces it, and that number matters
 * more to fishing than anything else on the page.
 */
export function estimateWaterTempF(date: Date, lat: number, airTempF: number | null): number {
  const doy = Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
  // peak ~5 Aug (day 217), trough ~5 Feb — the lag behind air temperature
  const seasonal = Math.cos(((doy - 217) / 365) * 2 * Math.PI);
  // Calibrated to southern Indiana, where Patoka runs roughly 38°F in February
  // and low-80s in early August, then scaled by latitude: southern water is
  // warmer and swings less, northern water is colder and swings more.
  const mean = Math.max(40, Math.min(82, 61 + (38 - lat) * 1.1));
  const swing = Math.max(6, Math.min(30, 23 - (38 - lat) * 0.7));
  let est = mean + swing * seasonal;
  // A hot or cold spell nudges the surface, but only a little — water is slow.
  if (airTempF != null) est += Math.max(-6, Math.min(6, (airTempF - (mean + swing * seasonal)) * 0.15));
  return Math.round(est);
}

// ---- the assessment ------------------------------------------------------

const hoursBetween = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 3600000;

export function assessFishing(ctx: FishingContext): FishingReport {
  const factors: FishingFactor[] = [];
  let score = 0;

  // --- water temperature: the one that actually governs the fish ---------
  const wt = ctx.water_temp_f;
  const present = ctx.species.map(k => SPECIES[k]).filter(Boolean);
  const active = present.map(s => {
    let verdict: 'prime' | 'active' | 'slow' = 'slow';
    if (wt != null) {
      if (s.primeF && wt >= s.primeF[0] && wt <= s.primeF[1]) verdict = 'prime';
      else if (wt >= s.activeF[0] && wt <= s.activeF[1]) verdict = 'active';
    }
    return { species: s, verdict };
  });
  const primeCount = active.filter(a => a.verdict === 'prime').length;
  const activeCount = active.filter(a => a.verdict !== 'slow').length;
  if (wt != null) {
    const eff: FactorEffect = primeCount >= 2 ? 'good' : activeCount >= 2 ? 'neutral' : 'poor';
    score += primeCount >= 2 ? 2 : activeCount >= 2 ? 0.5 : -2;
    factors.push({
      label: `Water ${Math.round(wt)}°F${ctx.water_temp_estimated ? ' (estimated)' : ''}`,
      effect: eff,
      detail: primeCount
        ? `In the prime band for ${active.filter(a => a.verdict === 'prime').map(a => a.species.name.toLowerCase()).join(', ')}.`
        : activeCount
          ? `Workable for ${active.filter(a => a.verdict === 'active').map(a => a.species.name.toLowerCase()).slice(0, 3).join(', ')}, but nothing is in its best band.`
          : 'Outside the active band for most of what swims here — expect a slow, deep, patient day.',
      basis: 'biology',
    });
  }

  // --- light: time of day and cloud, the part that is genuinely real -----
  const toSunrise = hoursBetween(ctx.when, ctx.sunrise);
  const toSunset = hoursBetween(ctx.when, ctx.sunset);
  // Lead with the species whose low-light feeding is actually documented —
  // that is what lets this factor claim 'biology' rather than 'mechanism'.
  const lowLightFish = present.filter(s => s.lowLight)
    .sort((a, b) => (a.lowLight === 'documented' ? 0 : 1) - (b.lowLight === 'documented' ? 0 : 1));
  const documentedLowLight = lowLightFish[0]?.lowLight === 'documented';
  const nearEdge = Math.min(toSunrise, toSunset);
  if (nearEdge <= 1.5) {
    score += 1.5;
    factors.push({
      label: nearEdge === toSunrise ? 'First light' : 'Last light',
      effect: 'good',
      detail: `You'll be on the water inside the low-light window${
        documentedLowLight ? ` — which is when ${lowLightFish[0].name.toLowerCase()} genuinely see best, and that one is physiology rather than lore` : ''}.`,
      basis: documentedLowLight ? 'biology' : 'mechanism',
    });
  } else if (nearEdge > 4 && (ctx.cloud_pct ?? 50) < 30) {
    score -= 1;
    factors.push({
      label: 'Bright midday sun',
      effect: 'poor',
      detail: 'Hard light pushes fish tight to cover and shade. Fish the structure, or come back at the edges of the day.',
      basis: 'mechanism',
    });
  }
  if (ctx.cloud_pct != null && ctx.cloud_pct >= 60 && nearEdge > 1.5) {
    score += 1;
    factors.push({
      label: `Overcast (${Math.round(ctx.cloud_pct)}% cloud)`,
      effect: 'good',
      detail: 'Less light in the water — fish roam further from cover instead of sitting under it.',
      basis: 'mechanism',
    });
  }

  // --- wind and chop: a real mechanism, within limits --------------------
  const chop = ctx.chop_ft;
  if (chop != null) {
    if (chop >= 0.4 && chop <= 1.6) {
      score += 1;
      factors.push({
        label: `${chop.toFixed(1)} ft chop`,
        effect: 'good',
        detail: 'A walleye chop. Broken water cuts light penetration and hides your line, and wind stacks bait on the windward bank — fish that side.',
        basis: 'mechanism',
      });
    } else if (chop > 2.4) {
      score -= 1.5;
      factors.push({ label: `${chop.toFixed(1)} ft chop`, effect: 'poor', detail: 'Too rough to hold a position or feel a bite — boat control becomes the whole day.', basis: 'mechanism' });
    } else if (chop < 0.2 && (ctx.cloud_pct ?? 50) < 40) {
      score -= 0.5;
      factors.push({ label: 'Slick calm', effect: 'poor', detail: 'Glass water and bright sky — fish can inspect everything. Go lighter and longer than you want to.', basis: 'mechanism' });
    }
  }

  // --- pressure: shown, labelled, barely weighted ------------------------
  if (ctx.pressure_change_mb != null) {
    const d = ctx.pressure_change_mb;
    const effect: FactorEffect = d <= -2 ? 'good' : d >= 3 ? 'poor' : 'neutral';
    score += d <= -2 ? 0.4 : d >= 3 ? -0.4 : 0;
    factors.push({
      label: `Pressure ${d > 0 ? 'rising' : d < 0 ? 'falling' : 'steady'} ${Math.abs(d).toFixed(0)} mb`,
      effect,
      detail: d <= -2
        ? 'Anglers fish a falling glass ahead of a front and swear by it. What actually changes is the cloud, wind and light that come with it — the pressure itself is a marker, not a mechanism.'
        : d >= 3
          ? 'The classic bluebird day behind a front, which anglers call tough. Again: what changed is the light and the wind, not the weight of the air.'
          : 'Steady — no story either way.',
      basis: 'tradition',
    });
  }

  // --- rain and storms ----------------------------------------------------
  if (ctx.thunder) {
    factors.push({ label: 'Thunderstorms', effect: 'poor', detail: 'Not a fishing question. Stay off the water.', basis: 'biology' });
    score -= 4;
  } else if ((ctx.precip_pct ?? 0) >= 60) {
    factors.push({ label: `${Math.round(ctx.precip_pct!)}% rain`, effect: 'neutral', detail: 'Light rain is often good fishing and bad sitting. Run-off can stain the creek arms — clarity is the thing to watch.', basis: 'mechanism' });
  }

  // --- moon: flavour, and said so ----------------------------------------
  if (ctx.moon_phase != null) {
    factors.push({
      label: `Moon: ${moonName(ctx.moon_phase)}`,
      effect: 'neutral',
      detail: 'Solunar theory puts peak feeding at moonrise, moonset and the moon overhead. There is no established evidence for it in freshwater, and no tide here for it to work through. Shown because plenty of good anglers fish by it — not counted in the rating.',
      basis: 'tradition',
    });
  }

  // Storms aren't a fishing grade — there is no bite worth it, so the rating
  // is floored rather than averaged against a nice water temperature.
  const rating: FishingRating = ctx.thunder ? 'slow'
    : score >= 3 ? 'prime' : score >= 1.2 ? 'good' : score >= -1 ? 'fair' : 'slow';
  const headline =
    ctx.thunder ? 'Storms in the window — this isn\'t a fishing question today'
    : rating === 'prime' ? 'Conditions line up about as well as they get'
    : rating === 'good' ? 'A good day to be fishing'
    : rating === 'fair' ? 'Fishable — you may have to work for them'
    : 'Tough conditions; go for the boat ride and take the rod anyway';

  // --- when to be on the water -------------------------------------------
  const bestWindows = [
    { label: 'Dawn', from: new Date(ctx.sunrise.getTime() - 45 * 60000), to: new Date(ctx.sunrise.getTime() + 105 * 60000), why: 'Low light, cooler surface, bait moving.' },
    { label: 'Dusk', from: new Date(ctx.sunset.getTime() - 105 * 60000), to: new Date(ctx.sunset.getTime() + 45 * 60000), why: 'The same window on the other end of the day.' },
  ];

  const waterTempNote = wt == null
    ? 'No water temperature — it is the single most useful number for fishing. Your sounder reads it; type it in.'
    : ctx.water_temp_estimated
      ? `Water temperature is ESTIMATED from the season and air temperature — no public gauge reports Patoka-class lakes. Your sounder reading replaces it and makes everything below sharper.`
      : 'Water temperature is your own reading.';

  return {
    rating, headline, factors, active, bestWindows, waterTempNote,
    honesty: 'Rated on water temperature, light and wind — the factors with real biology or a real mechanism behind them. Pressure and moon are shown because anglers use them, labelled because the evidence is thin, and weighted near zero. No app knows whether the fish will bite.',
  };
}
