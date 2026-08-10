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
class ApplicationState {
  private readonly sqlite: BetterSqlite3.Database;

  constructor(readonly filename: string) {
    this.sqlite = new BetterSqlite3(filename, { timeout: 5_000 });
    this.sqlite.pragma("journal_mode = DELETE");
    this.sqlite.pragma("synchronous = FULL");
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS trax_app_command_results (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL,
        state TEXT NOT NULL,
        result_code TEXT NOT NULL,
        previous_version INTEGER NOT NULL,
        current_version INTEGER NOT NULL,
        digest TEXT NOT NULL,
        attempt_number INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trax_app_optimistic_resources (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL,
        resource_incarnation_id TEXT NOT NULL,
        command_type TEXT NOT NULL,
        payload TEXT,
        expected_record_version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trax_app_replica_session (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        replica_id TEXT NOT NULL,
        replica_epoch INTEGER NOT NULL,
        checkpoint_state TEXT NOT NULL,
        reset_count INTEGER NOT NULL
      );
    `);
  }

  persistResults(results: readonly { commandId: string; resourceId: string; state: string; code: string; previousVersion: number; currentVersion: number; digest: string; attemptNumber: number }[]): void {
    const upsert = this.sqlite.prepare(`
      INSERT INTO trax_app_command_results
        (id, resource_id, state, result_code, previous_version, current_version, digest, attempt_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        resource_id = excluded.resource_id,
        state = excluded.state,
        result_code = excluded.result_code,
        previous_version = excluded.previous_version,
        current_version = excluded.current_version,
        digest = excluded.digest,
        attempt_number = excluded.attempt_number
    `);
    const removeOverlay = this.sqlite.prepare("DELETE FROM trax_app_optimistic_resources WHERE id = ?");
    this.sqlite.transaction(() => {
      for (const result of results) {
        upsert.run(result.commandId, result.resourceId, result.state, result.code, result.previousVersion,
          result.currentVersion, result.digest, result.attemptNumber);
        removeOverlay.run(result.commandId);
      }
    })();
  }

  addOverlays(commands: readonly (QueuedCommandInput & { resourceIncarnationId: string })[]): void {
    const upsert = this.sqlite.prepare(`
      INSERT INTO trax_app_optimistic_resources
        (id, resource_id, resource_incarnation_id, command_type, payload, expected_record_version)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        resource_id = excluded.resource_id,
        resource_incarnation_id = excluded.resource_incarnation_id,
        command_type = excluded.command_type,
        payload = excluded.payload,
        expected_record_version = excluded.expected_record_version
    `);
    this.sqlite.transaction(() => {
      for (const command of commands) {
        upsert.run(command.commandId, command.resourceId, command.resourceIncarnationId,
          command.type, command.payload ?? null, command.expectedRecordVersion);
      }
    })();
  }

  removeOverlays(commandIds: readonly string[]): void {
    const remove = this.sqlite.prepare("DELETE FROM trax_app_optimistic_resources WHERE id = ?");
    this.sqlite.transaction(() => { for (const commandId of commandIds) remove.run(commandId); })();
  }

  clearOverlays(): void { this.sqlite.prepare("DELETE FROM trax_app_optimistic_resources").run(); }

  readResults(): LocalCommandResult[] {
    return this.sqlite.prepare(`SELECT id, resource_id, state, result_code, previous_version,
      current_version, attempt_number FROM trax_app_command_results ORDER BY id`).all() as LocalCommandResult[];
  }

  readOverlays(): OptimisticResource[] {
    return this.sqlite.prepare(`SELECT id, resource_id, resource_incarnation_id, command_type,
      payload, expected_record_version FROM trax_app_optimistic_resources ORDER BY id`).all() as OptimisticResource[];
  }

  setReplicaSession(session: ReplicaSessionSecret, resetCount: number): void {
    this.sqlite.prepare(`INSERT INTO trax_app_replica_session
      (singleton, replica_id, replica_epoch, checkpoint_state, reset_count)
      VALUES (1, ?, ?, 'client_observed', ?)
      ON CONFLICT(singleton) DO UPDATE SET replica_id = excluded.replica_id,
        replica_epoch = excluded.replica_epoch, checkpoint_state = excluded.checkpoint_state,
        reset_count = excluded.reset_count`).run(session.replicaId, session.replicaEpoch, resetCount);
  }

  replicaSession(): ReplicaSessionView | undefined {
    const row = this.sqlite.prepare(`SELECT replica_id, replica_epoch, checkpoint_state, reset_count
      FROM trax_app_replica_session WHERE singleton = 1`).get() as
      { replica_id: string; replica_epoch: number; checkpoint_state: string; reset_count: number } | undefined;
    return row ? { replicaId: row.replica_id, replicaEpoch: row.replica_epoch,
      checkpointState: row.checkpoint_state, resetCount: row.reset_count } : undefined;
  }

  close(): void { this.sqlite.close(); }
}

export class SpikeCommandConnector implements PowerSyncBackendConnector {
  private resetRequired = false;
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
  }

  async fetchCredentials() {
    return { endpoint: this.endpoint, token: this.token };
  }

  private async persistResults(
    results: readonly { commandId: string; resourceId: string; state: string; code: string; previousVersion: number; currentVersion: number; digest: string; attemptNumber: number }[],
  ): Promise<void> {
    // PowerSync owns its SQLite file. Application result/overlay state is kept
    // in a separate explicit sidecar because re-entering the public SDK from
    // uploadData deadlocks in the pinned Node release.
    this.applicationState.persistResults(results);
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;
    const commands = validateQueuedCrud(transaction.crud);
    const localTransactionId = String(transaction.transactionId);
    const session = this.session;
    if (!session) throw new Error("A registered replica session is required for command upload.");
    const binding = { replicaId: session.replicaId, replicaEpoch: session.replicaEpoch };
    const response = await fetch(`${this.commandEndpoint}/spike/commands`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        "x-ps8-replica-credential": session.credential,
        ...(this.fault ? { "x-ps8-fault": this.fault.mode, "x-ps8-fault-secret": this.fault.secret } : {}),
      },
      body: JSON.stringify({ spikeProtocol, ...binding, localTransactionId, commands }),
      signal: AbortSignal.timeout(5_000),
    });
    let raw: unknown;
    try { raw = await response.json(); }
    catch { throw new Error("Malformed spike command response."); }
    if (response.status === 428) { this.resetRequired = true; throw new ReplicaResetRequiredError(); }
    if (response.status === 403) {
      const parsed = parseCommandResponse(raw, commands, binding);
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
        digest: commandDigest(command, binding), attemptNumber: 1,
      }]);
      await transaction.complete();
      return;
    }
    if (!response.ok) throw new Error(`Spike command upload failed with HTTP ${response.status}.`);
    const parsed = parseCommandResponse(raw, commands, binding);
    await this.persistResults(parsed.results);
    await transaction.complete();
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

export interface QuarantinedCommand { id: string; resource_id: string; resource_incarnation_id: string; command_type: string; state: "pending_review" | "invalidated"; payload: string | null; exportable: number }
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
  const commandEndpoint = options.commandEndpoint ?? "http://127.0.0.1:1";
  let resetCount = 0;
  let finalizedQuarantine: QuarantinedCommand[] = [];
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

  const api: SpikeClient = {
    get database() { return database; }, filename: fullFilename,
    async readResources() { return database.getAll<ReplicaResource>("SELECT id, payload FROM resources WHERE deleted_at IS NULL ORDER BY id"); },
    async readRawResources() { return database.getAll<RawReplicaResource>("SELECT id, resource_incarnation_id, payload, version, deleted_at FROM resources ORDER BY id"); },
    async queueCommands(commands, correlationId = crypto.randomUUID()) {
      if (commands.length !== 1) throw new Error("The M3a local transaction requires exactly one command.");
      const bound = await Promise.all(commands.map(async (command) => {
        if (command.resourceIncarnationId) return { ...command, resourceIncarnationId: command.resourceIncarnationId };
        const rows = await database.getAll<{ resource_incarnation_id: string }>("SELECT resource_incarnation_id FROM resources WHERE id = ?", [command.resourceId]);
        if (rows.length !== 1) throw new Error("Cannot bind a command without one replicated resource incarnation.");
        return { ...command, resourceIncarnationId: rows[0]!.resource_incarnation_id };
      }));
      // The application overlay is written before the public SDK queue. A
      // failed SDK transaction removes it, but a process crash between these
      // stores can still leave an orphan; production local atomicity is not
      // claimed by this feasibility harness.
      applicationState.addOverlays(bound);
      try {
        await database.writeTransaction(async (tx) => { for (const command of bound) {
          const payload = command.type === "ps8.resource.update.v1" ? command.payload : null;
          await tx.execute(`INSERT INTO command_queue (id,command_type,command_version,resource_id,resource_incarnation_id,expected_record_version,payload,upload_correlation_id) VALUES (?,?,1,?,?,?,?,?)`, [command.commandId, command.type, command.resourceId, command.resourceIncarnationId, command.expectedRecordVersion, payload, correlationId]);
        }});
      } catch (error) {
        applicationState.removeOverlays(bound.map((command) => command.commandId));
        throw error;
      }
    },
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
      if (!session) throw new Error("A registered replica session is required.");
      const hooks: ReplicaResetHooks = typeof hooksInput === "function" ? { afterQuarantineWritten: hooksInput } : (hooksInput ?? {});
      type QuarantineItem = { id:string; command_type:string; resource_id:string; resource_incarnation_id:string; payload:string|null; initiallyAuthorized:boolean };
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
          return { id: command.commandId, command_type: command.type, resource_id: command.resourceId,
            resource_incarnation_id: command.resourceIncarnationId, payload: command.payload ?? null };
        });
        await database.disconnect();
        const quarantined: QuarantineItem[] = [];
        for (const item of queued) {
          const result = await replicaPost<{ preserve:boolean }>(commandEndpoint, options.token, "/spike/replicas/classify", { replicaId:session.replicaId, replicaEpoch:session.replicaEpoch, resourceId:item.resource_id, resourceIncarnationId:item.resource_incarnation_id }, session);
          const initiallyAuthorized = result.status === 200 && "preserve" in result.body && result.body.preserve === true;
          quarantined.push({ ...item, payload: initiallyAuthorized ? item.payload : null, initiallyAuthorized });
        }
        await writePrivateJsonAtomically(quarantinePath, { version: 1, commands: quarantined });
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
        await database.disconnectAndClear();
        applicationState.clearOverlays();
        await database.close(); databaseClosed = true;
        state = { ...state, phase: "cleared" };
        await writePrivateJsonAtomically(resetStatePath, state);
        await hooks.afterClear?.(resetStatePath);
      }
      if (state.phase !== "cleared" || !state.newSession) throw new Error("Replica reset state did not reach cleared.");
      session = parseReplicaSessionSecret(state.newSession);
      if (!databaseClosed) { await database.close(); databaseClosed = true; }
      challenge = await issueChallenge(commandEndpoint, options.token, session);
      database = makeDatabase(); connector = new SpikeCommandConnector(options.endpoint, options.token, commandEndpoint, session, applicationState, options.uploadFault);
      await connectAndObserve();
      const retained = await readObject<{ version?:unknown; commands?:unknown }>(quarantinePath);
      if (retained?.version !== 1 || !Array.isArray(retained.commands)) throw new Error("Invalid application quarantine sidecar.");
      const finalized: QuarantinedCommand[] = [];
      for (const raw of retained.commands) {
        const item = raw as QuarantineItem;
        const current = await replicaPost<{ preserve:boolean }>(commandEndpoint, options.token, "/spike/replicas/classify", {
          replicaId: session.replicaId, replicaEpoch: session.replicaEpoch, resourceId: item.resource_id, resourceIncarnationId: item.resource_incarnation_id,
        }, session);
        const currentlyAuthorized = current.status === 200 && "preserve" in current.body && current.body.preserve === true;
        const local = await database.getAll<{ id:string }>("SELECT id FROM resources WHERE id = ? AND resource_incarnation_id = ? AND deleted_at IS NULL", [item.resource_id, item.resource_incarnation_id]);
        const visible = item.initiallyAuthorized === true && currentlyAuthorized && local.length === 1;
        finalized.push({ id:item.id, resource_id:item.resource_id, resource_incarnation_id:item.resource_incarnation_id, command_type:item.command_type,
          state:visible ? "pending_review" : "invalidated", payload:visible ? item.payload : null, exportable:visible ? 1 : 0 });
      }
      finalizedQuarantine = finalized;
      await writePrivateJsonAtomically(quarantinePath, { version: 1, commands: finalized });
      await unlink(resetStatePath).catch((error) => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
    },
    setUploadFault(fault) { connector.setUploadFault(fault); },
    async close() {
      const failures: unknown[] = [];
      try { await closeDatabase(database); } catch (error) { failures.push(error); }
      try { applicationState.close(); } catch (error) { failures.push(error); }
      if (failures.length > 0) throw new AggregateError(failures, "PowerSync and application-state cleanup failed.");
    },
  };
  return api;
}
