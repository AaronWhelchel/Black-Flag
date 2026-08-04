/** Selftest: synthetic Overpass response (a two-way multipolygon lake with an
 *  island) through the full osmwater pipeline → real pmtiles out. */
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
mkdirSync(join(root, 'build'), { recursive: true });

const g = (pts) => pts.map(([lat, lon]) => ({ lat, lon }));
const synth = {
  elements: [
    { type: 'relation', tags: { natural: 'water' }, members: [
      { type: 'way', role: 'outer', geometry: g([[38.40, -86.75], [38.40, -86.60], [38.46, -86.60]]) },
      { type: 'way', role: 'outer', geometry: g([[38.46, -86.60], [38.46, -86.75], [38.40, -86.75]]) },
      { type: 'way', role: 'inner', geometry: g([[38.428, -86.68], [38.428, -86.672], [38.434, -86.672], [38.434, -86.68], [38.428, -86.68]]) },
    ] },
    { type: 'way', tags: { natural: 'water' }, geometry: g([[38.37, -86.70], [38.37, -86.69], [38.38, -86.69], [38.38, -86.70], [38.37, -86.70]]) },
  ],
};
const f = join(root, 'build', 'osmwater-selftest.json');
writeFileSync(f, JSON.stringify(synth));

execFileSync('node', [join(here, 'osmwater.mjs'), 'in-patoka', f], { cwd: root, stdio: 'inherit' });

const man = JSON.parse(readFileSync(join(root, 'build', 'enc', 'in-patoka', 'manifest.json'), 'utf8'));
const roles = Object.keys(man.layers);
if (!roles.includes('depth-areas') || !roles.includes('coverage') || !roles.includes('coastline')) {
  console.error(`missing roles: ${roles}`); process.exit(1);
}
for (const file of Object.values(man.layers)) {
  if (!existsSync(join(root, 'build', 'enc', 'in-patoka', file))) { console.error(`missing ${file}`); process.exit(1); }
}
const dep = JSON.parse(readFileSync(join(root, 'build', 'enc', 'in-patoka', 'in-patoka-depth-areas.geojson'), 'utf8'));
const withHole = dep.features.find((x) => x.geometry.coordinates.length === 2);
if (!withHole) { console.error('island hole not assembled into its lake polygon'); process.exit(1); }
if (!dep.features.every((x) => x.properties.UNSURV === 1)) { console.error('UNSURV flag missing'); process.exit(1); }
console.log('OSMWATER SELF-TEST PASS — relation assembly, island holes, UNSURV honesty, 3 roles built');
