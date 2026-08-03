/**
 * Hydro pack builder — lakes & rivers for a region, from Natural Earth 10m
 * (via @geo-maps, public domain). First real instance of the pack pipeline:
 * source → crop → thin → provenance-stamped regional pack.
 *
 * Usage: node tools/packs/hydro.mjs [minLon minLat maxLon maxLat] [out]
 * Default region: North America East (-100, 17, -55, 50).
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const [minLon, minLat, maxLon, maxLat] = process.argv.length >= 6
  ? process.argv.slice(2, 6).map(Number) : [-100, 17, -55, 50];
const outPath = process.argv[6] ?? join(here, '..', '..', 'demo', 'packs', 'hydro-east-na.json');

const lakes = require('@geo-maps/earth-lakes-10m/map.geo.json');
const rivers = require('@geo-maps/earth-rivers-10m/map.geo.json');

const inBox = (lon, lat) => lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
const ringTouches = (ring) => ring.some(([lon, lat]) => inBox(lon, lat));
const rnd = (v) => Math.round(v * 500) / 500; // ~0.002° ≈ 0.12 nm — plotting scale, honest for an overview chart
const thin = (ring, keepEvery) => ring.filter((_, i) => i % keepEvery === 0 || i === ring.length - 1).map(([a, b]) => [rnd(a), rnd(b)]);

// Lakes: MultiPolygon inside a GeometryCollection
const lakeGeom = lakes.geometries[0];
const lakePolys = [];
for (const poly of lakeGeom.coordinates) {
  const outer = poly[0];
  if (!ringTouches(outer)) continue;
  if (outer.length < 4) continue;                        // keep small reservoirs — captains boat there (Patoka!)
  const keep = outer.length > 2000 ? 6 : outer.length > 500 ? 3 : 1;
  lakePolys.push([thin(outer, keep)]);                   // outer ring only — islands-in-lakes below pack scale
}

// Rivers: NE 10m models major rivers as area polygons (MultiPolygon)
const riverGeom = rivers.geometries[0];
const riverLines = [];
for (const poly of riverGeom.coordinates) {
  const outer = poly[0];
  if (!ringTouches(outer)) continue;
  if (outer.length < 6) continue;
  const keep = outer.length > 2000 ? 6 : outer.length > 500 ? 3 : 1;
  riverLines.push(thin(outer, keep));
}

const pack = {
  pack: 'hydro',
  region: { bbox: [minLon, minLat, maxLon, maxLat], name: 'east-na' },
  provenance: {
    source: 'natural-earth-10m (lakes, rivers) via @geo-maps@0.6.0',
    license: 'public-domain/natural-earth',
    issued: 'NE 10m v5 series',
    fetched_at: new Date().toISOString(),
    pipeline: 'tools/packs/hydro.mjs',
    note: 'plotting-scale generalization (~0.12 nm); full ENC detail arrives with the S-57 pipeline',
  },
  lakes: lakePolys,
  rivers: riverLines,
};

mkdirSync(dirname(outPath), { recursive: true });
const json = JSON.stringify(pack);
writeFileSync(outPath, json);
console.log(`wrote ${outPath}: ${lakePolys.length} lakes, ${riverLines.length} rivers, ${(json.length / 1048576).toFixed(2)} MB`);
