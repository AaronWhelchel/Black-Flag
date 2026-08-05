/**
 * Pack verifier — the gate that catches a chart with a hole in it.
 *
 * Key West shipped a pack whose tiles over the harbour were EMPTY: the cells
 * weren't selected, tippecanoe happily produced tiles with nothing in them,
 * checksums matched, and the app — finding no charted water there — fell back
 * to a coarse world shoreline and drew routes across land. Every stage
 * reported success. Nothing compared the built tiles against what went in.
 *
 * So: for every tile the SOURCE data has features in, the BUILT tile at
 * maxzoom must contain at least one feature that genuinely lies inside that
 * tile (not just buffer overhang from a neighbour). A gutted tile fails the
 * build (Register R4: quarantine, never publish a chart that lies).
 *
 * Usage: node tools/packs/verify.mjs <pmtiles> <role> <source.geojson>...
 */
import { readFileSync } from 'node:fs';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const argv = process.argv.slice(2);
let box = null;
const bi = argv.indexOf('--bbox');
if (bi >= 0) { box = argv[bi + 1].split(',').map(Number); argv.splice(bi, 2); }
const [tilePath, role, ...sources] = argv;
if (!tilePath || !role || !sources.length) {
  console.error('usage: node tools/packs/verify.mjs <pmtiles> <role> [--bbox w,s,e,n] <source.geojson>...');
  process.exit(1);
}
// Cells overhang the region by design; what ships for routing is the region.
const inBox = (lon, lat) => {
  if (!box) return true;
  const [w, s, e, n] = box, mx = (e - w) * 0.1, my = (n - s) * 0.1;
  return lon >= w - mx && lon <= e + mx && lat >= s - my && lat <= n + my;
};

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const tileBounds = (x, y, z) => {
  const n = 2 ** z;
  const lat = (ty) => { const yy = Math.PI - (2 * Math.PI * ty) / n; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(yy) - Math.exp(-yy))); };
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
};
/** Every vertex, plus points interpolated along each segment: a big polygon
 *  drawn with four corners still has to prove it exists in the middle. */
const STEP = 0.002;   // ≈200 m
const coordsOf = (geom, out = []) => {
  const line = (pts) => {
    for (let i = 0; i < pts.length; i++) {
      out.push(pts[i]);
      if (i + 1 < pts.length) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        const n = Math.min(400, Math.floor(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / STEP));
        for (let k = 1; k < n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
      }
    }
  };
  const walk = (c) => {
    if (typeof c[0] === 'number') { out.push(c); return; }
    if (typeof c[0]?.[0] === 'number') { line(c); return; }
    for (const k of c) walk(k);
  };
  if (geom?.coordinates) walk(geom.coordinates);
  return out;
};

const buf = readFileSync(tilePath);
const pm = new PMTiles({
  getKey: () => tilePath,
  getBytes: async (o, l) => ({ data: buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + l) }),
});
const header = await pm.getHeader();
const z = header.maxZoom;

// Whole-tile presence is too coarse a test: the gutted Key West tile still
// held a sliver of buffer overhang from its northern neighbour, which would
// have passed. Each tile is checked on a SUB-GRID (≈2 km cells at z12), so a
// tile that keeps a corner and loses its harbour still fails.
const SUB = 4;
const cellOf = (lon, lat) => {
  const x = lon2x(lon, z), y = lat2y(lat, z);
  const [w, s, e, n] = tileBounds(x, y, z);
  const sx = Math.min(SUB - 1, Math.max(0, Math.floor(((lon - w) / (e - w)) * SUB)));
  const sy = Math.min(SUB - 1, Math.max(0, Math.floor(((lat - s) / (n - s)) * SUB)));
  return { x, y, key: `${x}/${y}/${sx}/${sy}` };
};

const wanted = new Map();          // sub-cell key → source vertex count
const tilesWanted = new Set();
for (const src of sources) {
  const fc = JSON.parse(readFileSync(src, 'utf8'));
  for (const f of fc.features ?? []) {
    for (const [lon, lat] of coordsOf(f.geometry)) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 85) continue;
      if (!inBox(lon, lat)) continue;
      const c = cellOf(lon, lat);
      wanted.set(c.key, (wanted.get(c.key) ?? 0) + 1);
      tilesWanted.add(`${c.x}/${c.y}`);
    }
  }
}
if (!wanted.size) { console.log(`verify ${role}: source has no features — nothing to check`); process.exit(0); }

const built = new Set();
for (const t of tilesWanted) {
  const [x, y] = t.split('/').map(Number);
  const tile = await pm.getZxy(z, x, y);
  if (!tile?.data) continue;
  const layer = new VectorTile(new PbfReader(new Uint8Array(tile.data))).layers[role];
  for (let i = 0; layer && i < layer.length; i++) {
    for (const [lon, lat] of coordsOf(layer.feature(i).toGeoJSON(x, y, z).geometry)) {
      built.add(cellOf(lon, lat).key);
    }
  }
}

// A lone stray sliver can legitimately vanish to simplification; a sub-cell
// the source fills with geometry cannot.
const gutted = [...wanted].filter(([key, verts]) => verts >= 3 && !built.has(key));
const describe = ([key, verts]) => {
  const [x, y, sx, sy] = key.split('/').map(Number);
  const [w, s, e, n] = tileBounds(x, y, z);
  const lon = w + ((sx + 0.5) / SUB) * (e - w), lat = s + ((sy + 0.5) / SUB) * (n - s);
  return `${role} z${z}/${x}/${y} sub ${sx},${sy} near ${lat.toFixed(4)},${lon.toFixed(4)} — ${verts} source vertices, nothing built`;
};
console.log(`verify ${role}: z${z}, ${tilesWanted.size} tiles / ${wanted.size} sub-cells occupied in source, ${gutted.length} lost in tiling`);
for (const gap of gutted.slice(0, 12)) console.log(`  lost: ${describe(gap)}`);

// What actually makes a chart dangerous is a TILE that loses its content —
// the Key West failure was two tiles gutted end to end, not scattered
// slivers. So: fail on a gutted tile, or on broad loss; report the rest.
const per = new Map();
for (const [key] of wanted) {
  const t = key.split('/').slice(0, 2).join('/');
  const rec = per.get(t) ?? { occ: 0, lost: 0 };
  rec.occ++; per.set(t, rec);
}
for (const [key] of gutted) per.get(key.split('/').slice(0, 2).join('/')).lost++;
const guttedTiles = [...per].filter(([, r]) => r.occ >= 4 && r.lost / r.occ >= 0.5);
const lostFrac = gutted.length / wanted.size;
if (guttedTiles.length || lostFrac > 0.02) {
  for (const [t, r] of guttedTiles) console.error(`  GUTTED TILE z${z}/${t}: ${r.lost}/${r.occ} sub-cells lost`);
  console.error(`::error::${role}: ${guttedTiles.length} gutted tile(s), ${(lostFrac * 100).toFixed(1)}% of occupied areas lost — a chart with a hole is worse than no chart (Register R4)`);
  process.exit(4);
}
if (gutted.length) {
  console.error(`::warning::${role}: ${gutted.length} isolated area(s) (${(lostFrac * 100).toFixed(2)}%) simplified away — reported, not hidden`);
}
