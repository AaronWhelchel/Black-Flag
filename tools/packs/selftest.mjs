/**
 * Pipeline self-test: builds a synthetic "cell" (GeoJSON layers zipped like a
 * cell) and runs enc.mjs end-to-end through GDAL and tippecanoe. Proves the
 * orchestration without claiming any chart data. Runs in CI on every PR that
 * touches tools/packs.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const tmp = 'build/selftest';
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const fc = (features) => JSON.stringify({ type: 'FeatureCollection', features });
const poly = (coords, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [coords] } });
const point = (lon, lat, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [lon, lat] } });

// Synthetic layers in S-57 layer names (values are placeholders, never shipped)
writeFileSync(join(tmp, 'DEPARE.geojson'), fc([
  poly([[-74.1, 40.0], [-73.9, 40.0], [-73.9, 40.2], [-74.1, 40.2], [-74.1, 40.0]], { DRVAL1: 0, DRVAL2: 5 }),
  poly([[-73.9, 40.0], [-73.7, 40.0], [-73.7, 40.2], [-73.9, 40.2], [-73.9, 40.0]], { DRVAL1: 5, DRVAL2: 10 }),
]));
writeFileSync(join(tmp, 'SOUNDG.geojson'), fc([
  point(-74.0, 40.1, { DEPTH: 7.3 }), point(-73.8, 40.1, { DEPTH: 12.1 }),
]));
writeFileSync(join(tmp, 'LIGHTS.geojson'), fc([point(-74.03, 40.10, { LITCHR: 2, SIGPER: 4 })]));

execFileSync('zip', ['-j', '-q', join(tmp, 'SYNTH01.zip'), join(tmp, 'DEPARE.geojson'), join(tmp, 'SOUNDG.geojson'), join(tmp, 'LIGHTS.geojson')]);

// Run the real pipeline
execFileSync('node', ['tools/packs/enc.mjs', 'selftest', join(tmp, 'SYNTH01.zip')], { stdio: 'inherit' });

// Assert outputs
const manifest = JSON.parse(readFileSync('build/enc/selftest/manifest.json', 'utf8'));
const expect = ['depth-areas', 'soundings', 'lights'];
for (const role of expect) {
  if (!manifest.layers[role]) throw new Error(`self-test: missing layer ${role}`);
  const f = join('build/enc/selftest', manifest.layers[role]);
  if (!existsSync(f)) throw new Error(`self-test: missing file ${f}`);
}
console.log('PIPELINE SELF-TEST PASS —', Object.keys(manifest.layers).join(', '), 'built through GDAL + tippecanoe');
