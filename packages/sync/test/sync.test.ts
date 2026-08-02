import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine, SyncServer } from '../src/index.js';

/** Deterministic clock per device (no wall time in tests). */
const mkClock = (start: number, stepMs = 1000) => {
  let t = start;
  return { now: () => (t += stepMs) };
};

/** Seeded PRNG (LCG) — the convergence property must be reproducible. */
const mkRng = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

/** Canonical (sorted-key) serialization — convergence is about values, not
 *  the insertion order JSON.stringify happens to reflect. */
const stateOf = (e: SyncEngine, entity: string, id: string) => {
  const v = e.get(entity, id);
  return v === null ? 'null' : JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))));
};

// ---------- the §6 golden walkthrough: phone and tablet, both offline ----------

test('golden: same plan edited on phone and tablet offline merges per field, nothing clobbered', async () => {
  const server = new SyncServer();
  const phone = new SyncEngine('phone', mkClock(1_000_000));
  const tablet = new SyncEngine('tablet', mkClock(1_000_500));

  // Seed the plan from the phone and sync both devices to parity.
  phone.write('plan', 'p1', 'create', { name: 'Block Island', depart_at: '06:00', leg3_speed_kn: 15 });
  await phone.sync(server.transport());
  await tablet.sync(server.transport());

  // Sunday, both offline:
  phone.write('plan', 'p1', 'update', { depart_at: '09:30' });                 // Dana, phone
  tablet.write('plan', 'p1', 'update', { name: 'Block Island Run', leg3_speed_kn: 17 }); // partner, tablet

  // Monday: phone syncs first, then tablet, then both pull.
  await phone.sync(server.transport());
  await tablet.sync(server.transport());
  await phone.sync(server.transport());

  const expected = { name: 'Block Island Run', depart_at: '09:30', leg3_speed_kn: 17 };
  assert.deepEqual(phone.get('plan', 'p1'), expected);
  assert.deepEqual(tablet.get('plan', 'p1'), expected);
});

// ---------- guarantee 1: convergence under random interleaving ----------

test('convergence: random ops and sync order across 3 devices, many seeds → identical state', async () => {
  for (const seed of [1, 7, 42, 1234, 99999]) {
    const rng = mkRng(seed);
    const server = new SyncServer();
    const devices = [
      new SyncEngine('A', mkClock(2_000_000, 700)),
      new SyncEngine('B', mkClock(2_000_300, 900)),
      new SyncEngine('C', mkClock(1_999_700, 1100)),   // clock behind — must not matter
    ];
    const fields = ['a', 'b', 'c', 'd'];
    for (let step = 0; step < 120; step++) {
      const d = devices[Math.floor(rng() * 3)];
      const roll = rng();
      if (roll < 0.6) d.write('plan', 'p1', 'update', { [fields[Math.floor(rng() * 4)]]: Math.floor(rng() * 1000) });
      else if (roll < 0.7) d.write('log', 'l1', 'append', { entries: `note-${step}` });
      else await d.sync(server.transport());
    }
    for (const d of devices) await d.sync(server.transport());
    for (const d of devices) await d.sync(server.transport());   // second round: pull what the last pusher wrote

    const a = stateOf(devices[0], 'plan', 'p1');
    assert.equal(stateOf(devices[1], 'plan', 'p1'), a, `plan diverged (seed ${seed})`);
    assert.equal(stateOf(devices[2], 'plan', 'p1'), a, `plan diverged (seed ${seed})`);
    const la = stateOf(devices[0], 'log', 'l1');
    assert.equal(stateOf(devices[1], 'log', 'l1'), la, `log diverged (seed ${seed})`);
    assert.equal(stateOf(devices[2], 'log', 'l1'), la, `log diverged (seed ${seed})`);
    assert.equal(devices.reduce((s, d) => s + d.unsyncedCount(), 0), 0);
  }
});

// ---------- guarantee 3: deterministic conflict resolution ----------

test('same-field concurrent edit: later HLC wins; a wildly wrong clock cannot bury newer edits', async () => {
  const server = new SyncServer();
  const good = new SyncEngine('good', mkClock(5_000_000));
  const slow = new SyncEngine('slow', mkClock(1_000));   // clock ~83 min of fake time behind

  good.write('vessel', 'v1', 'create', { name: 'Restless' });
  await good.sync(server.transport());
  await slow.sync(server.transport());
  // slow-device HLC has witnessed good's timestamps — its *next* local edit
  // sorts after everything it has seen, despite its bad wall clock.
  slow.write('vessel', 'v1', 'update', { name: 'Restless II' });
  await slow.sync(server.transport());
  await good.sync(server.transport());

  assert.equal((good.get('vessel', 'v1') as any).name, 'Restless II');
  assert.equal((slow.get('vessel', 'v1') as any).name, 'Restless II');
});

test('tombstone: delete wins over a concurrent update, on every device', async () => {
  const server = new SyncServer();
  const a = new SyncEngine('A', mkClock(3_000_000));
  const b = new SyncEngine('B', mkClock(3_000_100));
  a.write('waypoint', 'w1', 'create', { name: 'WP1' });
  await a.sync(server.transport());
  await b.sync(server.transport());

  a.write('waypoint', 'w1', 'update', { name: 'WP1-renamed' });   // offline edit…
  b.write('waypoint', 'w1', 'delete', {});                        // …vs offline delete (later clock)
  await a.sync(server.transport());
  await b.sync(server.transport());
  await a.sync(server.transport());

  assert.equal(a.get('waypoint', 'w1'), null);
  assert.equal(b.get('waypoint', 'w1'), null);
});

// ---------- protocol robustness ----------

test('re-pushing after a dropped response is a no-op: same seqs, no duplicate application', async () => {
  const server = new SyncServer();
  const dev = new SyncEngine('D', mkClock(4_000_000));
  dev.write('plan', 'p1', 'create', { name: 'X' });
  const ops = [...dev.outbox];

  const first = server.push(ops);
  const second = server.push(ops);                      // client retries blindly
  assert.deepEqual(first.acks, second.acks);
  assert.equal(server.log.length, 1);
});

test('push failure leaves ops in the outbox; retry drains it — bounded loss is the outbox', async () => {
  const server = new SyncServer();
  const dev = new SyncEngine('D', mkClock(6_000_000));
  dev.write('plan', 'p1', 'create', { name: 'X' });
  dev.write('plan', 'p1', 'update', { name: 'Y' });
  assert.equal(dev.unsyncedCount(), 2);                  // the visible "what a lost phone costs"

  let fail = true;
  await assert.rejects(dev.sync(server.transport({ failPush: () => fail })));
  assert.equal(dev.unsyncedCount(), 2);                  // nothing silently lost
  fail = false;
  await dev.sync(server.transport({ failPush: () => fail }));
  assert.equal(dev.unsyncedCount(), 0);
  assert.equal(server.log.length, 2);
});

test('malformed op rejects the whole batch — one transaction per batch', () => {
  const server = new SyncServer();
  assert.throws(() => server.push([{ op_id: 'x', device_id: 'd', schema_version: 1, entity: '', entity_id: 'e', kind: 'update', fields: {}, hlc: 'h' } as any]));
  assert.equal(server.log.length, 0);
});

// ---------- persistence round-trip (the demo's IndexedDB path) ----------

test('snapshot round-trip preserves state, outbox, cursor, and clock monotonicity', async () => {
  const server = new SyncServer();
  const dev = new SyncEngine('D', mkClock(7_000_000));
  dev.write('plan', 'p1', 'create', { name: 'X', wps: 3 });
  await dev.sync(server.transport());
  dev.write('plan', 'p1', 'update', { wps: 4 });          // left unsynced

  const revived = SyncEngine.fromSnapshot(JSON.parse(JSON.stringify(dev.toSnapshot())), mkClock(7_050_000));
  assert.deepEqual(revived.get('plan', 'p1'), { name: 'X', wps: 4 });
  assert.equal(revived.unsyncedCount(), 1);
  await revived.sync(server.transport());
  assert.equal(revived.unsyncedCount(), 0);
  // A post-restore write must still sort after everything prior.
  revived.write('plan', 'p1', 'update', { wps: 5 });
  await revived.sync(server.transport());
  const fresh = new SyncEngine('E', mkClock(8_000_000));
  await fresh.sync(server.transport());
  assert.equal((fresh.get('plan', 'p1') as any).wps, 5);
});
