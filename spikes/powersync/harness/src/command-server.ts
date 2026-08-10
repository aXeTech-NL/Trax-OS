import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";
import pg, { type PoolClient } from "pg";
import {
  commandDigest,
  parseCommandEnvelope,
  spikeProtocol,
  type SpikeCommand,
  type ReplicaBinding,
  type SpikeCommandResult,
} from "./command-protocol.js";

const host = process.env.PS8_COMMAND_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PS8_COMMAND_PORT ?? "7070", 10);
const databaseUrl = process.env.PS8_DATABASE_URL;
const jwksUrl = process.env.PS8_JWKS_URL;
const faultSecret = process.env.PS8_POST_COMMIT_FAULT_SECRET;
const replicaRotationSecret = process.env.PS8_REPLICA_ROTATION_SECRET;
if (!databaseUrl || !jwksUrl || !faultSecret || faultSecret.length < 32 ||
    !replicaRotationSecret || replicaRotationSecret.length < 32 || replicaRotationSecret === faultSecret) {
  throw new Error("PS8_DATABASE_URL, PS8_JWKS_URL and distinct strong fault/replica-rotation secrets are required.");
}
const issuer = "urn:trax-os:issue-8-spike";
const audience = "powersync-dev";
const jwks = createRemoteJWKSet(new URL(jwksUrl));
const pool = new pg.Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 5_000, query_timeout: 5_000, statement_timeout: 5_000 });
const attempts = new Map<string, number>();
const dropped = new Set<string>();
interface AuthorizationBarrier { reached: boolean; release: () => void; wait: Promise<void> }
const authorizationBarriers = new Map<string, AuthorizationBarrier>();
const droppedResetResponses = new Set<string>();
const maxReplicasPerUser = 16;

function testAuthorized(request: IncomingMessage): boolean {
  return request.headers["x-ps8-fault-secret"] === faultSecret;
}

function createAuthorizationBarrier(commandId: string): AuthorizationBarrier {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const barrier = { reached: true, release, wait };
  authorizationBarriers.set(commandId, barrier);
  return barrier;
}

function json(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(`${JSON.stringify(body)}\n`);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 32_768) throw new Error("Request body exceeds the spike limit.");
    chunks.push(bytes);
  }
  if (!size) throw new Error("A JSON request body is required.");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function authenticate(request: IncomingMessage): Promise<string> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) throw new Error("bearer_required");
  const verified = await jwtVerify(authorization.slice(7), jwks, { issuer, audience });
  if (typeof verified.payload.sub !== "string") throw new Error("subject_required");
  return verified.payload.sub;
}

interface ResourceRow { id: string; resource_incarnation_id: string; version: string; deleted_at: string | null }
interface ReceiptRow {
  command_id: string; replica_id: string; replica_epoch: string; resource_id: string; digest: string; result_state: "applied" | "conflict" | "denied";
  result_code: "applied" | "optimistic_conflict" | "stale_incarnation" | "command_denied"; previous_version: string; current_version: string;
}
interface ReplicaRow {
  replica_id: string; user_id: string; credential_digest: string; replica_epoch: string;
  last_client_observed_ack_at: string | null; acknowledged_sequence: string | null; disabled_at: string | null;
  previous_credential_digest: string | null; staged_reset_request_id: string | null; last_acknowledged_reset_request_id: string | null;
  effective_now: string; retained_graveyard_floor: string; next_deletion_sequence: string; stale: boolean;
}
interface ReplicaSessionResponse { replicaId: string; replicaEpoch: number; credential: string }

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
const rotationKey = createHmac("sha256", replicaRotationSecret)
  .update("trax-ps8-r2-replica-credential-rotation-v1")
  .digest();
function rotatedCredential(replicaId: string, resetRequestId: string, targetEpoch: number): string {
  return `r2_${createHmac("sha256", rotationKey).update(`${replicaId}:${resetRequestId}:${targetEpoch}`).digest("base64url")}`;
}
function version4Uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
function credentialMatches(stored: string, candidate: string): boolean {
  const left = Buffer.from(stored, "hex"); const right = Buffer.from(candidate, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}
function credentialFrom(request: IncomingMessage): string | undefined {
  const value = request.headers["x-ps8-replica-credential"];
  return typeof value === "string" && value.length >= 32 && value.length <= 128 ? value : undefined;
}
function strictObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object_required");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) throw new Error("unknown_field");
  return record;
}
function parseBinding(value: Record<string, unknown>): ReplicaBinding {
  if (typeof value.replicaId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.replicaId) || !Number.isSafeInteger(value.replicaEpoch) || Number(value.replicaEpoch) < 1) throw new Error("invalid_replica");
  return { replicaId: value.replicaId, replicaEpoch: Number(value.replicaEpoch) };
}
function replicaIsStale(row: ReplicaRow): boolean { return row.stale; }
async function lockReplica(client: PoolClient, userId: string, binding: ReplicaBinding, credential: string): Promise<{ row: ReplicaRow; stale: boolean } | undefined> {
  const result = await client.query<ReplicaRow>(
    `SELECT replica.replica_id, replica.user_id, replica.credential_digest, replica.replica_epoch,
            replica.last_client_observed_ack_at, replica.acknowledged_sequence, replica.disabled_at,
            replica.previous_credential_digest, replica.staged_reset_request_id, replica.last_acknowledged_reset_request_id,
            state.effective_now, state.retained_graveyard_floor, state.next_deletion_sequence,
            ps8_replica_reset_required(replica.last_client_observed_ack_at, replica.acknowledged_sequence) AS stale
       FROM ps8_replicas AS replica CROSS JOIN ps8_retention_state AS state
      WHERE replica.replica_id = $1 AND state.singleton FOR UPDATE OF replica`, [binding.replicaId]);
  const row = result.rows[0];
  const digest = sha256(credential);
  if (!row || row.user_id !== userId || row.disabled_at !== null || Number(row.replica_epoch) !== binding.replicaEpoch || !credentialMatches(row.credential_digest, digest)) return undefined;
  return { row, stale: replicaIsStale(row) };
}
function receiptColumns(): string {
  return "command_id, replica_id, replica_epoch, resource_id, digest, result_state, result_code, previous_version, current_version";
}

function resultFromReceipt(row: ReceiptRow, attemptNumber: number, replay: boolean): SpikeCommandResult {
  return {
    commandId: row.command_id,
    resourceId: row.resource_id,
    digest: row.digest,
    state: row.result_state,
    code: replay && row.result_code === "applied" ? "already_applied" : row.result_code,
    previousVersion: Number(row.previous_version),
    currentVersion: Number(row.current_version),
    attemptNumber,
  };
}

function deniedResultFromDurableReceipt(row: ReceiptRow, attemptNumber: number): SpikeCommandResult {
  // A previously applied receipt remains immutable. After revocation we expose
  // only a terminal denial derived from its identity/digest/version binding,
  // never the historic applied outcome.
  return {
    commandId: row.command_id,
    resourceId: row.resource_id,
    digest: row.digest,
    state: "denied",
    code: "command_denied",
    previousVersion: Number(row.previous_version),
    currentVersion: Number(row.current_version),
    attemptNumber,
  };
}

async function lockActiveGrants(client: PoolClient, userId: string, resourceIds: readonly string[]): Promise<boolean> {
  await client.query("SELECT ps8_acquire_grant_read_lock()");
  const result = await client.query<{ resource_id: string }>(
    `SELECT resource_id FROM sync_grants
       WHERE user_id = $1 AND resource_id = ANY($2::uuid[])
         AND user_active AND workspace_active AND journey_active AND party_active
       ORDER BY resource_id, grant_path`,
    [userId, resourceIds],
  );
  return new Set(result.rows.map((row) => row.resource_id)).size === resourceIds.length;
}

async function executeCommands(
  userId: string,
  binding: ReplicaBinding,
  credential: string,
  commands: readonly SpikeCommand[],
  attemptNumber: number,
  afterAuthorization?: () => Promise<void>,
): Promise<{ status: number; body: object }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const replica = await lockReplica(client, userId, binding, credential);
    if (!replica) { await client.query("ROLLBACK"); return { status: 403, body: { error: "invalid_replica" } }; }
    await client.query("SELECT ps8_acquire_grant_read_lock()");
    const refreshed = await client.query<{ effective_now: string; retained_graveyard_floor: string; stale: boolean }>(
      `SELECT state.effective_now, state.retained_graveyard_floor,
              ps8_replica_reset_required(replica.last_client_observed_ack_at, replica.acknowledged_sequence) AS stale
         FROM ps8_retention_state AS state CROSS JOIN ps8_replicas AS replica
        WHERE state.singleton AND replica.replica_id = $1`, [binding.replicaId]);
    replica.row.effective_now = refreshed.rows[0]!.effective_now;
    replica.row.retained_graveyard_floor = refreshed.rows[0]!.retained_graveyard_floor;
    replica.row.stale = refreshed.rows[0]!.stale;
    if (replicaIsStale(replica.row)) { await client.query("ROLLBACK"); return { status: 428, body: { error: "replica_reset_required" } }; }
    const resourceIds = [...commands.map((command) => command.resourceId)].sort();
    const grantResult = await client.query<{ resource_id: string }>(
      `SELECT resource_id FROM sync_grants WHERE user_id = $1 AND resource_id = ANY($2::uuid[])
        AND user_active AND workspace_active AND journey_active AND party_active ORDER BY resource_id, grant_path`, [userId, resourceIds]);
    const hasActiveGrant = new Set(grantResult.rows.map((row) => row.resource_id)).size === resourceIds.length;
    if (!hasActiveGrant) {
      const command = commands[0]!;
      const digest = commandDigest(command, binding);
      let receiptResult = await client.query<ReceiptRow>(
        `SELECT ${receiptColumns()} FROM ps8_command_receipts WHERE user_id = $1 AND command_id = $2`,
        [userId, command.commandId],
      );
      let receipt = receiptResult.rows[0];
      if (receipt && (receipt.replica_id !== binding.replicaId || Number(receipt.replica_epoch) !== binding.replicaEpoch || receipt.resource_id !== command.resourceId || receipt.digest !== digest)) {
        await client.query("ROLLBACK");
        return { status: 409, body: { error: "idempotency_conflict" } };
      }
      if (!receipt) {
        // Missing and purged targets still get a durable, digest-bound terminal
        // receipt. Values come only from the authenticated request and reveal no
        // server-owned scope, existence, payload, or prior version.
        await client.query(
          `INSERT INTO ps8_command_receipts
             (user_id, command_id, replica_id, replica_epoch, resource_id, digest, result_state, result_code, previous_version, current_version)
           VALUES ($1, $2, $3, $4, $5, $6, 'denied', 'command_denied', $7, $7)
           ON CONFLICT (user_id, command_id) DO NOTHING`,
          [userId, command.commandId, binding.replicaId, binding.replicaEpoch, command.resourceId, digest, command.expectedRecordVersion],
        );
        receiptResult = await client.query<ReceiptRow>(
          `SELECT ${receiptColumns()} FROM ps8_command_receipts WHERE user_id = $1 AND command_id = $2`,
          [userId, command.commandId],
        );
        receipt = receiptResult.rows[0];
      }
      if (!receipt || receipt.replica_id !== binding.replicaId || Number(receipt.replica_epoch) !== binding.replicaEpoch || receipt.resource_id !== command.resourceId || receipt.digest !== digest) {
        await client.query("ROLLBACK");
        return { status: 409, body: { error: "idempotency_conflict" } };
      }
      await client.query("COMMIT");
      return {
        status: 403,
        body: { spikeProtocol, results: [deniedResultFromDurableReceipt(receipt, attemptNumber)] },
      };
    }
    await afterAuthorization?.();
    const resourcesResult = await client.query<ResourceRow>(
      "SELECT id, resource_incarnation_id, version, deleted_at FROM resources WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [resourceIds],
    );
    if (resourcesResult.rows.length !== resourceIds.length) {
      await client.query("ROLLBACK");
      return { status: 403, body: { error: "command_denied" } };
    }

    const receiptResult = await client.query<ReceiptRow>(
      `SELECT ${receiptColumns()} FROM ps8_command_receipts WHERE user_id = $1 AND command_id = ANY($2::uuid[]) ORDER BY command_id`,
      [userId, commands.map((command) => command.commandId)],
    );
    if (receiptResult.rows.length > 0) {
      if (receiptResult.rows.length !== commands.length) {
        await client.query("ROLLBACK");
        return { status: 409, body: { error: "partial_idempotency_match" } };
      }
      const byId = new Map(receiptResult.rows.map((row) => [row.command_id, row]));
      for (const command of commands) {
        const receipt = byId.get(command.commandId)!;
        if (receipt.replica_id !== binding.replicaId || Number(receipt.replica_epoch) !== binding.replicaEpoch || receipt.resource_id !== command.resourceId || receipt.digest !== commandDigest(command, binding)) {
          await client.query("ROLLBACK");
          return { status: 409, body: { error: "idempotency_conflict" } };
        }
      }
      await client.query("COMMIT");
      return { status: 200, body: { spikeProtocol, results: commands.map((command) => resultFromReceipt(byId.get(command.commandId)!, attemptNumber, true)) } };
    }

    const resources = new Map(resourcesResult.rows.map((row) => [row.id, row]));
    const staleIncarnation = commands.some((command) =>
      resources.get(command.resourceId)!.resource_incarnation_id !== command.resourceIncarnationId,
    );
    const conflict = !staleIncarnation && commands.some((command) => {
      const resource = resources.get(command.resourceId)!;
      return resource.deleted_at !== null || Number(resource.version) !== command.expectedRecordVersion;
    });
    const storedResults: SpikeCommandResult[] = [];
    if (staleIncarnation || conflict) {
      const resultCode = staleIncarnation ? "stale_incarnation" : "optimistic_conflict";
      for (const command of commands) {
        const currentVersion = Number(resources.get(command.resourceId)!.version);
        const digest = commandDigest(command, binding);
        await client.query(
          `INSERT INTO ps8_command_receipts
             (user_id, command_id, replica_id, replica_epoch, resource_id, digest, result_state, result_code, previous_version, current_version)
           VALUES ($1, $2, $3, $4, $5, $6, 'conflict', $7, $8, $9)`,
          [userId, command.commandId, binding.replicaId, binding.replicaEpoch, command.resourceId, digest, resultCode, command.expectedRecordVersion, currentVersion],
        );
        storedResults.push({ commandId: command.commandId, resourceId: command.resourceId, digest, state: "conflict", code: resultCode, previousVersion: command.expectedRecordVersion, currentVersion, attemptNumber });
      }
    } else {
      for (const [ordinal, command] of commands.entries()) {
        const previousVersion = command.expectedRecordVersion;
        const currentVersion = previousVersion + 1;
        if (command.type === "ps8.resource.update.v1") {
          await client.query("UPDATE resources SET payload = $1, version = $2 WHERE id = $3", [command.payload, currentVersion, command.resourceId]);
        } else {
          await client.query("UPDATE resources SET deleted_at = ps8_now(), version = $1 WHERE id = $2", [currentVersion, command.resourceId]);
        }
        const digest = commandDigest(command, binding);
        await client.query(
          `INSERT INTO ps8_command_change_events
             (event_id, user_id, command_id, resource_id, event_ordinal, event_type, resulting_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [randomUUID(), userId, command.commandId, command.resourceId, ordinal, command.type, currentVersion],
        );
        await client.query(
          `INSERT INTO ps8_command_receipts
             (user_id, command_id, replica_id, replica_epoch, resource_id, digest, result_state, result_code, previous_version, current_version)
           VALUES ($1, $2, $3, $4, $5, $6, 'applied', 'applied', $7, $8)`,
          [userId, command.commandId, binding.replicaId, binding.replicaEpoch, command.resourceId, digest, previousVersion, currentVersion],
        );
        storedResults.push({ commandId: command.commandId, resourceId: command.resourceId, digest, state: "applied", code: "applied", previousVersion, currentVersion, attemptNumber });
      }
    }
    await client.query("COMMIT");
    return { status: 200, body: { spikeProtocol, results: storedResults } };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* original failure wins */ }
    throw error;
  } finally {
    client.release();
  }
}

async function withReplicaTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
  catch (error) { try { await client.query("ROLLBACK"); } catch { /* original wins */ } throw error; }
  finally { client.release(); }
}

async function lifecycleRequest(request: IncomingMessage, response: ServerResponse, pathname: string, userId: string): Promise<boolean> {
  if (!pathname.startsWith("/spike/replicas")) return false;
  if (request.method !== "POST") { json(response, 405, { error: "method_not_allowed" }); return true; }
  try {
    if (pathname === "/spike/replicas/register") {
      strictObject(await readJson(request), []);
      const registration = await withReplicaTransaction(async (client): Promise<{ limited: true } | { limited: false; session: ReplicaSessionResponse }> => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('trax-ps8-replica-register:' || $1, 0))", [userId]);
        const count = Number((await client.query<{ count: string }>("SELECT count(*) AS count FROM ps8_replicas WHERE user_id = $1", [userId])).rows[0]!.count);
        if (count >= maxReplicasPerUser) return { limited: true };
        const replicaId = randomUUID(); const credential = `r2_${randomBytes(32).toString("base64url")}`;
        await client.query(`INSERT INTO ps8_replicas (replica_id, user_id, credential_digest, registered_at) VALUES ($1,$2,$3,ps8_now())`, [replicaId, userId, sha256(credential)]);
        return { limited: false, session: { replicaId, replicaEpoch: 1, credential } };
      });
      if (registration.limited) json(response, 429, { error: "replica_limit_reached" }); else json(response, 201, registration.session);
      return true;
    }
    const credential = credentialFrom(request); if (!credential) { json(response, 403, { error: "invalid_replica" }); return true; }
    const allowed = pathname === "/spike/replicas/challenge" ? ["replicaId", "replicaEpoch"]
      : pathname === "/spike/replicas/ack" ? ["replicaId", "replicaEpoch", "challengeId"]
      : pathname === "/spike/replicas/reset" ? ["replicaId", "replicaEpoch", "resetRequestId"]
      : pathname === "/spike/replicas/reset/ack" ? ["replicaId", "replicaEpoch", "resetRequestId"]
      : pathname === "/spike/replicas/classify" ? ["replicaId", "replicaEpoch", "resourceId", "resourceIncarnationId"] : [];
    if (!allowed.length) { json(response, 404, { error: "not_found" }); return true; }
    const body = strictObject(await readJson(request), allowed); const binding = parseBinding(body);
    if (pathname === "/spike/replicas/challenge") {
      const challenge = await withReplicaTransaction(async (client) => {
        const locked = await lockReplica(client, userId, binding, credential); if (!locked) return undefined;
        const challengeId = randomUUID(); const expiresAt = new Date(new Date(locked.row.effective_now).getTime() + 5 * 60_000).toISOString();
        await client.query("DELETE FROM ps8_replica_challenges WHERE replica_id = $1", [binding.replicaId]);
        await client.query(`INSERT INTO ps8_replica_challenges (challenge_id, replica_id, replica_epoch, target_sequence, issued_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6)`, [challengeId, binding.replicaId, binding.replicaEpoch, locked.row.next_deletion_sequence, locked.row.effective_now, expiresAt]);
        return { challengeId, targetSequence: Number(locked.row.next_deletion_sequence), expiresAt, checkpointProof: "client-observed-not-server-attested" };
      });
      if (!challenge) json(response, 403, { error: "invalid_replica" }); else json(response, 201, challenge); return true;
    }
    if (pathname === "/spike/replicas/ack") {
      const outcome = await withReplicaTransaction(async (client): Promise<{ kind: "invalid" | "rejected" | "acknowledged" }> => {
        const locked = await lockReplica(client, userId, binding, credential);
        if (!locked || typeof body.challengeId !== "string" || !/^[0-9a-f-]{36}$/.test(body.challengeId)) return { kind: "invalid" };
        const challenge = await client.query<{ target_sequence: string }>(
          `UPDATE ps8_replica_challenges AS challenge
              SET acknowledged_at = ps8_now()
            FROM ps8_retention_state AS state
           WHERE challenge.challenge_id = $1 AND challenge.replica_id = $2
             AND challenge.replica_epoch = $3 AND challenge.acknowledged_at IS NULL
             AND state.singleton AND ps8_now() <= challenge.expires_at
             AND challenge.target_sequence >= state.retained_graveyard_floor
           RETURNING challenge.target_sequence`,
          [body.challengeId, binding.replicaId, binding.replicaEpoch],
        );
        const row = challenge.rows[0];
        if (!row) return { kind: "rejected" };
        await client.query(
          "UPDATE ps8_replicas SET last_client_observed_ack_at = ps8_now(), acknowledged_sequence = $2 WHERE replica_id = $1",
          [binding.replicaId, row.target_sequence],
        );
        return { kind: "acknowledged" };
      });
      if (outcome.kind === "invalid") json(response, 403, { error: "invalid_replica" });
      else if (outcome.kind === "rejected") json(response, 409, { error: "checkpoint_ack_rejected" });
      else json(response, 200, { acknowledged: true, checkpointProof: "client-observed-not-server-attested" });
      return true;
    }
    if (pathname === "/spike/replicas/reset") {
      if (!version4Uuid(body.resetRequestId)) { json(response, 403, { error: "invalid_replica" }); return true; }
      const resetRequestId = body.resetRequestId;
      const outcome = await withReplicaTransaction(async (client): Promise<{ kind: "invalid" | "current" | "reset"; session?: ReplicaSessionResponse }> => {
        const result = await client.query<ReplicaRow>(
          `SELECT replica.*, state.effective_now, state.retained_graveyard_floor, state.next_deletion_sequence,
                  ps8_replica_reset_required(replica.last_client_observed_ack_at, replica.acknowledged_sequence) AS stale
             FROM ps8_replicas AS replica CROSS JOIN ps8_retention_state AS state
            WHERE replica.replica_id=$1 AND state.singleton FOR UPDATE OF replica`, [binding.replicaId]);
        const row = result.rows[0]; const candidateDigest = sha256(credential);
        if (!row || row.user_id !== userId || row.disabled_at !== null) return { kind: "invalid" };
        const targetEpoch = binding.replicaEpoch + 1;
        const nextCredential = rotatedCredential(binding.replicaId, resetRequestId, targetEpoch);
        if (Number(row.replica_epoch) === targetEpoch && row.staged_reset_request_id === resetRequestId && row.previous_credential_digest && credentialMatches(row.previous_credential_digest, candidateDigest) && credentialMatches(row.credential_digest, sha256(nextCredential))) {
          return { kind: "reset", session: { replicaId: binding.replicaId, replicaEpoch: targetEpoch, credential: nextCredential } };
        }
        if (Number(row.replica_epoch) !== binding.replicaEpoch || !credentialMatches(row.credential_digest, candidateDigest)) return { kind: "invalid" };
        if (!replicaIsStale(row)) return { kind: "current" };
        await client.query(
          `UPDATE ps8_replicas SET replica_epoch=$2, previous_credential_digest=credential_digest,
             credential_digest=$3, staged_reset_request_id=$4, last_client_observed_ack_at=NULL,
             acknowledged_sequence=NULL, reset_at=ps8_now() WHERE replica_id=$1`,
          [binding.replicaId, targetEpoch, sha256(nextCredential), resetRequestId],
        );
        return { kind: "reset", session: { replicaId: binding.replicaId, replicaEpoch: targetEpoch, credential: nextCredential } };
      });
      if (outcome.kind === "invalid") json(response, 403, { error: "invalid_replica" });
      else if (outcome.kind === "current") json(response, 409, { error: "replica_not_stale" });
      else if (request.headers["x-ps8-fault"] === "reset-post-commit-drop" && testAuthorized(request) && !droppedResetResponses.has(resetRequestId)) {
        droppedResetResponses.add(resetRequestId); response.destroy();
      } else json(response, 200, outcome.session!);
      return true;
    }
    if (pathname === "/spike/replicas/reset/ack") {
      if (!version4Uuid(body.resetRequestId)) { json(response, 403, { error: "invalid_replica" }); return true; }
      const outcome = await withReplicaTransaction(async (client): Promise<"invalid" | "acknowledged"> => {
        const locked = await lockReplica(client, userId, binding, credential); if (!locked) return "invalid";
        if (locked.row.last_acknowledged_reset_request_id === body.resetRequestId && locked.row.previous_credential_digest === null) return "acknowledged";
        if (locked.row.staged_reset_request_id !== body.resetRequestId || locked.row.previous_credential_digest === null) return "invalid";
        await client.query(`UPDATE ps8_replicas SET previous_credential_digest=NULL, staged_reset_request_id=NULL,
          last_acknowledged_reset_request_id=$2 WHERE replica_id=$1`, [binding.replicaId, body.resetRequestId]);
        return "acknowledged";
      });
      if (outcome === "invalid") json(response, 403, { error: "invalid_replica" }); else json(response, 200, { acknowledged: true });
      return true;
    }
    const classified = await withReplicaTransaction(async (client) => {
      const locked = await lockReplica(client, userId, binding, credential); if (!locked || typeof body.resourceId !== "string" || typeof body.resourceIncarnationId !== "string") return undefined;
      await client.query("SELECT ps8_acquire_grant_read_lock()");
      const grant = await client.query<{ resource_incarnation_id: string }>(`SELECT resource.resource_incarnation_id FROM resources AS resource JOIN sync_grants AS access_grant ON access_grant.resource_id=resource.id WHERE resource.id=$1 AND resource.resource_incarnation_id=$2 AND access_grant.user_id=$3 AND access_grant.user_active AND access_grant.workspace_active AND access_grant.journey_active AND access_grant.party_active LIMIT 1`, [body.resourceId, body.resourceIncarnationId, userId]);
      return { preserve: grant.rows.length === 1 };
    });
    if (!classified) json(response, 403, { error: "invalid_replica" }); else json(response, 200, classified); return true;
  } catch (error) { console.error("replica lifecycle request failed", error instanceof Error ? error.message : "unknown error"); json(response, 400, { error: "invalid_replica_request" }); return true; }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
    if (request.method === "GET" && url.pathname === "/health") {
      await pool.query("SELECT 1");
      json(response, 200, { status: "ready" });
      return;
    }
    const attemptMatch = url.pathname.match(/^\/spike\/test\/attempts\/([0-9a-f-]{36})$/);
    const barrierMatch = url.pathname.match(/^\/spike\/test\/barriers\/([0-9a-f-]{36})(?:\/(release))?$/);
    if (attemptMatch || barrierMatch) {
      if (!testAuthorized(request)) {
        json(response, 404, { error: "not_found" });
        return;
      }
      if (attemptMatch && request.method === "GET") {
        const suffix = `:${attemptMatch[1]}`;
        const count = [...attempts.entries()].filter(([key]) => key.endsWith(suffix)).reduce((sum, [, value]) => sum + value, 0);
        json(response, 200, { attempts: count });
        return;
      }
      if (barrierMatch && request.method === "GET" && !barrierMatch[2]) {
        json(response, 200, { reached: authorizationBarriers.get(barrierMatch[1]!)?.reached ?? false });
        return;
      }
      if (barrierMatch && request.method === "POST" && barrierMatch[2] === "release") {
        const barrier = authorizationBarriers.get(barrierMatch[1]!);
        if (!barrier) {
          json(response, 409, { error: "barrier_not_reached" });
          return;
        }
        barrier.release();
        json(response, 200, { released: true });
        return;
      }
      json(response, 405, { error: "method_not_allowed" });
      return;
    }
    if (!url.pathname.startsWith("/spike/")) { json(response, 404, { error: "not_found" }); return; }
    let userId: string;
    try { userId = await authenticate(request); }
    catch { json(response, 401, { error: "invalid_token" }); return; }
    if (await lifecycleRequest(request, response, url.pathname, userId)) return;
    if (request.method !== "POST" || url.pathname !== "/spike/commands") { json(response, 404, { error: "not_found" }); return; }
    const replicaCredential = credentialFrom(request);
    if (!replicaCredential) { json(response, 403, { error: "invalid_replica" }); return; }
    let envelope;
    try { envelope = parseCommandEnvelope(await readJson(request)); }
    catch (error) { json(response, 400, { error: "invalid_command", message: (error as Error).message }); return; }
    const fault = request.headers["x-ps8-fault"];
    const authorizedFault = testAuthorized(request);
    const attemptKey = `${userId}:${envelope.replicaId}:${envelope.replicaEpoch}:${envelope.commands[0]!.commandId}`;
    const attemptNumber = (attempts.get(attemptKey) ?? 0) + 1;
    attempts.set(attemptKey, attemptNumber);
    if (fault === "pre-commit-500" && authorizedFault) {
      json(response, 500, { error: "injected_pre_commit_failure" });
      return;
    }
    const barrierCommandId = envelope.commands[0]!.commandId;
    const outcome = await executeCommands(
      userId,
      { replicaId: envelope.replicaId, replicaEpoch: envelope.replicaEpoch },
      replicaCredential,
      envelope.commands,
      attemptNumber,
      fault === "authorization-barrier" && authorizedFault
        ? async () => {
            const barrier = createAuthorizationBarrier(barrierCommandId);
            try { await barrier.wait; }
            finally { authorizationBarriers.delete(barrierCommandId); }
          }
        : undefined,
    );
    if (
      outcome.status === 200
      && (fault === "post-commit-drop" || fault === "post-commit-drop-barrier")
      && authorizedFault
      && !dropped.has(attemptKey)
    ) {
      dropped.add(attemptKey);
      if (fault === "post-commit-drop-barrier") {
        const barrier = createAuthorizationBarrier(barrierCommandId);
        try { await barrier.wait; }
        finally { authorizationBarriers.delete(barrierCommandId); }
      }
      request.socket.destroy();
      return;
    }
    json(response, outcome.status, outcome.body);
  } catch (error) {
    console.error("spike command-server request failed", error instanceof Error ? error.message : "unknown error");
    if (!response.headersSent) json(response, 500, { error: "internal_error" });
    else response.destroy();
  }
});

server.listen(port, host, () => console.log(`Issue #8 experimental command server listening on ${host}:${port}`));
let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
