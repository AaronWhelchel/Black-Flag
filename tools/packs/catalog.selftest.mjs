/**
 * Self-test for catalog.mjs against synthetic records in the two shapes NOAA
 * actually publishes (verified against US1EEZ1M_19115.xml, 2026-08):
 *  A) default-namespace MD_Metadata + fileIdentifier + gml:pos polygon
 *     (including antimeridian-continued longitudes),
 *  B) legacy gmd-prefixed record with directional Decimal bounds.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

mkdirSync('build', { recursive: true });

const polyRecord = (id, positions) => `
<MD_Metadata xmlns="http://www.isotc211.org/2005/gmd" xmlns:gco="http://www.isotc211.org/2005/gco" xmlns:gml="http://www.opengis.net/gml/3.2">
  <fileIdentifier><gco:CharacterString>${id}_19115.xml</gco:CharacterString></fileIdentifier>
  <EX_BoundingPolygon><gml:Polygon><gml:exterior><gml:LinearRing>
    ${positions.map(([lat, lon]) => `<gml:pos>${lat} ${lon}</gml:pos>`).join('\n    ')}
  </gml:LinearRing></gml:exterior></gml:Polygon></EX_BoundingPolygon>
</MD_Metadata>`;

const boundsRecord = (id, w, s, e, n) => `
<gmd:MD_Metadata xmlns:gmd="x" xmlns:gco="y">
  <gmd:fileIdentifier><gco:CharacterString>${id}_19115.xml</gco:CharacterString></gmd:fileIdentifier>
  <gmd:westBoundLongitude><gco:Decimal>${w}</gco:Decimal></gmd:westBoundLongitude>
  <gmd:eastBoundLongitude><gco:Decimal>${e}</gco:Decimal></gmd:eastBoundLongitude>
  <gmd:southBoundLatitude><gco:Decimal>${s}</gco:Decimal></gmd:southBoundLatitude>
  <gmd:northBoundLatitude><gco:Decimal>${n}</gco:Decimal></gmd:northBoundLatitude>
</gmd:MD_Metadata>`;

const xml = `<DS_Series>${
  // Harbor cell in the FL region — polygon shape (lat lon order)
  polyRecord('US5FLPLY', [[25.0, -80.3], [25.4, -80.3], [25.4, -80.0], [25.0, -80.0]])}${
  // Approach cell overlapping the region — legacy bounds shape
  boundsRecord('US4FLBND', -80.6, 24.8, -79.8, 25.9)}${
  // Antimeridian-continued longitudes (like US1EEZ1M) far from the region
  polyRecord('US5AKWRP', [[20.1, -210], [23.9, -214.9]])}${
  // Band-1 overview covering everything — must be band-filtered out
  polyRecord('US1EEZ9M', [[20, -100], [45, -60]])}</DS_Series>`;

writeFileSync('build/test-catalog.xml', xml);

const out = execFileSync('node', ['tools/packs/catalog.mjs', 'build/test-catalog.xml', 'fl-keys-bimini'], { encoding: 'utf8' }).trim().split('\n');
if (!out.includes('US5FLPLY') || !out.includes('US4FLBND')) throw new Error(`selection wrong: ${out}`);
if (out.includes('US5AKWRP') || out.includes('US1EEZ9M')) throw new Error(`over-selected: ${out}`);
if (out[0] !== 'US5FLPLY') throw new Error(`harbor band should sort first: ${out}`);

// Exit-3 honesty: a region with no matches must fail loudly.
let failed = false;
try {
  execFileSync('node', ['tools/packs/catalog.mjs', 'build/test-catalog.xml', 'nj-manasquan'], { encoding: 'utf8', stdio: 'pipe' });
} catch (e) { failed = e.status === 3; }
if (!failed) throw new Error('empty region must exit 3');

console.log('CATALOG SELF-TEST PASS —', out.join(', '), '· empty-region exit-3 verified');
