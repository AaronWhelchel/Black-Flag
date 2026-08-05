/**
 * Vessel catalogue — Wikidata source (SRC-13).
 *
 * Wikidata is CC0: we can ship it, and it is the only large open dataset that
 * knows both RMS Titanic and the ferry that runs past your marina. It carries
 * real dimensions with UNITS attached, which matters — a "length: 30" that is
 * actually feet, imported as metres, would put a 100 ft draft-3 boat in the
 * catalogue and route it through a channel it can't fit.
 *
 * Only vessels with a length are taken. A name with no numbers is not a
 * vessel record, it's trivia.
 *
 * Usage: node tools/vessels/wikidata.mjs > build/vessels/wikidata.ndjson
 */
const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'blackflag-vessel-catalogue/1.0 (https://github.com/AaronWhelchel/Black-Flag; charts for small-boat captains)';

// Partition by length so every query stays inside the endpoint's timeout.
// Bands are in each item's OWN unit, which is fine — they only shard the work.
const BANDS = [[0, 4], [4, 7], [7, 10], [10, 14], [14, 20], [20, 28], [28, 40],
               [40, 60], [60, 90], [90, 140], [140, 220], [220, 400], [400, 1200]];

const QUERY = (lo, hi) => `
SELECT ?item ?itemLabel ?typeLabel ?loaAmt ?loaUnit ?beamAmt ?beamUnit ?draftAmt ?draftUnit ?gt ?built ?makerLabel ?crew ?pax WHERE {
  ?item wdt:P31 ?type .
  ?type wdt:P279* wd:Q1229765 .
  ?item p:P2043/psv:P2043 ?loaNode .
  ?loaNode wikibase:quantityAmount ?loaAmt ; wikibase:quantityUnit ?loaUnit .
  FILTER(?loaAmt > ${lo} && ?loaAmt <= ${hi})
  OPTIONAL { ?item p:P2261/psv:P2261 ?bN . ?bN wikibase:quantityAmount ?beamAmt ; wikibase:quantityUnit ?beamUnit . }
  OPTIONAL { ?item p:P2262/psv:P2262 ?dN . ?dN wikibase:quantityAmount ?draftAmt ; wikibase:quantityUnit ?draftUnit . }
  OPTIONAL { ?item wdt:P1093 ?gt }
  OPTIONAL { ?item wdt:P571 ?built }
  OPTIONAL { ?item wdt:P176 ?maker }
  OPTIONAL { ?item wdt:P1029 ?crew }
  OPTIONAL { ?item wdt:P1083 ?pax }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 9000`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function run(query, label) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`, {
        headers: { accept: 'application/sparql-results+json', 'user-agent': UA },
      });
      if (!res.ok) { console.error(`  ${label}: HTTP ${res.status}`); await sleep(15000); continue; }
      const js = await res.json();
      return js.results?.bindings ?? [];
    } catch (err) { console.error(`  ${label}: ${err.message}`); await sleep(15000); }
  }
  console.error(`  ${label}: gave up after 3 attempts`);
  return null;
}

// ---- units ---------------------------------------------------------------
const M = 3.280839895;
const UNIT_FT = {
  Q11573: M,        // metre
  Q3710: 1,         // foot
  Q218593: 1 / 12,  // inch
  Q828224: 3280.84, // kilometre
  Q174728: M / 100, // centimetre
};
const toFeet = (amt, unitUri) => {
  if (amt == null) return null;
  const q = String(unitUri ?? '').split('/').pop();
  const f = UNIT_FT[q];
  if (!f) return null;              // unknown unit — refuse to guess
  const ft = Number(amt) * f;
  return Number.isFinite(ft) && ft > 0 ? Math.round(ft * 10) / 10 : null;
};

// ---- category ------------------------------------------------------------
const CATEGORY_RULES = [
  [/cruise (ship|liner)/i, 'cruise-ship'], [/ocean liner|passenger liner|funnel liner|\bliner\b/i, 'ocean-liner'],
  [/ferry|ferryboat/i, 'ferry'], [/tug/i, 'tug'],
  [/container/i, 'container'], [/tanker/i, 'tanker'],
  [/bulk carrier|cargo|freighter|cargo ship/i, 'cargo'],
  [/submarine|u-boat/i, 'submarine'],
  [/aircraft carrier|destroyer|frigate|corvette|battleship|cruiser \(|warship|patrol|minesweeper|gunboat|naval |torpedo|landing (ship|craft)|amphibious|troopship|ironclad|man-of-war/i, 'warship'],
  [/(sailing ship|tall ship|barque|brig|schooner|clipper|windjammer|galleon)/i, 'tall-ship'],
  [/(sailboat|sailing yacht|sloop|ketch|yawl|dinghy \(sail|sailing dinghy)/i, 'sailboat'],
  [/catamaran|trimaran/i, 'catamaran'],
  [/motor yacht|superyacht|megayacht|yacht/i, 'motor-yacht'],
  [/trawler/i, 'trawler'],
  [/fishing|whaler|sealer|trawling/i, 'fishing-vessel'],
  [/icebreaker|research vessel|survey|dredg|barge|workboat|pilot boat|supply/i, 'workboat'],
  [/lifeboat|rescue/i, 'workboat'],
  [/kayak/i, 'kayak'], [/canoe/i, 'canoe'], [/paddleboard|surfboard/i, 'paddleboard'],
  [/inflatable|rib\b/i, 'rib'], [/houseboat/i, 'houseboat'],
  [/personal watercraft|jet ski/i, 'jet-ski'],
  [/rowing|rowboat|skiff|dinghy|tender/i, 'dinghy'],
  [/motorboat|speedboat|powerboat|launch/i, 'runabout'],
  [/motor (ship|vessel)|freight|coaster/i, 'cargo'],
  [/sailing (vessel|boat|craft)/i, 'sailboat'],
  [/steamboat|paddle steamer|riverboat/i, 'workboat'],
];
const categoryOf = (typeLabel, name) => {
  const s = `${typeLabel ?? ''} ${name ?? ''}`;
  for (const [re, cat] of CATEGORY_RULES) if (re.test(s)) return cat;
  return 'other';
};

const POWER_RULES = [
  [/steam|paddle steamer/i, 'steam'], [/nuclear/i, 'nuclear'],
  [/sail|barque|brig|schooner|clipper|sloop|ketch|windjammer|galleon|tall ship/i, 'sail'],
  [/kayak|canoe|rowing|rowboat|paddle/i, 'paddle'],
];
const powerOf = (typeLabel, name) => {
  const s = `${typeLabel ?? ''} ${name ?? ''}`;
  for (const [re, p] of POWER_RULES) if (re.test(s)) return p;
  return undefined;
};

// ---- main ----------------------------------------------------------------
const seen = new Map();
for (const [lo, hi] of BANDS) {
  const label = `length ${lo}–${hi}`;
  const rows = await run(QUERY(lo, hi), label);
  if (rows === null) { console.error('::warning::a Wikidata band failed — catalogue will be short by that band'); continue; }
  let kept = 0;
  for (const r of rows) {
    const qid = r.item.value.split('/').pop();
    if (seen.has(qid)) continue;
    const name = r.itemLabel?.value ?? '';
    if (!name || /^Q\d+$/.test(name)) continue;          // unlabelled item — no use to a captain
    const loa = toFeet(r.loaAmt?.value, r.loaUnit?.value);
    if (loa == null || loa > 1600) continue;             // no length, or nonsense
    const typeLabel = r.typeLabel?.value ?? '';
    const draft = toFeet(r.draftAmt?.value, r.draftUnit?.value);
    const beam = toFeet(r.beamAmt?.value, r.beamUnit?.value);
    const built = r.built?.value ? Number(String(r.built.value).slice(0, 4)) : undefined;
    const power = powerOf(typeLabel, name);
    seen.set(qid, {
      id: `wd-${qid.toLowerCase()}`,
      name,
      make: r.makerLabel?.value && !/^Q\d+$/.test(r.makerLabel.value) ? r.makerLabel.value : undefined,
      year_from: Number.isFinite(built) ? built : undefined,
      category: categoryOf(typeLabel, name),
      kind: 'ship',
      loa_ft: loa,
      beam_ft: beam ?? undefined,
      // a draft deeper than the boat is long is a bad import, not a boat
      draft_ft: draft != null && draft < loa ? draft : undefined,
      gross_tonnage: r.gt?.value ? Number(r.gt.value) : undefined,
      power: power ? { type: power } : undefined,
      capacity: {
        crew: r.crew?.value ? Number(r.crew.value) : undefined,
        passengers: r.pax?.value ? Number(r.pax.value) : undefined,
      },
      notes: typeLabel && typeLabel !== 'other' ? typeLabel : undefined,
      provenance: {
        source: 'Wikidata', license: 'CC0',
        url: `https://www.wikidata.org/wiki/${qid}`,
        confidence: 'published',
      },
    });
    kept++;
  }
  console.error(`  ${label}: ${rows.length} rows, ${kept} kept (${seen.size} total)`);
  await sleep(2500);   // be a decent citizen
}

if (seen.size === 0) {
  console.error('Wikidata returned nothing usable — quarantining (Register R4)');
  process.exit(1);
}
for (const v of seen.values()) console.log(JSON.stringify(v));
console.error(`wikidata: ${seen.size} vessels`);
