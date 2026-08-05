/**
 * OSM shoreline pack builder — lakes with NO government chart (Patoka-class).
 *
 * The browser can't always reach Overpass (Aaron's machine proved it), but CI
 * always can: this fetches a lake's water polygons server-side, assembles
 * multipolygon relations (outer rings + island holes), and bakes a standard
 * pack the app auto-downloads like any NOAA/USACE region. Deterministic and
 * offline for every captain from then on.
 *
 * Honesty: depth-areas carry UNSURV=1 — the SHAPE of the water is known, its
 * depth is NOT charted; the app makes no depth claim either way. Provenance
 * is OpenStreetMap ODbL, rendered on-chart.
 *
 * Usage: node tools/packs/osmwater.mjs <region> [elements.json]
 *   (elements.json = pre-fetched Overpass response, used by the selftest;
 *    without it, fetches live from Overpass.)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [regionKey, elementsFile] = process.argv.slice(2);
const { regions } = JSON.parse(readFileSync(join(here, 'regions.json'), 'utf8'));
const region = regions[regionKey];
if (!region?.osmwater) { console.error(`region ${regionKey} is not an osmwater region`); process.exit(2); }
const [w, s, e, n] = region.bbox;

// ---- fetch --------------------------------------------------------------
// Overpass is a free, shared, frequently-overloaded service. One big query on
// one mirror is a coin flip — it 504'd on two of three lakes in a single CI
// run. So: split the region into small tiles (a small query is far likelier
// to be served), rotate mirrors, and retry with backoff. A way returned for a
// tile carries its FULL geometry, so tiles are merged by element id with no
// stitching loss. Any tile that never answers still quarantines the whole
// build — a half-fetched lake is a lake with a hole in it (Register R4).
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const TILE_DEG = 0.3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function queryTile(bw, bs, be, bn, tileLabel) {
  const q = `[out:json][timeout:90];(way["natural"="water"](${bs},${bw},${bn},${be});relation["natural"="water"](${bs},${bw},${bn},${be}););out geom;`;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (let m = 0; m < MIRRORS.length; m++) {
      const url = MIRRORS[(attempt + m) % MIRRORS.length];
      try {
        const res = await fetch(url, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(q),
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'blackflag-pack-build (github actions; charts for small-boat captains)' },
        });
        if (!res.ok) { console.error(`  ${tileLabel} ${new URL(url).host}: ${res.status}`); continue; }
        const js = await res.json();
        return js.elements ?? [];
      } catch (err) { console.error(`  ${tileLabel} ${new URL(url).host}: ${err.message}`); }
    }
    const wait = 20000 * (attempt + 1);
    console.error(`  ${tileLabel}: all mirrors declined, waiting ${wait / 1000}s`);
    await sleep(wait);
  }
  return null;
}

async function fetchElements() {
  if (elementsFile) return JSON.parse(readFileSync(elementsFile, 'utf8')).elements ?? [];
  const nx = Math.max(1, Math.ceil((e - w) / TILE_DEG)), ny = Math.max(1, Math.ceil((n - s) / TILE_DEG));
  console.log(`fetching OSM water for ${regionKey} in ${nx}x${ny} tiles`);
  const byId = new Map();
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const bw = w + ((e - w) * ix) / nx, be = w + ((e - w) * (ix + 1)) / nx;
      const bs = s + ((n - s) * iy) / ny, bn = s + ((n - s) * (iy + 1)) / ny;
      const label = `tile ${ix + 1},${iy + 1}`;
      const els = await queryTile(bw, bs, be, bn, label);
      if (els === null) {
        console.error(`${label} never answered — quarantining build rather than shipping a partial lake (Register R4)`);
        process.exit(1);
      }
      for (const el of els) byId.set(`${el.type}/${el.id}`, el);
      console.log(`  ${label}: ${els.length} elements (${byId.size} unique so far)`);
      await sleep(1200);   // be a decent citizen of a free service
    }
  }
  return [...byId.values()];
}

// ---- assemble -----------------------------------------------------------
const key = (p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
function stitch(ways) {
  const segs = ways.filter((x) => x.length >= 2).map((x) => [...x]);
  const rings = [];
  while (segs.length) {
    let chain = segs.shift();
    let ext = true;
    while (ext && key(chain[0]) !== key(chain[chain.length - 1])) {
      ext = false;
      const tail = key(chain[chain.length - 1]), head = key(chain[0]);
      for (let i = 0; i < segs.length; i++) {
        const sg = segs[i];
        if (key(sg[0]) === tail) { chain = chain.concat(sg.slice(1)); segs.splice(i, 1); ext = true; break; }
        if (key(sg[sg.length - 1]) === tail) { chain = chain.concat(sg.slice(0, -1).reverse()); segs.splice(i, 1); ext = true; break; }
        if (key(sg[sg.length - 1]) === head) { chain = sg.slice(0, -1).concat(chain); segs.splice(i, 1); ext = true; break; }
        if (key(sg[0]) === head) { chain = sg.slice(1).reverse().concat(chain); segs.splice(i, 1); ext = true; break; }
      }
    }
    if (chain.length >= 4 && key(chain[0]) === key(chain[chain.length - 1])) rings.push(chain.map((p) => [p.lon, p.lat]));
  }
  return rings;
}
const inRing = (lon, lat, ring) => {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
};

const elements = await fetchElements();
const polys = [];   // each: [outer, ...holes]
const lines = [];   // shoreline rings for the coastline role
for (const el of elements) {
  if (el.type === 'way' && el.tags?.natural === 'water' && Array.isArray(el.geometry)) {
    const rings = stitch([el.geometry]);
    for (const r of rings) { polys.push([r]); lines.push(r); }
  } else if (el.type === 'relation' && el.tags?.natural === 'water' && Array.isArray(el.members)) {
    const outers = stitch(el.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry));
    const inners = stitch(el.members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => m.geometry));
    for (const o of outers) {
      const holes = inners.filter((h) => inRing(h[0][0], h[0][1], o));
      polys.push([o, ...holes]);
      lines.push(o, ...holes);
    }
  }
}
if (!polys.length) { console.error('no water polygons assembled — quarantining build (Register R4)'); process.exit(1); }

// ---- emit standard pack roles ------------------------------------------
const work = join('build', 'enc', regionKey);
mkdirSync(work, { recursive: true });
const fc = (features) => JSON.stringify({ type: 'FeatureCollection', features });
const polyFeat = (rings, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: rings } });
const lineFeat = (coords) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });

const roleFiles = {
  // UNSURV: shape known, depth NOT charted — the app makes no depth claim
  'depth-areas': fc(polys.map((p) => polyFeat(p, { UNSURV: 1, DRVAL1: 0 }))),
  // Coverage = the WHOLE fetched bbox, not just the water: OSM's water layer
  // is complete for the box, so everything not water IS land — this kills
  // coarse-base false water over real peninsulas outside the lake polygon.
  'coverage': fc([polyFeat([[[w, s], [e, s], [e, n], [w, n], [w, s]]], { CATCOV: 1 })]),
  'coastline': fc(lines.map((l) => lineFeat(l))),
};
const manifest = {
  pack: 'enc', region: regionKey, built_at: new Date().toISOString(), layers: {},
  provenance: {
    source: 'OpenStreetMap water polygons (ODbL)', license: 'ODbL',
    note: 'shoreline shape only — DEPTH IS NOT CHARTED for this water; not for navigation',
  },
};
for (const [role, json] of Object.entries(roleFiles)) {
  const gj = join(work, `${regionKey}-${role}.geojson`);
  writeFileSync(gj, json);
  const out = join(work, `${regionKey}-${role}.pmtiles`);
  // never drop features from a safety surface (see enc.mjs), then verify
  execFileSync('tippecanoe', ['-o', out, '--force', '-Z6', '-z12', '-pf', '-pk', '-l', role, gj], { stdio: 'pipe' });
  execFileSync('node', [join(here, 'verify.mjs'), out, role, '--bbox', region.bbox.join(','), gj], { stdio: 'inherit' });
  manifest.layers[role] = basename(out);
}
writeFileSync(join(work, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`OSM shoreline pack staged: ${work} — ${polys.length} water polygons, ${lines.length} shoreline rings`);
