/**
 * Vessel catalogue build — merge sources, sanity-check, shard, publish.
 *
 * Output layout (served like a chart pack, downloaded once, then offline):
 *   manifest.json   built_at, counts, sources and their licences
 *   index.json      compact rows for search: [id,name,category,loa,draft,hp,kind]
 *   v/<xx>.json     full records, 256 shards by id hash — a catalogue of every
 *                   boat afloat must not be a single blob a phone has to hold
 *
 * The sanity pass is the point of this file. A vessel record that says a 16 ft
 * runabout draws 30 ft would silently refuse every route the captain plans, and
 * one that says an ocean liner draws 2 ft would cheerfully route it aground.
 *
 * Usage: node tools/vessels/build.mjs <source.ndjson> [more.ndjson ...]
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join('build', 'vessels');
mkdirSync(join(out, 'v'), { recursive: true });

const sources = process.argv.slice(2);
const all = [];
const sourceCounts = {};

// curated seed always participates
{
  const seed = JSON.parse(readFileSync(join(here, 'seed-recreational.json'), 'utf8'));
  for (const v of seed.vessels) { delete v._comment; all.push(v); }
  sourceCounts['curated seed'] = seed.vessels.length;
}
for (const f of sources) {
  if (!existsSync(f)) { console.warn(`source missing, skipped: ${f}`); continue; }
  let n = 0;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { all.push(JSON.parse(line)); n++; } catch { /* a bad line is not a vessel */ }
  }
  sourceCounts[f] = n;
}
if (!all.length) { console.error('no vessels from any source — quarantining (Register R4)'); process.exit(1); }

// ---- sanity ---------------------------------------------------------------
// Every rejection is COUNTED and reported. Silently dropping records is how a
// catalogue quietly loses half its boats and nobody notices.
const rejected = { noName: 0, noNumbers: 0, draftVsLength: 0, absurd: 0, dupe: 0 };
const clean = [];
for (const v of all) {
  if (!v.name || !v.name.trim()) { rejected.noName++; continue; }
  const hasNumbers = v.loa_ft != null || v.draft_ft != null || v.gross_tonnage != null;
  if (!hasNumbers) { rejected.noNumbers++; continue; }
  if (v.loa_ft != null && (!(v.loa_ft > 0.5) || v.loa_ft > 1600)) { rejected.absurd++; continue; }
  if (v.draft_ft != null && !(v.draft_ft > 0 && v.draft_ft < 200)) { rejected.absurd++; continue; }
  // A boat's draft is a fraction of its length. Anything else is a unit
  // mix-up or a bad import, and a bad draft is a grounding.
  if (v.loa_ft != null && v.draft_ft != null && v.draft_ft > v.loa_ft * 0.6) { rejected.draftVsLength++; delete v.draft_ft; }
  if (v.beam_ft != null && v.loa_ft != null && v.beam_ft > v.loa_ft * 1.2) delete v.beam_ft;
  for (const k of ['capacity', 'performance', 'power']) {
    if (v[k]) { for (const [kk, vv] of Object.entries(v[k])) if (vv == null || Number.isNaN(vv)) delete v[k][kk];
                if (!Object.keys(v[k]).length) delete v[k]; }
  }
  clean.push(v);
}

// ---- dedupe ---------------------------------------------------------------
// Same name and same length ⇒ same vessel. Prefer the record that carries
// more of what a captain needs, and prefer curated over imported for models.
const key = (v) => `${v.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${v.loa_ft ?? '?'}`;
const richness = (v) =>
  (v.draft_ft != null ? 8 : 0) + (v.beam_ft != null ? 3 : 0) + (v.power?.hp ? 3 : 0) +
  (v.capacity ? Object.keys(v.capacity).length : 0) + (v.performance ? 3 : 0) +
  (v.provenance?.confidence === 'captain' ? 20 : v.provenance?.license === 'curated' ? 6 : 0);
const byKey = new Map();
for (const v of clean) {
  const k = key(v);
  const prev = byKey.get(k);
  if (!prev) { byKey.set(k, v); continue; }
  rejected.dupe++;
  if (richness(v) > richness(prev)) byKey.set(k, v);
}
const vessels = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));

// ---- emit -----------------------------------------------------------------
const hash2 = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return (h & 0xff).toString(16).padStart(2, '0');
};
const shards = new Map();
const index = [];
for (const v of vessels) {
  index.push([v.id, v.name, v.category ?? 'other',
              v.loa_ft ?? null, v.draft_ft ?? null, v.power?.hp ?? null,
              v.kind === 'ship' ? 1 : 0]);
  const sh = hash2(v.id);
  (shards.get(sh) ?? shards.set(sh, {}).get(sh))[v.id] = v;
}
for (const [sh, map] of shards) writeFileSync(join(out, 'v', `${sh}.json`), JSON.stringify(map));
writeFileSync(join(out, 'index.json'), JSON.stringify(index));

const byCategory = {};
for (const v of vessels) byCategory[v.category ?? 'other'] = (byCategory[v.category ?? 'other'] ?? 0) + 1;
const withDraft = vessels.filter(v => v.draft_ft != null).length;

const manifest = {
  pack: 'vessels',
  built_at: new Date().toISOString(),
  count: vessels.length,
  with_draft: withDraft,
  shards: [...shards.keys()].sort(),
  by_category: byCategory,
  sources: [
    { name: 'Wikidata', license: 'CC0', note: 'ships and boats with published dimensions; units converted from the stated unit, never assumed' },
    { name: 'Black Flag curated seed', license: 'curated', note: 'recreational models and class-typical profiles; estimated fields are declared per record' },
  ],
  honesty: 'draft_ft feeds depth-aware routing. Records mark estimated fields; the app declares an estimated draft to the captain rather than routing on it silently.',
};
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`vessel catalogue: ${vessels.length} vessels in ${shards.size} shards`);
console.log(`  sources: ${Object.entries(sourceCounts).map(([k, n]) => `${k}=${n}`).join(', ')}`);
console.log(`  with draft: ${withDraft} (${((withDraft / vessels.length) * 100).toFixed(0)}%)`);
console.log(`  rejected: ${JSON.stringify(rejected)}`);
console.log(`  categories: ${Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k}:${n}`).join(' ')}`);
if (vessels.length < 500) console.warn(`::warning::only ${vessels.length} vessels — a source probably failed`);
