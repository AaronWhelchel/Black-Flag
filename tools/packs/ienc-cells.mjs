/**
 * USACE IENC cell lister — inland rivers (Register SRC-10, CC0 public domain).
 *
 * Unlike NOAA (whose catalog we parse at build time), USACE cells follow a
 * fixed, published naming scheme: U37<RIVER><NNN>.zip, numbered from the
 * river's mouth in ~25-mile blocks, served from
 *   https://ienccloud.us/ienc/products/files/u37/ienc_s57/
 * A region names the river code(s) and cell ranges; cells that don't exist
 * 404 at download time and the workflow warn-skips them (reported, not
 * hidden) — the R4 gate still fails the build if NOTHING downloads.
 *
 * Usage: node tools/packs/ienc-cells.mjs <region>   → cell names, one per line
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const regionKey = process.argv[2];
const { regions } = JSON.parse(readFileSync(join(here, 'regions.json'), 'utf8'));
const region = regions[regionKey];

if (!region) { console.error(`unknown region: ${regionKey}`); process.exit(2); }
if (!region.ienc) { console.error(`region ${regionKey} has no "ienc" spec — it is a NOAA coastal region (use catalog.mjs)`); process.exit(2); }

const VALID_CODE = /^[A-Z]{2}$/;
let count = 0;
for (const seg of region.ienc) {
  if (!VALID_CODE.test(seg.code) || !(seg.from >= 0) || !(seg.to >= seg.from) || seg.to - seg.from > 60) {
    console.error(`bad ienc segment in ${regionKey}: ${JSON.stringify(seg)}`);
    process.exit(2);
  }
  for (let n = seg.from; n <= seg.to; n++) {
    console.log(`U37${seg.code}${String(n).padStart(3, '0')}`);
    count++;
  }
}
if (count === 0) { console.error(`region ${regionKey} produced no cells`); process.exit(3); }
