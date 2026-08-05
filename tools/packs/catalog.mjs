/**
 * ENC cell discovery — resolves a region's bounding box to actual NOAA cell
 * IDs using the official ENC product catalog (ENCProdCat_19115.xml, curl'd in
 * CI). Replaces hardcoded cell lists, which rot as NOAA reschemes cells.
 *
 * Schema reality (verified against charts.noaa.gov/ENCs/US1EEZ1M_19115.xml,
 * 2026-08): records are <MD_Metadata> in a DEFAULT namespace (no gmd: prefix),
 * identifiers appear as <fileIdentifier>…USxYYnnM_19115.xml…, and extents are
 * usually EX_BoundingPolygon with <gml:pos>lat lon</gml:pos> pairs — with
 * longitudes sometimes continued past ±180 across the antimeridian. Some
 * records may instead carry classic west/east/south/north Decimal bounds.
 * This parser accepts both.
 *
 * Usage: node tools/packs/catalog.mjs <catalog.xml> <region-key> [maxCells]
 * Prints matching cell IDs, one per line. Exits 3 if none found (R4: an empty
 * region quarantines the build, it does not "succeed" with nothing).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [catalogPath, regionKey, maxCellsArg] = process.argv.slice(2);
if (!catalogPath || !regionKey) {
  console.error('usage: node tools/packs/catalog.mjs <catalog.xml> <region-key> [maxCells]');
  process.exit(1);
}
const regions = JSON.parse(readFileSync(join(here, 'regions.json'), 'utf8')).regions;
const region = regions[regionKey];
if (!region?.bbox) { console.error(`unknown region or missing bbox: ${regionKey}`); process.exit(1); }
const [minLon, minLat, maxLon, maxLat] = region.bbox;
const bands = new Set((region.bands ?? [4, 5]).map(String));
const maxCells = Number(maxCellsArg ?? region.max_cells ?? 8);

const xml = readFileSync(catalogPath, 'utf8');
console.error(`catalog: ${(xml.length / 1048576).toFixed(1)} MB`);

const wrapLon = (lon) => {
  let l = lon;
  while (l < -180) l += 360;
  while (l > 180) l -= 360;
  return l;
};

// Chunk per metadata record; tolerate any (or no) namespace prefix.
const recRe = /<(?:\w+:)?MD_Metadata[\s>]/g;
const starts = [];
let m;
while ((m = recRe.exec(xml)) !== null) starts.push(m.index);
if (starts.length === 0) starts.push(0);   // single-record or unexpected shape: scan whole file
console.error(`records: ${starts.length}`);

const idRe = /\bUS[1-6][A-Z]{2}[A-Z0-9]{2,5}(?=_19115|\.000|\.zip|\b)/;
const posRe = /<gml:pos>\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*<\/gml:pos>/g;
const bound = (chunk, tag) => {
  const r = new RegExp(`(?:\\w+:)?${tag}[^>]*>\\s*<(?:\\w+:)?Decimal>(-?\\d+(?:\\.\\d+)?)`);
  const mm = chunk.match(r);
  return mm ? Number(mm[1]) : null;
};

const hits = new Map();
for (let i = 0; i < starts.length; i++) {
  const chunk = xml.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : Math.min(xml.length, starts[i] + 200000));
  const idm = chunk.match(idRe);
  if (!idm) continue;
  const id = idm[0];
  if (hits.has(id)) continue;
  if (!bands.has(id[2])) continue;

  let w = null, e = null, s = null, n = null;

  // Preferred: bounding polygon positions ("lat lon" per verified sample)
  let pm; posRe.lastIndex = 0;
  while ((pm = posRe.exec(chunk)) !== null) {
    const lat = Number(pm[1]);
    const lon = wrapLon(Number(pm[2]));
    if (Math.abs(lat) > 90) continue;
    w = w === null ? lon : Math.min(w, lon);
    e = e === null ? lon : Math.max(e, lon);
    s = s === null ? lat : Math.min(s, lat);
    n = n === null ? lat : Math.max(n, lat);
  }
  // Fallback: classic directional bounds
  if (w === null) {
    w = bound(chunk, 'westBoundLongitude'); e = bound(chunk, 'eastBoundLongitude');
    s = bound(chunk, 'southBoundLatitude'); n = bound(chunk, 'northBoundLatitude');
  }
  if (w === null || e === null || s === null || n === null) continue;

  const intersects = !(e < minLon || w > maxLon || n < minLat || s > maxLat);
  if (intersects) hits.set(id, { id, w, e, s, n, area: (e - w) * (n - s) });
}

const list = [...hits.values()];
if (list.length === 0) {
  console.error(`no ENC cells intersect ${regionKey} ${JSON.stringify(region.bbox)} in bands [${[...bands]}] — check the catalog structure or region bbox`);
  process.exit(3);
}

// ---- select cells to COVER the region, not to fit a count ----------------
// The old rule was "N smallest cells that touch the box". For Key West that
// quota filled with small outlying harbour cells before it ever reached the
// cell containing Key West itself — the published pack had a HOLE straight
// over the harbour, the app found no charted water there, fell back to the
// coarse world shoreline, and every Florida route cut the same corner. A
// chart with a hole in it is worse than no chart, so selection is now a
// greedy set cover over a sample grid, and what it fails to cover is
// reported loudly instead of silently shipped.
const GX = 80, GY = 80;
const pts = [];
for (let iy = 0; iy < GY; iy++) {
  for (let ix = 0; ix < GX; ix++) {
    pts.push([minLon + ((ix + 0.5) / GX) * (maxLon - minLon), minLat + ((iy + 0.5) / GY) * (maxLat - minLat)]);
  }
}
const covers = (c, p) => p[0] >= c.w && p[0] <= c.e && p[1] >= c.s && p[1] <= c.n;
const need = new Set(pts.keys());
const chosen = [];
const take = (c) => {
  chosen.push(c);
  for (const i of [...need]) if (covers(c, pts[i])) need.delete(i);
};
const sorted = [...list].sort((a, b) => b.id[2].localeCompare(a.id[2]) || (a.area - b.area));
// Phase 1 — every cell of the largest scale available (band 5 = harbour):
// detail is the whole point of a chart pack, and a harbour cell inside an
// approach cell adds no new AREA but far better depth data.
const topBand = sorted[0].id[2];
for (const c of sorted) {
  if (c.id[2] !== topBand || chosen.length >= maxCells) break;
  take(c);
}
// Phase 2 — fill whatever the detail cells left uncovered, fewest cells first.
// The cell count is a preference; COVERAGE is a safety requirement, so gap
// filling may exceed max_cells up to a hard ceiling. One extra cell to
// download beats a hole in the chart over a harbour.
const hardMax = Number(region.max_cells_hard ?? Math.max(maxCells * 2, maxCells + 8));
while (chosen.length < hardMax && need.size) {
  let best = null, bestGain = 0;
  for (const c of sorted) {
    if (chosen.includes(c)) continue;
    let got = 0;
    for (const i of need) if (covers(c, pts[i])) got++;
    if (got > bestGain) { best = c; bestGain = got; }
  }
  if (!best) break;
  take(best);
}
// Land is legitimately uncovered by ENC cells, so a leftover fraction is
// normal — but a big one means a real hole, and a hole is a safety defect.
const uncovered = need.size / pts.length;
console.error(`cell coverage: ${chosen.length} cells cover ${(100 - uncovered * 100).toFixed(1)}% of the region box (${need.size}/${pts.length} sample points uncovered)`);
if (uncovered > 0.25) {
  console.error(`::warning::${regionKey}: ${(uncovered * 100).toFixed(0)}% of the region box has no ENC cell in bands [${[...bands]}] — routes there fall back to coarse shorelines. Widen the bands or shrink the bbox.`);
}
if (chosen.length >= hardMax && need.size) {
  console.error(`::warning::${regionKey}: hit the ${hardMax}-cell hard ceiling with ${need.size} sample points still uncovered — raise max_cells in regions.json`);
}
if (chosen.length > maxCells) {
  console.error(`note: took ${chosen.length} cells (over the ${maxCells} preferred) to close coverage gaps — a hole in the chart is a safety defect, an extra cell is a download`);
}
for (const c of chosen) console.log(c.id);
