/**
 * Server-side sync semantics (Offline & Sync Design §5–6): an append-only
 * per-captain log, totally ordered by server_seq, idempotent by op_id.
 * This in-memory implementation is both the test simulator and the
 * executable specification for the Postgres module in apps/server.
 */
import { Operation, PushResult, Transport } from './engine.js';

export class SyncServer {
  log: Operation[] = [];
  private byOpId = new Map<string, number>();   // op_id -> server_seq

  push(ops: Operation[]): PushResult {
    // One transaction per batch: validate all before applying any (Design §8).
    for (const op of ops) {
      if (!op.op_id || !op.hlc || !op.entity || !op.entity_id) {
        throw new Error(`malformed op rejected: ${JSON.stringify(op).slice(0, 80)}`);
      }
    }
    const acks = ops.map(op => {
      const existing = this.byOpId.get(op.op_id);
      if (existing !== undefined) return { op_id: op.op_id, server_seq: existing };  // duplicate = no-op
      const seq = this.log.length + 1;
      this.log.push({ ...op, server_seq: seq });
      this.byOpId.set(op.op_id, seq);
      return { op_id: op.op_id, server_seq: seq };
    });
    return { acks };
  }

  pull(sinceSeq: number): { ops: Operation[]; cursor: number } {
    const ops = this.log.filter(o => (o.server_seq ?? 0) > sinceSeq);
    return { ops, cursor: this.log.length };
  }

  /** A Transport view for a device, with scriptable network failure. */
  transport(opts: { failPush?: () => boolean } = {}): Transport {
    return {
      push: async (ops) => {
        if (opts.failPush?.()) throw new Error('network: push dropped');
        return this.push(ops);
      },
      pull: async (since) => this.pull(since),
    };
  }
}
