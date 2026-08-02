/**
 * ENC chart-pack pipeline — SRC-01 in the Data Governance Register.
 *
 * NOAA ENC (S-57) → GeoJSON layers (GDAL) → vector tiles (tippecanoe) → PMTiles.
 * This orchestrator runs in CI/production where gdal-bin and tippecanoe are
 * installed (see .github/workflows — pack-build job to be added when the
 * first region ships). It is deliberately explicit, stage by stage, so a
 * failed pack quarantines instead of publishing (Register R4).
 *
 * Usage: node tools/packs/enc.mjs <region> <cell1.zip> [cell2.zip ...]
 * Cells come from the NOAA ENC catalog (https://charts.noaa.gov/ENCs/) —
 * public domain, redistribution permitted with attribution (Register SRC-01).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const S57_LAYERS = [
  // layer          → pack role
  ['DEPARE', 'depth-areas'],     // depth areas (the tinted bands)
  ['DEPCNT', 'depth-contours'],
  ['COALNE', 'coastline'],
  ['SOUNDG', 'soundings'],
  ['BOYLAT', 'buoys-lateral'],   // aids to navigation
  ['BOYSPP', 'buoys-special'],
  ['LIGHTS', 'lights'],
  ['OBSTRN', 'obstructions'],
  ['WRECKS', 'wrecks'],
  ['RESARE', 'restricted-areas'],
];

const need = (bin) => {
  try { execFileSync('which', [bin]); } catch {
    console.error(`missing dependency: ${bin} — this pipeline runs in CI (gdal-bin + tippecanoe). See tools/packs/README.md`);
    process.exit(2);
  }
};

const [region, ...cells] = process.argv.slice(2);
if (!region || cells.length === 0) {
  console.error('usage: node tools/packs/enc.mjs <region> <cell.zip> [...]');
  process.exit(1);
}
need('ogr2ogr'); need('tippecanoe');

const work = join('build', 'enc', region);
mkdirSync(work, { recursive: true });

// Stage 1 — S-57 → GeoJSON per layer per cell.
// A real NOAA cell zip contains ENC_ROOT/<CELL>.000 (S-57 base file); the
// pipeline self-test uses a synthetic zip of <LAYER>.geojson files instead —
// same orchestration, no chart data claimed.
const layerFiles = {};
for (const cell of cells) {
  if (!existsSync(cell)) { console.error(`cell not found: ${cell}`); process.exit(2); }
  const entries = execFileSync('unzip', ['-Z1', cell], { encoding: 'utf8' }).trim().split('\n');
  const s57base = entries.find(e => e.endsWith('.000'));
  for (const [s57, role] of S57_LAYERS) {
    const out = join(work, `${basename(cell, '.zip')}-${role}.geojson`);
    try {
      if (s57base) {
        execFileSync('ogr2ogr', ['-f', 'GeoJSON', out, `/vsizip/${cell}/${s57base}`, s57, '-skipfailures'], { stdio: 'pipe' });
      } else {
        const gj = entries.find(e => e.toUpperCase() === `${s57}.GEOJSON`);
        if (!gj) continue;
        execFileSync('ogr2ogr', ['-f', 'GeoJSON', out, `/vsizip/${cell}/${gj}`, '-skipfailures'], { stdio: 'pipe' });
      }
      (layerFiles[role] ??= []).push(out);
    } catch { /* layer absent in this cell — normal */ }
  }
}

// Stage 2 — GeoJSON → PMTiles per role
const manifest = { pack: 'enc', region, built_at: new Date().toISOString(), layers: {}, provenance: {
  source: 'NOAA ENC (S-57)', license: 'public-domain/noaa', note: 'attribution shown on chart surfaces; not for navigation positioning',
} };
for (const [role, files] of Object.entries(layerFiles)) {
  const out = join(work, `${region}-${role}.pmtiles`);
  try {
    execFileSync('tippecanoe', ['-o', out, '-zg', '--drop-densest-as-needed', '-l', role, ...files], { stdio: 'pipe' });
  } catch {
    // Sparse layers (a lone light, one wreck) defeat -zg's guess — retry with
    // an explicit zoom range rather than dropping the layer.
    execFileSync('tippecanoe', ['-o', out, '--force', '-Z6', '-z12', '-l', role, ...files], { stdio: 'pipe' });
  }
  manifest.layers[role] = basename(out);
}

// Stage 3 — manifest with checksums happens in the publish step (R4 gate)
writeFileSync(join(work, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`ENC pack staged: ${work} (${Object.keys(manifest.layers).length} layers) — publish step verifies checksums before upload`);
