/** Self-test for catalog.mjs against a synthetic ISO-19115-shaped snippet. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

mkdirSync('build', { recursive: true });
const cell = (id, w, s, e, n) => `
  <gmd:MD_DataIdentification>
    <gco:CharacterString>${id}</gco:CharacterString>
    <gmd:westBoundLongitude><gco:Decimal>${w}</gco:Decimal></gmd:westBoundLongitude>
    <gmd:eastBoundLongitude><gco:Decimal>${e}</gco:Decimal></gmd:eastBoundLongitude>
    <gmd:southBoundLatitude><gco:Decimal>${s}</gco:Decimal></gmd:southBoundLatitude>
    <gmd:northBoundLatitude><gco:Decimal>${n}</gco:Decimal></gmd:northBoundLatitude>
  </gmd:MD_DataIdentification>`;

// One harbor cell inside the FL region, one approach cell overlapping it,
// one Alaska cell far away, one band-1 overview that must be band-filtered out.
const xml = `<catalog>${
  cell('US5FLTST', -80.3, 25.0, -80.0, 25.4)}${
  cell('US4FLTST', -80.6, 24.8, -79.8, 25.9)}${
  cell('US5AKTST', -150, 60, -149, 61)}${
  cell('US1EEZ1M', -100, 20, -60, 45)}</catalog>`;
writeFileSync('build/test-catalog.xml', xml);

const out = execFileSync('node', ['tools/packs/catalog.mjs', 'build/test-catalog.xml', 'fl-keys-bimini'], { encoding: 'utf8' }).trim().split('\n');
if (!out.includes('US5FLTST') || !out.includes('US4FLTST')) throw new Error(`selection wrong: ${out}`);
if (out.includes('US5AKTST') || out.includes('US1EEZ1M')) throw new Error(`over-selected: ${out}`);
if (out[0] !== 'US5FLTST') throw new Error(`harbor band should sort first: ${out}`);
console.log('CATALOG SELF-TEST PASS —', out.join(', '));
