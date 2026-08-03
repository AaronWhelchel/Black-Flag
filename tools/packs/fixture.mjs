/**
 * Synthetic ENC fixture — a small, honest stand-in cell for the upper Florida
 * Keys area, pushed through the REAL pack pipeline (enc.mjs → tippecanoe →
 * PMTiles) so the demo's decoder and depth-aware routing can be developed and
 * E2E-tested offline. Attributes mirror what GDAL's S-57 driver emits
 * (DRVAL1/DRVAL2, DEPTH, CATLAM, CATWRK, VALDCO…). This is TEST DATA — the
 * manifest says so, and it never ships as a real chart.
 *
 * Usage: node tools/packs/fixture.mjs   → build/enc/fixture-keys/ + copies
 *        the .pmtiles + manifest into demo/packs/fixture/
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, copyFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const stage = join(root, 'build', 'fixture-src');
mkdirSync(stage, { recursive: true });

const fc = (features) => JSON.stringify({ type: 'FeatureCollection', features });
const poly = (rings, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: rings } });
const line = (coords, props) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });
const pt = (lon, lat, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [lon, lat] } });
const box = (w, s, e, n) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];

// ---- depth areas (meters, like real DEPARE) --------------------------------
// Base deep water over the whole fixture; a mid band; a nearshore shallow
// band along the land diagonal; and a marked SHALLOW BANK (0–1.8 m) sitting
// exactly where the v0.8 land-only auto-route detoured — so a boat with real
// draft must route around it once the pack is loaded.
const DEPARE = fc([
  poly(box(-80.75, 24.85, -80.30, 25.15), { DRVAL1: 9.1, DRVAL2: 30 }),
  poly(box(-80.62, 24.88, -80.36, 25.08), { DRVAL1: 5.4, DRVAL2: 9.1 }),
  poly(box(-80.56, 24.98, -80.40, 25.10), { DRVAL1: 1.8, DRVAL2: 5.4 }),
  // the bank: astride the old detour path (~24.95..24.985, -80.61..-80.55)
  poly(box(-80.61, 24.945, -80.55, 24.985), { DRVAL1: 0, DRVAL2: 1.8 }),
]);

const DEPCNT = fc([
  line([[-80.62, 24.88], [-80.62, 25.08]], { VALDCO: 9.1 }),
  line([[-80.56, 24.98], [-80.40, 24.98]], { VALDCO: 5.4 }),
]);

// ---- soundings (DEPTH in meters, as ADD_SOUNDG_DEPTH emits) ---------------
const SOUNDG = fc([]);
const sound = (lon, lat, d) => SOUNDG_FEATS.push(pt(lon, lat, { DEPTH: d }));
const SOUNDG_FEATS = [];
for (let i = 0; i < 8; i++) sound(-80.72 + i * 0.05, 24.90 + (i % 3) * 0.07, 11 + (i % 4) * 2.3);
for (let i = 0; i < 5; i++) sound(-80.60 + i * 0.045, 24.92 + (i % 2) * 0.04, 6.2 + (i % 3) * 1.1);
sound(-80.585, 24.955, 0.9); sound(-80.575, 24.975, 1.2); sound(-80.565, 24.962, 0.6);   // on the bank
sound(-80.50, 25.02, 3.1); sound(-80.46, 25.04, 2.5);
const SOUNDG_FC = fc(SOUNDG_FEATS);

// ---- aids & hazards --------------------------------------------------------
const LIGHTS = fc([
  pt(-80.43, 25.02, { COLOUR: '1', LITCHR: 8, SIGPER: 4, VALNMR: 9, OBJNAM: 'Fixture Pt Lt' }),
]);
const BOYLAT = fc([
  pt(-80.615, 24.94, { CATLAM: 2, COLOUR: '3', OBJNAM: 'FB "2"' }),   // starboard-hand red nun
  pt(-80.545, 24.94, { CATLAM: 1, COLOUR: '4', OBJNAM: 'FB "1"' }),   // port-hand green can
]);
const WRECKS = fc([
  pt(-80.47, 24.99, { CATWRK: 2, VALSOU: 1.5, OBJNAM: 'wreck (dangerous)' }),
]);
const OBSTRN = fc([
  pt(-80.52, 25.05, { CATOBS: 6, VALSOU: 0.9, OBJNAM: 'submerged piling' }),
]);
const COALNE = fc([
  line([[-80.56, 25.15], [-80.44, 25.04], [-80.36, 24.95]], {}),
]);
const RESARE = fc([
  poly(box(-80.50, 24.88, -80.44, 24.92), { CATREA: 4, OBJNAM: 'Fixture Sanctuary (test)' }),
]);

const layers = { DEPARE, DEPCNT, SOUNDG: SOUNDG_FC, LIGHTS, BOYLAT, WRECKS, OBSTRN, COALNE, RESARE };
for (const [name, json] of Object.entries(layers)) writeFileSync(join(stage, `${name}.geojson`), json);

// zip in the shape enc.mjs's synthetic path expects (<LAYER>.geojson entries)
const cellZip = join(root, 'build', 'fixture-cell.zip');
execFileSync('zip', ['-jq', cellZip, ...Object.keys(layers).map(n => join(stage, `${n}.geojson`))]);

// through the REAL pipeline
execFileSync('node', [join(here, 'enc.mjs'), 'fixture-keys', cellZip], { cwd: root, stdio: 'inherit' });

// stamp the manifest as test data, copy into demo/packs/fixture
const packDir = join(root, 'build', 'enc', 'fixture-keys');
const manifest = JSON.parse(readFileSync(join(packDir, 'manifest.json'), 'utf8'));
manifest.provenance = { source: 'SYNTHETIC FIXTURE — test data, not a chart', license: 'n/a', note: 'for pipeline/UI tests only' };
writeFileSync(join(packDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
const dest = join(root, 'demo', 'packs', 'fixture');
mkdirSync(dest, { recursive: true });
for (const f of readdirSync(packDir)) if (f.endsWith('.pmtiles') || f === 'manifest.json') copyFileSync(join(packDir, f), join(dest, f));
console.log('fixture pack → demo/packs/fixture/', readdirSync(dest).join(', '));
