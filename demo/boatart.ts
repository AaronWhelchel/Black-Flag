/**
 * Boat art — your boat, drawn to scale, in today's water.
 *
 * This is not decoration. The whole argument of the day plan is that two feet
 * of chop is a pleasant afternoon on a 31 ft cruiser and a beating in a 16 ft
 * runabout, and that argument lands far harder as a picture than as a
 * sentence. So the hull is drawn at the boat's real length, the draft is the
 * real draft below the real waterline, and the waves are the day's estimated
 * chop at the same scale. If the water looks big next to your boat, it is.
 *
 * Everything is derived from numbers already in the vessel record, so a boat
 * the captain corrects immediately looks different.
 */

export type HullStyle =
  | 'open_bow' | 'center_console' | 'cruiser' | 'sportfish' | 'sailboat' | 'pwc'
  | 'pontoon' | 'jon_boat' | 'kayak' | 'houseboat';

export interface BoatArtOpts {
  style: HullStyle;
  loa_ft: number;
  draft_ft?: number | null;
  air_draft_ft?: number | null;
  /** Today's chop, drawn at the same scale as the hull. */
  chop_ft?: number | null;
  name?: string;
  /** Draw the draft and chop callouts. */
  annotate?: boolean;
  height?: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const n = (v: number) => Math.round(v * 100) / 100;

/** Freeboard — how much hull sits above the water — as a fraction of length. */
const FREEBOARD: Record<HullStyle, number> = {
  open_bow: 0.13, center_console: 0.14, cruiser: 0.17, sportfish: 0.17,
  sailboat: 0.12, pwc: 0.16, pontoon: 0.11, jon_boat: 0.10, kayak: 0.05, houseboat: 0.16,
};

/** Height above the waterline when the record doesn't say (mast, T-top, arch). */
export function defaultAirDraft(style: HullStyle, L: number, F: number): number {
  switch (style) {
    case 'sailboat': return L * 1.35;
    case 'center_console': return F + L * 0.28;
    case 'sportfish': return F + L * 0.38;
    case 'cruiser': return F + L * 0.30;
    case 'houseboat': return F + L * 0.26;
    case 'pontoon': return F + L * 0.24;
    default: return F + L * 0.14;
  }
}

/** How far the DRAWING actually reaches above the water. A mast is 40 ft on a
 *  30 ft boat, so framing to it would shrink the hull to a splinter — the rig
 *  runs off the top of the frame and the air draft is stated in words. */
function drawnTopFt(style: HullStyle, L: number, F: number): number {
  switch (style) {
    case 'sportfish': return F + L * 0.44;
    case 'center_console': return F + L * 0.30;
    case 'cruiser': return F + L * 0.24;
    case 'pontoon': return F * 0.5 + L * 0.30;
    case 'houseboat': return F * 0.5 + L * 0.24;
    case 'sailboat': return F * 1.3 + L * 0.30;   // mast stub, deliberately cut
    default: return F * 2.2;
  }
}

/** Where the hull is deepest, so the draft mark lands on the keel. */
const deepestX = (style: HullStyle) =>
  style === 'sailboat' ? 0.47 : style === 'pontoon' ? 0.5 : style === 'kayak' || style === 'pwc' ? 0.5 : 0.14;

/** Hull and superstructure in profile, bow to the right. Units are FEET,
 *  waterline at y = 0, above water is negative y. */
function hullPaths(style: HullStyle, L: number, D: number, F: number): { fill: string; line: string }[] {
  const out: { fill: string; line: string }[] = [];
  const deep = Math.max(D, L * 0.02);

  const runabout = (sheerBow: number) => `
    M 0,${n(-F)} L 0,${n(deep * 0.92)}
    C ${n(L * 0.3)},${n(deep)} ${n(L * 0.58)},${n(deep * 0.86)} ${n(L * 0.84)},${n(deep * 0.16)}
    L ${n(L)},${n(-F * sheerBow)}
    C ${n(L * 0.68)},${n(-F * (sheerBow * 0.82))} ${n(L * 0.32)},${n(-F * 1.04)} 0,${n(-F)} Z`;

  switch (style) {
    case 'open_bow':
    case 'sportfish':
    case 'cruiser':
    case 'center_console': {
      out.push({ fill: 'hull', line: runabout(style === 'cruiser' || style === 'sportfish' ? 1.35 : 1.55) });
      // engines
      if (style === 'open_bow' || style === 'center_console') {
        out.push({ fill: 'dark', line: `M ${n(-L * 0.055)},${n(-F * 0.55)} h ${n(L * 0.055)} v ${n(F * 0.55 + deep * 0.75)} h ${n(-L * 0.035)} z` });
      }
      if (style === 'center_console') {
        out.push({ fill: 'house', line: `M ${n(L * 0.45)},${n(-F)} h ${n(L * 0.13)} v ${n(-L * 0.14)} h ${n(-L * 0.13)} z` });   // console
        out.push({ fill: 'dark', line: `M ${n(L * 0.4)},${n(-F - L * 0.26)} h ${n(L * 0.24)} v ${n(L * 0.018)} h ${n(-L * 0.24)} z` });  // T-top
        out.push({ fill: 'dark', line: `M ${n(L * 0.45)},${n(-F - L * 0.26)} v ${n(L * 0.12)} M ${n(L * 0.6)},${n(-F - L * 0.26)} v ${n(L * 0.12)}` });
      }
      if (style === 'cruiser' || style === 'sportfish') {
        out.push({ fill: 'house', line: `M ${n(L * 0.18)},${n(-F)} L ${n(L * 0.2)},${n(-F - L * 0.2)} L ${n(L * 0.55)},${n(-F - L * 0.21)} L ${n(L * 0.68)},${n(-F - L * 0.06)} L ${n(L * 0.68)},${n(-F)} Z` });
        out.push({ fill: 'glass', line: `M ${n(L * 0.56)},${n(-F - L * 0.185)} L ${n(L * 0.655)},${n(-F - L * 0.07)} L ${n(L * 0.655)},${n(-F - L * 0.03)} L ${n(L * 0.56)},${n(-F - L * 0.03)} Z` });
        if (style === 'sportfish') {
          out.push({ fill: 'dark', line: `M ${n(L * 0.34)},${n(-F - L * 0.2)} v ${n(-L * 0.18)} M ${n(L * 0.3)},${n(-F - L * 0.38)} h ${n(L * 0.14)}` });   // tower
          out.push({ fill: 'dark', line: `M ${n(L * 0.1)},${n(-F - L * 0.02)} L ${n(-L * 0.02)},${n(-F - L * 0.34)}` });   // outrigger
        }
      }
      break;
    }
    case 'pontoon': {
      // Tubes straddle the waterline; the deck sits on top of them.
      const tube = Math.max(deep * 1.6, L * 0.055);
      const tubeTop = -tube * 0.45;
      out.push({ fill: 'hull', line: `M ${n(L * 0.04)},${n(tubeTop)} h ${n(L * 0.88)} a ${n(tube * 0.5)},${n(tube * 0.5)} 0 0 1 0,${n(tube)} h ${n(-L * 0.88)} a ${n(tube * 0.5)},${n(tube * 0.5)} 0 0 1 0,${n(-tube)} z` });
      out.push({ fill: 'house', line: `M 0,${n(tubeTop)} h ${n(L)} v ${n(-F * 0.5)} h ${n(-L)} z` });   // deck
      out.push({ fill: 'line', line: `M ${n(L * 0.04)},${n(tubeTop - F * 0.5)} v ${n(-L * 0.07)} h ${n(L * 0.92)} v ${n(L * 0.07)}` });   // rail
      out.push({ fill: 'dark', line: `M ${n(L * 0.22)},${n(tubeTop - F * 0.5 - L * 0.24)} h ${n(L * 0.48)} M ${n(L * 0.26)},${n(tubeTop - F * 0.5 - L * 0.24)} v ${n(L * 0.17)} M ${n(L * 0.66)},${n(tubeTop - F * 0.5 - L * 0.24)} v ${n(L * 0.17)}` });
      out.push({ fill: 'dark', line: `M ${n(-L * 0.05)},${n(tubeTop)} h ${n(L * 0.05)} v ${n(tube * 1.3)} h ${n(-L * 0.032)} z` });
      break;
    }
    case 'jon_boat': {
      out.push({ fill: 'hull', line: `M 0,${n(-F)} L 0,${n(deep)} L ${n(L * 0.88)},${n(deep)} L ${n(L)},${n(-F * 0.9)} Z` });
      out.push({ fill: 'dark', line: `M ${n(-L * 0.06)},${n(-F * 0.4)} h ${n(L * 0.06)} v ${n(F * 0.4 + deep * 0.9)} h ${n(-L * 0.04)} z` });
      break;
    }
    case 'kayak': {
      out.push({ fill: 'hull', line: `M 0,${n(-F * 1.6)} C ${n(L * 0.15)},${n(-F * 0.2)} ${n(L * 0.85)},${n(-F * 0.2)} ${n(L)},${n(-F * 1.8)} C ${n(L * 0.8)},${n(deep * 1.3)} ${n(L * 0.2)},${n(deep * 1.3)} 0,${n(-F * 1.6)} Z` });
      out.push({ fill: 'dark', line: `M ${n(L * 0.46)},${n(-F * 0.6)} l ${n(L * 0.03)},${n(-L * 0.15)} l ${n(L * 0.03)},${n(L * 0.15)}` });   // paddler
      break;
    }
    case 'pwc': {
      out.push({ fill: 'hull', line: `M 0,${n(-F * 0.4)} C ${n(L * 0.1)},${n(deep * 1.2)} ${n(L * 0.75)},${n(deep * 1.1)} ${n(L)},${n(-F * 1.1)} C ${n(L * 0.75)},${n(-F * 1.5)} ${n(L * 0.35)},${n(-F * 1.35)} 0,${n(-F * 0.4)} Z` });
      out.push({ fill: 'dark', line: `M ${n(L * 0.42)},${n(-F * 1.35)} l ${n(-L * 0.04)},${n(-L * 0.12)} l ${n(L * 0.16)},${n(-L * 0.02)}` });   // bars
      break;
    }
    case 'houseboat': {
      out.push({ fill: 'hull', line: `M 0,${n(-F * 0.5)} L 0,${n(deep)} L ${n(L * 0.9)},${n(deep)} L ${n(L)},${n(-F * 0.5)} Z` });
      out.push({ fill: 'house', line: `M ${n(L * 0.05)},${n(-F * 0.5)} h ${n(L * 0.8)} v ${n(-L * 0.2)} h ${n(-L * 0.8)} z` });
      out.push({ fill: 'glass', line: `M ${n(L * 0.12)},${n(-F * 0.5 - L * 0.15)} h ${n(L * 0.2)} v ${n(L * 0.08)} h ${n(-L * 0.2)} z M ${n(L * 0.4)},${n(-F * 0.5 - L * 0.15)} h ${n(L * 0.2)} v ${n(L * 0.08)} h ${n(-L * 0.2)} z` });
      out.push({ fill: 'dark', line: `M ${n(L * 0.1)},${n(-F * 0.5 - L * 0.2)} h ${n(L * 0.7)} v ${n(-L * 0.015)} h ${n(-L * 0.7)} z` });
      break;
    }
    case 'sailboat': {
      out.push({ fill: 'hull', line: `
        M 0,${n(-F * 0.9)} L 0,${n(F * 0.15)}
        C ${n(L * 0.25)},${n(F * 0.5)} ${n(L * 0.6)},${n(F * 0.45)} ${n(L * 0.93)},${n(-F * 0.1)}
        L ${n(L)},${n(-F * 1.25)}
        C ${n(L * 0.65)},${n(-F * 1.05)} ${n(L * 0.3)},${n(-F * 0.95)} 0,${n(-F * 0.9)} Z` });
      out.push({ fill: 'dark', line: `M ${n(L * 0.42)},${n(F * 0.4)} h ${n(L * 0.1)} l ${n(-L * 0.012)},${n(deep)} h ${n(-L * 0.076)} z` });   // fin keel
      out.push({ fill: 'dark', line: `M ${n(L * 0.12)},${n(F * 0.35)} l ${n(L * 0.02)},${n(deep * 0.75)} l ${n(L * 0.012)},${n(-deep * 0.75)}` });  // rudder
      out.push({ fill: 'dark', line: `M ${n(L * 0.5)},${n(-F * 1.05)} v ${n(-(F * 1.3 + L * 0.32))}` });   // mast, running off the top
      out.push({ fill: 'dark', line: `M ${n(L * 0.5)},${n(-F * 1.05 - L * 0.09)} L ${n(L * 0.22)},${n(-F * 1.05 - L * 0.055)}` });   // boom
      break;
    }
  }
  return out;
}

/**
 * An SVG of this boat, at this length, in this chop. Width is fluid; the
 * caller sizes it with CSS.
 */
export function boatSvg(o: BoatArtOpts): string {
  const L = Math.max(4, o.loa_ft || 18);
  const F = L * (FREEBOARD[o.style] ?? 0.13);
  const D = Math.max(0.2, o.draft_ft ?? L * 0.06);
  const air = o.air_draft_ft ?? defaultAirDraft(o.style, L, F);
  const chop = Math.max(0, o.chop_ft ?? 0);

  // The frame has to fit the boat, its keel and the waves — all in feet, so
  // everything stays honestly to scale against everything else. A mast is the
  // exception: framing a 30 ft sloop around a 40 ft rig shrinks the hull to a
  // splinter and tells the captain nothing, so tall rigs run off the top and
  // the air draft is stated in words instead.
  const above = Math.max(drawnTopFt(o.style, L, F), chop * 2.2) + L * 0.05;
  const below = Math.max(D, chop * 1.2) + L * 0.06;
  const padX = L * 0.14;
  const vbW = L + padX * 2, vbH = above + below;
  const parts = hullPaths(o.style, L, D, F);

  // Chop drawn as a real wave train at the boat's own scale.
  const amp = chop / 2;
  const wl = 6 + chop * 9;            // longer waves for bigger seas
  const wave = (yOff: number, op: number, phase = 0) => {
    const x0 = -padX * 3;
    let d = `M ${n(x0)},${n(yOff)}`;
    let k = 0;
    for (let x = x0; x < L + padX * 3; x += wl / 2, k++) {
      d += ` Q ${n(x + wl / 4)},${n(yOff + ((k + phase) % 2 ? amp : -amp) * 2)} ${n(x + wl / 2)},${n(yOff)}`;
    }
    return `<path d="${d}" fill="none" stroke="#2f7fd4" stroke-opacity="${op}" stroke-width="${n(Math.max(0.05, L * 0.009))}" stroke-linecap="round"/>`;
  };

  const stroke = n(Math.max(0.05, L * 0.007));
  const paint: Record<string, string> = {
    hull: `fill="#1d3557" stroke="#0f2038" stroke-width="${stroke}"`,
    dark: `fill="none" stroke="#0f2038" stroke-width="${n(stroke * 2.4)}" stroke-linecap="round"`,
    house: `fill="#e8eef6" stroke="#0f2038" stroke-width="${stroke}"`,
    glass: `fill="#7fb2e5" stroke="none"`,
    line: `fill="none" stroke="#4a6d99" stroke-width="${n(stroke * 1.6)}" stroke-linecap="round"`,
  };
  const shapes = parts.map(p => `<path d="${p.line}" ${paint[p.fill] ?? paint.hull}/>`).join('');

  // Text does NOT go inside the drawing: it would scale with the boat, so a
  // 50 ft houseboat and a 12 ft kayak would carry wildly different type. The
  // numbers are set in HTML beside the SVG, where they stay legible.
  const dx = deepestX(o.style);
  const ann = o.annotate === false ? '' : `
    <line x1="${n(L * dx)}" y1="0" x2="${n(L * dx)}" y2="${n(D)}" stroke="#d9484f" stroke-width="${n(stroke * 1.6)}" stroke-dasharray="${n(L * 0.018)} ${n(L * 0.018)}"/>
    <line x1="${n(L * dx - L * 0.03)}" y1="${n(D)}" x2="${n(L * dx + L * 0.03)}" y2="${n(D)}" stroke="#d9484f" stroke-width="${n(stroke * 1.6)}"/>`;

  return `<svg viewBox="${n(-padX)} ${n(-above)} ${n(vbW)} ${n(vbH)}" width="100%" height="${o.height ?? 190}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(o.name ?? 'your boat')}, ${Math.round(L)} feet, drawn to scale in ${n(Math.round(chop * 10) / 10)} foot chop">
    <defs>
      <linearGradient id="bfsky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#eaf2fb"/><stop offset="1" stop-color="#f7fbff"/>
      </linearGradient>
      <linearGradient id="bfsea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#cfe3f6"/><stop offset="1" stop-color="#9dc2e6"/>
      </linearGradient>
    </defs>
    <rect x="${n(-vbW * 4)}" y="${n(-vbH * 6)}" width="${n(vbW * 9)}" height="${n(vbH * 6)}" fill="url(#bfsky)"/>
    <rect x="${n(-vbW * 4)}" y="0" width="${n(vbW * 9)}" height="${n(vbH * 6)}" fill="url(#bfsea)"/>
    ${chop > 0.05 ? wave(-amp * 0.7, 0.3, 1) : ''}
    ${shapes}
    ${ann}
    ${chop > 0.05
      ? wave(amp * 0.35, 0.85) + wave(amp * 1.1, 0.4, 1)
      : `<line x1="${n(-vbW * 4)}" y1="0" x2="${n(vbW * 5)}" y2="0" stroke="#2f7fd4" stroke-opacity=".5" stroke-width="${n(stroke * 1.2)}"/>`}
  </svg>`;
}

/** The catalogue's categories and the vessel editor's types both land here. */
export function hullStyleFor(type?: string, category?: string, loa?: number): HullStyle {
  const t = (category ?? type ?? '').toLowerCase();
  if (/pontoon/.test(t)) return 'pontoon';
  if (/kayak|canoe|paddle/.test(t)) return 'kayak';
  if (/jon|skiff|dinghy|jon_boat/.test(t)) return 'jon_boat';
  if (/houseboat/.test(t)) return 'houseboat';
  if (/sail|catamaran/.test(t)) return 'sailboat';
  if (/pwc|jet-?ski/.test(t)) return 'pwc';
  if (/sportfish|trawler/.test(t)) return 'sportfish';
  if (/cruiser|yacht|express/.test(t)) return 'cruiser';
  if (/center|walkaround|bass|centre/.test(t)) return 'center_console';
  if (/bowrider|open_bow|deck|runabout/.test(t)) return 'open_bow';
  return (loa ?? 18) >= 26 ? 'cruiser' : 'open_bow';
}
