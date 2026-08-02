/**
 * ENC cell discovery — resolves a region's bounding box to actual NOAA cell
 * IDs using the official ENC product catalog (downloaded in CI). This replaces
 * hardcoded cell lists, which rot as NOAA reschemes cells (Register R6: every
 * source has an exit; a guessed cell name is not a source).
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

// Split the catalog into per-cell chunks keyed by cell ID. Modern and legacy
// IDs both match: US + band digit + 2 letters + 2–4 alphanumerics.
const idRe = /\bUS[1-6][A-Z]{2}[A-Z0-9]{2,4}\b/g;
const hits = [];
let m;
const seenAt = new Map();
while ((m = idRe.exec(xml)) !== null) {
  if (!seenAt.has(m[0])) seenAt.set(m[0], m.index);
}
const entries = [...seenAt.entries()].sort((a, b) => a[1] - b[1]);

const num = (chunk, tag) => {
  const r = new RegExp(`${tag}[^>]*>\\s*<gco:Decimal>(-?\\d+(?:\\.\\d+)?)</gco:Decimal>`);
  const mm = chunk.match(r);
  return mm ? Number(mm[1]) : null;
};

for (let i = 0; i < entries.length; i++) {
  const [id, start] = entries[i];
  const end = i + 1 < entries.length ? entries[i + 1][1] : Math.min(xml.length, start + 20000);
  const chunk = xml.slice(start, end);
  const w = num(chunk, 'westBoundLongitude'), e = num(chunk, 'eastBoundLongitude');
  const s = num(chunk, 'southBoundLatitude'), n = num(chunk, 'northBoundLatitude');
  if (w === null || e === null || s === null || n === null) continue;
  if (!bands.has(id[2])) continue;
  const intersects = !(e < minLon || w > maxLon || n < minLat || s > maxLat);
  if (intersects) hits.push({ id, area: (e - w) * (n - s) });
}

// Prefer harbor-scale (higher band digit), then smaller cells first.
hits.sort((a, b) => (b.id[2].localeCompare(a.id[2])) || (a.area - b.area));
const chosen = [...new Map(hits.map(h => [h.id, h])).values()].slice(0, maxCells);

if (chosen.length === 0) {
  console.error(`no ENC cells intersect ${regionKey} ${JSON.stringify(region.bbox)} in bands [${[...bands]}] — check the catalog or region bbox`);
  process.exit(3);
}
if (hits.length > chosen.length) {
  console.error(`note: ${hits.length} cells matched, capped to ${chosen.length} (max_cells) — dropped: ${hits.slice(chosen.length).map(h => h.id).join(', ')}`);
}
for (const c of chosen) console.log(c.id);
