/**
 * Vessels — the catalogue a captain picks their boat from.
 *
 * One record covers a 16 ft runabout and RMS Titanic, because a captain
 * should be able to find whatever they're actually piloting: a rented kayak,
 * their own Tahoe T16, a delivery on someone's 44 ft trawler, or a ferry.
 *
 * The hard rule here is HONESTY ABOUT NUMBERS. Draft feeds depth-aware
 * routing, air draft decides whether you fit under a bridge — a wrong number
 * grounds a boat or takes the mast off. So every record says where its
 * figures came from and which of them are class-typical estimates rather
 * than published specifications, and the app refuses to route on an
 * estimated draft without telling the captain it is estimating.
 */

export type VesselCategory =
  | 'kayak' | 'canoe' | 'paddleboard' | 'dinghy' | 'jet-ski'
  | 'jon-boat' | 'bass-boat' | 'runabout' | 'bowrider' | 'deck-boat' | 'pontoon'
  | 'center-console' | 'walkaround' | 'cuddy' | 'express-cruiser' | 'motor-yacht'
  | 'trawler' | 'houseboat' | 'sailboat' | 'catamaran' | 'rib'
  | 'tug' | 'ferry' | 'cargo' | 'tanker' | 'container' | 'cruise-ship'
  | 'ocean-liner' | 'warship' | 'submarine' | 'fishing-vessel' | 'tall-ship'
  | 'workboat' | 'other';

export type PowerType =
  | 'outboard' | 'inboard' | 'sterndrive' | 'jet' | 'sail' | 'paddle' | 'oar'
  | 'steam' | 'diesel' | 'diesel-electric' | 'gas-turbine' | 'nuclear' | 'electric' | 'other';

/** Where a record's numbers came from, and how much to trust them. */
export interface VesselProvenance {
  source: string;                 // 'Wikidata', 'manufacturer', 'captain', …
  license: string;                // 'CC0', 'curated', 'captain-contributed'
  url?: string;
  /** published = from a spec sheet or reference; estimated = typical for the
   *  class; captain = someone measured their own boat. */
  confidence: 'published' | 'estimated' | 'captain';
  fetched?: string;
}

export interface VesselSpec {
  id: string;
  name: string;                   // display name, e.g. 'Tahoe T16'
  make?: string;
  model?: string;
  year_from?: number;
  year_to?: number;
  category: VesselCategory;
  /** A production model many people own, or one specific named ship. */
  kind: 'model' | 'ship';

  loa_ft?: number;
  beam_ft?: number;
  /** The figure ROUTING uses. For an outboard boat that is the drive DOWN:
   *  the shallowest water you meet is at idle coming off a ramp or into a
   *  cove, which is exactly when the leg is down. */
  draft_ft?: number;
  draft_up_ft?: number;
  draft_down_ft?: number;
  air_draft_ft?: number;          // height above waterline — bridges
  displacement_lb?: number;
  dry_weight_lb?: number;
  deadrise_deg?: number;
  max_hp?: number;
  gross_tonnage?: number;

  power?: { type?: PowerType; make?: string; model?: string; hp?: number; count?: number };
  performance?: {
    cruise_kn?: number; top_kn?: number; top_mph?: number; rpm_at_top?: number;
    fuel_gph_cruise?: number; range_nm?: number;
  };
  capacity?: {
    persons?: number; fuel_gal?: number; water_gal?: number; berths?: number;
    passengers?: number; crew?: number;
    /** Overloading is a real way to sink a small boat — if the maker states
     *  a limit, a captain planning six aboard should be able to see it. */
    max_persons_lb?: number; max_total_lb?: number;
  };

  uses?: string[];                // 'skiing', 'tubing', 'fishing', 'cruising', …
  notes?: string;
  /** Field names whose values are class-typical, not published for THIS boat. */
  estimated?: string[];
  provenance: VesselProvenance;
}

/** Compact row carried in the search index (the full record is fetched on
 *  demand) — a catalogue of every boat afloat can't all sit in memory. */
export type VesselIndexRow = [
  id: string, name: string, category: VesselCategory,
  loa_ft: number | null, draft_ft: number | null, hp: number | null, kind: 0 | 1,
];

export const FT_PER_M = 3.280839895;
export const KN_PER_MPH = 0.868976;
export const MPH_PER_KN = 1.150779;

export const round1 = (n: number) => Math.round(n * 10) / 10;

/** Is this number safe to route on, or is it a guess we have to declare? */
export function draftBasis(v: Pick<VesselSpec, 'draft_ft' | 'estimated' | 'provenance'>):
  'published' | 'estimated' | 'captain' | 'unknown' {
  if (v.draft_ft == null) return 'unknown';
  if (v.estimated?.includes('draft_ft')) return 'estimated';
  return v.provenance.confidence;
}

/** Normalise free text for matching: fold case, punctuation and spacing so
 *  "Tahoe T-16", "tahoe t16" and "TAHOE  T 16" are the same search. */
export function searchKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const CATEGORY_WORDS: Partial<Record<VesselCategory, string>> = {
  'jet-ski': 'jetski personal watercraft pwc',
  'runabout': 'runabout ski boat',
  'bowrider': 'bowrider',
  'pontoon': 'pontoon party barge',
  'center-console': 'center console centre',
  'express-cruiser': 'express cruiser',
  'motor-yacht': 'motor yacht',
  'cruise-ship': 'cruise ship liner',
  'ocean-liner': 'ocean liner',
  'fishing-vessel': 'fishing trawler commercial',
  'rib': 'rib inflatable',
};

/** Everything a row should be findable by, in one string. */
export function rowHaystack(row: VesselIndexRow): string {
  return `${searchKey(row[1])} ${row[2]} ${CATEGORY_WORDS[row[2]] ?? ''}`;
}

export interface VesselSearchHit { row: VesselIndexRow; score: number }

/**
 * Search the catalogue. Ranking favours, in order: an exact name, a name
 * starting with the query, all query words present in the name, then a
 * category match — so typing "tahoe t16" finds the boat and typing "pontoon"
 * finds the class.
 */
export function searchVessels(
  rows: VesselIndexRow[],
  query: string,
  opts: { limit?: number; haystacks?: string[] } = {},
): VesselSearchHit[] {
  const q = searchKey(query);
  if (!q) return [];
  const words = q.split(' ');
  const limit = opts.limit ?? 40;
  const hits: VesselSearchHit[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = searchKey(row[1]);
    const hay = opts.haystacks ? opts.haystacks[i] : rowHaystack(row);
    let score = 0;
    if (name === q) score = 1000;
    else if (name.startsWith(q)) score = 700 - Math.min(200, name.length);
    else if (name.includes(q)) score = 500 - Math.min(200, name.length);
    else if (words.every(w => hay.includes(w))) score = 300 - Math.min(200, name.length);
    else continue;
    // a real production model beats a one-off ship when scores tie, and
    // records that actually carry dimensions beat bare names
    if (row[6] === 0) score += 12;
    if (row[4] != null) score += 8;
    if (row[3] != null) score += 4;
    hits.push({ row, score });
  }
  hits.sort((a, b) => b.score - a.score || a.row[1].localeCompare(b.row[1]));
  return hits.slice(0, limit);
}

/** One-line summary for a search result row. */
export function describeRow(row: VesselIndexRow): string {
  const bits: string[] = [];
  if (row[3] != null) bits.push(`${round1(row[3])} ft`);
  bits.push(row[2].replace(/-/g, ' '));
  if (row[5] != null) bits.push(`${row[5]} hp`);
  if (row[4] != null) bits.push(`${round1(row[4])} ft draft`);
  return bits.join(' · ');
}

/** Fields the trip planner actually consumes, pulled off a catalogue record. */
export interface VesselTripFields {
  draft_ft?: number;
  beam_ft?: number;
  air_draft_ft?: number;
  cruise_kn?: number;
  fuel_capacity_gal?: number;
  burn_gph_cruise?: number;
}

export function tripFieldsOf(v: VesselSpec): VesselTripFields {
  const cruise = v.performance?.cruise_kn
    ?? (v.performance?.top_kn != null ? round1(v.performance.top_kn * 0.7) : undefined)
    ?? (v.performance?.top_mph != null ? round1(v.performance.top_mph * KN_PER_MPH * 0.7) : undefined);
  return {
    // The deeper figure is the one to plan on: an outboard boat meets its
    // shallowest water at idle, which is exactly when the leg is down.
    draft_ft: v.draft_down_ft ?? v.draft_ft,
    beam_ft: v.beam_ft,
    air_draft_ft: v.air_draft_ft,
    cruise_kn: cruise,
    fuel_capacity_gal: v.capacity?.fuel_gal,
    burn_gph_cruise: v.performance?.fuel_gph_cruise,
  };
}
