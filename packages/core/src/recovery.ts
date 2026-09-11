import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  writeFileSync,
  readFileSync,
  renameSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { resolve, join } from "node:path";
import type { Correlation } from "./types.js";

/** Metadata only: never persist code, arguments, images, tokens or result payloads. */
export type RecoveryRecord = Correlation & { provider: string; method: string };
export interface RecoveryLease {
  readonly blocked: boolean;
  readonly pending: readonly RecoveryRecord[];
  begin(record: RecoveryRecord): void;
  settle(rpcId: string, executionId: string): void;
  /** Trusted host attests backend reconciliation; this does not replay or undo an action. */
  reconcile(): void;
  close(confirmed: boolean): void;
}
export interface RecoveryJournal {
  open(
    scope: { ownerKey: string; taskKey: string },
    sessionId: string,
  ): RecoveryLease;
}
type State = {
  version: 1;
  lease: string;
  pid: number;
  sessionId: string;
  pending: RecoveryRecord[];
};
const syncDir = (path: string) => {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code !== "ESRCH";
  }
};

/** Local single-machine journal. Put it in durable application data, outside the kernel read roots.
 * A task lease survives host death. Corrupt/incomplete records fail closed. No automatic stale-lock
 * deletion: a trusted host must reconcile the backend before adopting a dead process's lease.
 */
export class FileRecoveryJournal implements RecoveryJournal {
  readonly directory: string;
  constructor(directory: string) {
    this.directory = resolve(directory);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }
  open(
    scope: { ownerKey: string; taskKey: string },
    sessionId: string,
  ): RecoveryLease {
    const key = createHash("sha256")
      .update(JSON.stringify([scope.ownerKey, scope.taskKey]))
      .digest("hex");
    const directory = join(this.directory, key);
    const path = join(directory, "state.json");
    const lease = randomUUID();
    let blocked = false,
      closed = false;
    let state: State = {
      version: 1,
      lease,
      pid: process.pid,
      sessionId,
      pending: [],
    };
    const read = (): State => {
      const data = readFileSync(path);
      if (data.length > 1_048_576) throw new Error("RECOVERY_JOURNAL_CORRUPT");
      const s = JSON.parse(data.toString("utf8"));
      if (
        s.version !== 1 ||
        !Number.isSafeInteger(s.pid) ||
        s.pid < 1 ||
        typeof s.lease !== "string" ||
        !Array.isArray(s.pending)
      )
        throw new Error("RECOVERY_JOURNAL_CORRUPT");
      return s;
    };
    const write = () => {
      const temp = join(directory, `state-${lease}.tmp`);
      const fd = openSync(temp, "w", 0o600);
      try {
        writeFileSync(fd, JSON.stringify(state));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temp, path);
      syncDir(directory);
    };
    const owned = () => {
      if (closed || blocked || read().lease !== lease)
        throw new Error("RECOVERY_REQUIRED");
    };
    try {
      mkdirSync(directory, { mode: 0o700 });
      syncDir(this.directory);
      write();
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
      blocked = true;
      // Missing/corrupt state is also blocked; never delete it automatically.
      try {
        state = read();
      } catch {
        state = { ...state, lease: "corrupt", pid: 0 };
      }
    }
    return {
      get blocked() {
        return blocked;
      },
      get pending() {
        return structuredClone(state.pending);
      },
      begin(record) {
        owned();
        if (state.pending.length >= 256)
          throw new Error("RECOVERY_JOURNAL_LIMIT");
        state.pending.push(structuredClone(record));
        write(); // Durable intent precedes external dispatch.
      },
      settle(rpcId, executionId) {
        owned();
        state.pending = state.pending.filter(
          (r) => r.rpcId !== rpcId || r.executionId !== executionId,
        );
        write();
      },
      reconcile() {
        if (closed) throw new Error("RECOVERY_LEASE_CLOSED");
        const fence = join(directory, "reconcile.lock");
        mkdirSync(fence, { mode: 0o700 });
        try {
          const current = read();
          if (current.lease !== lease && alive(current.pid))
            throw new Error("RECOVERY_OWNER_ACTIVE");
          // Atomic directory ownership already excludes a new open. Re-read lease to reject
          // another reconciler that won since this handle was opened (including PID reuse).
          if (current.lease !== state.lease)
            throw new Error("RECOVERY_LEASE_CHANGED");
          state = {
            version: 1,
            lease,
            pid: process.pid,
            sessionId,
            pending: [],
          };
          write();
          blocked = false;
        } finally {
          rmdirSync(fence);
          syncDir(directory);
        }
      },
      close(confirmed) {
        if (closed) return;
        if (confirmed && !blocked && state.pending.length === 0) {
          owned();
          unlinkSync(path);
          rmdirSync(directory);
          syncDir(resolve(directory, ".."));
        }
        closed = true;
      },
    };
  }
}
