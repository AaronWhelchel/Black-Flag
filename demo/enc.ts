/**
 * ENC chart-pack loader & renderer — decodes the PMTiles packs built by
 * tools/packs/enc.mjs (NOAA S-57 → GDAL → tippecanoe) directly in the
 * browser. Range-reads from local files, no server needed: captains load a
 * regional pack once and keep it offline (Offline & Sync Design).
 *
 * Honesty: every drawn surface carries the pack's provenance, the chart says
 * "not for navigation positioning", and depth gating for auto-routing uses
 * DRVAL1 — the band's guaranteed MINIMUM depth (the ENC safety-contour
 * semantic) — never an average.
 */
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

export const ENC_ROLES = [
  'depth-areas', 'depth-contours', 'coastline', 'soundings',
  'buoys-lateral', 'buoys-special', 'lights', 'obstructions', 'wrecks', 'restricted-areas',
  // inland (USACE IENC)
  'sailing-line', 'mile-markers', 'locks', 'dams', 'bridges',
  'coverage',
] as const;
export type EncRole = (typeof ENC_ROLES)[number];

export interface EncFeature { geom: { type: string; coordinates: any }; props: Record<string, any>; tb?: [number, number, number, number] }
/** A polygon plus the bounds of the tile it came from — consumers paint it
 *  through that window. Cutting concave geometry with Sutherland–Hodgman
 *  BRIDGED notches (phantom water straight across a Patoka peninsula);
 *  painting uncut geometry through a per-tile clip rect is exact. */
export interface GatePoly { rings: number[][][]; tb?: [number, number, number, number] }
export interface BBox { minLat: number; maxLat: number; minLon: number; maxLon: number }

/** pmtiles Source over a local Blob/File — range reads, nothing loaded whole. */
class BlobSource {
  constructor(private blob: Blob, private key: string) {}
  getKey() { return this.key; }
  async getBytes(offset: number, length: number) {
    return { data: await this.blob.slice(offset, offset + length).arrayBuffer() };
  }
}

const lon2tx = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2ty = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

interface RoleState { pm: PMTiles; minZoom: number; maxZoom: number; bounds: [number, number, number, number] }

export class EncPack {
  roles = new Map<EncRole, RoleState>();
  region = '';
  provenance = 'ENC pack';
  /** called when async tile decodes finish — hook to chart.render() */
  onTiles: (() => void) | null = null;
  private tiles = new Map<string, EncFeature[] | 'loading'>();

  static parseRole(name: string): EncRole | null {
    const m = name.match(/-(depth-areas|depth-contours|coastline|soundings|buoys-lateral|buoys-special|lights|obstructions|wrecks|restricted-areas|sailing-line|mile-markers|locks|dams|bridges|coverage)\.pmtiles$/);
    return (m ? (m[1] as EncRole) : null);
  }

  static async fromFiles(files: { name: string; blob: Blob }[]): Promise<EncPack> {
    const pack = new EncPack();
    for (const f of files) {
      if (f.name.endsWith('manifest.json')) {
        try {
          const man = JSON.parse(await f.blob.text());
          if (man.region) pack.region = man.region;
          if (man.provenance?.source) pack.provenance = man.provenance.source;
        } catch { /* manifest optional */ }
        continue;
      }
      const role = EncPack.parseRole(f.name);
      if (!role) continue;
      const pm = new PMTiles(new BlobSource(f.blob, f.name) as any);
      const h = await pm.getHeader();
      pack.roles.set(role, { pm, minZoom: h.minZoom, maxZoom: h.maxZoom, bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat] });
      if (!pack.region) pack.region = f.name.replace(/-(depth-areas|depth-contours|coastline|soundings|buoys-lateral|buoys-special|lights|obstructions|wrecks|restricted-areas|sailing-line|mile-markers|locks|dams|bridges|coverage)\.pmtiles$/, '');
    }
    if (pack.roles.size === 0) throw new Error('no recognizable .pmtiles layers in the selected files');
    return pack;
  }

  /** does any layer of this pack cover (intersect) the given viewport? */
  covers(bb: BBox): boolean {
    for (const r of this.roles.values()) {
      const [w, s, e, n] = r.bounds;
      if (bb.minLon <= e && bb.maxLon >= w && bb.minLat <= n && bb.maxLat >= s) return true;
    }
    return false;
  }

  boundsOf(role: EncRole): [number, number, number, number] | null {
    return this.roles.get(role)?.bounds ?? null;
  }

  private tileRange(role: EncRole, bb: BBox, zHint: number) {
    const st = this.roles.get(role);
    if (!st) return null;
    let z = Math.max(st.minZoom, Math.min(st.maxZoom, Math.floor(zHint)));
    // cap the tile fan-out; drop zoom until the viewport needs ≤ 20 tiles
    for (; z > st.minZoom; z--) {
      const nx = lon2tx(bb.maxLon, z) - lon2tx(bb.minLon, z) + 1;
      const ny = lat2ty(bb.minLat, z) - lat2ty(bb.maxLat, z) + 1;
      if (nx * ny <= 20) break;
    }
    return { z, x0: lon2tx(bb.minLon, z), x1: lon2tx(bb.maxLon, z), y0: lat2ty(bb.maxLat, z), y1: lat2ty(bb.minLat, z) };
  }

  private async fetchTile(role: EncRole, z: number, x: number, y: number, key: string) {
    const st = this.roles.get(role)!;
    try {
      const t = await st.pm.getZxy(z, x, y);
      if (!t?.data) { this.tiles.set(key, []); return; }
      const vt = new VectorTile(new PbfReader(new Uint8Array(t.data)) as any);
      const layer = vt.layers[role];
      const feats: EncFeature[] = [];
      if (layer) {
        // Vector tiles carry a buffer past the tile edge — phantom geometry.
        // Geometry is kept UNCUT; every feature carries its tile's true
        // bounds (tb) and consumers paint through that window. (Cutting the
        // rings here with Sutherland–Hodgman bridged concave notches —
        // phantom water straight across a Patoka peninsula.)
        const n = 2 ** z;
        const tLonMin = (x / n) * 360 - 180, tLonMax = ((x + 1) / n) * 360 - 180;
        const mLat = (ty: number) => { const yy = Math.PI - (2 * Math.PI * ty) / n; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(yy) - Math.exp(-yy))); };
        const tb: [number, number, number, number] = [tLonMin, mLat(y + 1), tLonMax, mLat(y)];
        for (let i = 0; i < layer.length; i++) {
          const gj = layer.feature(i).toGeoJSON(x, y, z);
          feats.push({ geom: gj.geometry as EncFeature['geom'], props: (gj.properties ?? {}) as Record<string, any>, tb });
        }
      }
      this.tiles.set(key, feats);
    } catch {
      this.tiles.set(key, []);   // unreadable tile — skipped, never guessed
    }
    this.onTiles?.();
  }

  /** Synchronous view of decoded features over a viewport; kicks off async
   *  decodes for anything missing and reports completeness honestly. */
  collect(role: EncRole, bb: BBox, zHint: number): { feats: EncFeature[]; complete: boolean } {
    const r = this.tileRange(role, bb, zHint);
    if (!r) return { feats: [], complete: true };
    const feats: EncFeature[] = [];
    let complete = true;
    for (let x = r.x0; x <= r.x1; x++) {
      for (let y = r.y0; y <= r.y1; y++) {
        const key = `${role}/${r.z}/${x}/${y}`;
        const c = this.tiles.get(key);
        if (c === undefined) { this.tiles.set(key, 'loading'); void this.fetchTile(role, r.z, x, y, key); complete = false; }
        else if (c === 'loading') complete = false;
        else feats.push(...c);
      }
    }
    return { feats, complete };
  }

  /** Await every tile of `role` over the bbox — used before mask building. */
  async ensure(role: EncRole, bb: BBox, zHint: number): Promise<EncFeature[]> {
    for (let tries = 0; tries < 200; tries++) {
      const { feats, complete } = this.collect(role, bb, zHint);
      if (complete) return feats;
      await new Promise(res => setTimeout(res, 60));
    }
    return this.collect(role, bb, zHint).feats;   // best effort after ~12 s
  }
}

// ================= rendering =================

const M2FT = 3.28084;
/** ENC-ish depth tints, translucent so they read over satellite and vector. */
export function depthFill(drval1: number): string {
  if (drval1 < 1.8) return 'rgba(94, 216, 201, 0.50)';    // drying / very shallow
  if (drval1 < 5.4) return 'rgba(110, 190, 235, 0.38)';
  if (drval1 < 9.1) return 'rgba(140, 190, 235, 0.22)';
  return 'rgba(150, 190, 235, 0.10)';                      // deep
}

type Project = (lon: number, lat: number) => [number, number];

function eachRing(geom: EncFeature['geom'], cb: (ring: number[][]) => void) {
  if (geom.type === 'Polygon') for (const ring of geom.coordinates) cb(ring);
  else if (geom.type === 'MultiPolygon') for (const poly of geom.coordinates) for (const ring of poly) cb(ring);
}
/** Polygon-level access: cb receives [outer, ...holes] per polygon. */
function eachPoly(geom: EncFeature['geom'], cb: (rings: number[][][]) => void) {
  if (geom.type === 'Polygon') cb(geom.coordinates);
  else if (geom.type === 'MultiPolygon') for (const poly of geom.coordinates) cb(poly);
}
function eachLine(geom: EncFeature['geom'], cb: (line: number[][]) => void) {
  if (geom.type === 'LineString') cb(geom.coordinates);
  else if (geom.type === 'MultiLineString') for (const l of geom.coordinates) cb(l);
}
function eachPoint(geom: EncFeature['geom'], cb: (lon: number, lat: number) => void) {
  if (geom.type === 'Point') cb(geom.coordinates[0], geom.coordinates[1]);
  else if (geom.type === 'MultiPoint') for (const c of geom.coordinates) cb(c[0], c[1]);
}

/** Draw all ENC layers for the viewport. Returns true when every needed tile
 *  was already decoded (false → caller will be re-rendered via onTiles). */
export function drawEnc(pack: EncPack, ctx: CanvasRenderingContext2D, project: Project, bb: BBox, zoom: number, satDrawn: boolean): boolean {
  let complete = true;
  const path = (ring: number[][]) => {
    ctx.beginPath();
    for (let i = 0; i < ring.length; i++) {
      const [px, py] = project(ring[i][0], ring[i][1]);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
  };

  // Paint a feature's fill through its tile's window — tile-buffer overhang
  // is phantom geometry and must never show or route as real.
  const clipTb = (tb: [number, number, number, number] | undefined, draw: () => void) => {
    if (!tb) { draw(); return; }
    ctx.save();
    const [x0, y0] = project(tb[0], tb[3]);
    const [x1, y1] = project(tb[2], tb[1]);
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    draw();
    ctx.restore();
  };

  // depth areas — deepest first so shallows paint on top
  {
    const { feats, complete: c } = pack.collect('depth-areas', bb, zoom);
    complete &&= c;
    const sorted = feats.slice().sort((a, b) => (Number(b.props.DRVAL1) || 0) - (Number(a.props.DRVAL1) || 0));
    for (const f of sorted) {
      clipTb(f.tb, () => {
        ctx.fillStyle = depthFill(Number(f.props.DRVAL1) || 0);
        eachRing(f.geom, (ring) => { path(ring); ctx.closePath(); ctx.fill(); });
      });
    }
  }

  if (zoom >= 11) {
    const { feats, complete: c } = pack.collect('depth-contours', bb, zoom);
    complete &&= c;
    ctx.strokeStyle = satDrawn ? 'rgba(200,225,255,0.55)' : 'rgba(110,160,210,0.55)';
    ctx.lineWidth = 1;
    for (const f of feats) eachLine(f.geom, (l) => { path(l); ctx.stroke(); });
  }

  // restricted areas — quiet fill; the dashed border only at close zoom
  // (stroking tile-clipped polygons at low zoom paints the clip edges as a
  // false magenta grid across the chart)
  if (zoom >= 9) {
    const { feats, complete: c } = pack.collect('restricted-areas', bb, zoom);
    complete &&= c;
    for (const f of feats) {
      clipTb(f.tb, () => {
        eachRing(f.geom, (ring) => {
          path(ring); ctx.closePath();
          ctx.fillStyle = 'rgba(200, 60, 180, 0.06)'; ctx.fill();
          if (zoom >= 11.5) { ctx.strokeStyle = 'rgba(200, 60, 180, 0.5)'; ctx.lineWidth = 1.2; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]); }
        });
      });
    }
  }

  // soundings — spot depths in feet, only when zoomed right in (they are
  // R&D noise at planning scale; captains want them approaching a spot)
  if (zoom >= 12) {
    const { feats, complete: c } = pack.collect('soundings', bb, zoom);
    complete &&= c;
    const seen = new Set<string>();
    ctx.font = 'italic 10.5px -apple-system, sans-serif';
    ctx.fillStyle = satDrawn ? 'rgba(235,245,255,0.9)' : 'rgba(80,110,150,0.95)';
    for (const f of feats) {
      const d = Number(f.props.DEPTH);
      if (!Number.isFinite(d)) continue;
      eachPoint(f.geom, (lon, lat) => {
        const k = `${Math.round(lon * 5000)}/${Math.round(lat * 5000)}`;
        if (seen.has(k)) return;
        seen.add(k);
        const [x, y] = project(lon, lat);
        const ft = d * M2FT;
        ctx.fillText(ft < 10 ? ft.toFixed(1) : String(Math.round(ft)), x - 6, y + 4);
      });
    }
  }

  // sailing line — the charted recommended track (inland rivers). Drawn
  // prominently: this IS the route guidance a captain follows downriver.
  {
    const { feats, complete: c } = pack.collect('sailing-line', bb, zoom);
    complete &&= c;
    if (feats.length) {
      ctx.strokeStyle = satDrawn ? 'rgba(80,220,255,0.9)' : 'rgba(30,150,220,0.9)';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([12, 6]);
      for (const f of feats) eachLine(f.geom, (l) => { path(l); ctx.stroke(); });
      ctx.setLineDash([]);
    }
  }

  // dams — heavy dark bars (a dam across your course is a hard stop)
  {
    const { feats, complete: c } = pack.collect('dams', bb, zoom);
    complete &&= c;
    ctx.strokeStyle = '#3a3f47'; ctx.lineWidth = 5; ctx.lineCap = 'butt';
    for (const f of feats) {
      eachLine(f.geom, (l) => { path(l); ctx.stroke(); });
      eachRing(f.geom, (r) => { path(r); ctx.closePath(); ctx.stroke(); });
    }
    ctx.lineWidth = 1;
  }

  // locks — chambers drawn as outlined boxes with the gate symbol
  if (zoom >= 8) {
    const { feats, complete: c } = pack.collect('locks', bb, zoom);
    complete &&= c;
    for (const f of feats) {
      eachRing(f.geom, (ring) => {
        path(ring); ctx.closePath();
        ctx.fillStyle = 'rgba(60,120,200,0.25)'; ctx.fill();
        ctx.strokeStyle = '#2f6db8'; ctx.lineWidth = 2; ctx.stroke();
      });
      // label at centroid
      let cx = 0, cy = 0, n = 0;
      eachRing(f.geom, (ring) => { for (const p of ring) { const [x, y] = project(p[0], p[1]); cx += x; cy += y; n++; } });
      if (n && zoom >= 9) {
        ctx.fillStyle = satDrawn ? '#bfe0ff' : '#2f6db8';
        ctx.font = 'bold 10px -apple-system, sans-serif';
        ctx.fillText(`⚙ ${f.props.OBJNAM ?? 'Lock'}`, cx / n + 8, cy / n);
      }
    }
  }

  // bridges — line + vertical clearance label (VERCLR, meters → feet)
  if (zoom >= 9) {
    const { feats, complete: c } = pack.collect('bridges', bb, zoom);
    complete &&= c;
    ctx.strokeStyle = satDrawn ? '#e8e8e8' : '#6a7480'; ctx.lineWidth = 3;
    for (const f of feats) {
      eachLine(f.geom, (l) => {
        path(l); ctx.stroke();
        const vc = Number(f.props.VERCLR);
        if (Number.isFinite(vc) && l.length) {
          const mid = l[Math.floor(l.length / 2)];
          const [x, y] = project(mid[0], mid[1]);
          ctx.fillStyle = satDrawn ? '#ffe9a8' : '#8a6d1d';
          ctx.font = 'bold 10px -apple-system, sans-serif';
          ctx.fillText(`br clr ${Math.round(vc * M2FT)} ft`, x + 6, y - 6);
        }
      });
      eachRing(f.geom, (r) => { path(r); ctx.closePath(); ctx.stroke(); });
    }
    ctx.lineWidth = 1;
  }

  // mile markers — small river-mile ticks
  if (zoom >= 9.5) {
    const { feats, complete: c } = pack.collect('mile-markers', bb, zoom);
    complete &&= c;
    ctx.font = '9.5px -apple-system, sans-serif';
    for (const f of feats) {
      const mi = f.props.wtwdis ?? f.props.WTWDIS;
      eachPoint(f.geom, (lon, lat) => {
        const [x, y] = project(lon, lat);
        ctx.fillStyle = satDrawn ? 'rgba(255,255,255,0.75)' : 'rgba(90,110,130,0.9)';
        ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
        if (mi !== undefined && zoom >= 10.5) ctx.fillText(`mi ${mi}`, x + 5, y + 3);
      });
    }
  }

  // point symbols — close zoom only; at planning scale they are clutter
  if (zoom >= 10.5) {
    const sym = (role: EncRole, draw: (x: number, y: number, p: Record<string, any>) => void) => {
      const { feats, complete: c } = pack.collect(role, bb, zoom);
      complete &&= c;
      for (const f of feats) eachPoint(f.geom, (lon, lat) => { const [x, y] = project(lon, lat); draw(x, y, f.props); });
    };
    // wrecks — magenta danger circle + Wk
    sym('wrecks', (x, y, p) => {
      ctx.strokeStyle = '#c93cb4'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
      if (Number(p.CATWRK) === 2) { ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]); }
      ctx.fillStyle = '#c93cb4'; ctx.font = 'bold 9px -apple-system, sans-serif'; ctx.fillText('Wk', x - 6, y + 3.5);
    });
    // obstructions — dashed magenta circle
    sym('obstructions', (x, y) => {
      ctx.strokeStyle = '#c93cb4'; ctx.lineWidth = 1.4; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#c93cb4'; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
    });
    // lights — gold flare
    sym('lights', (x, y) => {
      ctx.fillStyle = '#f2b632';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 9, y - 4); ctx.lineTo(x + 9, y + 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.8; ctx.stroke();
    });
    // lateral buoys — IALA-B: nun (triangle) red = starboard, can (square) green = port
    const buoy = (x: number, y: number, p: Record<string, any>) => {
      const col = String(p.COLOUR ?? '');
      const starboard = Number(p.CATLAM) === 2 || col.includes('3');
      ctx.fillStyle = starboard ? '#e02d2d' : '#1f9d3a';
      if (starboard) { ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x - 5, y + 4); ctx.closePath(); ctx.fill(); }
      else ctx.fillRect(x - 4.5, y - 5, 9, 9);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    };
    sym('buoys-lateral', buoy);
    sym('buoys-special', (x, y) => {
      ctx.fillStyle = '#f2b632'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    });
  }

  return complete;
}

// ================= depth gate for auto-routing =================

export interface DepthGate {
  /** HARD-blocked polygons: charted MAXIMUM depth (DRVAL2) below what the
   *  vessel needs — even at its deepest this water can't float her. */
  shallowPolys: GatePoly[];
  /** CAUTION polygons: guaranteed minimum (DRVAL1) below need, but charted
   *  max is not. USACE lakes chart most open water 0–9 ft ("not surveyed to
   *  project depth") even where it's 40 ft deep — hard-blocking these makes
   *  whole lakes unroutable. Routing avoids them when a guaranteed path
   *  exists and crosses them with an explicit warning when it doesn't. */
  cautionPolys: GatePoly[];
  /** set false to let the mask keep caution water open (relaxed pass) */
  blockCaution?: boolean;
  /** Where the chart claims authority. Preferred: the cells' own M_COVR
   *  coverage polygons (CATCOV=1) — inside them the chart is the ONLY water
   *  authority. A bounds RECT is the fallback for packs built before the
   *  coverage layer existed; it over-claims (a bounds box includes water no
   *  cell covers — that bug marooned a Key West start point as "land"). */
  coveragePolys?: GatePoly[];
  coverageRect?: [number, number, number, number];
  /** charted wrecks/obstructions shoaler than the vessel needs */
  shallowPoints: { lat: number; lon: number; radius_nm: number }[];
  /** charted dams — hard barriers regardless of draft (lockages are a
   *  planned-stop feature, not a thing to route blindly through) */
  barrierLines: number[][][];
  /** ALL charted depth areas — authoritative water, carved INTO the mask so
   *  chart-visible channels (e.g. the Barkley Canal) are routable even where
   *  generalized shorelines can't see them */
  waterPolys: GatePoly[];
  /** Berth (each side) applied to shallow boundaries in the mask, nm. The
   *  berth's job is to stop grid routing hugging a shoal by half a cell — so
   *  it must SCALE with the routing grid: a fixed fat berth seals real
   *  channels (the Barkley Canal is ~0.07 nm wide). Set by the router from
   *  its grid cell size; defaults conservative for direct mask use. */
  berth_nm?: number;
  neededM: number | null;
  coverage: boolean;
}

/** Collect everything the route must not cross over the route area.
 *  Depth: DRVAL1 is the band's guaranteed minimum — if it's less than the
 *  vessel needs (draft + safety ± water-level offset), some spot in that band
 *  may ground her, so the whole band is out (the paper-chart safety-contour
 *  call). Dams: barriers even with no draft set.
 *  `offsetM` = current water level relative to the charted datum (from a
 *  gauge or the captain), positive = more water than charted. */
export async function buildDepthGate(pack: EncPack, bb: BBox, neededM: number | null, offsetM = 0): Promise<DepthGate> {
  const gate: DepthGate = { shallowPolys: [], cautionPolys: [], shallowPoints: [], barrierLines: [], waterPolys: [], neededM, coverage: pack.covers(bb) };
  if (!gate.coverage) return gate;
  const zHint = 12;
  if (pack.roles.has('coverage')) {
    const covr = await pack.ensure('coverage', bb, zHint);
    const polys: GatePoly[] = [];
    for (const f of covr) {
      if (f.props.CATCOV !== undefined && Number(f.props.CATCOV) !== 1) continue;   // 2 = "no coverage here"
      eachPoly(f.geom, (rings) => polys.push({ rings, tb: f.tb }));
    }
    gate.coveragePolys = polys;
  } else {
    const db = pack.boundsOf('depth-areas');
    if (db) gate.coverageRect = db;   // legacy packs without a coverage layer
  }
  {
    const depare = await pack.ensure('depth-areas', bb, zHint);
    for (const f of depare) {
      eachPoly(f.geom, (rings) => gate.waterPolys.push({ rings, tb: f.tb }));
      if (neededM === null) continue;
      if (f.props.UNSURV) continue;   // OSM-shoreline packs: water shape known, depth NOT charted — no depth claim either way
      const d1 = Number(f.props.DRVAL1), d2 = Number(f.props.DRVAL2);
      if (Number.isFinite(d2) && d2 + offsetM < neededM) {
        eachPoly(f.geom, (rings) => gate.shallowPolys.push({ rings, tb: f.tb }));      // hard: max depth below need
      } else if (Number.isFinite(d1) && d1 + offsetM < neededM) {
        eachPoly(f.geom, (rings) => gate.cautionPolys.push({ rings, tb: f.tb }));      // not guaranteed at need
      }
    }
  }
  if (neededM !== null) {
    for (const role of ['wrecks', 'obstructions'] as EncRole[]) {
      for (const f of await pack.ensure(role, bb, zHint)) {
        const sou = Number(f.props.VALSOU);
        const dangerous = Number(f.props.CATWRK) === 2 || (Number.isFinite(sou) && sou + offsetM < neededM);
        if (!dangerous) continue;
        eachPoint(f.geom, (lon, lat) => gate.shallowPoints.push({ lat, lon, radius_nm: 0.05 }));
      }
    }
  }
  for (const f of await pack.ensure('dams', bb, zHint)) {
    eachLine(f.geom, (l) => gate.barrierLines.push(l));
    eachRing(f.geom, (r) => gate.barrierLines.push(r));
  }
  return gate;
}
