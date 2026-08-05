import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchVessels, searchKey, describeRow, draftBasis, tripFieldsOf,
  VesselIndexRow, VesselSpec,
} from '../src/vessel.js';

const rows: VesselIndexRow[] = [
  ['tahoe-t16', 'Tahoe T16', 'runabout', 16, 1.2, 75, 0],
  ['tahoe-2150', 'Tahoe 2150', 'bowrider', 21.5, 2.1, 200, 0],
  ['bayliner-vr5', 'Bayliner VR5', 'bowrider', 21.6, 2.2, 200, 0],
  ['sun-tracker-party-barge-20', 'Sun Tracker Party Barge 20 DLX', 'pontoon', 21.8, 1.2, 90, 0],
  ['rms-titanic', 'RMS Titanic', 'ocean-liner', 882.5, 34.6, null, 1],
  ['carnival-vista', 'Carnival Vista', 'cruise-ship', 1055, 27, null, 1],
  ['generic-kayak-12', 'Kayak — 12 ft touring', 'kayak', 12, 0.5, null, 0],
];

test('finds a boat by make and model however it is typed', () => {
  for (const q of ['Tahoe T16', 'tahoe t16', 'TAHOE  T-16', 't16']) {
    const hits = searchVessels(rows, q);
    assert.equal(hits[0]?.row[0], 'tahoe-t16', `query "${q}" gave ${hits[0]?.row[0]}`);
  }
});

test('an exact name outranks a longer name that merely contains it', () => {
  const hits = searchVessels(rows, 'tahoe');
  assert.equal(hits.length, 2);
  assert.ok(hits.every(h => h.row[1].startsWith('Tahoe')));
});

test('searching a class finds the class, not just names', () => {
  assert.ok(searchVessels(rows, 'pontoon').some(h => h.row[0] === 'sun-tracker-party-barge-20'));
  assert.ok(searchVessels(rows, 'party barge').some(h => h.row[0] === 'sun-tracker-party-barge-20'));
  assert.ok(searchVessels(rows, 'personal watercraft').length === 0, 'no PWC in this fixture');
});

test('the catalogue reaches from a kayak to an ocean liner', () => {
  assert.equal(searchVessels(rows, 'titanic')[0].row[0], 'rms-titanic');
  assert.equal(searchVessels(rows, 'carnival')[0].row[0], 'carnival-vista');
  assert.equal(searchVessels(rows, 'kayak')[0].row[2], 'kayak');
});

test('an empty query returns nothing rather than everything', () => {
  assert.equal(searchVessels(rows, '   ').length, 0);
});

test('result lines carry the numbers a captain is choosing on', () => {
  const line = describeRow(rows[0]);
  assert.match(line, /16 ft/);
  assert.match(line, /runabout/);
  assert.match(line, /75 hp/);
  assert.match(line, /1.2 ft draft/);
});

test('searchKey folds punctuation, case and spacing', () => {
  assert.equal(searchKey('Sea Ray  SDX-250!'), 'sea ray sdx 250');
});

// ---- honesty about numbers ----------------------------------------------

const published: VesselSpec = {
  id: 'x', name: 'X', category: 'runabout', kind: 'model', draft_ft: 1.2,
  provenance: { source: 'manufacturer', license: 'curated', confidence: 'published' },
};

test('a class-typical draft is reported as estimated, never as published', () => {
  assert.equal(draftBasis(published), 'published');
  assert.equal(draftBasis({ ...published, estimated: ['draft_ft'] }), 'estimated');
  assert.equal(draftBasis({ ...published, draft_ft: undefined }), 'unknown');
  assert.equal(
    draftBasis({ ...published, provenance: { ...published.provenance, confidence: 'captain' } }),
    'captain',
  );
});

test('cruise speed is derived honestly when only a top speed is known', () => {
  const t = tripFieldsOf({
    ...published, performance: { top_mph: 40, rpm_at_top: 6000 },
  });
  // 40 mph ≈ 34.8 kn; a sane cruise is well below wide-open throttle
  assert.ok(t.cruise_kn! > 20 && t.cruise_kn! < 28, `got ${t.cruise_kn}`);
});

test('trip fields never invent a draft that is not in the record', () => {
  const t = tripFieldsOf({ ...published, draft_ft: undefined });
  assert.equal(t.draft_ft, undefined);
});
