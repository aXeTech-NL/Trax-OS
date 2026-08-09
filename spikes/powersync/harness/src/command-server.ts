import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";
import pg, { type PoolClient } from "pg";
import {
  commandDigest,
  parseCommandEnvelope,
  spikeProtocol,
  type SpikeCommand,
  type SpikeCommandResult,
} from "./command-protocol.js";

const host = process.env.PS8_COMMAND_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PS8_COMMAND_PORT ?? "7070", 10);
const databaseUrl = process.env.PS8_DATABASE_URL;
const jwksUrl = process.env.PS8_JWKS_URL;
const faultSecret = process.env.PS8_POST_COMMIT_FAULT_SECRET;
if (!databaseUrl || !jwksUrl || !faultSecret || faultSecret.length < 32) {
  throw new Error("PS8_DATABASE_URL, PS8_JWKS_URL and a strong PS8_POST_COMMIT_FAULT_SECRET are required.");
}
const issuer = "urn:trax-os:issue-8-spike";
const audience = "powersync-dev";
const jwks = createRemoteJWKSet(new URL(jwksUrl));
const pool = new pg.Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 5_000, query_timeout: 5_000, statement_timeout: 5_000 });
const attempts = new Map<string, number>();
const dropped = new Set<string>();
interface AuthorizationBarrier { reached: boolean; release: () => void; wait: Promise<void> }
const authorizationBarriers = new Map<string, AuthorizationBarrier>();

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

interface ResourceRow { id: string; version: string; deleted_at: string | null }
interface ReceiptRow {
  command_id: string; resource_id: string; digest: string; result_state: "applied" | "conflict" | "denied";
  result_code: "applied" | "optimistic_conflict" | "command_denied"; previous_version: string; current_version: string;
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
  commands: readonly SpikeCommand[],
  attemptNumber: number,
  afterAuthorization?: () => Promise<void>,
): Promise<{ status: number; body: object }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resourceIds = [...commands.map((command) => command.resourceId)].sort();
    const hasActiveGrant = await lockActiveGrants(client, userId, resourceIds);
    if (!hasActiveGrant) {
      const command = commands[0]!;
      const digest = commandDigest(command);
      await client.query(
        `INSERT INTO ps8_command_receipts
           (user_id, command_id, resource_id, digest, result_state, result_code, previous_version, current_version)
         SELECT $1, $2, resource.id, $4, 'denied', 'command_denied', $5, $5
           FROM resources AS resource WHERE resource.id = $3
         ON CONFLICT (user_id, command_id) DO NOTHING`,
        [userId, command.commandId, command.resourceId, digest, command.expectedRecordVersion],
      );
      const deniedReceipt = await client.query<ReceiptRow>(
        `SELECT command_id, resource_id, digest, result_state, result_code, previous_version, current_version
           FROM ps8_command_receipts WHERE user_id = $1 AND command_id = $2`,
        [userId, command.commandId],
      );
      await client.query("COMMIT");
      const receipt = deniedReceipt.rows[0];
      const matches = receipt?.resource_id === command.resourceId && receipt.digest === digest && receipt.result_state === "denied";
      return {
        status: 403,
        body: matches
          ? { spikeProtocol, results: [resultFromReceipt(receipt, attemptNumber, true)] }
          : { error: "command_denied" },
      };
    }
    await afterAuthorization?.();
    const resourcesResult = await client.query<ResourceRow>(
      "SELECT id, version, deleted_at FROM resources WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [resourceIds],
    );
    if (resourcesResult.rows.length !== resourceIds.length) {
      await client.query("ROLLBACK");
      return { status: 403, body: { error: "command_denied" } };
    }

    const receiptResult = await client.query<ReceiptRow>(
      `SELECT command_id, resource_id, digest, result_state, result_code, previous_version, current_version
         FROM ps8_command_receipts WHERE user_id = $1 AND command_id = ANY($2::uuid[]) ORDER BY command_id`,
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
        if (receipt.resource_id !== command.resourceId || receipt.digest !== commandDigest(command)) {
          await client.query("ROLLBACK");
          return { status: 409, body: { error: "idempotency_conflict" } };
        }
      }
      await client.query("COMMIT");
      return { status: 200, body: { spikeProtocol, results: commands.map((command) => resultFromReceipt(byId.get(command.commandId)!, attemptNumber, true)) } };
    }

    const resources = new Map(resourcesResult.rows.map((row) => [row.id, row]));
    const conflict = commands.some((command) => {
      const resource = resources.get(command.resourceId)!;
      return resource.deleted_at !== null || Number(resource.version) !== command.expectedRecordVersion;
    });
    const storedResults: SpikeCommandResult[] = [];
    if (conflict) {
      for (const command of commands) {
        const currentVersion = Number(resources.get(command.resourceId)!.version);
        const digest = commandDigest(command);
        await client.query(
          `INSERT INTO ps8_command_receipts
             (user_id, command_id, resource_id, digest, result_state, result_code, previous_version, current_version)
           VALUES ($1, $2, $3, $4, 'conflict', 'optimistic_conflict', $5, $6)`,
          [userId, command.commandId, command.resourceId, digest, command.expectedRecordVersion, currentVersion],
        );
        storedResults.push({ commandId: command.commandId, resourceId: command.resourceId, digest, state: "conflict", code: "optimistic_conflict", previousVersion: command.expectedRecordVersion, currentVersion, attemptNumber });
      }
    } else {
      for (const [ordinal, command] of commands.entries()) {
        const previousVersion = command.expectedRecordVersion;
        const currentVersion = previousVersion + 1;
        if (command.type === "ps8.resource.update.v1") {
          await client.query("UPDATE resources SET payload = $1, version = $2 WHERE id = $3", [command.payload, currentVersion, command.resourceId]);
        } else {
          await client.query("UPDATE resources SET deleted_at = clock_timestamp(), version = $1 WHERE id = $2", [currentVersion, command.resourceId]);
        }
        const digest = commandDigest(command);
        await client.query(
          `INSERT INTO ps8_command_change_events
             (event_id, user_id, command_id, resource_id, event_ordinal, event_type, resulting_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [randomUUID(), userId, command.commandId, command.resourceId, ordinal, command.type, currentVersion],
        );
        await client.query(
          `INSERT INTO ps8_command_receipts
             (user_id, command_id, resource_id, digest, result_state, result_code, previous_version, current_version)
           VALUES ($1, $2, $3, $4, 'applied', 'applied', $5, $6)`,
          [userId, command.commandId, command.resourceId, digest, previousVersion, currentVersion],
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
    if (request.method !== "POST" || url.pathname !== "/spike/commands") {
      json(response, 404, { error: "not_found" });
      return;
    }
    let userId: string;
    try { userId = await authenticate(request); }
    catch { json(response, 401, { error: "invalid_token" }); return; }
    let envelope;
    try { envelope = parseCommandEnvelope(await readJson(request)); }
    catch (error) { json(response, 400, { error: "invalid_command", message: (error as Error).message }); return; }
    const fault = request.headers["x-ps8-fault"];
    const authorizedFault = testAuthorized(request);
    const attemptKey = `${userId}:${envelope.commands[0]!.commandId}`;
    const attemptNumber = (attempts.get(attemptKey) ?? 0) + 1;
    attempts.set(attemptKey, attemptNumber);
    if (fault === "pre-commit-500" && authorizedFault) {
      json(response, 500, { error: "injected_pre_commit_failure" });
      return;
    }
    const barrierCommandId = envelope.commands[0]!.commandId;
    const outcome = await executeCommands(
      userId,
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
    if (outcome.status === 200 && fault === "post-commit-drop" && authorizedFault && !dropped.has(attemptKey)) {
      dropped.add(attemptKey);
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
