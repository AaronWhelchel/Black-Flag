/**
 * Vessel artwork — the real drawing of a real boat.
 *
 * The parametric silhouettes in boatart.ts are honest about dimensions and
 * useless at identity: every 16 ft runabout comes out the same shape. A
 * captain wants to open the app and see THEIR boat. So models can carry a
 * proper drawing, and the app prefers it wherever the boat is shown as
 * itself — the dock, the catalogue record, the day's hero.
 *
 * The generated silhouette doesn't retire. It stays for the 47,000 vessels
 * nobody has drawn yet, and it stays for the one job the artwork can't do:
 * standing the hull against today's chop at true scale, which needs a side
 * view and a waterline.
 *
 * Artwork is matched by catalogue id first, then by make and model, so a
 * captain who typed their boat in by hand still gets the picture.
 */

export interface VesselArt {
  /** data URL, injected at build time so the demo stays one offline file */
  src: string;
  /** plan (from above) or profile (from the side) */
  view: 'plan' | 'profile';
  /** drawn light-on-dark, so it wants a dark panel behind it */
  onDark: boolean;
  credit?: string;
}

interface ArtEntry extends VesselArt {
  ids?: string[];
  make?: RegExp;
  model?: RegExp;
  /** Tested against the name folded to lowercase words: "Tahoe-T16",
   *  "TAHOE T 16" and "tahoe_t16" all have to find the same drawing. */
  nameRe?: RegExp;
}

const ART: ArtEntry[] = [
  {
    ids: ['tahoe-t16'],
    make: /^tahoe$/i,
    model: /^t-?16$/i,
    nameRe: /^tahoe t ?16$/,
    src: '__ART_TAHOE_T16__',
    view: 'plan',
    onDark: true,
  },
];

const norm = (s?: string | null) => (s ?? '').trim();
/** Fold punctuation and case so hand-typed names still match. */
const fold = (s?: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Artwork for this boat, or null if nobody has drawn it yet. */
export function artFor(v: { id?: string; catalog_id?: string; make?: string; model?: string; name?: string }): VesselArt | null {
  const id = norm(v.catalog_id) || norm(v.id);
  const name = norm(v.name);
  for (const a of ART) {
    if (id && a.ids?.includes(id)) return a;
    if (a.make && a.model && norm(v.make) && norm(v.model)) {
      if (a.make.test(norm(v.make)) && a.model.test(norm(v.model))) return a;
    }
    // A hand-entered boat usually only has a name: "Tahoe T16", "Tahoe-T16"
    if (name) {
      const f = fold(name);
      if (a.nameRe?.test(f)) return a;
      const parts = f.split(' ');
      if (a.make && a.model && parts.length >= 2 && a.make.test(parts[0]) && a.model.test(parts.slice(1).join(' '))) return a;
    }
  }
  return null;
}

export const hasArt = (v: Parameters<typeof artFor>[0]) => artFor(v) !== null;
