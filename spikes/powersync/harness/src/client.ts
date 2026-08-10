import { mkdir } from "node:fs/promises";
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
  spikeProtocol,
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
const optimistic_resources = Table.createLocalOnly({
  resource_id: column.text,
  resource_incarnation_id: column.text,
  command_type: column.text,
  payload: column.text,
  expected_record_version: column.integer,
});
const command_results = Table.createLocalOnly({
  resource_id: column.text,
  state: column.text,
  result_code: column.text,
  previous_version: column.integer,
  current_version: column.integer,
  digest: column.text,
  attempt_number: column.integer,
});

export const spikeSchema = new Schema({ resources, command_queue, optimistic_resources, command_results });

export interface UploadFaultOptions {
  mode: "pre-commit-500" | "post-commit-drop" | "post-commit-drop-barrier";
  secret: string;
}

const requiredQueueColumns = [
  "command_type", "command_version", "expected_record_version", "resource_id", "resource_incarnation_id", "upload_correlation_id",
] as const;
const allowedQueueColumns = [...requiredQueueColumns, "payload"] as const;

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
        !Number.isSafeInteger(data.expected_record_version) || typeof data.upload_correlation_id !== "string") {
      throw new Error("Malformed command_queue PUT values.");
    }
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

export class SpikeCommandConnector implements PowerSyncBackendConnector {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
    private readonly commandEndpoint: string,
    private readonly deviceId: string,
    private readonly localDatabaseFilename: string,
    private fault?: UploadFaultOptions,
  ) {}

  setUploadFault(fault?: UploadFaultOptions): void {
    this.fault = fault;
  }

  async fetchCredentials() {
    return { endpoint: this.endpoint, token: this.token };
  }

  private async persistResults(
    results: readonly { commandId: string; resourceId: string; state: string; code: string; previousVersion: number; currentVersion: number; digest: string; attemptNumber: number }[],
  ): Promise<void> {
    // The pinned Node SDK invokes uploadData while its database worker owns the
    // callback, so re-entering database.writeTransaction here deadlocks. This
    // spike-only second SQLite connection writes only local-only backing rows.
    // Its commit and the later SDK queue completion are deliberately separate
    // transactions; durable server receipts make retry safe, not local atomicity.
    const sqlite = new BetterSqlite3(this.localDatabaseFilename, { timeout: 5_000 });
    try {
      sqlite.transaction(() => {
        const resultStatement = sqlite.prepare(
          `INSERT INTO ps_data_local__command_results (id, data) VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        );
        const overlayStatement = sqlite.prepare("DELETE FROM ps_data_local__optimistic_resources WHERE id = ?");
        for (const result of results) {
          resultStatement.run(result.commandId, JSON.stringify({
            resource_id: result.resourceId, state: result.state, result_code: result.code,
            previous_version: result.previousVersion, current_version: result.currentVersion,
            digest: result.digest, attempt_number: result.attemptNumber,
          }));
          overlayStatement.run(result.commandId);
        }
      })();
    } finally { sqlite.close(); }
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;
    const commands = validateQueuedCrud(transaction.crud);
    const localTransactionId = String(transaction.transactionId);
    const response = await fetch(`${this.commandEndpoint}/spike/commands`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        ...(this.fault ? { "x-ps8-fault": this.fault.mode, "x-ps8-fault-secret": this.fault.secret } : {}),
      },
      body: JSON.stringify({ spikeProtocol, deviceId: this.deviceId, localTransactionId, commands }),
      signal: AbortSignal.timeout(5_000),
    });
    let raw: unknown;
    try { raw = await response.json(); }
    catch { throw new Error("Malformed spike command response."); }
    if (response.status === 403) {
      const parsed = parseCommandResponse(raw, commands);
      if (parsed.results[0]?.state !== "denied") throw new Error("Denied command response lacks a digest-bound terminal result.");
      await this.persistResults(parsed.results);
      await transaction.complete();
      return;
    }
    if (response.status === 409 && raw && typeof raw === "object" && (raw as { error?: unknown }).error === "idempotency_conflict") {
      const command = commands[0]!;
      await this.persistResults([{
        commandId: command.commandId, resourceId: command.resourceId, state: "failed", code: "idempotency_conflict",
        previousVersion: command.expectedRecordVersion, currentVersion: command.expectedRecordVersion,
        digest: commandDigest(command), attemptNumber: 1,
      }]);
      await transaction.complete();
      return;
    }
    if (!response.ok) throw new Error(`Spike command upload failed with HTTP ${response.status}.`);
    const parsed = parseCommandResponse(raw, commands);
    await this.persistResults(parsed.results);
    await transaction.complete();
  }
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

export interface SpikeClient {
  database: PowerSyncDatabase;
  filename: string;
  readResources(): Promise<ReplicaResource[]>;
  readRawResources(): Promise<RawReplicaResource[]>;
  queueCommands(commands: readonly QueuedCommandInput[], correlationId?: string): Promise<void>;
  readCommandResults(): Promise<LocalCommandResult[]>;
  readOptimisticResources(): Promise<OptimisticResource[]>;
  uploadQueueCount(): Promise<number>;
  setUploadFault(fault?: UploadFaultOptions): void;
  close(): Promise<void>;
}

export async function openSpikeClient(options: {
  name: string; runtimeDirectory: string; endpoint: string; token: string;
  commandEndpoint?: string; uploadFault?: UploadFaultOptions;
  forgedConnectionParams?: Record<string, string>; firstSyncTimeoutMs?: number;
}): Promise<SpikeClient> {
  await mkdir(options.runtimeDirectory, { recursive: true });
  const filename = `${options.name}.db`;
  const database = new PowerSyncDatabase({ schema: spikeSchema, database: { dbFilename: filename, dbLocation: options.runtimeDirectory } });
  const connector = new SpikeCommandConnector(options.endpoint, options.token, options.commandEndpoint ?? "http://127.0.0.1:1", options.name, path.join(options.runtimeDirectory, filename), options.uploadFault);
  try {
    await database.connect(
      connector,
      { params: options.forgedConnectionParams, retryDelayMs: 100 },
    );
    await waitForInitialSync(database, options.firstSyncTimeoutMs ?? 30_000);
  } catch (error) {
    try { await closeDatabase(database); } catch (cleanupError) { throw new AggregateError([error, cleanupError], `Opening PowerSync client ${options.name} and cleanup both failed.`); }
    throw error;
  }
  return {
    database,
    filename: path.join(options.runtimeDirectory, filename),
    async readResources() { return database.getAll<ReplicaResource>("SELECT id, payload FROM resources WHERE deleted_at IS NULL ORDER BY id"); },
    async readRawResources() { return database.getAll<RawReplicaResource>("SELECT id, resource_incarnation_id, payload, version, deleted_at FROM resources ORDER BY id"); },
    async queueCommands(commands, correlationId = crypto.randomUUID()) {
      if (commands.length !== 1) throw new Error("The M3a local transaction requires exactly one command.");
      if (new Set(commands.map((command) => command.commandId)).size !== commands.length) throw new Error("Duplicate command ID in one local transaction.");
      if (new Set(commands.map((command) => command.resourceId)).size !== commands.length) throw new Error("Duplicate resource target in one local transaction.");
      const boundCommands = await Promise.all(commands.map(async (command) => {
        if (command.resourceIncarnationId) return { ...command, resourceIncarnationId: command.resourceIncarnationId };
        const rows = await database.getAll<{ resource_incarnation_id: string }>(
          "SELECT resource_incarnation_id FROM resources WHERE id = ?",
          [command.resourceId],
        );
        if (rows.length !== 1) throw new Error("Cannot bind a command without one replicated resource incarnation.");
        return { ...command, resourceIncarnationId: rows[0]!.resource_incarnation_id };
      }));
      await database.writeTransaction(async (tx) => {
        for (const command of boundCommands) {
          const payload = command.type === "ps8.resource.update.v1" ? command.payload : null;
          await tx.execute(
            `INSERT INTO command_queue
               (id, command_type, command_version, resource_id, resource_incarnation_id, expected_record_version, payload, upload_correlation_id)
             VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
            [command.commandId, command.type, command.resourceId, command.resourceIncarnationId, command.expectedRecordVersion, payload, correlationId],
          );
          await tx.execute(
            `INSERT OR REPLACE INTO optimistic_resources
               (id, resource_id, resource_incarnation_id, command_type, payload, expected_record_version) VALUES (?, ?, ?, ?, ?, ?)`,
            [command.commandId, command.resourceId, command.resourceIncarnationId, command.type, payload, command.expectedRecordVersion],
          );
        }
      });
    },
    async readCommandResults() { return database.getAll<LocalCommandResult>("SELECT id, resource_id, state, result_code, previous_version, current_version, attempt_number FROM command_results ORDER BY id"); },
    async readOptimisticResources() { return database.getAll<OptimisticResource>("SELECT id, resource_id, resource_incarnation_id, command_type, payload, expected_record_version FROM optimistic_resources ORDER BY id"); },
    async uploadQueueCount() { return (await database.getUploadQueueStats()).count; },
    setUploadFault(fault) { connector.setUploadFault(fault); },
    async close() { await closeDatabase(database); },
  };
}
