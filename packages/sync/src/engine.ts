/**
 * The sync engine — Offline & Sync Design §§4–6, as pure logic over a store
 * and a transport. Trust-critical core: built to be hardened, not iterated
 * casually (Vision & Principles, Principle 6).
 *
 * Guarantees (each enforced by tests in packages/sync/test):
 *  1. Convergence — same ops, any order → same state on every device.
 *  2. Bounded loss — a lost device costs at most its unsynced outbox.
 *  3. Deterministic conflict resolution — field-level LWW by HLC, device-id tiebreak.
 */
import { HLC, Clock, compareHlc } from './hlc.js';

export interface Operation {
  op_id: string;
  device_id: string;
  schema_version: number;
  entity: string;
  entity_id: string;
  kind: 'create' | 'update' | 'delete' | 'append';
  fields: Record<string, unknown>;
  hlc: string;
  server_seq?: number;
}

export interface PushResult { acks: { op_id: string; server_seq: number }[]; }
export interface Transport {
  push(ops: Operation[]): Promise<PushResult>;
  pull(sinceSeq: number): Promise<{ ops: Operation[]; cursor: number }>;
}

export interface EngineSnapshot {
  deviceId: string;
  entities: Record<string, Record<string, unknown>>;
  fieldClocks: Record<string, Record<string, string>>;
  appends: Record<string, Record<string, { h: string; v: unknown }[]>>;
  tombstones: Record<string, string>;         // entityKey -> delete hlc
  appliedOpIds: string[];
  outbox: Operation[];
  cursor: number;
  hlc: { lastMs: number; counter: number };
  opCounter: number;
}

const key = (entity: string, id: string) => `${entity}/${id}`;

export class SyncEngine {
  private entities = new Map<string, Record<string, unknown>>();
  private fieldClocks = new Map<string, Map<string, string>>();
  private tombstones = new Map<string, string>();
  /** Append-only fields: entries kept in HLC order so every device
   *  materializes the identical sequence regardless of arrival order. */
  private appends = new Map<string, Map<string, { h: string; v: unknown }[]>>();
  private applied = new Set<string>();
  outbox: Operation[] = [];
  cursor = 0;
  private hlc: HLC;
  private opCounter = 0;

  constructor(public deviceId: string, private clock: Clock, public schemaVersion = 1) {
    this.hlc = new HLC(deviceId, clock);
  }

  /** ULID-shaped, deterministic under an injected clock: time + device + seq. */
  private nextOpId(): string {
    this.opCounter += 1;
    return `${String(this.clock.now()).padStart(13, '0')}-${this.deviceId}-${String(this.opCounter).padStart(6, '0')}`;
  }

  // ---- local writes: commit locally first, then queue (Design §4) ----

  write(entity: string, entityId: string, kind: Operation['kind'], fields: Record<string, unknown>): Operation {
    const op: Operation = {
      op_id: this.nextOpId(), device_id: this.deviceId, schema_version: this.schemaVersion,
      entity, entity_id: entityId, kind, fields, hlc: this.hlc.tick(),
    };
    this.applyOp(op);
    this.outbox.push(op);
    return op;
  }

  get(entity: string, entityId: string): Record<string, unknown> | null {
    const k = key(entity, entityId);
    if (this.tombstones.has(k)) return null;
    return this.entities.get(k) ?? null;
  }

  /** What a lost device would cost — always visible to the captain (§2). */
  unsyncedCount(): number { return this.outbox.length; }

  /** All live (non-tombstoned) entities of a type. */
  list(entity: string): { id: string; data: Record<string, unknown> }[] {
    const prefix = `${entity}/`;
    const out: { id: string; data: Record<string, unknown> }[] = [];
    for (const [k, v] of this.entities) {
      if (k.startsWith(prefix) && !this.tombstones.has(k)) out.push({ id: k.slice(prefix.length), data: v });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  // ---- merge: field-level LWW, delete wins, appends never conflict (§6) ----

  private applyOp(op: Operation): void {
    if (this.applied.has(op.op_id)) return;         // idempotent
    this.applied.add(op.op_id);
    this.hlc.witness(op.hlc);
    const k = key(op.entity, op.entity_id);

    if (op.kind === 'delete') {
      const existing = this.tombstones.get(k);
      if (!existing || compareHlc(op.hlc, existing) > 0) this.tombstones.set(k, op.hlc);
      this.entities.delete(k);
      this.fieldClocks.delete(k);
      this.appends.delete(k);
      return;
    }

    const grave = this.tombstones.get(k);
    if (grave && compareHlc(grave, op.hlc) > 0) return;   // delete won

    const ent = this.entities.get(k) ?? {};
    const clocks = this.fieldClocks.get(k) ?? new Map<string, string>();
    for (const [field, value] of Object.entries(op.fields)) {
      const prev = clocks.get(field);
      if (op.kind === 'append') {
        const perEntity = this.appends.get(k) ?? new Map<string, { h: string; v: unknown }[]>();
        const list = perEntity.get(field) ?? [];
        let i = list.length;
        while (i > 0 && compareHlc(list[i - 1].h, op.hlc) > 0) i--;
        list.splice(i, 0, { h: op.hlc, v: value });
        perEntity.set(field, list);
        this.appends.set(k, perEntity);
        ent[field] = list.map(x => x.v);
        clocks.set(field, op.hlc);
      } else if (!prev || compareHlc(op.hlc, prev) > 0) {
        ent[field] = value;                          // later HLC wins this field
        clocks.set(field, op.hlc);
      }
      // earlier value is preserved in the log, not destroyed (Design §6)
    }
    this.entities.set(k, ent);
    this.fieldClocks.set(k, clocks);
  }

  // ---- protocol: flush outbox → pull tail → apply → advance (§6) ----

  async sync(t: Transport): Promise<void> {
    if (this.outbox.length > 0) {
      const res = await t.push([...this.outbox]);
      const acked = new Set(res.acks.map(a => a.op_id));
      this.outbox = this.outbox.filter(o => !acked.has(o.op_id));
    }
    const { ops, cursor } = await t.pull(this.cursor);
    for (const op of ops) this.applyOp(op);
    this.cursor = cursor;
  }

  // ---- persistence (the store executes this; the log does not care how — D4) ----

  toSnapshot(): EngineSnapshot {
    return {
      deviceId: this.deviceId,
      entities: Object.fromEntries([...this.entities].map(([k, v]) => [k, v])),
      fieldClocks: Object.fromEntries([...this.fieldClocks].map(([k, m]) => [k, Object.fromEntries(m)])),
      appends: Object.fromEntries([...this.appends].map(([k, m]) => [k, Object.fromEntries([...m].map(([f, l]) => [f, [...l]]))])),
      tombstones: Object.fromEntries(this.tombstones),
      appliedOpIds: [...this.applied],
      outbox: [...this.outbox],
      cursor: this.cursor,
      hlc: this.hlc.snapshot(),
      opCounter: this.opCounter,
    };
  }

  static fromSnapshot(s: EngineSnapshot, clock: Clock): SyncEngine {
    const e = new SyncEngine(s.deviceId, clock);
    e.entities = new Map(Object.entries(s.entities));
    e.fieldClocks = new Map(Object.entries(s.fieldClocks).map(([k, m]) => [k, new Map(Object.entries(m))]));
    e.appends = new Map(Object.entries(s.appends ?? {}).map(([k, m]) => [k, new Map(Object.entries(m).map(([f, l]) => [f, [...(l as any)]]))]));
    e.tombstones = new Map(Object.entries(s.tombstones));
    e.applied = new Set(s.appliedOpIds);
    e.outbox = [...s.outbox];
    e.cursor = s.cursor;
    (e as any).hlc.restore(s.hlc);
    e.opCounter = s.opCounter;
    return e;
  }
}
