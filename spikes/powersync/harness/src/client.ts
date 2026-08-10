import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import {
  type AbstractPowerSyncDatabase,
  column,
  PowerSyncDatabase,
  type PowerSyncBackendConnector,
  Schema,
  Table,
} from "@powersync/node";
import BetterSqlite3 from "better-sqlite3";
import type { ReplicaResource } from "./assertions.js";
import {
  commandDigest,
  parseCommandResponse,
  parseReplicaSessionSecret,
  spikeProtocol,
  type ReplicaSessionSecret,
  type SpikeCommand,
  type SpikeCommandType,
} from "./command-protocol.js";

const resources = new Table({
  resource_incarnation_id: column.text,
  workspace_id: column.text,
  journey_id: column.text,
  audience: column.text,
  party_id: column.text,
  payload: column.text,
  version: column.integer,
  deleted_at: column.text,
});

const command_queue = Table.createInsertOnly({
  command_type: column.text,
  command_version: column.integer,
  resource_id: column.text,
  resource_incarnation_id: column.text,
  expected_record_version: column.integer,
  payload: column.text,
  upload_correlation_id: column.text,
});
export const spikeSchema = new Schema({ resources, command_queue });

export const spikeCapacityLimits = Object.freeze({
  maxOutstandingCommandsAndResults: 64,
  maxSerializedOutstandingBytes: 65_536,
  maxTransientUploadAttempts: 5,
  terminalResultReservationBytes: 512,
  applicationStateSchemaVersion: 2,
});

interface TerminalResultRecord {
  commandId: string; resourceId: string; state: string; code: string;
  previousVersion: number; currentVersion: number; digest: string; attemptNumber: number;
}

export function terminalResultSerializedBytes(result: TerminalResultRecord): number {
  return Buffer.byteLength(JSON.stringify(result), "utf8");
}

export function reservedOutstandingBytes(actualCommandBytes: number): number {
  if (!Number.isSafeInteger(actualCommandBytes) || actualCommandBytes < 1) throw new Error("Invalid command byte accounting input.");
  return Math.max(actualCommandBytes, spikeCapacityLimits.terminalResultReservationBytes);
}

export function quarantineEntryReservationBytes(entry: {
  id: string; resource_id: string; resource_incarnation_id: string; command_type: string; payload: string | null;
  expected_record_version: number | null;
}): number {
  // Include the largest possible reservation field in the measured shapes so
  // the persisted representation is always covered by the reservation itself.
  const reservationCeiling = spikeCapacityLimits.maxSerializedOutstandingBytes;
  const initial = { ...entry, initiallyAuthorized: true, reserved_bytes: reservationCeiling };
  const retained = { id: entry.id, resource_id: entry.resource_id, resource_incarnation_id: entry.resource_incarnation_id,
    command_type: entry.command_type, expected_record_version:entry.expected_record_version,
    state: "pending_review", payload: entry.payload, exportable: 1, reserved_bytes: reservationCeiling };
  const invalidated = { ...retained, state: "invalidated", payload: null, exportable: 0 };
  return Math.max(
    spikeCapacityLimits.terminalResultReservationBytes,
    ...[initial, retained, invalidated].map((value) => Buffer.byteLength(JSON.stringify(value), "utf8")),
  );
}

export function assertCombinedOutstandingCapacity(count: number, bytes: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error("Invalid combined capacity accounting input.");
  }
  if (count > spikeCapacityLimits.maxOutstandingCommandsAndResults) throw new Error("quarantine_capacity_exceeded");
  if (bytes > spikeCapacityLimits.maxSerializedOutstandingBytes) throw new Error("quarantine_byte_capacity_exceeded");
}

export function assertOutstandingCapacity(currentCount: number, currentBytes: number, addedBytes: number): void {
  if (!Number.isSafeInteger(currentCount) || currentCount < 0 || !Number.isSafeInteger(currentBytes) || currentBytes < 0 ||
      !Number.isSafeInteger(addedBytes) || addedBytes < 1) throw new Error("Invalid capacity accounting input.");
  if (currentCount + 1 > spikeCapacityLimits.maxOutstandingCommandsAndResults) throw new Error("command_capacity_exceeded");
  if (currentBytes + addedBytes > spikeCapacityLimits.maxSerializedOutstandingBytes) throw new Error("command_byte_capacity_exceeded");
}

export function isRetryableUploadStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function transientAttemptDecision(status: number, completedFailures: number): "reset" | "retry" | "exhausted" | "terminal" {
  if (status === 428) return "reset";
  if (!isRetryableUploadStatus(status)) return "terminal";
  return completedFailures + 1 >= spikeCapacityLimits.maxTransientUploadAttempts ? "exhausted" : "retry";
}

export class AsyncSerialGate {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await work(); }
    finally { release(); }
  }
}

export interface UploadFaultOptions {
  mode: "pre-commit-500" | "pre-commit-hold" | "post-commit-drop" | "post-commit-drop-barrier" | "post-result-hold";
  secret: string;
}

const requiredQueueColumns = [
  "command_type", "command_version", "expected_record_version", "resource_id", "resource_incarnation_id", "upload_correlation_id",
] as const;
const allowedQueueColumns = [...requiredQueueColumns, "payload"] as const;

export function assertPositiveExpectedRecordVersion(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error("expectedRecordVersion must be a positive safe integer.");
  }
}

export function validateQueuedCrud(crud: readonly { table: string; op: string; id: string; opData?: Record<string, unknown>; transactionId?: number }[]): SpikeCommand[] {
  if (crud.length !== 1) throw new Error("The M3a queue transaction must contain exactly one command.");
  const targets = new Set<string>();
  return crud.map((entry): SpikeCommand => {
    if (entry.table !== "command_queue" || entry.op !== "PUT") {
      throw new Error("Unsupported local CRUD: only command_queue PUT entries are accepted.");
    }
    const data = entry.opData;
    const keys = data ? Object.keys(data) : [];
    if (!data || keys.some((key) => !allowedQueueColumns.includes(key as (typeof allowedQueueColumns)[number])) ||
        requiredQueueColumns.some((key) => !keys.includes(key))) {
      throw new Error("Malformed command_queue PUT columns.");
    }
    if (typeof entry.id !== "string" || typeof data.command_type !== "string" || data.command_version !== 1 ||
        typeof data.resource_id !== "string" || typeof data.resource_incarnation_id !== "string" ||
        typeof data.upload_correlation_id !== "string") {
      throw new Error("Malformed command_queue PUT values.");
    }
    assertPositiveExpectedRecordVersion(data.expected_record_version);
    const type = data.command_type as SpikeCommandType;
    if (type !== "ps8.resource.update.v1" && type !== "ps8.resource.soft_delete.v1") throw new Error("Unsupported command_queue command type.");
    if (targets.has(data.resource_id)) throw new Error("Duplicate resource target in one local transaction.");
    targets.add(data.resource_id);
    if (type === "ps8.resource.update.v1" && typeof data.payload !== "string") throw new Error("Update queue entry requires payload.");
    if (type === "ps8.resource.soft_delete.v1" && data.payload !== null && data.payload !== undefined) throw new Error("Soft-delete queue entry cannot carry payload.");
    return {
      commandId: entry.id,
      type,
      resourceId: data.resource_id,
      resourceIncarnationId: data.resource_incarnation_id,
      expectedRecordVersion: Number(data.expected_record_version),
      ...(type === "ps8.resource.update.v1" ? { payload: data.payload as string } : {}),
    };
  });
}

export class ReplicaResetRequiredError extends Error {
  constructor() { super("replica_reset_required"); this.name = "ReplicaResetRequiredError"; }
}
export function isReplicaResetRequired(error: unknown): error is ReplicaResetRequiredError {
  return error instanceof ReplicaResetRequiredError;
}

/**
 * Application-owned local state deliberately lives outside PowerSync's SQLite
 * file. The queue and this sidecar cannot commit atomically in the pinned SDK;
 * durable server receipts make terminal retries safe, while production local
 * atomicity remains an explicit later gate.
 */
export class ApplicationState {
  private readonly sqlite: BetterSqlite3.Database;

  constructor(readonly filename: string) {
    this.sqlite = new BetterSqlite3(filename, { timeout: 5_000 });
    this.sqlite.pragma("journal_mode = DELETE");
    this.sqlite.pragma("synchronous = FULL");
    try {
      const currentVersion = Number(this.sqlite.pragma("user_version", { simple: true }));
      if (currentVersion > spikeCapacityLimits.applicationStateSchemaVersion) {
        throw new Error("Unsupported application-state schema version.");
      }
      if (currentVersion < spikeCapacityLimits.applicationStateSchemaVersion) this.migrate(currentVersion);
      const collision = this.sqlite.prepare(`SELECT result.id FROM trax_app_command_results AS result
        JOIN trax_app_optimistic_resources AS overlay ON overlay.id=result.id LIMIT 1`).get();
      if (collision) throw new Error("command_id_already_active_in_multiple_states");
    } catch (error) {
      this.sqlite.close();
      throw error;
    }
  }

  private migrate(fromVersion: number): void {
    this.sqlite.transaction(() => {
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS trax_app_command_results (
          id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, state TEXT NOT NULL, result_code TEXT NOT NULL,
          previous_version INTEGER NOT NULL, current_version INTEGER NOT NULL, digest TEXT NOT NULL,
          attempt_number INTEGER NOT NULL, serialized_bytes INTEGER NOT NULL CHECK (serialized_bytes > 0),
          actual_serialized_bytes INTEGER NOT NULL CHECK (actual_serialized_bytes > 0),
          sdk_completed INTEGER NOT NULL DEFAULT 0 CHECK (sdk_completed IN (0, 1))
        );
        CREATE TABLE IF NOT EXISTS trax_app_optimistic_resources (
          id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, resource_incarnation_id TEXT NOT NULL,
          command_type TEXT NOT NULL, payload TEXT, expected_record_version INTEGER NOT NULL,
          serialized_bytes INTEGER NOT NULL CHECK (serialized_bytes > 0),
          actual_serialized_bytes INTEGER NOT NULL CHECK (actual_serialized_bytes > 0)
        );
        CREATE TABLE IF NOT EXISTS trax_app_upload_attempts (
          id TEXT PRIMARY KEY, failure_count INTEGER NOT NULL CHECK (failure_count > 0 AND failure_count <= 5)
        );
        CREATE TABLE IF NOT EXISTS trax_app_replica_session (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1), replica_id TEXT NOT NULL,
          replica_epoch INTEGER NOT NULL, checkpoint_state TEXT NOT NULL, reset_count INTEGER NOT NULL
        );
      `);
      const columns = (table: string): Set<string> => new Set(
        (this.sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>).map((column) => column.name),
      );
      const resultColumns = columns("trax_app_command_results");
      if (!resultColumns.has("serialized_bytes")) this.sqlite.exec(
        `ALTER TABLE trax_app_command_results ADD COLUMN serialized_bytes INTEGER NOT NULL DEFAULT ${spikeCapacityLimits.terminalResultReservationBytes} CHECK (serialized_bytes > 0)`,
      );
      if (!resultColumns.has("actual_serialized_bytes")) this.sqlite.exec(
        "ALTER TABLE trax_app_command_results ADD COLUMN actual_serialized_bytes INTEGER NOT NULL DEFAULT 1 CHECK (actual_serialized_bytes > 0)",
      );
      if (!resultColumns.has("sdk_completed")) this.sqlite.exec(
        "ALTER TABLE trax_app_command_results ADD COLUMN sdk_completed INTEGER NOT NULL DEFAULT 0 CHECK (sdk_completed IN (0, 1))",
      );
      const overlayColumns = columns("trax_app_optimistic_resources");
      if (!overlayColumns.has("serialized_bytes")) this.sqlite.exec(
        `ALTER TABLE trax_app_optimistic_resources ADD COLUMN serialized_bytes INTEGER NOT NULL DEFAULT ${spikeCapacityLimits.terminalResultReservationBytes} CHECK (serialized_bytes > 0)`,
      );
      if (!overlayColumns.has("actual_serialized_bytes")) this.sqlite.exec(
        "ALTER TABLE trax_app_optimistic_resources ADD COLUMN actual_serialized_bytes INTEGER NOT NULL DEFAULT 1 CHECK (actual_serialized_bytes > 0)",
      );
      const legacyResults = this.sqlite.prepare(`SELECT id, resource_id, state, result_code, previous_version,
        current_version, digest, attempt_number, serialized_bytes FROM trax_app_command_results`).all() as Array<{
          id:string; resource_id:string; state:string; result_code:string; previous_version:number; current_version:number;
          digest:string; attempt_number:number; serialized_bytes:number;
        }>;
      const updateResult = this.sqlite.prepare(
        "UPDATE trax_app_command_results SET serialized_bytes=?, actual_serialized_bytes=?, sdk_completed=0 WHERE id=?",
      );
      for (const row of legacyResults) {
        const actual = terminalResultSerializedBytes({ commandId:row.id, resourceId:row.resource_id, state:row.state,
          code:row.result_code, previousVersion:row.previous_version, currentVersion:row.current_version,
          digest:row.digest, attemptNumber:row.attempt_number });
        updateResult.run(Math.max(Number(row.serialized_bytes), reservedOutstandingBytes(actual)), actual, row.id);
      }
      const legacyOverlays = this.sqlite.prepare(`SELECT id, resource_id, resource_incarnation_id, command_type,
        payload, expected_record_version, serialized_bytes FROM trax_app_optimistic_resources`).all() as Array<{
          id:string; resource_id:string; resource_incarnation_id:string; command_type:string; payload:string|null;
          expected_record_version:number; serialized_bytes:number;
        }>;
      const updateOverlay = this.sqlite.prepare(
        "UPDATE trax_app_optimistic_resources SET serialized_bytes=?, actual_serialized_bytes=? WHERE id=?",
      );
      for (const row of legacyOverlays) {
        const actual = Buffer.byteLength(JSON.stringify({ commandId:row.id, type:row.command_type,
          resourceId:row.resource_id, resourceIncarnationId:row.resource_incarnation_id,
          expectedRecordVersion:row.expected_record_version, payload:row.payload }), "utf8");
        updateOverlay.run(Math.max(Number(row.serialized_bytes), reservedOutstandingBytes(actual)), actual, row.id);
      }
      this.sqlite.pragma(`user_version = ${spikeCapacityLimits.applicationStateSchemaVersion}`);
    })();
    if (fromVersion < 0) throw new Error("Invalid application-state schema version.");
  }

  schemaVersion(): number { return Number(this.sqlite.pragma("user_version", { simple: true })); }

  hasActiveCommandId(commandId:string): boolean {
    return this.sqlite.prepare(`SELECT 1 FROM trax_app_command_results WHERE id=?
      UNION ALL SELECT 1 FROM trax_app_optimistic_resources WHERE id=? LIMIT 1`).get(commandId,commandId) !== undefined;
  }

  activeCommandIds(): string[] {
    return (this.sqlite.prepare(`SELECT id FROM trax_app_command_results
      UNION ALL SELECT id FROM trax_app_optimistic_resources ORDER BY id`).all() as Array<{ id:string }>).map((row) => row.id);
  }

  persistResults(results: readonly TerminalResultRecord[]): void {
    const insert = this.sqlite.prepare(`INSERT INTO trax_app_command_results
      (id,resource_id,state,result_code,previous_version,current_version,digest,attempt_number,
       serialized_bytes,actual_serialized_bytes,sdk_completed)
      VALUES (?,?,?,?,?,?,?,?,?,?,0)`);
    const existingResult = this.sqlite.prepare(`SELECT resource_id,state,result_code,previous_version,
      current_version,digest,attempt_number,serialized_bytes,actual_serialized_bytes,sdk_completed
      FROM trax_app_command_results WHERE id=?`);
    const priorReservation = this.sqlite.prepare("SELECT serialized_bytes FROM trax_app_optimistic_resources WHERE id=?");
    const removeOverlay = this.sqlite.prepare("DELETE FROM trax_app_optimistic_resources WHERE id=?");
    const removeAttempt = this.sqlite.prepare("DELETE FROM trax_app_upload_attempts WHERE id=?");
    const normalizedCode = (code:string):string => code === "already_applied" ? "applied" : code;
    this.sqlite.transaction(() => {
      for (const result of results) {
        const existing = existingResult.get(result.commandId) as {
          resource_id:string; state:string; result_code:string; previous_version:number; current_version:number;
          digest:string; attempt_number:number; serialized_bytes:number; actual_serialized_bytes:number; sdk_completed:number;
        } | undefined;
        if (existing) {
          const compatible = existing.resource_id === result.resourceId && existing.state === result.state &&
            normalizedCode(existing.result_code) === normalizedCode(result.code) &&
            Number(existing.previous_version) === result.previousVersion &&
            Number(existing.current_version) === result.currentVersion && existing.digest === result.digest;
          if (!compatible) throw new Error("command_result_id_conflict");
          // A server replay confirms the same immutable outcome. Retain the
          // original attempt/accounting/completion state rather than replacing
          // an unresolved or already SDK-completed application record.
          removeOverlay.run(result.commandId);
          removeAttempt.run(result.commandId);
          continue;
        }
        const prior = priorReservation.get(result.commandId) as { serialized_bytes:number } | undefined;
        const actual = terminalResultSerializedBytes(result);
        const reserved = prior?.serialized_bytes ?? reservedOutstandingBytes(actual);
        if (actual > reserved) throw new Error("terminal_result_reservation_exceeded");
        if (!prior) {
          const usage = this.capacityUsage();
          assertOutstandingCapacity(usage.count, usage.bytes, reserved);
        }
        insert.run(result.commandId,result.resourceId,result.state,result.code,result.previousVersion,
          result.currentVersion,result.digest,result.attemptNumber,reserved,actual);
        removeOverlay.run(result.commandId);
        removeAttempt.run(result.commandId);
      }
    })();
  }

  markResultsSdkCompleted(commandIds: readonly string[]): void {
    const mark = this.sqlite.prepare("UPDATE trax_app_command_results SET sdk_completed=1 WHERE id=? AND sdk_completed=0");
    this.sqlite.transaction(() => {
      for (const commandId of commandIds) {
        const existing = this.sqlite.prepare("SELECT 1 FROM trax_app_command_results WHERE id=?").get(commandId);
        if (!existing) throw new Error("Cannot complete a missing command result.");
        mark.run(commandId);
      }
    })();
  }

  addOverlays(commands: readonly (QueuedCommandInput & {
    resourceIncarnationId:string; actualSerializedBytes:number; reservedBytes:number;
  })[]): string[] {
    const insert = this.sqlite.prepare(`INSERT INTO trax_app_optimistic_resources
      (id,resource_id,resource_incarnation_id,command_type,payload,expected_record_version,
       serialized_bytes,actual_serialized_bytes) VALUES (?,?,?,?,?,?,?,?)`);
    const resultExists = this.sqlite.prepare("SELECT 1 FROM trax_app_command_results WHERE id=?");
    return this.sqlite.transaction(() => {
      const inserted:string[] = [];
      const batchIds = new Set<string>();
      for (const command of commands) {
        if (batchIds.has(command.commandId) || resultExists.get(command.commandId)) {
          throw new Error("command_id_already_active");
        }
        batchIds.add(command.commandId);
        insert.run(command.commandId,command.resourceId,command.resourceIncarnationId,command.type,
          command.payload ?? null,command.expectedRecordVersion,command.reservedBytes,command.actualSerializedBytes);
        inserted.push(command.commandId);
      }
      return inserted;
    })();
  }

  removeOverlays(commandIds: readonly string[]): void {
    const remove = this.sqlite.prepare("DELETE FROM trax_app_optimistic_resources WHERE id=?");
    this.sqlite.transaction(() => { for (const commandId of commandIds) remove.run(commandId); })();
  }

  clearOverlays(): void {
    this.sqlite.transaction(() => {
      this.sqlite.prepare("DELETE FROM trax_app_optimistic_resources").run();
      this.sqlite.prepare("DELETE FROM trax_app_upload_attempts").run();
    })();
  }

  capacityUsage(): { count:number; bytes:number } {
    const row = this.sqlite.prepare(`SELECT
      (SELECT count(*) FROM trax_app_command_results)+(SELECT count(*) FROM trax_app_optimistic_resources) count,
      coalesce((SELECT sum(serialized_bytes) FROM trax_app_command_results),0)+
      coalesce((SELECT sum(serialized_bytes) FROM trax_app_optimistic_resources),0) bytes`).get() as { count:number; bytes:number };
    return { count:Number(row.count), bytes:Number(row.bytes) };
  }

  resultCapacityUsage(): { count:number; bytes:number } {
    const row = this.sqlite.prepare(`SELECT count(*) count,coalesce(sum(serialized_bytes),0) bytes
      FROM trax_app_command_results`).get() as { count:number; bytes:number };
    return { count:Number(row.count), bytes:Number(row.bytes) };
  }

  resultByteAccounting(commandId:string): { reservedBytes:number; actualBytes:number; sdkCompleted:boolean } | undefined {
    const row = this.sqlite.prepare(`SELECT serialized_bytes,actual_serialized_bytes,sdk_completed
      FROM trax_app_command_results WHERE id=?`).get(commandId) as
      { serialized_bytes:number; actual_serialized_bytes:number; sdk_completed:number } | undefined;
    return row ? { reservedBytes:Number(row.serialized_bytes), actualBytes:Number(row.actual_serialized_bytes),
      sdkCompleted:row.sdk_completed === 1 } : undefined;
  }

  acknowledgeResult(commandId:string): boolean {
    return this.sqlite.prepare("DELETE FROM trax_app_command_results WHERE id=? AND sdk_completed=1").run(commandId).changes === 1;
  }

  recordTransientFailure(commandId:string): number {
    this.sqlite.prepare(`INSERT INTO trax_app_upload_attempts (id,failure_count) VALUES (?,1)
      ON CONFLICT(id) DO UPDATE SET failure_count=failure_count+1`).run(commandId);
    const row = this.sqlite.prepare("SELECT failure_count FROM trax_app_upload_attempts WHERE id=?").get(commandId) as { failure_count:number };
    return Number(row.failure_count);
  }

  clearTransientFailure(commandId:string): void { this.sqlite.prepare("DELETE FROM trax_app_upload_attempts WHERE id=?").run(commandId); }

  readResults(): LocalCommandResult[] {
    return this.sqlite.prepare(`SELECT id,resource_id,state,result_code,previous_version,current_version,
      attempt_number FROM trax_app_command_results ORDER BY id`).all() as LocalCommandResult[];
  }

  readOverlays(): OptimisticResource[] {
    return this.sqlite.prepare(`SELECT id,resource_id,resource_incarnation_id,command_type,payload,
      expected_record_version FROM trax_app_optimistic_resources ORDER BY id`).all() as OptimisticResource[];
  }

  readOverlayRecords(): Array<OptimisticResource & { serialized_bytes:number; actual_serialized_bytes:number }> {
    return this.sqlite.prepare(`SELECT id,resource_id,resource_incarnation_id,command_type,payload,
      expected_record_version,serialized_bytes,actual_serialized_bytes
      FROM trax_app_optimistic_resources ORDER BY id`).all() as
      Array<OptimisticResource & { serialized_bytes:number; actual_serialized_bytes:number }>;
  }

  setReplicaSession(session:ReplicaSessionSecret, resetCount:number): void {
    this.sqlite.prepare(`INSERT INTO trax_app_replica_session
      (singleton,replica_id,replica_epoch,checkpoint_state,reset_count) VALUES (1,?,?,'client_observed',?)
      ON CONFLICT(singleton) DO UPDATE SET replica_id=excluded.replica_id,replica_epoch=excluded.replica_epoch,
      checkpoint_state=excluded.checkpoint_state,reset_count=excluded.reset_count`).run(session.replicaId,session.replicaEpoch,resetCount);
  }

  replicaSession(): ReplicaSessionView | undefined {
    const row = this.sqlite.prepare(`SELECT replica_id,replica_epoch,checkpoint_state,reset_count
      FROM trax_app_replica_session WHERE singleton=1`).get() as
      { replica_id:string; replica_epoch:number; checkpoint_state:string; reset_count:number } | undefined;
    return row ? { replicaId:row.replica_id,replicaEpoch:row.replica_epoch,
      checkpointState:row.checkpoint_state,resetCount:row.reset_count } : undefined;
  }

  close(): void { this.sqlite.close(); }
}

export class SpikeCommandConnector implements PowerSyncBackendConnector {
  private resetRequired = false;
  private completionHoldReached = false;
  private completionHoldRelease: (() => void) | undefined;
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
    private readonly commandEndpoint: string,
    private session: ReplicaSessionSecret | undefined,
    private readonly applicationState: ApplicationState,
    private fault?: UploadFaultOptions,
  ) {}

  setSession(session: ReplicaSessionSecret): void { this.session = session; this.resetRequired = false; }
  needsReset(): boolean { return this.resetRequired; }
  testSession(): ReplicaSessionSecret | undefined { return this.session ? { ...this.session } : undefined; }

  setUploadFault(fault?: UploadFaultOptions): void {
    this.fault = fault;
    if (fault?.mode !== "post-result-hold") this.releaseCompletionHold();
  }
  completionIsHeld(): boolean { return this.completionHoldReached; }
  releaseCompletionHold(): void { this.completionHoldRelease?.(); this.completionHoldRelease = undefined; this.completionHoldReached = false; }

  private async holdBeforeSdkCompletion(): Promise<void> {
    if (this.fault?.mode !== "post-result-hold") return;
    this.completionHoldReached = true;
    await new Promise<void>((resolve) => { this.completionHoldRelease = resolve; });
  }

  async fetchCredentials() {
    return { endpoint: this.endpoint, token: this.token };
  }

  private async completeWithResults(
    transaction: { complete(): Promise<void> }, results: readonly TerminalResultRecord[],
  ): Promise<void> {
    this.applicationState.persistResults(results);
    await this.holdBeforeSdkCompletion();
    await transaction.complete();
    this.applicationState.markResultsSdkCompleted(results.map((result) => result.commandId));
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;
    const commands = validateQueuedCrud(transaction.crud);
    const localTransactionId = String(transaction.transactionId);
    const session = this.session;
    if (!session) throw new Error("A registered replica session is required for command upload.");
    const binding = { replicaId: session.replicaId, replicaEpoch: session.replicaEpoch };
    const exhaust = async (failureCount: number): Promise<void> => {
      const command = commands[0]!;
      await this.completeWithResults(transaction, [{
        commandId: command.commandId, resourceId: command.resourceId, state: "failed", code: "retry_exhausted",
        previousVersion: command.expectedRecordVersion, currentVersion: command.expectedRecordVersion,
        digest: commandDigest(command, binding), attemptNumber: failureCount,
      }]);
    };
    let response: Response;
    try {
      response = await fetch(`${this.commandEndpoint}/spike/commands`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          "x-ps8-replica-credential": session.credential,
          ...(this.fault && this.fault.mode !== "post-result-hold"
            ? { "x-ps8-fault": this.fault.mode, "x-ps8-fault-secret": this.fault.secret } : {}),
        },
        body: JSON.stringify({ spikeProtocol, ...binding, localTransactionId, commands }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      const failures = this.applicationState.recordTransientFailure(commands[0]!.commandId);
      if (failures >= spikeCapacityLimits.maxTransientUploadAttempts) { await exhaust(failures); return; }
      throw error;
    }
    if (response.status === 428) { this.resetRequired = true; throw new ReplicaResetRequiredError(); }
    if (isRetryableUploadStatus(response.status)) {
      const failures = this.applicationState.recordTransientFailure(commands[0]!.commandId);
      if (failures >= spikeCapacityLimits.maxTransientUploadAttempts) { await exhaust(failures); return; }
      throw new Error(`Retryable spike command upload failure HTTP ${response.status}.`);
    }
    let raw: unknown;
    try { raw = await response.json(); }
    catch { throw new Error("Malformed spike command response."); }
    if (response.status === 403) {
      const parsed = parseCommandResponse(raw, commands, binding);
      if (parsed.results[0]?.state !== "denied") throw new Error("Denied command response lacks a digest-bound terminal result.");
      await this.completeWithResults(transaction, parsed.results);
      return;
    }
    if (response.status === 409 && raw && typeof raw === "object" && (raw as { error?: unknown }).error === "idempotency_conflict") {
      const command = commands[0]!;
      await this.completeWithResults(transaction, [{
        commandId: command.commandId, resourceId: command.resourceId, state: "failed", code: "idempotency_conflict",
        previousVersion: command.expectedRecordVersion, currentVersion: command.expectedRecordVersion,
        digest: commandDigest(command, binding), attemptNumber: 1,
      }]);
      return;
    }
    if (!response.ok) throw new Error(`Spike command upload failed with HTTP ${response.status}.`);
    const parsed = parseCommandResponse(raw, commands, binding);
    await this.completeWithResults(transaction, parsed.results);
  }
}

export interface PrivateFileOperations {
  open: typeof open; chmod: typeof chmod; rename: typeof rename; unlink: typeof unlink;
}
const privateFileOperations: PrivateFileOperations = { open, chmod, rename, unlink };

async function syncParentDirectory(target: string, operations: PrivateFileOperations): Promise<void> {
  let directory;
  try {
    directory = await operations.open(path.dirname(target), "r");
    await directory.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EBADF") throw error;
  } finally {
    await directory?.close();
  }
}

export async function writePrivateJsonAtomically(target: string, value: unknown, operations: PrivateFileOperations = privateFileOperations): Promise<void> {
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  let renamed = false;
  try {
    const file = await operations.open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(value)}\n`, { encoding: "utf8" });
      await file.sync();
    } finally {
      await file.close();
    }
    await operations.chmod(temporary, 0o600);
    await operations.rename(temporary, target);
    renamed = true;
    await operations.chmod(target, 0o600);
    await syncParentDirectory(target, operations);
  } catch (error) {
    if (!renamed) {
      try { await operations.unlink(temporary); }
      catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new AggregateError([error, cleanupError], "Private atomic write and temporary-file cleanup both failed.");
        }
      }
    }
    throw error;
  }
}

type QuarantineIntent = {
  id:string; command_type:string; resource_id:string; resource_incarnation_id:string;
  payload:string|null; expected_record_version:number; initiallyAuthorized:boolean; reserved_bytes:number;
};
type QuarantineStore = { version:2; finalized:QuarantinedCommand[]; pending:QuarantineIntent[] };

function quarantineString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1) throw new Error(`Invalid quarantine ${field}.`);
  return value;
}

function normalizeQuarantineReservation(raw: unknown, entry: {
  id:string; resource_id:string; resource_incarnation_id:string; command_type:string; payload:string|null;
  expected_record_version:number|null;
}): number {
  const minimum = quarantineEntryReservationBytes(entry);
  const candidate = Number(raw);
  const reserved = Number.isSafeInteger(candidate) && candidate >= minimum ? candidate : minimum;
  if (reserved > spikeCapacityLimits.maxSerializedOutstandingBytes) throw new Error("Invalid quarantine reservation.");
  return reserved;
}

function normalizeFinalizedQuarantine(raw: unknown, allowLegacyMissingVersion = false): QuarantinedCommand {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid finalized quarantine entry.");
  const value = raw as Record<string, unknown>;
  const state = value.state;
  if (state !== "pending_review" && state !== "invalidated") throw new Error("Invalid finalized quarantine state.");
  const payload = value.payload === null ? null : quarantineString(value.payload, "payload");
  const exportable = Number(value.exportable);
  if ((state === "pending_review" && exportable !== 1) || (state === "invalidated" && (exportable !== 0 || payload !== null))) {
    throw new Error("Inconsistent finalized quarantine entry.");
  }
  let expected_record_version: number | null;
  if (value.expected_record_version === null || (allowLegacyMissingVersion && value.expected_record_version === undefined)) {
    expected_record_version = null;
  } else {
    expected_record_version = Number(value.expected_record_version);
    if (!Number.isSafeInteger(expected_record_version) || expected_record_version < 1) {
      throw new Error("Invalid quarantine expected version.");
    }
  }
  const base = {
    id:quarantineString(value.id,"id"), resource_id:quarantineString(value.resource_id,"resource_id"),
    resource_incarnation_id:quarantineString(value.resource_incarnation_id,"resource_incarnation_id"),
    command_type:quarantineString(value.command_type,"command_type"), payload, expected_record_version,
  };
  const reserved_bytes = normalizeQuarantineReservation(value.reserved_bytes, base);
  const normalized: QuarantinedCommand = { ...base, state, exportable, reserved_bytes };
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > reserved_bytes) {
    throw new Error("Finalized quarantine representation exceeds reservation.");
  }
  return normalized;
}

function normalizePendingQuarantine(raw: unknown): QuarantineIntent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid pending quarantine entry.");
  const value = raw as Record<string, unknown>;
  if (typeof value.initiallyAuthorized !== "boolean") throw new Error("Invalid pending quarantine authorization state.");
  const payload = value.payload === null ? null : quarantineString(value.payload, "payload");
  if (!value.initiallyAuthorized && payload !== null) throw new Error("Denied quarantine intent retained payload.");
  const expected_record_version = Number(value.expected_record_version);
  if (!Number.isSafeInteger(expected_record_version) || expected_record_version < 1) throw new Error("Invalid quarantine expected version.");
  const base = {
    id:quarantineString(value.id,"id"), resource_id:quarantineString(value.resource_id,"resource_id"),
    resource_incarnation_id:quarantineString(value.resource_incarnation_id,"resource_incarnation_id"),
    command_type:quarantineString(value.command_type,"command_type"), payload, expected_record_version,
  };
  const reserved_bytes = normalizeQuarantineReservation(value.reserved_bytes, base);
  const normalized: QuarantineIntent = { ...base, initiallyAuthorized:value.initiallyAuthorized, reserved_bytes };
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > reserved_bytes) {
    throw new Error("Pending quarantine representation exceeds reservation.");
  }
  return normalized;
}

function assertUniqueQuarantineIds(store:QuarantineStore): void {
  const ids = new Set<string>();
  for (const item of [...store.finalized, ...store.pending]) {
    if (ids.has(item.id)) throw new Error("quarantine_duplicate_id_conflict");
    ids.add(item.id);
  }
}

export async function readQuarantineStore(target: string): Promise<{ store:QuarantineStore; existed:boolean; migrated:boolean }> {
  let value: unknown;
  try { value = JSON.parse(await readFile(target, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { store:{ version:2, finalized:[], pending:[] }, existed:false, migrated:false };
    }
    throw error;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid application quarantine sidecar.");
  const record = value as Record<string, unknown>;
  if (record.version === 2 && Array.isArray(record.finalized) && Array.isArray(record.pending)) {
    const store = { version:2 as const, finalized:record.finalized.map((entry) => normalizeFinalizedQuarantine(entry)),
      pending:record.pending.map(normalizePendingQuarantine) };
    assertUniqueQuarantineIds(store);
    return { store, existed:true, migrated:false };
  }
  if (record.version === 1 && Array.isArray(record.commands)) {
    const finalized:QuarantinedCommand[] = [];
    const pending:QuarantineIntent[] = [];
    for (const raw of record.commands) {
      const item = raw as Record<string, unknown>;
      if (item?.state === "pending_review" || item?.state === "invalidated") {
        finalized.push(normalizeFinalizedQuarantine(item, true));
      } else {
        if (item?.expected_record_version === undefined) {
          throw new Error("legacy_unfinished_reset_missing_expected_record_version");
        }
        pending.push(normalizePendingQuarantine(item));
      }
    }
    const store:QuarantineStore = { version:2, finalized, pending };
    assertUniqueQuarantineIds(store);
    return { store, existed:true, migrated:true };
  }
  throw new Error("Invalid application quarantine sidecar.");
}

function finalizedQuarantineBytes(commands: readonly QuarantinedCommand[]): number {
  return commands.reduce((total, command) => total + command.reserved_bytes, 0);
}

export function mergeFinalizedQuarantine(
  existing: readonly QuarantinedCommand[], additions: readonly QuarantinedCommand[],
): QuarantinedCommand[] {
  const merged:QuarantinedCommand[] = [];
  const ids = new Set<string>();
  for (const command of [...existing, ...additions]) {
    if (ids.has(command.id)) throw new Error("quarantine_duplicate_id_conflict");
    ids.add(command.id);
    merged.push({ ...command });
  }
  return merged.sort((left, right) => left.id.localeCompare(right.id));
}

export async function persistQuarantineAcknowledgement(
  target:string,
  current:readonly QuarantinedCommand[],
  commandId:string,
  writer:typeof writePrivateJsonAtomically = writePrivateJsonAtomically,
):Promise<QuarantinedCommand[] | undefined> {
  const index = current.findIndex((command) => command.id === commandId);
  if (index < 0) return undefined;
  const next = current.filter((_command, candidateIndex) => candidateIndex !== index).map((command) => ({ ...command }));
  await writer(target, { version:2, finalized:next, pending:[] });
  return next;
}

async function replicaPost<T>(endpoint: string, token: string, pathName: string, body: object, session?: ReplicaSessionSecret, extraHeaders: Record<string, string> = {}): Promise<{ status: number; body: T | { error?: string } }> {
  const response = await fetch(`${endpoint}${pathName}`, { method: "POST", headers: {
    authorization: `Bearer ${token}`, "content-type": "application/json",
    ...(session ? { "x-ps8-replica-credential": session.credential } : {}), ...extraHeaders,
  }, body: JSON.stringify(body), signal: AbortSignal.timeout(5_000) });
  return { status: response.status, body: await response.json() as T | { error?: string } };
}
async function registerReplica(endpoint: string, token: string): Promise<ReplicaSessionSecret> {
  const result = await replicaPost<ReplicaSessionSecret>(endpoint, token, "/spike/replicas/register", {});
  if (result.status !== 201) throw new Error("Replica registration failed.");
  return parseReplicaSessionSecret(result.body);
}
async function issueChallenge(endpoint: string, token: string, session: ReplicaSessionSecret): Promise<{ challengeId: string }> {
  const result = await replicaPost<{ challengeId: string }>(endpoint, token, "/spike/replicas/challenge", { replicaId: session.replicaId, replicaEpoch: session.replicaEpoch }, session);
  if (result.status !== 201 || !("challengeId" in result.body)) throw new Error(`Replica challenge issuance failed with HTTP ${result.status}: ${JSON.stringify(result.body)}.`);
  return result.body as { challengeId: string };
}
async function acknowledgeChallenge(endpoint: string, token: string, session: ReplicaSessionSecret, challengeId: string): Promise<void> {
  const result = await replicaPost(endpoint, token, "/spike/replicas/ack", { replicaId: session.replicaId, replicaEpoch: session.replicaEpoch, challengeId }, session);
  if (result.status !== 200) throw new Error("Client-observed checkpoint acknowledgement failed.");
}

export interface InitialSyncDatabase {
  waitForFirstSync(options: { signal: AbortSignal }): Promise<void>;
  readonly currentStatus: { readonly hasSynced: boolean | undefined };
}

export async function waitForInitialSync(database: InitialSyncDatabase, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => { reject(new Error(`Initial PowerSync checkpoint timed out after ${timeoutMs} ms.`)); controller.abort(); }, timeoutMs);
  });
  try {
    await Promise.race([database.waitForFirstSync({ signal: controller.signal }), deadline]);
    if (!database.currentStatus.hasSynced) throw new Error("PowerSync waitForFirstSync returned without a completed checkpoint.");
  } finally { if (timeout) clearTimeout(timeout); }
}

async function closeDatabase(database: PowerSyncDatabase): Promise<void> {
  const failures: unknown[] = [];
  try { await database.disconnect(); } catch (error) { failures.push(error); }
  try { await database.close(); } catch (error) { failures.push(error); }
  if (failures.length > 0) throw new AggregateError(failures, "PowerSync client cleanup failed.");
}

export interface RawReplicaResource extends ReplicaResource { resource_incarnation_id: string; version: number; deleted_at: string | null }
export interface LocalCommandResult {
  id: string; resource_id: string; state: "applied" | "conflict" | "denied" | "failed";
  result_code: string; previous_version: number; current_version: number; attempt_number: number;
}
export interface QueuedCommandInput { commandId: string; type: SpikeCommandType; resourceId: string; resourceIncarnationId?: string; expectedRecordVersion: number; payload?: string }
export interface OptimisticResource { id: string; resource_id: string; resource_incarnation_id: string; command_type: string; payload: string | null; expected_record_version: number }

// A migrated R2 finalized review entry can have an unknown expected version.
// No API in this spike auto-requeues or reapplies quarantine; any future action
// must revalidate current authorization, version and conflicts first.
export interface QuarantinedCommand { id: string; resource_id: string; resource_incarnation_id: string; command_type: string; expected_record_version: number | null; state: "pending_review" | "invalidated"; payload: string | null; exportable: number; reserved_bytes: number }
export interface ReplicaSessionView { replicaId: string; replicaEpoch: number; checkpointState: string; resetCount: number }
export interface ReplicaResetHooks {
  afterQuarantineWritten?: (sidecarPath: string) => Promise<void>;
  afterSessionPersisted?: (resetStatePath: string) => Promise<void>;
  afterClear?: (resetStatePath: string) => Promise<void>;
  resetPostCommitDropSecret?: string;
}
export interface SpikeClient {
  readonly database: PowerSyncDatabase; readonly filename: string;
  readResources(): Promise<ReplicaResource[]>; readRawResources(): Promise<RawReplicaResource[]>;
  queueCommands(commands: readonly QueuedCommandInput[], correlationId?: string): Promise<void>;
  acknowledgeCommandResult(commandId: string): Promise<boolean>;
  acknowledgeOrDiscardQuarantinedCommand(commandId: string): Promise<boolean>;
  testInjectOrphanOverlay(command: QueuedCommandInput, bypassCapacity?: boolean): Promise<void>;
  outstandingCapacity(): Promise<{ count: number; bytes: number }>;
  resultByteAccounting(commandId: string): Promise<{ reservedBytes:number; actualBytes:number; sdkCompleted:boolean } | undefined>;
  completionIsHeld(): boolean; releaseCompletionHold(): void;
  readCommandResults(): Promise<LocalCommandResult[]>; readOptimisticResources(): Promise<OptimisticResource[]>;
  readQuarantinedCommands(): Promise<QuarantinedCommand[]>; replicaSession(): Promise<ReplicaSessionView | undefined>;
  uploadQueueCount(): Promise<number>; resetRequired(): boolean;
  performReplicaReset(hooks?: ReplicaResetHooks | ((sidecarPath: string) => Promise<void>)): Promise<void>;
  quarantineSidecarPath(): string; applicationStateSidecarPath(): string;
  testReplicaSecret(): ReplicaSessionSecret | undefined;
  setUploadFault(fault?: UploadFaultOptions): void; close(): Promise<void>;
}

export async function openSpikeClient(options: {
  name: string; runtimeDirectory: string; endpoint: string; token: string;
  commandEndpoint?: string; uploadFault?: UploadFaultOptions;
  forgedConnectionParams?: Record<string, string>; firstSyncTimeoutMs?: number;
}): Promise<SpikeClient> {
  await mkdir(options.runtimeDirectory, { recursive: true });
  const filename = `${options.name}.db`; const fullFilename = path.join(options.runtimeDirectory, filename);
  const quarantineDirectory = path.join(path.dirname(options.runtimeDirectory), "quarantine");
  await mkdir(quarantineDirectory, { recursive: true, mode: 0o700 });
  await chmod(quarantineDirectory, 0o700);
  const quarantinePath = path.join(quarantineDirectory, `${options.name}.quarantine.json`);
  const resetStatePath = path.join(quarantineDirectory, `${options.name}.reset.json`);
  const applicationStatePath = path.join(quarantineDirectory, `${options.name}.application-state.sqlite`);
  const applicationState = new ApplicationState(applicationStatePath);
  await chmod(applicationStatePath, 0o600);
  let persistedQuarantine: Awaited<ReturnType<typeof readQuarantineStore>>;
  try {
    persistedQuarantine = await readQuarantineStore(quarantinePath);
    if (persistedQuarantine.store.pending.length > 0) {
      throw new Error("Cross-process continuation of an unfinished replica reset is not supported by this spike.");
    }
    if (persistedQuarantine.migrated) await writePrivateJsonAtomically(quarantinePath, persistedQuarantine.store);
    const quarantinedIds = new Set(persistedQuarantine.store.finalized.map((command) => command.id));
    if (applicationState.activeCommandIds().some((commandId) => quarantinedIds.has(commandId))) {
      throw new Error("command_id_already_active_in_multiple_states");
    }
    const usage = applicationState.capacityUsage();
    assertCombinedOutstandingCapacity(
      usage.count + persistedQuarantine.store.finalized.length,
      usage.bytes + finalizedQuarantineBytes(persistedQuarantine.store.finalized),
    );
  } catch (error) {
    applicationState.close();
    throw error;
  }
  const commandEndpoint = options.commandEndpoint ?? "http://127.0.0.1:1";
  let resetCount = 0;
  let finalizedQuarantine: QuarantinedCommand[] = persistedQuarantine.store.finalized;
  let finalizedQuarantineReservedBytes = finalizedQuarantineBytes(finalizedQuarantine);
  let session = options.commandEndpoint ? await registerReplica(commandEndpoint, options.token) : undefined;
  let challenge = session ? await issueChallenge(commandEndpoint, options.token, session) : undefined;
  const makeDatabase = () => new PowerSyncDatabase({ schema: spikeSchema, database: { dbFilename: filename, dbLocation: options.runtimeDirectory } });
  let database = makeDatabase();
  let databaseClosed = false;
  let connector = new SpikeCommandConnector(options.endpoint, options.token, commandEndpoint, session, applicationState, options.uploadFault);
  const connectAndObserve = async () => {
    databaseClosed = false;
    await database.connect(connector, { params: options.forgedConnectionParams, retryDelayMs: 100 });
    await waitForInitialSync(database, options.firstSyncTimeoutMs ?? 30_000);
    if (session && challenge) {
      await acknowledgeChallenge(commandEndpoint, options.token, session, challenge.challengeId);
      applicationState.setReplicaSession(session, resetCount);
    }
  };
  try { await connectAndObserve(); }
  catch (error) {
    try { await closeDatabase(database); applicationState.close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], `Opening PowerSync client ${options.name} and cleanup both failed.`); }
    throw error;
  }

  const enqueueGate = new AsyncSerialGate();
  const combinedCapacityUsage = (): { count: number; bytes: number } => {
    const application = applicationState.capacityUsage();
    return {
      count: application.count + finalizedQuarantine.length,
      bytes: application.bytes + finalizedQuarantineReservedBytes,
    };
  };
  const bindCommand = async (command: QueuedCommandInput): Promise<QueuedCommandInput & {
    resourceIncarnationId:string; actualSerializedBytes:number; reservedBytes:number;
  }> => {
    // Treat public programmatic inputs as untrusted at runtime. This check must
    // precede resource binding and every application-sidecar, SDK-queue or
    // quarantine mutation; TypeScript's number annotation is not a boundary.
    assertPositiveExpectedRecordVersion(command.expectedRecordVersion);
    const resourceIncarnationId = command.resourceIncarnationId ?? (await database.getAll<{ resource_incarnation_id: string }>(
      "SELECT resource_incarnation_id FROM resources WHERE id = ?", [command.resourceId],
    ))[0]?.resource_incarnation_id;
    if (!resourceIncarnationId) throw new Error("Cannot bind a command without one replicated resource incarnation.");
    const actualSerializedBytes = Buffer.byteLength(JSON.stringify({
      commandId: command.commandId, type: command.type, resourceId: command.resourceId,
      resourceIncarnationId, expectedRecordVersion: command.expectedRecordVersion, payload: command.payload ?? null,
    }), "utf8");
    return { ...command, resourceIncarnationId, actualSerializedBytes,
      reservedBytes:reservedOutstandingBytes(actualSerializedBytes) };
  };
  const api: SpikeClient = {
    get database() { return database; }, filename: fullFilename,
    async readResources() { return database.getAll<ReplicaResource>("SELECT id, payload FROM resources WHERE deleted_at IS NULL ORDER BY id"); },
    async readRawResources() { return database.getAll<RawReplicaResource>("SELECT id, resource_incarnation_id, payload, version, deleted_at FROM resources ORDER BY id"); },
    async queueCommands(commands, correlationId = crypto.randomUUID()) {
      return enqueueGate.run(async () => {
        if (commands.length !== 1) throw new Error("The M3a local transaction requires exactly one command.");
        const bound = await Promise.all(commands.map(bindCommand));
        if (finalizedQuarantine.some((entry) => entry.id === bound[0]!.commandId) ||
            applicationState.hasActiveCommandId(bound[0]!.commandId)) {
          throw new Error("command_id_already_active");
        }
        const usage = combinedCapacityUsage();
        assertOutstandingCapacity(usage.count, usage.bytes, bound[0]!.reservedBytes);
        // The application overlay is written before the public SDK queue. A
        // failed SDK transaction removes it, but a process crash between these
        // stores can still leave an orphan; production local atomicity is not
        // claimed by this feasibility harness.
        let insertedOverlayIds: string[] = [];
        insertedOverlayIds = applicationState.addOverlays(bound);
        try {
          await database.writeTransaction(async (tx) => { for (const command of bound) {
            const payload = command.type === "ps8.resource.update.v1" ? command.payload : null;
            await tx.execute(`INSERT INTO command_queue (id,command_type,command_version,resource_id,resource_incarnation_id,expected_record_version,payload,upload_correlation_id) VALUES (?,?,1,?,?,?,?,?)`, [command.commandId, command.type, command.resourceId, command.resourceIncarnationId, command.expectedRecordVersion, payload, correlationId]);
          }});
        } catch (error) {
          // Only rows inserted by this admission may be rolled back. An
          // insert-only duplicate fails before SDK mutation and leaves the
          // original overlay/queue untouched.
          applicationState.removeOverlays(insertedOverlayIds);
          throw error;
        }
      });
    },
    async acknowledgeCommandResult(commandId) { return enqueueGate.run(async () => applicationState.acknowledgeResult(commandId)); },
    async acknowledgeOrDiscardQuarantinedCommand(commandId) {
      return enqueueGate.run(async () => {
        const next = await persistQuarantineAcknowledgement(quarantinePath, finalizedQuarantine, commandId);
        if (!next) return false;
        // Publish in-memory/capacity state only after the private sidecar rename
        // and directory fsync have succeeded.
        finalizedQuarantine = next;
        finalizedQuarantineReservedBytes = finalizedQuarantineBytes(next);
        return true;
      });
    },
    async testInjectOrphanOverlay(command, bypassCapacity = false) {
      return enqueueGate.run(async () => {
        const bound = await bindCommand(command);
        if (finalizedQuarantine.some((entry) => entry.id === bound.commandId) ||
            applicationState.hasActiveCommandId(bound.commandId)) {
          throw new Error("command_id_already_active");
        }
        if (!bypassCapacity) {
          const usage = combinedCapacityUsage();
          assertOutstandingCapacity(usage.count, usage.bytes, bound.reservedBytes);
        }
        applicationState.addOverlays([bound]);
      });
    },
    async outstandingCapacity() { return combinedCapacityUsage(); },
    async resultByteAccounting(commandId) { return applicationState.resultByteAccounting(commandId); },
    completionIsHeld() { return connector.completionIsHeld(); },
    releaseCompletionHold() { connector.releaseCompletionHold(); },
    async readCommandResults() { return applicationState.readResults(); },
    async readOptimisticResources() { return applicationState.readOverlays(); },
    async readQuarantinedCommands() { return finalizedQuarantine.map((command) => ({ ...command })); },
    async replicaSession() { return applicationState.replicaSession(); },
    async uploadQueueCount() { return (await database.getUploadQueueStats()).count; },
    resetRequired() { return connector.needsReset(); },
    quarantineSidecarPath() { return quarantinePath; },
    applicationStateSidecarPath() { return applicationStatePath; },
    testReplicaSecret() { return connector.testSession(); },
    async performReplicaReset(hooksInput) {
      return enqueueGate.run(async () => {
      if (!session) throw new Error("A registered replica session is required.");
      const hooks: ReplicaResetHooks = typeof hooksInput === "function" ? { afterQuarantineWritten: hooksInput } : (hooksInput ?? {});
      const assertResetCapacity = (store: QuarantineStore): number => {
        const results = applicationState.resultCapacityUsage();
        const finalizedBytes = finalizedQuarantineBytes(store.finalized);
        const pendingBytes = store.pending.reduce((total, item) => total + item.reserved_bytes, 0);
        assertCombinedOutstandingCapacity(
          results.count + store.finalized.length + store.pending.length,
          results.bytes + finalizedBytes + pendingBytes,
        );
        return finalizedBytes + pendingBytes;
      };
      type ResetState = { version:2; phase:"quarantined"|"session_staged"|"cleared"; resetRequestId:string; oldSession:ReplicaSessionSecret; newSession?:ReplicaSessionSecret };
      const readObject = async <T>(target: string): Promise<T | undefined> => {
        try { return JSON.parse(await readFile(target, "utf8")) as T; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
      };
      let state = await readObject<ResetState>(resetStatePath);
      if (!state) {
        if (!connector.needsReset()) throw new Error("Replica reset was not requested by the server.");
        const batch = await database.getCrudBatch(1_000);
        const queued = (batch?.crud ?? []).map((entry) => {
          const command = validateQueuedCrud([entry])[0]!;
          return { id:command.commandId, command_type:command.type, resource_id:command.resourceId,
            resource_incarnation_id:command.resourceIncarnationId, payload:command.payload ?? null,
            expected_record_version:command.expectedRecordVersion };
        });
        const queuedById = new Map(queued.map((command) => [command.id, command]));
        const overlays = applicationState.readOverlayRecords();
        const overlaysById = new Map(overlays.map((overlay) => [overlay.id, overlay]));
        for (const command of queued) {
          const overlay = overlaysById.get(command.id);
          if (overlay && (overlay.resource_id !== command.resource_id ||
              overlay.resource_incarnation_id !== command.resource_incarnation_id ||
              overlay.command_type !== command.command_type || overlay.payload !== command.payload ||
              Number(overlay.expected_record_version) !== command.expected_record_version)) {
            throw new Error("SDK queue and application overlay intent diverged.");
          }
        }
        const candidates = [...queued];
        for (const overlay of overlays) {
          if (!queuedById.has(overlay.id)) candidates.push({
            id:overlay.id, command_type:overlay.command_type as SpikeCommandType,
            resource_id:overlay.resource_id, resource_incarnation_id:overlay.resource_incarnation_id,
            payload:overlay.payload, expected_record_version:Number(overlay.expected_record_version),
          });
        }
        const prior = await readQuarantineStore(quarantinePath);
        if (prior.store.pending.length > 0) throw new Error("Unexpected pending quarantine without reset state.");
        const priorIds = new Set(prior.store.finalized.map((command) => command.id));
        for (const candidate of candidates) {
          if (priorIds.has(candidate.id)) throw new Error("quarantine_duplicate_id_conflict");
        }
        await database.disconnect();
        const pending: QuarantineIntent[] = [];
        for (const item of candidates) {
          const result = await replicaPost<{ preserve:boolean }>(commandEndpoint, options.token, "/spike/replicas/classify", { replicaId:session.replicaId, replicaEpoch:session.replicaEpoch, resourceId:item.resource_id, resourceIncarnationId:item.resource_incarnation_id }, session);
          const initiallyAuthorized = result.status === 200 && "preserve" in result.body && result.body.preserve === true;
          const overlayReservation = overlaysById.get(item.id)?.serialized_bytes ?? 0;
          const base = { ...item, payload:initiallyAuthorized ? item.payload : null };
          const reserved_bytes = Math.max(overlayReservation, quarantineEntryReservationBytes(base));
          pending.push({ ...base, initiallyAuthorized, reserved_bytes });
        }
        const store:QuarantineStore = { version:2, finalized:prior.store.finalized, pending };
        assertResetCapacity(store);
        await writePrivateJsonAtomically(quarantinePath, store);
        state = { version: 2, phase: "quarantined", resetRequestId: crypto.randomUUID(), oldSession: { ...session } };
        await writePrivateJsonAtomically(resetStatePath, state);
        await hooks.afterQuarantineWritten?.(quarantinePath);
      }
      if (state.version !== 2) throw new Error("Invalid application reset state.");
      if (state.phase === "quarantined") {
        const body = { replicaId: state.oldSession.replicaId, replicaEpoch: state.oldSession.replicaEpoch, resetRequestId: state.resetRequestId };
        let reset: { status:number; body: ReplicaSessionSecret | { error?:string } };
        try {
          reset = await replicaPost<ReplicaSessionSecret>(commandEndpoint, options.token, "/spike/replicas/reset", body, state.oldSession,
            hooks.resetPostCommitDropSecret ? { "x-ps8-fault": "reset-post-commit-drop", "x-ps8-fault-secret": hooks.resetPostCommitDropSecret } : {});
        } catch (error) {
          if (!hooks.resetPostCommitDropSecret) throw error;
          reset = await replicaPost<ReplicaSessionSecret>(commandEndpoint, options.token, "/spike/replicas/reset", body, state.oldSession);
        }
        if (reset.status !== 200) throw new Error("Stale-only replica reset failed.");
        const newSession = parseReplicaSessionSecret(reset.body);
        state = { ...state, phase: "session_staged", newSession };
        const stagedQuarantine = await readQuarantineStore(quarantinePath);
        assertResetCapacity(stagedQuarantine.store);
        await writePrivateJsonAtomically(resetStatePath, state);
        await hooks.afterSessionPersisted?.(resetStatePath);
      }
      if (state.phase === "session_staged") {
        const newSession = parseReplicaSessionSecret(state.newSession);
        const acknowledgement = await replicaPost(commandEndpoint, options.token, "/spike/replicas/reset/ack", {
          replicaId:newSession.replicaId, replicaEpoch:newSession.replicaEpoch, resetRequestId:state.resetRequestId,
        }, newSession);
        if (acknowledgement.status !== 200) throw new Error("Replica reset acknowledgement failed.");
        session = newSession; connector.setSession(newSession); resetCount += 1;
        const clearingQuarantine = await readQuarantineStore(quarantinePath);
        assertResetCapacity(clearingQuarantine.store);
        await database.disconnectAndClear();
        // Every application overlay, including a crash orphan with no SDK CRUD
        // entry, is already represented in the persisted pending quarantine.
        applicationState.clearOverlays();
        await database.close(); databaseClosed = true;
        state = { ...state, phase: "cleared" };
        assertResetCapacity(clearingQuarantine.store);
        await writePrivateJsonAtomically(resetStatePath, state);
        await hooks.afterClear?.(resetStatePath);
      }
      if (state.phase !== "cleared" || !state.newSession) throw new Error("Replica reset state did not reach cleared.");
      session = parseReplicaSessionSecret(state.newSession);
      if (!databaseClosed) { await database.close(); databaseClosed = true; }
      challenge = await issueChallenge(commandEndpoint, options.token, session);
      database = makeDatabase(); connector = new SpikeCommandConnector(options.endpoint, options.token, commandEndpoint, session, applicationState, options.uploadFault);
      await connectAndObserve();
      const retained = await readQuarantineStore(quarantinePath);
      assertResetCapacity(retained.store);
      const additions: QuarantinedCommand[] = [];
      for (const item of retained.store.pending) {
        const current = await replicaPost<{ preserve:boolean }>(commandEndpoint, options.token, "/spike/replicas/classify", {
          replicaId: session.replicaId, replicaEpoch: session.replicaEpoch, resourceId: item.resource_id, resourceIncarnationId: item.resource_incarnation_id,
        }, session);
        const currentlyAuthorized = current.status === 200 && "preserve" in current.body && current.body.preserve === true;
        const local = await database.getAll<{ id:string }>("SELECT id FROM resources WHERE id = ? AND resource_incarnation_id = ? AND deleted_at IS NULL", [item.resource_id, item.resource_incarnation_id]);
        const visible = item.initiallyAuthorized === true && currentlyAuthorized && local.length === 1;
        const finalized:QuarantinedCommand = {
          id:item.id, resource_id:item.resource_id, resource_incarnation_id:item.resource_incarnation_id,
          command_type:item.command_type, expected_record_version:item.expected_record_version,
          state:visible ? "pending_review" : "invalidated", payload:visible ? item.payload : null,
          exportable:visible ? 1 : 0, reserved_bytes:item.reserved_bytes,
        };
        if (Buffer.byteLength(JSON.stringify(finalized), "utf8") > item.reserved_bytes) {
          throw new Error("quarantine_representation_reservation_exceeded");
        }
        additions.push(finalized);
      }
      const merged = mergeFinalizedQuarantine(retained.store.finalized, additions);
      const completedStore:QuarantineStore = { version:2, finalized:merged, pending:[] };
      assertResetCapacity(completedStore);
      await writePrivateJsonAtomically(quarantinePath, completedStore);
      finalizedQuarantine = merged;
      finalizedQuarantineReservedBytes = finalizedQuarantineBytes(merged);
      await unlink(resetStatePath).catch((error) => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
      });
    },
    setUploadFault(fault) { connector.setUploadFault(fault); },
    async close() {
      const failures: unknown[] = [];
      connector.releaseCompletionHold();
      try { await closeDatabase(database); } catch (error) { failures.push(error); }
      try { applicationState.close(); } catch (error) { failures.push(error); }
      if (failures.length > 0) throw new AggregateError(failures, "PowerSync and application-state cleanup failed.");
    },
  };
  return api;
}
