import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import {
  assertAuthorizedReplica,
  pollUntil,
  type ReplicaResource,
} from "../src/assertions.js";
import { openSpikeClient, spikeCapacityLimits, type SpikeClient } from "../src/client.js";
import {
  expectedCaseyAfterAlphaRevocation,
  expectedResources,
  ids,
  resourceIncarnations,
  type Principal,
} from "../src/fixtures.js";
import { writeEvidenceEntry } from "../src/evidence.js";
import { tamperJwtSignature } from "../src/jwt-test.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; use scripts/run.sh.`);
  return value;
}

if (process.env.PS8_PINNED_RUN !== "1") {
  throw new Error(
    "The real integration test must run through spikes/powersync/scripts/run.sh so endpoints and service provenance are bound.",
  );
}

const tokenBaseUrl = requiredEnvironment("PS8_TOKEN_URL");
const powerSyncEndpoint = requiredEnvironment("PS8_POWERSYNC_URL");
const commandEndpoint = requiredEnvironment("PS8_COMMAND_URL");
const faultSecret = requiredEnvironment("PS8_POST_COMMIT_FAULT_SECRET");
const databaseUrl = requiredEnvironment("PS8_DATABASE_URL");
const commandDatabaseUrl = requiredEnvironment("PS8_COMMAND_DATABASE_URL");
const runtimeDirectory = requiredEnvironment("PS8_RUNTIME_DIR");
const evidenceDirectory = requiredEnvironment("PS8_EVIDENCE_DIR");
const runId = requiredEnvironment("PS8_RUN_ID");
const composeProject = requiredEnvironment("COMPOSE_PROJECT_NAME");
const wrapperCommand = requiredEnvironment("PS8_WRAPPER_COMMAND");
const credentials = JSON.parse(
  requiredEnvironment("PS8_TOKEN_CREDENTIALS_JSON"),
) as Record<Principal, string>;
const command = `cd spikes/powersync/harness && npx --yes npm@10.9.4 run test:integration (via ${wrapperCommand})`;

function authorization(principal: Principal, secret: string): string {
  return `Basic ${Buffer.from(`${principal}:${secret}`).toString("base64")}`;
}

async function tokenResponse(options: {
  principal: Principal;
  secret?: string;
  variant?: "wrong-audience" | "expired";
  query?: string;
}): Promise<Response> {
  return fetch(`${tokenBaseUrl}/token${options.query ?? ""}`, {
    headers: {
      authorization: authorization(
        options.principal,
        options.secret ?? credentials[options.principal],
      ),
      ...(options.variant
        ? { "x-ps8-test-token-variant": options.variant }
        : {}),
    },
    signal: AbortSignal.timeout(5_000),
  });
}

async function fetchToken(
  principal: Principal,
  variant?: "wrong-audience" | "expired",
): Promise<string> {
  const response = await tokenResponse({ principal, variant });
  const body = await response.text();
  assert.equal(
    response.status,
    200,
    `token request for ${principal} failed: ${body}`,
  );
  const payload = JSON.parse(body) as { token: string };
  assert.ok(payload.token);
  return payload.token;
}

function hasIds(
  rows: readonly ReplicaResource[],
  expected: readonly string[],
): boolean {
  return (
    JSON.stringify(rows.map((row) => row.id).sort()) ===
    JSON.stringify([...expected].sort())
  );
}

async function readExpected(
  label: string,
  client: SpikeClient,
  expected: readonly string[],
): Promise<ReplicaResource[]> {
  return pollUntil(
    label,
    () => client.readResources(),
    (rows) => hasIds(rows, expected),
    30_000,
    100,
  );
}

async function closeAll(clients: SpikeClient[]): Promise<void> {
  const results = await Promise.allSettled(
    clients.splice(0).map((client) => client.close()),
  );
  const failures = results
    .filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "One or more PowerSync replicas failed to close.",
    );
  }
}

async function closeAllAndPool(clients: SpikeClient[], pool: pg.Pool): Promise<void> {
  const results = await Promise.allSettled([closeAll(clients), pool.end()]);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length) throw new AggregateError(failures, "PowerSync client and PostgreSQL cleanup failed.");
}

async function exerciseRevocation(options: {
  label: string;
  principal: Principal;
  onlineClient: SpikeClient;
  token: string;
  pool: pg.Pool;
  deactivateSql: string;
  reactivateSql: string;
  parameters: string[];
  expectedAfter: readonly string[];
  expectedRestored: readonly string[];
  clients: SpikeClient[];
  afterDeactivate?: () => Promise<void>;
}): Promise<void> {
  await options.pool.query(options.deactivateSql, options.parameters);
  const onlineRows = await readExpected(
    `${options.label} online purge`,
    options.onlineClient,
    options.expectedAfter,
  );
  assertAuthorizedReplica(
    `${options.principal}-${options.label}-online`,
    onlineRows,
    options.expectedAfter,
  );

  const stale = await openSpikeClient({
    name: `${options.principal}-${options.label}-stale-${runId}`,
    runtimeDirectory,
    endpoint: powerSyncEndpoint,
    token: options.token,
    forgedConnectionParams: { scope: "all", party_id: ids.parties.alpha },
  });
  options.clients.push(stale);
  assertAuthorizedReplica(
    `${options.principal}-${options.label}-fresh-stale-token`,
    await readExpected(
      `${options.label} fresh replica reduced scope`,
      stale,
      options.expectedAfter,
    ),
    options.expectedAfter,
  );
  await options.afterDeactivate?.();
  await stale.close();
  options.clients.splice(options.clients.indexOf(stale), 1);

  await options.pool.query(options.reactivateSql, options.parameters);
  assertAuthorizedReplica(
    `${options.principal}-${options.label}-restored`,
    await readExpected(
      `${options.label} reactivation checkpoint`,
      options.onlineClient,
      options.expectedRestored,
    ),
    options.expectedRestored,
  );
}

interface TokenProbeObservation {
  name: string;
  status: number;
  diagnostic: string;
}

function sanitizedDiagnostic(body: string): string {
  return body
    .replace(
      /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
      "[redacted-jwt]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

async function assertRejectedByPowerSync(
  name: string,
  token: string,
  expectedCode: "PSYNC_S2101" | "PSYNC_S2103" | "PSYNC_S2105",
): Promise<TokenProbeObservation> {
  const response = await fetch(`${powerSyncEndpoint}/sync/stream`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.text();
  const diagnostic = sanitizedDiagnostic(body);
  assert.equal(
    response.status,
    401,
    `${name} token was not rejected: ${diagnostic}`,
  );
  let error: { code?: unknown; description?: unknown } | undefined;
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (parsed.error && typeof parsed.error === "object") {
      error = parsed.error as { code?: unknown; description?: unknown };
    }
  } catch {
    assert.fail(`${name} returned non-JSON error content: ${diagnostic}`);
  }
  assert.equal(
    error?.code,
    expectedCode,
    `${name} returned an unexpected error code: ${diagnostic}`,
  );
  if (expectedCode === "PSYNC_S2101") {
    assert.match(String(error?.description ?? ""), /signature verification failed/i);
  }
  return { name, status: response.status, diagnostic };
}

test(
  "real PowerSync replicas authenticate identity, isolate scopes and purge every online revoked hierarchy",
  { timeout: 240_000 },
  async () => {
    const startedAtMilliseconds = Date.now();
    const startedAt = new Date(startedAtMilliseconds).toISOString();
    const clients: SpikeClient[] = [];
    const failures: unknown[] = [];
    const tokenProbeObservations: TokenProbeObservation[] = [];
    let aliceIndependentPathPreserved = false;
    let stage = "setup";
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 2,
      connectionTimeoutMillis: 5_000,
      query_timeout: 5_000,
      statement_timeout: 5_000,
    });

    try {
      stage = "reset fixtures";
      await rm(runtimeDirectory, { recursive: true, force: true });
      await pool.query("UPDATE users SET active = true");
      await pool.query("UPDATE workspace_memberships SET active = true");
      await pool.query("UPDATE journey_memberships SET active = true");
      await pool.query("UPDATE party_memberships SET active = true");

      stage = "token issuer identity and scope authentication";
      const forgedScope = await tokenResponse({
        principal: "alice",
        query: `?principal=eve&workspace_id=${ids.workspaces.two}&party_id=${ids.parties.charlie}`,
      });
      assert.equal(forgedScope.status, 400);
      const aliceAsEve = await tokenResponse({
        principal: "eve",
        secret: credentials.alice,
      });
      assert.equal(
        aliceAsEve.status,
        401,
        "Alice credential obtained Eve identity token",
      );
      const aliceAsCasey = await tokenResponse({
        principal: "casey",
        secret: credentials.alice,
      });
      assert.equal(
        aliceAsCasey.status,
        401,
        "Alice credential obtained Casey identity token",
      );

      const tokens = Object.fromEntries(
        await Promise.all(
          (Object.keys(expectedResources) as Principal[]).map(
            async (principal) => [principal, await fetchToken(principal)],
          ),
        ),
      ) as Record<Principal, string>;

      stage = "initial replica scope and same-workspace Journey isolation";
      const principals = Object.keys(expectedResources) as Principal[];
      const opened: SpikeClient[] = [];
      for (const principal of principals) {
        const client = await openSpikeClient({
          name: `${principal}-${runId}`,
          runtimeDirectory,
          endpoint: powerSyncEndpoint,
          token: tokens[principal],
          forgedConnectionParams: {
            workspace_id: ids.workspaces.two,
            journey_id: ids.journeys.two,
            party_id: ids.parties.charlie,
            scope: "all",
          },
        });
        opened.push(client);
        clients.push(client);
      }

      for (const [index, principal] of principals.entries()) {
        const client = opened[index];
        assert.ok(client);
        const rows = await readExpected(
          `${principal} initial exact scope`,
          client,
          expectedResources[principal],
        );
        assertAuthorizedReplica(principal, rows, expectedResources[principal]);
        assert.ok(
          (await stat(client.filename)).isFile(),
          `${principal} did not use an on-disk SQLite replica`,
        );
      }
      const bobRows = await opened[principals.indexOf("bob")]!.readResources();
      const caseyRows =
        await opened[principals.indexOf("casey")]!.readResources();
      assert.ok(
        ![...bobRows, ...caseyRows].some(
          (row) => row.id === ids.resources.aliceOnlySameWorkspaceJourney,
        ),
        "same-workspace foreign Journey resource leaked",
      );

      stage = "party revocation";
      await exerciseRevocation({
        label: "party",
        principal: "casey",
        onlineClient: opened[principals.indexOf("casey")]!,
        token: tokens.casey,
        pool,
        deactivateSql:
          "UPDATE party_memberships SET active = false WHERE user_id = $1 AND party_id = $2",
        reactivateSql:
          "UPDATE party_memberships SET active = true WHERE user_id = $1 AND party_id = $2",
        parameters: [ids.users.casey, ids.parties.alpha],
        expectedAfter: expectedCaseyAfterAlphaRevocation,
        expectedRestored: expectedResources.casey,
        clients,
        afterDeactivate: async () => {
          const aliceRows = await readExpected(
            "Alice independent alpha path during Casey alpha revocation",
            opened[principals.indexOf("alice")]!,
            expectedResources.alice,
          );
          assertAuthorizedReplica(
            "alice-independent-alpha-path",
            aliceRows,
            expectedResources.alice,
          );
          aliceIndependentPathPreserved = true;
        },
      });

      stage = "Journey revocation";
      await exerciseRevocation({
        label: "journey",
        principal: "bob",
        onlineClient: opened[principals.indexOf("bob")]!,
        token: tokens.bob,
        pool,
        deactivateSql:
          "UPDATE journey_memberships SET active = false WHERE user_id = $1 AND journey_id = $2",
        reactivateSql:
          "UPDATE journey_memberships SET active = true WHERE user_id = $1 AND journey_id = $2",
        parameters: [ids.users.bob, ids.journeys.one],
        expectedAfter: [],
        expectedRestored: expectedResources.bob,
        clients,
      });

      stage = "workspace revocation";
      await exerciseRevocation({
        label: "workspace",
        principal: "alice",
        onlineClient: opened[principals.indexOf("alice")]!,
        token: tokens.alice,
        pool,
        deactivateSql:
          "UPDATE workspace_memberships SET active = false WHERE user_id = $1 AND workspace_id = $2",
        reactivateSql:
          "UPDATE workspace_memberships SET active = true WHERE user_id = $1 AND workspace_id = $2",
        parameters: [ids.users.alice, ids.workspaces.one],
        expectedAfter: [],
        expectedRestored: expectedResources.alice,
        clients,
      });

      stage = "user revocation";
      await exerciseRevocation({
        label: "user",
        principal: "eve",
        onlineClient: opened[principals.indexOf("eve")]!,
        token: tokens.eve,
        pool,
        deactivateSql: "UPDATE users SET active = false WHERE id = $1",
        reactivateSql: "UPDATE users SET active = true WHERE id = $1",
        parameters: [ids.users.eve],
        expectedAfter: [],
        expectedRestored: expectedResources.eve,
        clients,
        afterDeactivate: async () => {
          const response = await tokenResponse({ principal: "eve" });
          assert.equal(
            response.status,
            403,
            "inactive Eve obtained a new token",
          );
        },
      });

      // Run invalid-JWT service probes after the successful real-client sync
      // control so each rejected fixture is compared with proven valid access.
      stage = "invalid JWT service rejection";
      const wrongAudience = await fetchToken("alice", "wrong-audience");
      const expired = await fetchToken("alice", "expired");
      const tampered = tamperJwtSignature(tokens.alice);
      tokenProbeObservations.push(
        await assertRejectedByPowerSync(
          "wrong-audience",
          wrongAudience,
          "PSYNC_S2105",
        ),
      );
      tokenProbeObservations.push(
        await assertRejectedByPowerSync("expired", expired, "PSYNC_S2103"),
      );
      tokenProbeObservations.push(
        await assertRejectedByPowerSync(
          "tampered-signature",
          tampered,
          "PSYNC_S2101",
        ),
      );
    } catch (error) {
      failures.push(
        new Error(
          `${stage}: ${error instanceof Error ? error.message : "unknown failure"}`,
          { cause: error },
        ),
      );
    }

    try {
      await closeAll(clients);
    } catch (error) {
      failures.push(error);
    }
    try {
      await pool.end();
    } catch (error) {
      failures.push(error);
    }

    if (failures.length > 0) {
      try {
        await writeEvidenceEntry(evidenceDirectory, {
          check: "scoped-replication-and-hierarchical-online-revocation",
          state: "failed",
          command,
          executedAt: startedAt,
          exitCode: 1,
          platform: `${os.platform()}-${os.arch()} node-${process.version}`,
          details: `Run ${runId} in ${composeProject} failed against token=${tokenBaseUrl} and powersync=${powerSyncEndpoint}: ${failures
            .map((error) =>
              error instanceof Error
                ? error.message
                : "Unknown integration failure",
            )
            .join(" | ")}`,
        });
      } catch (evidenceError) {
        failures.push(evidenceError);
      }
      throw new AggregateError(
        failures,
        "Issue #8 integration or cleanup failed.",
      );
    }

    assert.equal(
      aliceIndependentPathPreserved,
      true,
      "Alice's independent alpha path was not observed during Casey revocation",
    );
    const observationsTarget = path.join(
      evidenceDirectory,
      "integration-observations.json",
    );
    const observationsTemporary = `${observationsTarget}.${process.pid}.tmp`;
    await writeFile(
      observationsTemporary,
      `${JSON.stringify(
        {
          runId,
          test: {
            name: "real PowerSync replicas authenticate identity, isolate scopes and purge every online revoked hierarchy",
            count: 1,
            passed: 1,
            skipped: 0,
            startedAt,
            durationMilliseconds: Date.now() - startedAtMilliseconds,
          },
          validTokenControl: {
            principals: Object.keys(expectedResources),
            completedFirstSync: true,
            exactReplicaAllowlistsMatched: true,
          },
          assertions: {
            authenticatedIdentityIssuance: true,
            sameWorkspaceJourneyIsolation: true,
            hierarchicalOnlineRevocation: [
              "party",
              "journey",
              "workspace",
              "user",
            ],
            aliceIndependentAlphaPathPreserved: true,
          },
          tokenProbes: tokenProbeObservations,
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(observationsTemporary, observationsTarget);
  },
);


async function testControl(pathname: string, method = "GET"): Promise<Record<string, unknown>> {
  const response = await fetch(`${commandEndpoint}/spike/test/${pathname}`, {
    method,
    headers: { "x-ps8-fault-secret": faultSecret },
    signal: AbortSignal.timeout(5_000),
  });
  const body = JSON.parse(await response.text()) as Record<string, unknown>;
  assert.equal(response.status, 200, `test control ${pathname} failed: ${JSON.stringify(body)}`);
  return body;
}

async function waitForAttempt(commandId: string): Promise<number> {
  const body = await pollUntil(
    `command attempt ${commandId}`,
    () => testControl(`attempts/${commandId}`),
    (candidate) => Number(candidate.attempts) >= 1,
    10_000,
    50,
  );
  return Number(body.attempts);
}

interface TestReplicaSession { replicaId: string; replicaEpoch: number; credential: string }
const directReplicaByToken = new Map<string, TestReplicaSession>();
const replicaCredentialById = new Map<string, string>();
async function replicaRequest(
  token: string,
  action: "register" | "challenge" | "ack" | "reset" | "reset/ack" | "classify",
  body: Record<string, unknown>,
  session?: TestReplicaSession,
  credentialOverride?: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${commandEndpoint}/spike/replicas/${action}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...((credentialOverride ?? session?.credential) ? { "x-ps8-replica-credential": credentialOverride ?? session!.credential } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  return { status: response.status, body: JSON.parse(await response.text()) as Record<string, unknown> };
}
async function registerTestReplica(token: string): Promise<TestReplicaSession> {
  const response = await replicaRequest(token, "register", {});
  assert.equal(response.status, 201);
  assert.equal(typeof response.body.replicaId, "string");
  assert.equal(response.body.replicaEpoch, 1);
  assert.equal(typeof response.body.credential, "string");
  return response.body as unknown as TestReplicaSession;
}
async function challengeAndAck(token: string, session: TestReplicaSession): Promise<{ challengeId: string; targetSequence: number }> {
  const challenge = await replicaRequest(token, "challenge", { replicaId: session.replicaId, replicaEpoch: session.replicaEpoch }, session);
  assert.equal(challenge.status, 201);
  assert.equal(challenge.body.checkpointProof, "client-observed-not-server-attested");
  const result = { challengeId: String(challenge.body.challengeId), targetSequence: Number(challenge.body.targetSequence) };
  const ack = await replicaRequest(token, "ack", { replicaId: session.replicaId, replicaEpoch: session.replicaEpoch, challengeId: result.challengeId }, session);
  assert.deepEqual({ status: ack.status, proof: ack.body.checkpointProof }, { status: 200, proof: "client-observed-not-server-attested" });
  return result;
}
async function commandRequest(token: string | undefined, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const raw = body as Record<string, unknown>;
  const selected = typeof raw.replicaId === "string"
    ? { replicaId:raw.replicaId, replicaEpoch:Number(raw.replicaEpoch), credential:replicaCredentialById.get(raw.replicaId) }
    : token ? directReplicaByToken.get(token) : undefined;
  const bound = selected && !raw.replicaId ? { ...raw, replicaId:selected.replicaId, replicaEpoch:selected.replicaEpoch } : raw;
  const response = await fetch(`${commandEndpoint}/spike/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(selected?.credential ? { "x-ps8-replica-credential": selected.credential } : {}),
      ...headers,
    },
    body: JSON.stringify(bound),
    signal: AbortSignal.timeout(5_000),
  });
  return { status: response.status, body: JSON.parse(await response.text()) as Record<string, unknown> };
}

function rememberReplica(client: SpikeClient) {
  const secret = client.testReplicaSecret(); assert.ok(secret); replicaCredentialById.set(secret.replicaId, secret.credential); return secret;
}

function commandBody(command: { commandId: string; type: string; resourceId: string; resourceIncarnationId?: string; expectedRecordVersion: number; payload?: string }, session?: { replicaId:string; replicaEpoch:number }) {
  const resourceIncarnationId = command.resourceIncarnationId ?? resourceIncarnations[command.resourceId];
  if (!resourceIncarnationId) throw new Error("Integration command requires a known resource incarnation.");
  return { spikeProtocol: 1, ...(session ? { replicaId:session.replicaId, replicaEpoch:session.replicaEpoch } : {}), localTransactionId: randomUUID(), commands: [{ ...command, resourceIncarnationId }] };
}

async function waitForResult(client: SpikeClient, commandId: string) {
  const rows = await pollUntil(
    `local result ${commandId}`,
    () => client.readCommandResults(),
    (candidate) => candidate.some((row) => row.id === commandId),
    30_000,
    100,
  );
  return rows.find((row) => row.id === commandId)!;
}

test(
  "experimental insert-only PowerSync commands derive authority and converge idempotency, conflicts and tombstones",
  { timeout: 240_000 },
  async () => {
    const startedAt = new Date().toISOString();
    const clients: SpikeClient[] = [];
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5_000, query_timeout: 5_000, statement_timeout: 5_000 });
    const fixturePayloads = [
      [ids.resources.sharedOne, "MARKER_W1_J1_SHARED"],
      [ids.resources.alphaPrivate, "MARKER_PARTY_ALPHA_PRIVATE"],
      [ids.resources.bravoPrivate, "MARKER_PARTY_BRAVO_PRIVATE"],
      [ids.resources.aliceOnlySameWorkspaceJourney, "MARKER_W1_SECOND_JOURNEY_ALICE_ONLY"],
      [ids.resources.sharedTwo, "MARKER_W2_FORBIDDEN_SHARED"],
      [ids.resources.charliePrivate, "MARKER_W2_FORBIDDEN_PRIVATE"],
    ] as const;
    try {
      await rm(runtimeDirectory, { recursive: true, force: true });
      await pool.query("TRUNCATE ps8_command_change_events, ps8_command_receipts");
      for (const [id, payload] of fixturePayloads) await pool.query("UPDATE resources SET payload = $1, version = 1, deleted_at = NULL WHERE id = $2", [payload, id]);
      await pool.query("UPDATE users SET active = true");
      await pool.query("UPDATE workspace_memberships SET active = true");
      await pool.query("UPDATE journey_memberships SET active = true");
      await pool.query("UPDATE party_memberships SET active = true");

      const tokens = {
        alice: await fetchToken("alice"), bob: await fetchToken("bob"), casey: await fetchToken("casey"), eve: await fetchToken("eve"),
      };
      for (const principal of Object.keys(tokens) as Principal[]) {
        const directClient = await openSpikeClient({ name:`direct-${principal}-${runId}`, runtimeDirectory, endpoint:powerSyncEndpoint, commandEndpoint, token:tokens[principal] });
        clients.push(directClient);
        const secret = directClient.testReplicaSecret(); assert.ok(secret);
        directReplicaByToken.set(tokens[principal], secret); replicaCredentialById.set(secret.replicaId, secret.credential);
      }

      const privilegeRows = await pool.query<{ role: string; resource_update: boolean; receipt_insert: boolean; clock_advance: boolean; retention_run: boolean; database_temp: boolean }>(
        `SELECT role,
           has_column_privilege(role, 'resources', 'payload', 'UPDATE') AS resource_update,
           has_table_privilege(role, 'ps8_command_receipts', 'INSERT') AS receipt_insert,
           has_function_privilege(role, 'ps8_test_set_time(timestamptz)', 'EXECUTE') AS clock_advance,
           has_function_privilege(role, 'ps8_run_retention()', 'EXECUTE') AS retention_run,
           has_database_privilege(role, current_database(), 'TEMP') AS database_temp
         FROM unnest(ARRAY['ps8_replication','ps8_storage','ps8_token_reader','ps8_command_writer']) role`,
      );
      for (const row of privilegeRows.rows.filter((row) => row.role !== "ps8_command_writer")) {
        assert.equal(row.resource_update, false, `${row.role} can update resources`);
        assert.equal(row.receipt_insert, false, `${row.role} can insert receipts`);
      }
      for (const row of privilegeRows.rows) {
        assert.equal(row.clock_advance, false, `${row.role} can advance the test clock`);
        assert.equal(row.retention_run, false, `${row.role} can run retention maintenance`);
      }
      assert.deepEqual(privilegeRows.rows.find((row) => row.role === "ps8_command_writer"), {
        role: "ps8_command_writer", resource_update: true, receipt_insert: true,
        clock_advance: false, retention_run: false, database_temp: false,
      });
      assert.equal(privilegeRows.rows.find((row) => row.role === "ps8_storage")?.database_temp, true);
      assert.ok(privilegeRows.rows.filter((row) => row.role !== "ps8_storage").every((row) => row.database_temp === false));

      const floorBeforeTempProbe = Number((await pool.query("SELECT retained_graveyard_floor FROM ps8_retention_state WHERE singleton")).rows[0].retained_graveyard_floor);
      const writerPool = new pg.Pool({ connectionString: commandDatabaseUrl, max: 1, connectionTimeoutMillis: 5_000, query_timeout: 5_000, statement_timeout: 5_000 });
      try {
        await assert.rejects(
          writerPool.query("CREATE TEMP TABLE ps8_retention_state (singleton boolean, effective_now timestamptz)"),
          /permission denied.*temporary|permission denied.*database/i,
        );
        await writerPool.query("SET search_path = pg_temp, public");
        assert.equal(
          (await writerPool.query("SELECT ps8_now() AS effective_now")).rows[0].effective_now.toISOString(),
          "2026-01-01T00:00:00.000Z",
        );
      } finally {
        await writerPool.end();
      }
      assert.equal(Number((await pool.query("SELECT retained_graveyard_floor FROM ps8_retention_state WHERE singleton")).rows[0].retained_graveyard_floor), floorBeforeTempProbe);

      const probeCommand = { commandId: randomUUID(), type: "ps8.resource.update.v1", resourceId: ids.resources.sharedOne, expectedRecordVersion: 1, payload: "not-applied" };
      assert.equal((await commandRequest(undefined, commandBody(probeCommand))).status, 401);
      assert.equal((await commandRequest(await fetchToken("alice", "expired"), commandBody(probeCommand))).status, 401);
      assert.equal((await commandRequest(await fetchToken("alice", "wrong-audience"), commandBody(probeCommand))).status, 401);
      assert.equal((await commandRequest(tamperJwtSignature(tokens.alice), commandBody(probeCommand))).status, 401);
      const basicResponse = await fetch(`${commandEndpoint}/spike/commands`, { method: "POST", headers: { authorization: authorization("alice", credentials.alice), "content-type": "application/json" }, body: JSON.stringify(commandBody(probeCommand)), signal: AbortSignal.timeout(5_000) });
      assert.equal(basicResponse.status, 401);

      const actorInjection = await commandRequest(tokens.alice, { ...commandBody(probeCommand), actorId: ids.users.alice });
      assert.equal(actorInjection.status, 400);
      const nestedScope = await commandRequest(tokens.alice, { ...commandBody(probeCommand), commands: [{ ...probeCommand, workspaceId: ids.workspaces.one }] });
      assert.equal(nestedScope.status, 400);
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM ps8_command_receipts")).rows[0].count), 0);

      for (const [token, resourceId] of [
        [tokens.eve, ids.resources.sharedOne],
        [tokens.bob, ids.resources.aliceOnlySameWorkspaceJourney],
        [tokens.alice, ids.resources.bravoPrivate],
      ] as const) {
        const denied = await commandRequest(token, commandBody({ ...probeCommand, commandId: randomUUID(), resourceId }));
        assert.equal(denied.status, 403);
      }
      await pool.query("UPDATE party_memberships SET active = false WHERE user_id = $1 AND party_id = $2", [ids.users.casey, ids.parties.alpha]);
      assert.equal((await commandRequest(tokens.casey, commandBody({ ...probeCommand, commandId: randomUUID(), resourceId: ids.resources.alphaPrivate }))).status, 403);
      await pool.query("UPDATE party_memberships SET active = true WHERE user_id = $1 AND party_id = $2", [ids.users.casey, ids.parties.alpha]);
      const deniedSetupReceipts = await pool.query("SELECT result_state, result_code FROM ps8_command_receipts ORDER BY command_id");
      assert.equal(deniedSetupReceipts.rows.length, 4);
      assert.ok(deniedSetupReceipts.rows.every((row) => row.result_state === "denied" && row.result_code === "command_denied"));
      await pool.query("TRUNCATE ps8_command_change_events, ps8_command_receipts");

      const resourceLocker = await pool.connect();
      try {
        await resourceLocker.query("BEGIN");
        await resourceLocker.query("SELECT id FROM resources WHERE id = $1 FOR UPDATE", [ids.resources.aliceOnlySameWorkspaceJourney]);
        const deniedWhileLocked = await commandRequest(tokens.bob, commandBody({ ...probeCommand, commandId: randomUUID(), resourceId: ids.resources.aliceOnlySameWorkspaceJourney }));
        assert.equal(deniedWhileLocked.status, 403, "unauthorized request waited for or acquired a resource lock");
      } finally {
        await resourceLocker.query("ROLLBACK");
        resourceLocker.release();
      }

      const raceCommand = { commandId: randomUUID(), type: "ps8.resource.update.v1" as const, resourceId: ids.resources.sharedTwo, expectedRecordVersion: 1, payload: "M3A_AUTHORIZATION_WINS_BEFORE_REVOCATION" };
      const raceRequest = commandRequest(tokens.eve, commandBody(raceCommand), { "x-ps8-fault": "authorization-barrier", "x-ps8-fault-secret": faultSecret });
      await pollUntil("authorization barrier reached", () => testControl(`barriers/${raceCommand.commandId}`), (body) => body.reached === true, 10_000, 50);
      let revocationError: unknown;
      const revocation = pool.query("/* ps8-race-revocation */ UPDATE journey_memberships SET active = false WHERE user_id = $1 AND journey_id = $2", [ids.users.eve, ids.journeys.two])
        .catch((error: unknown) => { revocationError = error; });
      await pollUntil(
        "revocation waits on active grant lock",
        () => pool.query<{ wait_event_type: string | null }>("SELECT wait_event_type FROM pg_stat_activity WHERE query LIKE '%ps8-race-revocation%' AND pid <> pg_backend_pid() AND state = 'active'"),
        (result) => result.rows.some((row) => row.wait_event_type === "Lock"),
        10_000,
        50,
      );
      await testControl(`barriers/${raceCommand.commandId}/release`, "POST");
      assert.equal((await raceRequest).status, 200);
      await revocation;
      if (revocationError) throw revocationError;
      const racedResource = await pool.query("SELECT payload, version FROM resources WHERE id = $1", [raceCommand.resourceId]);
      assert.deepEqual({ payload: racedResource.rows[0].payload, version: Number(racedResource.rows[0].version) }, { payload: raceCommand.payload, version: 2 });
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM sync_grants WHERE user_id = $1 AND resource_id = $2 AND user_active AND workspace_active AND journey_active AND party_active", [ids.users.eve, raceCommand.resourceId])).rows[0].count), 0);
      const afterRevocation = await commandRequest(tokens.eve, commandBody({ ...raceCommand, commandId: randomUUID(), expectedRecordVersion: 2, payload: "M3A_MUST_NOT_COMMIT_AFTER_REVOCATION" }));
      assert.equal(afterRevocation.status, 403);
      await pool.query("UPDATE journey_memberships SET active = true WHERE user_id = $1 AND journey_id = $2", [ids.users.eve, ids.journeys.two]);

      const retentionRaceCommand = {
        commandId: randomUUID(), type: "ps8.resource.update.v1" as const,
        resourceId: ids.resources.sharedTwo, expectedRecordVersion: 2,
        payload: "M3B_RETENTION_LOCK_ORDER",
      };
      const retentionRaceRequest = commandRequest(tokens.eve, commandBody(retentionRaceCommand), {
        "x-ps8-fault": "authorization-barrier", "x-ps8-fault-secret": faultSecret,
      });
      await pollUntil("retention race authorization barrier", () => testControl(`barriers/${retentionRaceCommand.commandId}`), (body) => body.reached === true, 10_000, 50);
      let retentionRaceError: unknown;
      const retentionRace = pool.query("/* ps8-race-retention */ SELECT * FROM ps8_run_retention()")
        .catch((error: unknown) => { retentionRaceError = error; });
      await pollUntil(
        "retention waits on active grant lock",
        () => pool.query<{ wait_event_type: string | null }>("SELECT wait_event_type FROM pg_stat_activity WHERE query LIKE '%ps8-race-retention%' AND pid <> pg_backend_pid() AND state = 'active'"),
        (result) => result.rows.some((row) => row.wait_event_type === "Lock"),
        10_000,
        50,
      );
      await testControl(`barriers/${retentionRaceCommand.commandId}/release`, "POST");
      assert.equal((await retentionRaceRequest).status, 200);
      await retentionRace;
      if (retentionRaceError) throw retentionRaceError;
      assert.deepEqual(
        (await pool.query("SELECT payload, version FROM resources WHERE id = $1", [retentionRaceCommand.resourceId])).rows.map((row) => ({ payload: row.payload, version: Number(row.version) })),
        [{ payload: retentionRaceCommand.payload, version: 3 }],
      );

      const retryClient = await openSpikeClient({ name: `command-retry-${runId}`, runtimeDirectory, endpoint: powerSyncEndpoint, commandEndpoint, token: tokens.alice, uploadFault: { mode: "post-commit-drop", secret: faultSecret } });
      clients.push(retryClient);
      const retryReplica = rememberReplica(retryClient);
      const retryCommand = { commandId: randomUUID(), type: "ps8.resource.update.v1" as const, resourceId: ids.resources.sharedOne, expectedRecordVersion: 1, payload: "M3A_RETRY_RESULT" };
      await retryClient.queueCommands([retryCommand]);
      const retryResult = await waitForResult(retryClient, retryCommand.commandId);
      assert.equal(retryResult.state, "applied");
      assert.equal(retryResult.result_code, "already_applied");
      assert.ok(retryResult.attempt_number >= 2);
      await pollUntil("retry canonical convergence", () => retryClient.readRawResources(), (rows) => rows.some((row) => row.id === retryCommand.resourceId && row.version === 2 && row.payload === "M3A_RETRY_RESULT"), 30_000, 100);
      assert.equal(retryClient.uploadQueueCount instanceof Function, true);
      await pollUntil("retry queue completion", () => retryClient.uploadQueueCount(), (count) => count === 0, 10_000, 100);
      const retryCounts = await pool.query("SELECT (SELECT count(*) FROM ps8_command_receipts WHERE command_id = $1) receipts, (SELECT count(*) FROM ps8_command_change_events WHERE command_id = $1) events, (SELECT version FROM resources WHERE id = $2) version", [retryCommand.commandId, retryCommand.resourceId]);
      assert.deepEqual({ receipts: Number(retryCounts.rows[0].receipts), events: Number(retryCounts.rows[0].events), version: Number(retryCounts.rows[0].version) }, { receipts: 1, events: 1, version: 2 });

      const exactReplay = await commandRequest(tokens.alice, commandBody(retryCommand, retryReplica));
      assert.equal(exactReplay.status, 200);
      assert.equal(((exactReplay.body.results as Array<Record<string, unknown>>)[0]?.code), "already_applied");
      for (const changed of [
        { ...retryCommand, payload: "M3A_CHANGED_REPLAY" },
        { ...retryCommand, expectedRecordVersion: 2 },
        { ...retryCommand, type: "ps8.resource.soft_delete.v1", payload: undefined },
      ]) {
        const changedReplay = await commandRequest(tokens.alice, commandBody(changed, retryReplica));
        assert.equal(changedReplay.status, 409);
        assert.equal(changedReplay.body.error, "idempotency_conflict");
      }

      const revokedRetryClient = await openSpikeClient({
        name: `revoked-post-commit-retry-${runId}`, runtimeDirectory, endpoint: powerSyncEndpoint,
        commandEndpoint, token: tokens.eve,
        uploadFault: { mode: "post-commit-drop-barrier", secret: faultSecret },
      });
      clients.push(revokedRetryClient);
      const revokedRetryReplica = rememberReplica(revokedRetryClient);
      const postCommitRevocationCommand = {
        commandId: randomUUID(), type: "ps8.resource.update.v1" as const,
        resourceId: ids.resources.sharedTwo, expectedRecordVersion: 3,
        payload: "M3B_APPLIED_BEFORE_RETRY_REVOCATION",
      };
      await revokedRetryClient.queueCommands([postCommitRevocationCommand]);
      await pollUntil("post-commit drop barrier", () => testControl(`barriers/${postCommitRevocationCommand.commandId}`), (body) => body.reached === true, 10_000, 50);
      const appliedBeforeRevocation = await pool.query(
        "SELECT result_state, result_code, digest FROM ps8_command_receipts WHERE user_id = $1 AND command_id = $2",
        [ids.users.eve, postCommitRevocationCommand.commandId],
      );
      assert.deepEqual(
        { state: appliedBeforeRevocation.rows[0]?.result_state, code: appliedBeforeRevocation.rows[0]?.result_code },
        { state: "applied", code: "applied" },
      );
      await pool.query("UPDATE journey_memberships SET active = false WHERE user_id = $1 AND journey_id = $2", [ids.users.eve, ids.journeys.two]);
      await testControl(`barriers/${postCommitRevocationCommand.commandId}/release`, "POST");
      const postCommitRevokedResult = await waitForResult(revokedRetryClient, postCommitRevocationCommand.commandId);
      assert.deepEqual(
        { state: postCommitRevokedResult.state, code: postCommitRevokedResult.result_code },
        { state: "denied", code: "command_denied" },
      );
      await pollUntil("post-commit revoked retry queue completion", () => revokedRetryClient.uploadQueueCount(), (count) => count === 0, 10_000, 100);
      const immutableAppliedReceipt = await pool.query(
        "SELECT result_state, result_code, digest FROM ps8_command_receipts WHERE user_id = $1 AND command_id = $2",
        [ids.users.eve, postCommitRevocationCommand.commandId],
      );
      assert.deepEqual(immutableAppliedReceipt.rows[0], appliedBeforeRevocation.rows[0], "derived denial mutated the durable applied receipt");
      const changedRevokedReplay = await commandRequest(tokens.eve, commandBody({ ...postCommitRevocationCommand, payload: "M3B_CHANGED_REVOKED_REPLAY" }, revokedRetryReplica));
      assert.equal(changedRevokedReplay.status, 409);
      assert.equal(changedRevokedReplay.body.error, "idempotency_conflict");
      assert.deepEqual(
        (await pool.query("SELECT payload, version FROM resources WHERE id = $1", [postCommitRevocationCommand.resourceId])).rows.map((row) => ({ payload: row.payload, version: Number(row.version) })),
        [{ payload: postCommitRevocationCommand.payload, version: 4 }],
      );
      revokedRetryClient.setUploadFault(undefined);
      await pool.query("UPDATE journey_memberships SET active = true WHERE user_id = $1 AND journey_id = $2", [ids.users.eve, ids.journeys.two]);
      await pollUntil("post-commit retry grant restored", () => revokedRetryClient.readRawResources(), (rows) => rows.some((row) => row.id === postCommitRevocationCommand.resourceId && row.version === 4), 30_000, 100);
      const postCommitLaterProgress = {
        commandId: randomUUID(), type: "ps8.resource.update.v1" as const,
        resourceId: ids.resources.sharedTwo, expectedRecordVersion: 4,
        payload: "M3B_AFTER_REVOKED_RETRY",
      };
      await revokedRetryClient.queueCommands([postCommitLaterProgress]);
      assert.equal((await waitForResult(revokedRetryClient, postCommitLaterProgress.commandId)).state, "applied");
      await pollUntil("post-commit retry later progress", () => revokedRetryClient.uploadQueueCount(), (count) => count === 0, 10_000, 100);

      const idempotencyClient = await openSpikeClient({ name: `idempotency-${runId}`, runtimeDirectory, endpoint: powerSyncEndpoint, commandEndpoint, token: tokens.alice });
      clients.push(idempotencyClient);
      await idempotencyClient.queueCommands([{ ...retryCommand, payload: "M3A_CHANGED_REPLAY" }]);
      const idempotencyResult = await waitForResult(idempotencyClient, retryCommand.commandId);
      assert.deepEqual({ state: idempotencyResult.state, code: idempotencyResult.result_code }, { state: "failed", code: "idempotency_conflict" });
      await pollUntil("idempotency terminal queue completion", () => idempotencyClient.uploadQueueCount(), (count) => count === 0, 10_000, 100);
      assert.ok(!(await idempotencyClient.readOptimisticResources()).some((row) => row.id === retryCommand.commandId));
      const idempotencyProgress = { commandId: randomUUID(), type: "ps8.resource.update.v1" as const, resourceId: ids.resources.aliceOnlySameWorkspaceJourney, expectedRecordVersion: 1, payload: "M3A_AFTER_IDEMPOTENCY_CONFLICT" };
      await idempotencyClient.queueCommands([idempotencyProgress]);
      assert.equal((await waitForResult(idempotencyClient, idempotencyProgress.commandId)).state, "applied");

      const conflictClient = await openSpikeClient({ name: `command-conflict-${runId}`, runtimeDirectory, endpoint: powerSyncEndpoint, commandEndpoint, token: tokens.alice });
      clients.push(conflictClient);
      const staleCommand = { commandId: randomUUID(), type: "ps8.resource.update.v1" as const, resourceId: ids.resources.sharedOne, expectedRecordVersion: 1, payload: "M3A_STALE" };
      await conflictClient.queueCommands([staleCommand]);
      const staleResult = await waitForResult(conflictClient, staleCommand.commandId);
      assert.equal(staleResult.state, "conflict");
      assert.equal(staleResult.current_version, 2);
      await pollUntil("conflict queue completion", () => conflictClient.uploadQueueCount(), (count) => count === 0, 10_000, 100);

      const competingAlice = await openSpikeClient({ name: `competing-alice-${runId}`, runtimeDirectory, endpoint: powerSyncEndpoint, commandEndpoint, token: tokens.alice });
      const competingCasey = await openSpikeClient({ name: `competing-casey-${runId}`, runtimeDirectory, endpoint: powerSyncEndpoint, commandEndpoint, token: tokens.casey });
      clients.push(competingAlice, competingCasey);
      const competingCommands = [
        { commandId: randomUUID(), type: "ps8.resource.update.v1" as const, resourceId: ids.resources.alphaPrivate, expectedRecordVersion: 1, payload: "M3A_CONCURRENT_A" },
        { commandId: randomUUID(), type: "ps8.resource.update.v1" as const, resourceId: ids.resources.alphaPrivate, expectedRecordVersion: 1, payload: "M3A_CONCURRENT_B" },
      ] as const;
      await Promise.all([competingAlice.queueCommands([competingCommands[0]]), competingCasey.queueCommands([competingCommands[1]])]);
      const competingResults = await Promise.all([waitForResult(competingAlice, competingCommands[0].commandId), waitForResult(competingCasey, competingCommands[1].commandId)]);
      assert.deepEqual(competingResults.map((result) => result.state).sort(), ["applied", "conflict"]);
      const competingCanonical = await pool.query("SELECT payload, version FROM resources WHERE id = $1", [ids.resources.alphaPrivate]);
      assert.equal(Number(competingCanonical.rows[0].version), 2);
      assert.ok(["M3A_CONCURRENT_A", "M3A_CONCURRENT_B"].includes(competingCanonical.rows[0].payload));

      const preCommitClient = await openSpikeClient({ name: `precommit-${runId}`, runtimeDirectory, endpoint: powerSyncEndpoint, commandEndpoint, token: tokens.bob, uploadFault: { mode: "pre-commit-hold", secret: faultSecret } });
      clients.push(preCommitClient);
      const preCommitCommand = { commandId: randomUUID(), type: "ps8.resource.update.v1" as const, resourceId: ids.resources.bravoPrivate, expectedRecordVersion: 1, payload: "M3A_MUST_NOT_APPLY" };
      await preCommitClient.queueCommands([preCommitCommand]);
      await waitForAttempt(preCommitCommand.commandId);
      assert.ok((await preCommitClient.uploadQueueCount()) > 0);
      assert.ok((await preCommitClient.readOptimisticResources()).some((row) => row.id === preCommitCommand.commandId));
      assert.ok(!(await preCommitClient.readCommandResults()).some((row) => row.id === preCommitCommand.commandId));
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM ps8_command_receipts WHERE command_id = $1", [preCommitCommand.commandId])).rows[0].count), 0);

      await pool.query("UPDATE journey_memberships SET active = false WHERE user_id = $1 AND journey_id = $2", [ids.users.bob, ids.journeys.one]);
      const deniedClient = await openSpikeClient({ name: `denied-${runId}`, runtimeDirectory, endpoint: powerSyncEndpoint, commandEndpoint, token: tokens.bob });
      clients.push(deniedClient);
      const deniedReplica = rememberReplica(deniedClient);
      const deniedCommand = { commandId: randomUUID(), type: "ps8.resource.update.v1" as const, resourceId: ids.resources.bravoPrivate, resourceIncarnationId: resourceIncarnations[ids.resources.bravoPrivate]!, expectedRecordVersion: 1, payload: "M3A_DENIED_MUST_NOT_APPLY" };
      await deniedClient.queueCommands([deniedCommand]);
      const deniedResult = await waitForResult(deniedClient, deniedCommand.commandId);
      assert.deepEqual({ state: deniedResult.state, code: deniedResult.result_code }, { state: "denied", code: "command_denied" });
      await pollUntil("denied queue completion", () => deniedClient.uploadQueueCount(), (count) => count === 0, 10_000, 100);
      assert.ok(!(await deniedClient.readOptimisticResources()).some((row) => row.id === deniedCommand.commandId));
      const deniedReceipt = await pool.query("SELECT digest, result_state, result_code FROM ps8_command_receipts WHERE user_id = $1 AND command_id = $2", [ids.users.bob, deniedCommand.commandId]);
      assert.deepEqual({ state: deniedReceipt.rows[0]?.result_state, code: deniedReceipt.rows[0]?.result_code }, { state: "denied", code: "command_denied" });
      await pool.query("UPDATE journey_memberships SET active = true WHERE user_id = $1 AND journey_id = $2", [ids.users.bob, ids.journeys.one]);
      await pollUntil("denied client grant restored", () => deniedClient.readRawResources(), (rows) => rows.some((row) => row.id === ids.resources.bravoPrivate), 30_000, 100);
      const deniedReplay = await commandRequest(tokens.bob, commandBody(deniedCommand, deniedReplica));
      assert.equal(deniedReplay.status, 200);
      assert.equal((deniedReplay.body.results as Array<Record<string, unknown>>)[0]?.state, "denied");
      assert.equal((await pool.query("SELECT payload, version FROM resources WHERE id = $1", [ids.resources.bravoPrivate])).rows[0].payload, "MARKER_PARTY_BRAVO_PRIVATE");
      const afterDeniedCommand = { commandId: randomUUID(), type: "ps8.resource.update.v1" as const, resourceId: ids.resources.bravoPrivate, expectedRecordVersion: 1, payload: "M3A_AFTER_DENIED_REPLAY" };
      await deniedClient.queueCommands([afterDeniedCommand]);
      assert.equal((await waitForResult(deniedClient, afterDeniedCommand.commandId)).state, "applied");

      const deleteClient = await openSpikeClient({ name: `delete-${runId}`, runtimeDirectory, endpoint: powerSyncEndpoint, commandEndpoint, token: tokens.bob });
      clients.push(deleteClient);
      const deleteReplica = rememberReplica(deleteClient);
      const deleteCommand = { commandId: randomUUID(), type: "ps8.resource.soft_delete.v1" as const, resourceId: ids.resources.sharedOne, expectedRecordVersion: 2 };
      await deleteClient.queueCommands([deleteCommand]);
      assert.equal((await waitForResult(deleteClient, deleteCommand.commandId)).state, "applied");
      await pollUntil("tombstone raw convergence", () => deleteClient.readRawResources(), (rows) => rows.some((row) => row.id === ids.resources.sharedOne && row.version === 3 && row.deleted_at !== null), 30_000, 100);
      await pollUntil("cross-client tombstone convergence", () => retryClient.readRawResources(), (rows) => rows.some((row) => row.id === ids.resources.sharedOne && row.version === 3 && row.deleted_at !== null), 30_000, 100);
      assert.ok(!(await deleteClient.readResources()).some((row) => row.id === ids.resources.sharedOne));
      assert.ok(!(await retryClient.readResources()).some((row) => row.id === ids.resources.sharedOne));
      const staleResurrection = { commandId: randomUUID(), type: "ps8.resource.update.v1" as const, resourceId: ids.resources.sharedOne, expectedRecordVersion: 2, payload: "M3A_RESURRECTION" };
      await deleteClient.queueCommands([staleResurrection]);
      assert.equal((await waitForResult(deleteClient, staleResurrection.commandId)).state, "conflict");
      const tombstone = await pool.query("SELECT payload, version, deleted_at IS NOT NULL AS deleted FROM resources WHERE id = $1", [ids.resources.sharedOne]);
      assert.deepEqual({ payload: tombstone.rows[0].payload, version: Number(tombstone.rows[0].version), deleted: tombstone.rows[0].deleted }, { payload: "M3A_RETRY_RESULT", version: 3, deleted: true });

      await pool.query("UPDATE journey_memberships SET active = false WHERE user_id = $1 AND journey_id = $2", [ids.users.bob, ids.journeys.one]);
      await pollUntil("tombstone revoked from Bob", () => deleteClient.readRawResources(), (rows) => !rows.some((row) => row.id === ids.resources.sharedOne), 30_000, 100);
      assert.equal((await commandRequest(tokens.bob, commandBody(deleteCommand, deleteReplica))).status, 403, "revoked replay returned historic receipt");
      await pool.query("UPDATE journey_memberships SET active = true WHERE user_id = $1 AND journey_id = $2", [ids.users.bob, ids.journeys.one]);
      await pollUntil("tombstone restored after grant reactivation", () => deleteClient.readRawResources(), (rows) => rows.some((row) => row.id === ids.resources.sharedOne && row.version === 3 && row.deleted_at !== null), 30_000, 100);

      const invalidCrudClient = await openSpikeClient({ name: `invalid-crud-${runId}`, runtimeDirectory, endpoint: powerSyncEndpoint, commandEndpoint, token: tokens.alice });
      clients.push(invalidCrudClient);
      const receiptCountBefore = Number((await pool.query("SELECT count(*) AS count FROM ps8_command_receipts")).rows[0].count);
      await invalidCrudClient.database.execute("UPDATE resources SET payload = ? WHERE id = ?", ["LOCAL_DIRECT_RESOURCE_WRITE", ids.resources.alphaPrivate]);
      await pollUntil("unsupported CRUD remains queued", () => invalidCrudClient.uploadQueueCount(), (count) => count > 0, 5_000, 50);
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM ps8_command_receipts")).rows[0].count), receiptCountBefore);

      const serverCounts = await pool.query("SELECT (SELECT count(*) FROM ps8_command_receipts) receipts, (SELECT count(*) FROM ps8_command_change_events) events");
      const target = path.join(evidenceDirectory, "integration-observations.json");
      const existing = JSON.parse(await readFile(target, "utf8")) as Record<string, unknown>;
      await writeFile(target, `${JSON.stringify({ ...existing, experimentalM3a: {
        status: "executed-uncommitted",
        startedAt,
        commandIds: {
          retry: retryCommand.commandId, staleConflict: staleCommand.commandId,
          authorizationRace: raceCommand.commandId,
          idempotencyConflict: retryCommand.commandId,
          idempotencyLaterProgress: idempotencyProgress.commandId,
          competing: competingCommands.map((entry) => entry.commandId),
          denied: deniedCommand.commandId,
          deniedLaterProgress: afterDeniedCommand.commandId,
          delete: deleteCommand.commandId,
          staleResurrection: staleResurrection.commandId,
        },
        outcomes: {
          postCommitAttempts: retryResult.attempt_number,
          retryReceiptCount: 1, retryEventCount: 1, retryVersion: 2,
          authorizationRaceOrdering: "command-committed-before-revocation",
          postRevocationCommand: "denied",
          idempotencyConflict: idempotencyResult.result_code,
          idempotencyLaterProgress: "applied",
          competingStates: competingResults.map((result) => result.state).sort(),
          denialReceipt: deniedReceipt.rows[0]?.result_code,
          denialReplayAfterRegrant: "denied",
          denialLaterProgress: "applied",
          preCommitOverlayObserved: true,
          terminalOverlaysRemoved: true,
          tombstoneVersion: 3,
          crossClientTombstone: true,
          tombstoneRestoredAfterRegrant: true,
          staleResurrection: "conflict",
          revokedReplay: "denied",
          unsupportedCrudRemainedQueued: true,
          totalReceipts: Number(serverCounts.rows[0].receipts), totalEvents: Number(serverCounts.rows[0].events),
        },
        sanitized: true,
      } }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

      const r1StartedAt = new Date().toISOString();
      const maintenance = async () => {
        const row = (await pool.query("SELECT * FROM ps8_run_retention()")).rows[0];
        return {
          payloadsCleared: Number(row.payloads_cleared),
          markersPurged: Number(row.markers_purged),
          retainedFloor: Number(row.retained_floor),
        };
      };
      const graveyardColumns = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ps8_resource_graveyard' ORDER BY column_name",
      );
      assert.ok(!graveyardColumns.rows.some((row) => row.column_name === "payload"));
      const initialMarker = await pool.query(
        "SELECT resource_incarnation_id, final_version, deletion_sequence, deleted_at FROM ps8_resource_graveyard WHERE resource_id = $1",
        [ids.resources.sharedOne],
      );
      assert.deepEqual({
        incarnation: initialMarker.rows[0]?.resource_incarnation_id,
        finalVersion: Number(initialMarker.rows[0]?.final_version),
        deletionSequence: Number(initialMarker.rows[0]?.deletion_sequence),
      }, {
        incarnation: resourceIncarnations[ids.resources.sharedOne],
        finalVersion: 3,
        deletionSequence: 1,
      });

      await pool.query("SELECT ps8_test_set_time('2026-01-31T00:00:00Z')");
      assert.deepEqual(await maintenance(), { payloadsCleared: 0, markersPurged: 0, retainedFloor: 1 });
      assert.notEqual((await pool.query("SELECT payload FROM resources WHERE id = $1", [ids.resources.sharedOne])).rows[0]?.payload, null);
      await pool.query("SELECT ps8_test_set_time('2026-01-31T00:00:00.000001Z')");
      assert.deepEqual(await maintenance(), { payloadsCleared: 1, markersPurged: 0, retainedFloor: 1 });
      assert.equal((await pool.query("SELECT payload FROM resources WHERE id = $1", [ids.resources.sharedOne])).rows[0]?.payload, null);

      await pool.query("SELECT ps8_test_set_time('2026-04-01T00:00:00Z')");
      assert.deepEqual(await maintenance(), { payloadsCleared: 0, markersPurged: 0, retainedFloor: 1 });
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM ps8_resource_graveyard WHERE resource_id = $1", [ids.resources.sharedOne])).rows[0].count), 1);
      assert.equal((await pool.query("SELECT ps8_replica_reset_required('2026-01-01T00:00:00Z', 1) AS required")).rows[0].required, false);
      const replacementIncarnation = "85555555-5555-4555-8555-555555555501";
      await assert.rejects(
        pool.query(
          `INSERT INTO resources (id, resource_incarnation_id, workspace_id, journey_id, audience, party_id, payload, version)
           VALUES ($1, $2, $3, $4, 'journey', NULL, 'M3B_REUSE_BLOCKED', 3)`,
          [ids.resources.sharedOne, replacementIncarnation, ids.workspaces.one, ids.journeys.one],
        ),
        /retained graveyard|duplicate key/i,
      );

      await pool.query("SELECT ps8_test_set_time('2026-04-01T00:00:00.000001Z')");
      assert.equal((await pool.query("SELECT ps8_replica_reset_required('2026-01-01T00:00:00Z', 1) AS required")).rows[0].required, true);
      assert.deepEqual(await maintenance(), { payloadsCleared: 0, markersPurged: 1, retainedFloor: 2 });
      await pollUntil("expired tombstone leaves connected replica", () => deleteClient.readRawResources(), (rows) => !rows.some((row) => row.id === ids.resources.sharedOne), 30_000, 100);
      const retentionClient = await openSpikeClient({ name:`retention-r1-${runId}`, runtimeDirectory, endpoint:powerSyncEndpoint, commandEndpoint, token:tokens.bob });
      clients.push(retentionClient); const retentionReplica = rememberReplica(retentionClient);
      assert.deepEqual(await maintenance(), { payloadsCleared: 0, markersPurged: 0, retainedFloor: 2 });
      assert.equal((await pool.query("SELECT ps8_replica_reset_required(ps8_now(), 1) AS required")).rows[0].required, true);

      const purgedTargetCommand = {
        commandId: randomUUID(), type: "ps8.resource.update.v1" as const,
        resourceId: ids.resources.sharedOne,
        resourceIncarnationId: resourceIncarnations[ids.resources.sharedOne]!,
        expectedRecordVersion: 3, payload: "M3B_PURGED_TARGET_MUST_NOT_APPLY",
      };
      await retentionClient.queueCommands([purgedTargetCommand]);
      const purgedTargetResult = await waitForResult(retentionClient, purgedTargetCommand.commandId);
      assert.deepEqual(
        { state: purgedTargetResult.state, code: purgedTargetResult.result_code },
        { state: "denied", code: "command_denied" },
      );
      await pollUntil("purged target terminal queue completion", () => retentionClient.uploadQueueCount(), (count) => count === 0, 10_000, 100);
      assert.deepEqual(
        (await pool.query("SELECT result_state, result_code FROM ps8_command_receipts WHERE user_id = $1 AND command_id = $2", [ids.users.bob, purgedTargetCommand.commandId])).rows[0],
        { result_state: "denied", result_code: "command_denied" },
      );

      await pool.query(
        `INSERT INTO resources (id, resource_incarnation_id, workspace_id, journey_id, audience, party_id, payload, version)
         VALUES ($1, $2, $3, $4, 'journey', NULL, 'M3B_REPLACEMENT', 3)`,
        [ids.resources.sharedOne, replacementIncarnation, ids.workspaces.one, ids.journeys.one],
      );
      await pollUntil(
        "replacement incarnation converges",
        () => retentionClient.readRawResources(),
        (rows) => rows.some((row) => row.id === ids.resources.sharedOne && row.resource_incarnation_id === replacementIncarnation && row.version === 3),
        30_000,
        100,
      );
      const oldIncarnationCommand = {
        commandId: randomUUID(), type: "ps8.resource.update.v1" as const,
        resourceId: ids.resources.sharedOne,
        resourceIncarnationId: resourceIncarnations[ids.resources.sharedOne]!,
        expectedRecordVersion: 3, payload: "M3B_OLD_INCARNATION_MUST_NOT_APPLY",
      };
      await retentionClient.queueCommands([oldIncarnationCommand]);
      const oldIncarnationResult = await waitForResult(retentionClient, oldIncarnationCommand.commandId);
      assert.deepEqual(
        { state: oldIncarnationResult.state, code: oldIncarnationResult.result_code, currentVersion: oldIncarnationResult.current_version },
        { state: "conflict", code: "stale_incarnation", currentVersion: 3 },
      );
      await pollUntil("stale incarnation queue completion", () => retentionClient.uploadQueueCount(), (count) => count === 0, 10_000, 100);
      const replacementBeforeProgress = await pool.query("SELECT resource_incarnation_id, version FROM resources WHERE id = $1", [ids.resources.sharedOne]);
      assert.deepEqual({ incarnation: replacementBeforeProgress.rows[0].resource_incarnation_id, version: Number(replacementBeforeProgress.rows[0].version) }, { incarnation: replacementIncarnation, version: 3 });
      const oldIncarnationReplay = await commandRequest(tokens.bob, commandBody(oldIncarnationCommand, retentionReplica));
      assert.equal(oldIncarnationReplay.status, 200);
      assert.equal((oldIncarnationReplay.body.results as Array<Record<string, unknown>>)[0]?.code, "stale_incarnation");
      const changedIncarnationReplay = await commandRequest(tokens.bob, commandBody({ ...oldIncarnationCommand, resourceIncarnationId: replacementIncarnation }, retentionReplica));
      assert.equal(changedIncarnationReplay.status, 409);
      assert.equal(changedIncarnationReplay.body.error, "idempotency_conflict");

      const afterIncarnationConflict = {
        commandId: randomUUID(), type: "ps8.resource.update.v1" as const,
        resourceId: ids.resources.sharedOne, resourceIncarnationId: replacementIncarnation,
        expectedRecordVersion: 3, payload: "M3B_AFTER_INCARNATION_CONFLICT",
      };
      await retentionClient.queueCommands([afterIncarnationConflict]);
      assert.deepEqual(
        { state: (await waitForResult(retentionClient, afterIncarnationConflict.commandId)).state,
          queue: await pollUntil("post-incarnation progress queue completion", () => retentionClient.uploadQueueCount(), (count) => count === 0, 10_000, 100) },
        { state: "applied", queue: 0 },
      );

      await pool.query("SELECT ps8_test_set_graveyard_retention(interval '120 days')");
      const extendedDelete = {
        commandId: randomUUID(), type: "ps8.resource.soft_delete.v1" as const,
        resourceId: ids.resources.bravoPrivate,
        resourceIncarnationId: resourceIncarnations[ids.resources.bravoPrivate]!,
        expectedRecordVersion: 2,
      };
      await retentionClient.queueCommands([extendedDelete]);
      assert.equal((await waitForResult(retentionClient, extendedDelete.commandId)).state, "applied");
      const extendedMarker = await pool.query("SELECT deletion_sequence, deleted_at FROM ps8_resource_graveyard WHERE resource_id = $1", [ids.resources.bravoPrivate]);
      const extendedSequence = Number(extendedMarker.rows[0].deletion_sequence);
      const markerTime = "(SELECT deleted_at FROM ps8_resource_graveyard WHERE resource_id = $1)";

      await pool.query(`SELECT ps8_test_set_time(${markerTime} + interval '90 days')`, [ids.resources.bravoPrivate]);
      const exactExtended90 = await maintenance();
      assert.equal(exactExtended90.markersPurged, 0);
      assert.equal((await pool.query(`SELECT ps8_replica_reset_required(${markerTime}, $2) AS required`, [ids.resources.bravoPrivate, extendedSequence])).rows[0].required, false);
      await pool.query(`SELECT ps8_test_set_time(${markerTime} + interval '90 days 1 microsecond')`, [ids.resources.bravoPrivate]);
      assert.equal((await pool.query(`SELECT ps8_replica_reset_required(${markerTime}, $2) AS required`, [ids.resources.bravoPrivate, extendedSequence])).rows[0].required, true);
      assert.equal((await maintenance()).markersPurged, 0);
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM ps8_resource_graveyard WHERE resource_id = $1", [ids.resources.bravoPrivate])).rows[0].count), 1);
      await pool.query(`SELECT ps8_test_set_time(${markerTime} + interval '120 days')`, [ids.resources.bravoPrivate]);
      assert.equal((await maintenance()).markersPurged, 0);
      await pool.query(`SELECT ps8_test_set_time(${markerTime} + interval '120 days 1 microsecond')`, [ids.resources.bravoPrivate]);
      const extendedPurge = await maintenance();
      assert.deepEqual({ markersPurged: extendedPurge.markersPurged, retainedFloor: extendedPurge.retainedFloor }, { markersPurged: 1, retainedFloor: extendedSequence + 1 });
      assert.deepEqual(await maintenance(), { payloadsCleared: 0, markersPurged: 0, retainedFloor: extendedSequence + 1 });

      // Exercise the formerly inverted path directly through the limited writer:
      // resource row -> graveyard trigger -> serialized state counter. Retention
      // purges another marker concurrently, then waits on state without holding a
      // lock the writer needs, so both transactions must complete without deadlock.
      const expiredRaceResource = randomUUID();
      const expiredRaceIncarnation = randomUUID();
      const limitedWriterResource = randomUUID();
      const limitedWriterIncarnation = randomUUID();
      for (const [resourceId, incarnationId, payload] of [
        [expiredRaceResource, expiredRaceIncarnation, "M3B_EXPIRED_RACE_MARKER"],
        [limitedWriterResource, limitedWriterIncarnation, "M3B_LIMITED_WRITER_SOFT_DELETE"],
      ] as const) {
        await pool.query(
          `INSERT INTO resources (id, resource_incarnation_id, workspace_id, journey_id, audience, party_id, payload, version)
           VALUES ($1, $2, $3, $4, 'journey', NULL, $5, 1)`,
          [resourceId, incarnationId, ids.workspaces.one, ids.journeys.one, payload],
        );
      }
      await pool.query("UPDATE resources SET deleted_at = ps8_now(), version = 2 WHERE id = $1", [expiredRaceResource]);
      await pool.query(
        "UPDATE ps8_resource_graveyard SET deleted_at = ps8_now() - interval '120 days 1 microsecond' WHERE resource_id = $1",
        [expiredRaceResource],
      );

      const directWriterPool = new pg.Pool({
        connectionString: commandDatabaseUrl, max: 1, connectionTimeoutMillis: 5_000,
        query_timeout: 5_000, statement_timeout: 5_000,
      });
      const directWriter = await directWriterPool.connect();
      let directWriterCommitted = false;
      let directRetentionError: unknown;
      let directRetentionResult: pg.QueryResult | undefined;
      try {
        await directWriter.query("BEGIN");
        await directWriter.query(
          "/* ps8-limited-writer-soft-delete */ UPDATE resources SET deleted_at = ps8_now(), version = version + 1 WHERE id = $1",
          [limitedWriterResource],
        );
        const directRetention = pool.query("/* ps8-race-direct-soft-delete-retention */ SELECT * FROM ps8_run_retention()")
          .then((result) => { directRetentionResult = result; })
          .catch((error: unknown) => { directRetentionError = error; });
        await pollUntil(
          "retention waits for limited-writer state allocation",
          () => pool.query<{ wait_event_type: string | null }>(
            "SELECT wait_event_type FROM pg_stat_activity WHERE query LIKE '%ps8-race-direct-soft-delete-retention%' AND pid <> pg_backend_pid() AND state = 'active'",
          ),
          (result) => result.rows.some((row) => row.wait_event_type === "Lock"),
          5_000,
          25,
        );
        await directWriter.query("COMMIT");
        directWriterCommitted = true;
        await directRetention;
        if (directRetentionError) throw directRetentionError;
        assert.ok(directRetentionResult);
        assert.equal(Number(directRetentionResult.rows[0].markers_purged), 1);
      } finally {
        if (!directWriterCommitted) await directWriter.query("ROLLBACK").catch(() => undefined);
        directWriter.release();
        await directWriterPool.end();
      }
      const directMarker = await pool.query(
        "SELECT deletion_sequence FROM ps8_resource_graveyard WHERE resource_id = $1",
        [limitedWriterResource],
      );
      const directMarkerSequence = Number(directMarker.rows[0].deletion_sequence);
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM ps8_resource_graveyard WHERE resource_id = $1", [expiredRaceResource])).rows[0].count), 0);
      assert.equal(Number((await pool.query("SELECT retained_graveyard_floor FROM ps8_retention_state WHERE singleton")).rows[0].retained_graveyard_floor), directMarkerSequence);
      assert.equal((await pool.query("SELECT deleted_at IS NOT NULL AS deleted FROM resources WHERE id = $1", [limitedWriterResource])).rows[0].deleted, true);
      await pool.query(
        "UPDATE ps8_resource_graveyard SET deleted_at = ps8_now() - interval '120 days 1 microsecond' WHERE resource_id = $1",
        [limitedWriterResource],
      );
      assert.deepEqual(
        { markersPurged: (await maintenance()).markersPurged,
          retainedFloor: Number((await pool.query("SELECT retained_graveyard_floor FROM ps8_retention_state WHERE singleton")).rows[0].retained_graveyard_floor) },
        { markersPurged: 1, retainedFloor: directMarkerSequence + 1 },
      );

      const lowerMarkerResource = randomUUID();
      const higherMarkerResource = randomUUID();
      const lowerMarkerIncarnation = randomUUID();
      const higherMarkerIncarnation = randomUUID();
      for (const [resourceId, incarnationId, payload] of [
        [lowerMarkerResource, lowerMarkerIncarnation, "M3B_LOWER_RETAINED_MARKER"],
        [higherMarkerResource, higherMarkerIncarnation, "M3B_HIGHER_EXPIRED_MARKER"],
      ] as const) {
        await pool.query(
          `INSERT INTO resources (id, resource_incarnation_id, workspace_id, journey_id, audience, party_id, payload, version)
           VALUES ($1, $2, $3, $4, 'journey', NULL, $5, 1)`,
          [resourceId, incarnationId, ids.workspaces.one, ids.journeys.one, payload],
        );
        await pool.query("UPDATE resources SET deleted_at = ps8_now(), version = 2 WHERE id = $1", [resourceId]);
      }
      const sequenceRows = await pool.query<{ resource_id: string; deletion_sequence: string }>(
        "SELECT resource_id, deletion_sequence FROM ps8_resource_graveyard WHERE resource_id = ANY($1::uuid[]) ORDER BY deletion_sequence",
        [[lowerMarkerResource, higherMarkerResource]],
      );
      const sequenceByResource = new Map(sequenceRows.rows.map((row) => [row.resource_id, Number(row.deletion_sequence)]));
      const lowerSequence = sequenceByResource.get(lowerMarkerResource)!;
      const higherSequence = sequenceByResource.get(higherMarkerResource)!;
      assert.ok(lowerSequence < higherSequence);
      await pool.query(
        "UPDATE ps8_resource_graveyard SET deleted_at = ps8_now() - interval '120 days 1 microsecond' WHERE resource_id = $1",
        [higherMarkerResource],
      );
      const outOfOrderPurge = await maintenance();
      assert.deepEqual(
        { markersPurged: outOfOrderPurge.markersPurged, retainedFloor: outOfOrderPurge.retainedFloor },
        { markersPurged: 1, retainedFloor: lowerSequence },
      );
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM ps8_resource_graveyard WHERE resource_id = $1", [lowerMarkerResource])).rows[0].count), 1);
      await pool.query("SELECT ps8_test_set_time(ps8_now() + interval '120 days')");
      assert.equal((await maintenance()).markersPurged, 0);
      await pool.query("SELECT ps8_test_set_time(ps8_now() + interval '1 microsecond')");
      const lowerMarkerPurge = await maintenance();
      assert.deepEqual(
        { markersPurged: lowerMarkerPurge.markersPurged, retainedFloor: lowerMarkerPurge.retainedFloor },
        { markersPurged: 1, retainedFloor: higherSequence + 1 },
      );

      const r2StartedAt = new Date().toISOString();

      // Registration returns one server-generated 256-bit credential. Only its
      // digest is retained, and every invalid binding has the same response.
      const registration = await registerTestReplica(tokens.alice);
      assert.match(registration.credential, /^r2_[A-Za-z0-9_-]{43}$/);
      assert.equal(Buffer.from(registration.credential.slice(3), "base64url").length, 32);
      const registrationRow = await pool.query<{ credential_digest: string }>(
        "SELECT credential_digest FROM ps8_replicas WHERE replica_id = $1",
        [registration.replicaId],
      );
      assert.equal(registrationRow.rows[0]?.credential_digest, createHash("sha256").update(registration.credential).digest("hex"));
      assert.notEqual(registrationRow.rows[0]?.credential_digest, registration.credential);
      assert.equal(Number((await pool.query(
        "SELECT count(*) AS count FROM ps8_replicas AS replica WHERE row_to_json(replica)::text LIKE '%' || $1 || '%'",
        [registration.credential],
      )).rows[0].count), 0);

      const disabled = await registerTestReplica(tokens.alice);
      await pool.query("UPDATE ps8_replicas SET disabled_at = ps8_now() WHERE replica_id = $1", [disabled.replicaId]);
      const unknownReplica = { replicaId: randomUUID(), replicaEpoch: 1, credential: `r2_${randomBytes(32).toString("base64url")}` };
      const invalidReplicaResponses = await Promise.all([
        replicaRequest(tokens.alice, "challenge", { replicaId: registration.replicaId, replicaEpoch: 1 }, registration, `r2_${randomBytes(32).toString("base64url")}`),
        replicaRequest(tokens.bob, "challenge", { replicaId: registration.replicaId, replicaEpoch: 1 }, registration),
        replicaRequest(tokens.alice, "challenge", { replicaId: registration.replicaId, replicaEpoch: 2 }, registration),
        replicaRequest(tokens.alice, "challenge", { replicaId: disabled.replicaId, replicaEpoch: 1 }, disabled),
        replicaRequest(tokens.alice, "challenge", { replicaId: unknownReplica.replicaId, replicaEpoch: 1 }, unknownReplica),
      ]);
      for (const candidate of invalidReplicaResponses) {
        assert.deepEqual(candidate, { status: 403, body: { error: "invalid_replica" } });
      }

      const firstChallenge = await replicaRequest(tokens.alice, "challenge", { replicaId: registration.replicaId, replicaEpoch: 1 }, registration);
      assert.equal(firstChallenge.status, 201);
      assert.equal(firstChallenge.body.checkpointProof, "client-observed-not-server-attested");
      const replacementChallenge = await replicaRequest(tokens.alice, "challenge", { replicaId: registration.replicaId, replicaEpoch: 1 }, registration);
      assert.equal(replacementChallenge.status, 201);
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM ps8_replica_challenges WHERE replica_id=$1", [registration.replicaId])).rows[0].count), 1);
      assert.deepEqual(
        await replicaRequest(tokens.alice, "ack", { replicaId:registration.replicaId, replicaEpoch:1, challengeId:firstChallenge.body.challengeId }, registration),
        { status: 409, body: { error: "checkpoint_ack_rejected" } },
      );
      const firstAckBody = { replicaId: registration.replicaId, replicaEpoch: 1, challengeId: replacementChallenge.body.challengeId };
      assert.equal((await replicaRequest(tokens.alice, "ack", firstAckBody, registration)).status, 200);
      assert.deepEqual(await replicaRequest(tokens.alice, "ack", firstAckBody, registration), { status: 409, body: { error: "checkpoint_ack_rejected" } });

      const expiring = await registerTestReplica(tokens.alice);
      const expiringChallenge = await replicaRequest(tokens.alice, "challenge", { replicaId: expiring.replicaId, replicaEpoch: 1 }, expiring);
      assert.equal(expiringChallenge.status, 201);
      await pool.query("SELECT ps8_test_set_time(ps8_now() + interval '5 minutes 1 microsecond')");
      assert.deepEqual(
        await replicaRequest(tokens.alice, "ack", { replicaId: expiring.replicaId, replicaEpoch: 1, challengeId: expiringChallenge.body.challengeId }, expiring),
        { status: 409, body: { error: "checkpoint_ack_rejected" } },
      );
      assert.deepEqual(
        await replicaRequest(tokens.alice, "ack", { replicaId: registration.replicaId, replicaEpoch: 2, challengeId: firstChallenge.body.challengeId }, registration),
        { status: 403, body: { error: "invalid_replica" } },
      );

      const belowFloor = await registerTestReplica(tokens.alice);
      const belowFloorChallenge = await replicaRequest(tokens.alice, "challenge", { replicaId: belowFloor.replicaId, replicaEpoch: 1 }, belowFloor);
      const floorResource = randomUUID();
      await pool.query(
        `INSERT INTO resources (id, resource_incarnation_id, workspace_id, journey_id, audience, party_id, payload, version)
         VALUES ($1, $2, $3, $4, 'journey', NULL, 'M3B_R2_FLOOR', 1)`,
        [floorResource, randomUUID(), ids.workspaces.one, ids.journeys.one],
      );
      await pool.query("UPDATE resources SET deleted_at = ps8_now(), version = 2 WHERE id = $1", [floorResource]);
      await pool.query("UPDATE ps8_resource_graveyard SET deleted_at = ps8_now() - interval '120 days 1 microsecond' WHERE resource_id = $1", [floorResource]);
      assert.equal((await maintenance()).markersPurged, 1);
      assert.deepEqual(
        await replicaRequest(tokens.alice, "ack", { replicaId: belowFloor.replicaId, replicaEpoch: 1, challengeId: belowFloorChallenge.body.challengeId }, belowFloor),
        { status: 409, body: { error: "checkpoint_ack_rejected" } },
      );

      // Two current replicas prove exact P90D acceptance, +1 microsecond
      // rejection and per-replica rather than global epoch rotation.
      const r2Resource = randomUUID();
      const r2Incarnation = randomUUID();
      await pool.query(
        `INSERT INTO resources (id, resource_incarnation_id, workspace_id, journey_id, audience, party_id, payload, version)
         VALUES ($1, $2, $3, $4, 'journey', NULL, 'M3B_R2_COMMAND', 1)`,
        [r2Resource, r2Incarnation, ids.workspaces.one, ids.journeys.one],
      );
      const r2AClient = await openSpikeClient({ name: `r2-a-${runId}`, runtimeDirectory, endpoint: powerSyncEndpoint, commandEndpoint, token: tokens.alice });
      const r2BClient = await openSpikeClient({ name: `r2-b-${runId}`, runtimeDirectory, endpoint: powerSyncEndpoint, commandEndpoint, token: tokens.alice });
      clients.push(r2AClient, r2BClient);
      const r2A = rememberReplica(r2AClient);
      const r2B = rememberReplica(r2BClient);
      const aAckTime = "(SELECT last_client_observed_ack_at FROM ps8_replicas WHERE replica_id = $1)";
      await pool.query(`SELECT ps8_test_set_time(${aAckTime} + interval '90 days')`, [r2A.replicaId]);
      await challengeAndAck(tokens.alice, r2B);
      const exactP90Command = { commandId: randomUUID(), type: "ps8.resource.update.v1", resourceId: r2Resource, resourceIncarnationId: r2Incarnation, expectedRecordVersion: 1, payload: "M3B_R2_EXACT_P90" };
      assert.equal((await commandRequest(tokens.alice, commandBody(exactP90Command, r2A))).status, 200);
      await pool.query(`SELECT ps8_test_set_time(${aAckTime} + interval '90 days 1 microsecond')`, [r2A.replicaId]);
      const r2StaleCommand = { ...exactP90Command, commandId: randomUUID(), expectedRecordVersion: 2, payload: "M3B_R2_STALE_MUST_NOT_APPLY" };
      const beforeStale = await pool.query(
        "SELECT version, payload, (SELECT count(*) FROM ps8_command_receipts WHERE command_id=$2) receipts, (SELECT count(*) FROM ps8_command_change_events WHERE command_id=$2) events FROM resources WHERE id=$1",
        [r2Resource, r2StaleCommand.commandId],
      );
      assert.deepEqual(await commandRequest(tokens.alice, commandBody(r2StaleCommand, r2A)), { status: 428, body: { error: "replica_reset_required" } });
      const afterStale = await pool.query(
        "SELECT version, payload, (SELECT count(*) FROM ps8_command_receipts WHERE command_id=$2) receipts, (SELECT count(*) FROM ps8_command_change_events WHERE command_id=$2) events FROM resources WHERE id=$1",
        [r2Resource, r2StaleCommand.commandId],
      );
      assert.deepEqual(afterStale.rows[0], beforeStale.rows[0]);
      const bCurrentCommand = { ...r2StaleCommand, commandId: randomUUID(), payload: "M3B_R2_B_REMAINS_CURRENT" };
      assert.equal((await commandRequest(tokens.alice, commandBody(bCurrentCommand, r2B))).status, 200);

      const resetARequestId = randomUUID();
      const resetABody = { replicaId: r2A.replicaId, replicaEpoch: r2A.replicaEpoch, resetRequestId:resetARequestId };
      const resetAResponse = await replicaRequest(tokens.alice, "reset", resetABody, r2A);
      assert.equal(resetAResponse.status, 200);
      const resetAReplay = await replicaRequest(tokens.alice, "reset", resetABody, r2A);
      assert.deepEqual(resetAReplay, resetAResponse);
      const r2AAfterReset = resetAResponse.body as unknown as TestReplicaSession;
      assert.deepEqual({ id: r2AAfterReset.replicaId, epoch: r2AAfterReset.replicaEpoch }, { id: r2A.replicaId, epoch: 2 });
      assert.notEqual(r2AAfterReset.credential, r2A.credential);
      assert.deepEqual(
        await replicaRequest(tokens.alice, "reset", { ...resetABody, resetRequestId:randomUUID() }, r2A),
        { status:403, body:{ error:"invalid_replica" } },
      );
      assert.equal((await replicaRequest(tokens.alice, "reset/ack", { replicaId:r2AAfterReset.replicaId, replicaEpoch:r2AAfterReset.replicaEpoch, resetRequestId:resetARequestId }, r2AAfterReset)).status, 200);
      assert.equal((await replicaRequest(tokens.alice, "reset/ack", { replicaId:r2AAfterReset.replicaId, replicaEpoch:r2AAfterReset.replicaEpoch, resetRequestId:resetARequestId }, r2AAfterReset)).status, 200);
      assert.deepEqual(
        await commandRequest(tokens.alice, commandBody({ ...r2StaleCommand, commandId: randomUUID(), expectedRecordVersion: 3 }, r2A), { "x-ps8-replica-credential": r2A.credential }),
        { status: 403, body: { error: "invalid_replica" } },
      );
      assert.equal((await commandRequest(tokens.alice, commandBody({ ...r2StaleCommand, commandId: randomUUID(), expectedRecordVersion: 3, payload: "M3B_R2_B_AFTER_A_RESET" }, r2B))).status, 200);
      replicaCredentialById.set(r2AAfterReset.replicaId, r2AAfterReset.credential);
      await challengeAndAck(tokens.alice, r2AAfterReset);
      await pool.query("SELECT ps8_test_set_time((SELECT last_client_observed_ack_at FROM ps8_replicas WHERE replica_id=$1) + interval '90 days 1 microsecond')", [r2AAfterReset.replicaId]);
      const r2RaceCommand = { ...r2StaleCommand, commandId: randomUUID(), expectedRecordVersion: 4, payload: "M3B_R2_RESET_RACE_MUST_NOT_APPLY" };
      const raceResetRequestId = randomUUID();
      const [raceUpload, raceReset] = await Promise.all([
        commandRequest(tokens.alice, commandBody(r2RaceCommand, r2AAfterReset)),
        replicaRequest(tokens.alice, "reset", { replicaId: r2AAfterReset.replicaId, replicaEpoch: r2AAfterReset.replicaEpoch, resetRequestId:raceResetRequestId }, r2AAfterReset),
      ]);
      assert.equal(raceReset.status, 200);
      const raceResetSession = raceReset.body as unknown as TestReplicaSession;
      assert.equal((await replicaRequest(tokens.alice, "reset/ack", { replicaId:raceResetSession.replicaId, replicaEpoch:raceResetSession.replicaEpoch, resetRequestId:raceResetRequestId }, raceResetSession)).status, 200);
      assert.ok(raceUpload.status === 403 || raceUpload.status === 428);
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM ps8_command_receipts WHERE command_id=$1", [r2RaceCommand.commandId])).rows[0].count), 0);
      assert.equal((await pool.query("SELECT payload FROM resources WHERE id=$1", [r2Resource])).rows[0].payload, "M3B_R2_B_AFTER_A_RESET");

      // Honest-client reset uses only public PowerSync lifecycle methods. The
      // application sidecar is logical plaintext quarantine (mode 0600), not
      // encryption or forensic deletion evidence.
      await pool.query("UPDATE party_memberships SET active=true WHERE user_id=$1 AND party_id=$2", [ids.users.alice, ids.parties.alpha]);
      const quarantineResources = {
        authorized: { id: randomUUID(), incarnation: randomUUID(), audience: "journey", party: null, payload: "M3B_R2_Q_AUTH" },
        revoked: { id: randomUUID(), incarnation: randomUUID(), audience: "party", party: ids.parties.alpha, payload: "M3B_R2_Q_REVOKED" },
        replaced: { id: randomUUID(), incarnation: randomUUID(), audience: "journey", party: null, payload: "M3B_R2_Q_REPLACED" },
      } as const;
      for (const resource of Object.values(quarantineResources)) {
        await pool.query(
          `INSERT INTO resources (id,resource_incarnation_id,workspace_id,journey_id,audience,party_id,payload,version) VALUES ($1,$2,$3,$4,$5,$6,$7,1)`,
          [resource.id, resource.incarnation, ids.workspaces.one, ids.journeys.one, resource.audience, resource.party, resource.payload],
        );
      }
      const resetClientName = `r2-quarantine-${runId}`;
      let resetClient = await openSpikeClient({ name: resetClientName, runtimeDirectory, endpoint: powerSyncEndpoint, commandEndpoint, token: tokens.alice, uploadFault: { mode: "pre-commit-hold", secret: faultSecret } });
      clients.push(resetClient);
      assert.equal((await stat(resetClient.applicationStateSidecarPath())).mode & 0o777, 0o600);
      assert.equal((await stat(path.dirname(resetClient.applicationStateSidecarPath()))).mode & 0o777, 0o700);
      const resetSession = rememberReplica(resetClient);
      const quarantineCommands = Object.entries(quarantineResources).map(([key, resource]) => ({
        key, commandId: randomUUID(), type: "ps8.resource.update.v1" as const, resourceId: resource.id,
        resourceIncarnationId: resource.incarnation, expectedRecordVersion: 1, payload: `M3B_R2_PENDING_${key.toUpperCase()}`,
      }));
      await resetClient.queueCommands([quarantineCommands[0]!]);
      await waitForAttempt(quarantineCommands[0]!.commandId);
      await resetClient.queueCommands([quarantineCommands[1]!]);
      await resetClient.queueCommands([quarantineCommands[2]!]);
      await pollUntil("three pending reset commands", () => resetClient.uploadQueueCount(), (count) => count === 3, 10_000, 50);
      await pool.query("SELECT ps8_test_set_time((SELECT last_client_observed_ack_at FROM ps8_replicas WHERE replica_id=$1) + interval '90 days 1 microsecond')", [resetSession.replicaId]);
      resetClient.setUploadFault(undefined);
      await pollUntil("client receives reset required", async () => resetClient.resetRequired(), (value) => value, 15_000, 50);
      assert.equal(await resetClient.uploadQueueCount(), 3);
      assert.equal((await resetClient.readOptimisticResources()).length, 3);
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM ps8_command_receipts WHERE command_id=ANY($1::uuid[])", [quarantineCommands.map((command) => command.commandId)])).rows[0].count), 0);

      const replacementAfterReset = randomUUID();
      await assert.rejects(
        resetClient.performReplicaReset({
          resetPostCommitDropSecret: faultSecret,
          async afterQuarantineWritten(sidecarPath) {
            assert.equal((await stat(sidecarPath)).mode & 0o777, 0o600);
            const sidecar = await readFile(sidecarPath, "utf8");
            assert.ok(!sidecar.includes(resetSession.credential));
            await pool.query("UPDATE party_memberships SET active=false WHERE user_id=$1 AND party_id=$2", [ids.users.alice, ids.parties.alpha]);
            await pool.query("DELETE FROM resources WHERE id=$1", [quarantineResources.replaced.id]);
            await pool.query(
              `INSERT INTO resources (id,resource_incarnation_id,workspace_id,journey_id,audience,party_id,payload,version) VALUES ($1,$2,$3,$4,'journey',NULL,'M3B_R2_REPLACEMENT',1)`,
              [quarantineResources.replaced.id, replacementAfterReset, ids.workspaces.one, ids.journeys.one],
            );
          },
          async afterSessionPersisted(resetPath) {
            assert.equal((await stat(resetPath)).mode & 0o777, 0o600);
            throw new Error("injected failure after session persistence");
          },
        }),
        /injected failure after session persistence/,
      );
      assert.equal(await resetClient.uploadQueueCount(), 3);
      assert.equal((await resetClient.readOptimisticResources()).length, 3);
      assert.equal((await readdir(path.dirname(resetClient.quarantineSidecarPath()))).filter((entry) => entry.endsWith(".tmp")).length, 0);
      await assert.rejects(
        resetClient.performReplicaReset({ async afterClear(resetPath) {
          assert.equal((await stat(resetPath)).mode & 0o777, 0o600);
          throw new Error("injected failure after destructive clear");
        } }),
        /injected failure after destructive clear/,
      );
      assert.deepEqual(
        await replicaRequest(tokens.alice, "challenge", { replicaId:resetSession.replicaId, replicaEpoch:resetSession.replicaEpoch }, resetSession),
        { status:403, body:{ error:"invalid_replica" } },
      );
      assert.equal((await readdir(path.dirname(resetClient.quarantineSidecarPath()))).filter((entry) => entry.endsWith(".tmp")).length, 0);
      await resetClient.performReplicaReset();
      const recoveredResetSession = resetClient.testReplicaSecret()!;
      assert.equal(recoveredResetSession.replicaId, resetSession.replicaId);
      assert.equal(recoveredResetSession.replicaEpoch, resetSession.replicaEpoch + 1);
      assert.notEqual(recoveredResetSession.credential, resetSession.credential);
      const recoveredServerState = (await pool.query<{ previous_credential_digest:string|null; staged_reset_request_id:string|null; plaintext_count:string }>(
        `SELECT previous_credential_digest, staged_reset_request_id,
          (SELECT count(*) FROM ps8_replicas AS candidate WHERE row_to_json(candidate)::text LIKE '%' || $2 || '%') AS plaintext_count
          FROM ps8_replicas WHERE replica_id=$1`, [resetSession.replicaId, recoveredResetSession.credential])).rows[0]!;
      assert.deepEqual(recoveredServerState, { previous_credential_digest:null, staged_reset_request_id:null, plaintext_count:"0" });
      assert.equal((await readdir(path.dirname(resetClient.quarantineSidecarPath()))).filter((entry) => entry.endsWith(".tmp") || entry.endsWith(".reset.json")).length, 0);
      const quarantine = await resetClient.readQuarantinedCommands();
      assert.equal(quarantine.length, 3, `unexpected quarantine resources: ${JSON.stringify(quarantine.map((entry) => entry.resource_id))}`);
      const quarantineByResource = new Map(quarantine.map((entry) => [entry.resource_id, entry]));
      assert.deepEqual(
        { state: quarantineByResource.get(quarantineCommands[0]!.resourceId)?.state, exportable: quarantineByResource.get(quarantineCommands[0]!.resourceId)?.exportable, payload: quarantineByResource.get(quarantineCommands[0]!.resourceId)?.payload },
        { state: "pending_review", exportable: 1, payload: quarantineCommands[0]!.payload },
      );
      for (const command of quarantineCommands.slice(1)) {
        assert.deepEqual(
          { state: quarantineByResource.get(command.resourceId)?.state, exportable: quarantineByResource.get(command.resourceId)?.exportable, payload: quarantineByResource.get(command.resourceId)?.payload },
          { state: "invalidated", exportable: 0, payload: null },
        );
      }
      assert.equal(await resetClient.uploadQueueCount(), 0);
      assert.equal((await resetClient.readOptimisticResources()).length, 0);
      assert.equal((await resetClient.replicaSession())?.resetCount, 1);
      assert.equal((await stat(resetClient.quarantineSidecarPath())).mode & 0o777, 0o600);
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM ps8_command_receipts WHERE command_id=ANY($1::uuid[])", [quarantineCommands.map((command) => command.commandId)])).rows[0].count), 0);
      assert.deepEqual(
        (await pool.query("SELECT id,payload,version FROM resources WHERE id=ANY($1::uuid[]) ORDER BY id", [Object.values(quarantineResources).map((resource) => resource.id)])).rows.map((row) => ({ id: row.id, payload: row.payload, version: Number(row.version) })),
        [
          { id: quarantineResources.authorized.id, payload: quarantineResources.authorized.payload, version: 1 },
          { id: quarantineResources.revoked.id, payload: quarantineResources.revoked.payload, version: 1 },
          { id: quarantineResources.replaced.id, payload: "M3B_R2_REPLACEMENT", version: 1 },
        ].sort((left, right) => left.id.localeCompare(right.id)),
      );
      const postResetReplica = await resetClient.readRawResources();
      assert.ok(postResetReplica.some((row) => row.id === quarantineResources.authorized.id && row.resource_incarnation_id === quarantineResources.authorized.incarnation));
      assert.ok(!postResetReplica.some((row) => row.id === quarantineResources.revoked.id));
      assert.ok(postResetReplica.some((row) => row.id === quarantineResources.replaced.id && row.resource_incarnation_id === replacementAfterReset));
      await pool.query("UPDATE party_memberships SET active=true WHERE user_id=$1 AND party_id=$2", [ids.users.alice, ids.parties.alpha]);

      const r3StartedAt = new Date().toISOString();

      // A second reset discovers application-sidecar crash residue that never
      // reached the public SDK CRUD queue. Full intent survives only when the
      // current grant and resource incarnation still match. Prior quarantine
      // is merged without replacement or automatic eviction.
      const firstResetQuarantine = (await resetClient.readQuarantinedCommands()).map((entry) => ({ ...entry }));
      const orphanResources = {
        authorized:{ id:randomUUID(),incarnation:randomUUID(),audience:"journey",party:null,payload:"M3B_R3_ORPHAN_AUTH_RESOURCE" },
        revoked:{ id:randomUUID(),incarnation:randomUUID(),audience:"party",party:ids.parties.alpha,payload:"M3B_R3_ORPHAN_REVOKED_RESOURCE" },
        replaced:{ id:randomUUID(),incarnation:randomUUID(),audience:"journey",party:null,payload:"M3B_R3_ORPHAN_REPLACED_RESOURCE" },
        trigger:{ id:randomUUID(),incarnation:randomUUID(),audience:"journey",party:null,payload:"M3B_R3_SECOND_RESET_TRIGGER" },
      } as const;
      for (const resource of Object.values(orphanResources)) {
        await pool.query(
          `INSERT INTO resources (id,resource_incarnation_id,workspace_id,journey_id,audience,party_id,payload,version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,1)`,
          [resource.id,resource.incarnation,ids.workspaces.one,ids.journeys.one,resource.audience,resource.party,resource.payload],
        );
      }
      const orphanCommands = (Object.entries(orphanResources).filter(([key]) => key !== "trigger") as Array<
        ["authorized"|"revoked"|"replaced", typeof orphanResources.authorized]
      >).map(([key,resource]) => ({
        key,commandId:randomUUID(),type:"ps8.resource.update.v1" as const,resourceId:resource.id,
        resourceIncarnationId:resource.incarnation,expectedRecordVersion:1,payload:`M3B_R3_ORPHAN_INTENT_${key.toUpperCase()}`,
      }));
      for (const command of orphanCommands) await resetClient.testInjectOrphanOverlay(command);
      assert.equal(await resetClient.uploadQueueCount(),0);
      assert.equal((await resetClient.readOptimisticResources()).length,3);
      const secondResetTrigger = {
        commandId:randomUUID(),type:"ps8.resource.update.v1" as const,resourceId:orphanResources.trigger.id,
        resourceIncarnationId:orphanResources.trigger.incarnation,expectedRecordVersion:1,payload:"M3B_R3_SECOND_RESET_QUEUED",
      };
      resetClient.setUploadFault({ mode:"pre-commit-hold",secret:faultSecret });
      await resetClient.queueCommands([secondResetTrigger]);
      await waitForAttempt(secondResetTrigger.commandId);
      const beforeSecondResetSession = resetClient.testReplicaSecret()!;
      await pool.query("SELECT ps8_test_set_time((SELECT last_client_observed_ack_at FROM ps8_replicas WHERE replica_id=$1) + interval '90 days 1 microsecond')", [beforeSecondResetSession.replicaId]);
      resetClient.setUploadFault(undefined);
      await pollUntil("second reset required",async () => resetClient.resetRequired(),value => value,15_000,25);
      const orphanReplacementIncarnation = randomUUID();
      await resetClient.performReplicaReset({ async afterQuarantineWritten() {
        await pool.query("UPDATE party_memberships SET active=false WHERE user_id=$1 AND party_id=$2", [ids.users.alice,ids.parties.alpha]);
        await pool.query("DELETE FROM resources WHERE id=$1", [orphanResources.replaced.id]);
        await pool.query(
          `INSERT INTO resources (id,resource_incarnation_id,workspace_id,journey_id,audience,party_id,payload,version)
           VALUES ($1,$2,$3,$4,'journey',NULL,'M3B_R3_ORPHAN_REPLACEMENT',1)`,
          [orphanResources.replaced.id,orphanReplacementIncarnation,ids.workspaces.one,ids.journeys.one],
        );
      }});
      const secondResetQuarantine = await resetClient.readQuarantinedCommands();
      assert.equal(secondResetQuarantine.length,firstResetQuarantine.length + 4);
      for (const prior of firstResetQuarantine) {
        assert.deepEqual(secondResetQuarantine.find((entry) => entry.id === prior.id),prior);
      }
      const orphanById = new Map(secondResetQuarantine.map((entry) => [entry.id,entry]));
      const authorizedOrphan = orphanById.get(orphanCommands.find((command) => command.key === "authorized")!.commandId)!;
      assert.deepEqual(
        { state:authorizedOrphan.state,payload:authorizedOrphan.payload,exportable:authorizedOrphan.exportable,
          expected:authorizedOrphan.expected_record_version },
        { state:"pending_review",payload:orphanCommands.find((command) => command.key === "authorized")!.payload,
          exportable:1,expected:1 },
      );
      for (const command of orphanCommands.filter((candidate) => candidate.key !== "authorized")) {
        const invalidated = orphanById.get(command.commandId)!;
        assert.deepEqual({ state:invalidated.state,payload:invalidated.payload,exportable:invalidated.exportable },
          { state:"invalidated",payload:null,exportable:0 });
      }
      assert.equal(await resetClient.uploadQueueCount(),0);
      assert.equal((await resetClient.readOptimisticResources()).length,0);
      await pool.query("UPDATE party_memberships SET active=true WHERE user_id=$1 AND party_id=$2", [ids.users.alice,ids.parties.alpha]);

      // Persisted finalized quarantine is loaded on a new client object. This
      // is not a claim that an unfinished destructive reset can resume across
      // process restart; such pending state fails closed on open.
      clients.splice(clients.indexOf(resetClient),1);
      await resetClient.close();
      resetClient = await openSpikeClient({ name:resetClientName,runtimeDirectory,endpoint:powerSyncEndpoint,commandEndpoint,token:tokens.alice });
      clients.push(resetClient);
      assert.deepEqual(await resetClient.readQuarantinedCommands(),secondResetQuarantine);
      assert.equal((await resetClient.outstandingCapacity()).count,secondResetQuarantine.length);
      const finalizedCollision = secondResetQuarantine.find((entry) => entry.state === "pending_review")!;
      const finalizedCollisionVersion = finalizedCollision.expected_record_version;
      if (finalizedCollisionVersion === null) throw new Error("New R3 quarantine must retain a positive expected version.");
      const beforeFinalizedCollision = await resetClient.outstandingCapacity();
      const finalizedCollisionCommand = {
        commandId:finalizedCollision.id,type:finalizedCollision.command_type as "ps8.resource.update.v1",
        resourceId:finalizedCollision.resource_id,resourceIncarnationId:finalizedCollision.resource_incarnation_id,
        expectedRecordVersion:finalizedCollisionVersion,payload:finalizedCollision.payload ?? "MUST_NOT_REQUEUE",
      };
      await assert.rejects(resetClient.queueCommands([finalizedCollisionCommand]),/command_id_already_active/);
      await assert.rejects(resetClient.testInjectOrphanOverlay(finalizedCollisionCommand),/command_id_already_active/);
      assert.deepEqual(await resetClient.outstandingCapacity(),beforeFinalizedCollision);
      assert.equal(await resetClient.uploadQueueCount(),0);
      assert.deepEqual(await resetClient.readQuarantinedCommands(),secondResetQuarantine);

      // Simulate 58 more crash residues beside seven persisted entries. The
      // resulting N+1 reset is rejected before clear; explicit acknowledgement
      // of one prior item then admits exactly 64 without evicting the rest.
      const bulkOrphans = Array.from({ length:58 },(_,index) => ({
        commandId:randomUUID(),type:"ps8.resource.update.v1" as const,
        resourceId:orphanResources.authorized.id,resourceIncarnationId:orphanResources.authorized.incarnation,
        expectedRecordVersion:1,payload:`M3B_R3_BULK_ORPHAN_${index}`,
      }));
      resetClient.setUploadFault({ mode:"pre-commit-hold",secret:faultSecret });
      await resetClient.queueCommands([bulkOrphans[0]!]);
      await waitForAttempt(bulkOrphans[0]!.commandId);
      for (const command of bulkOrphans.slice(1)) await resetClient.testInjectOrphanOverlay(command,true);
      const beforeCapacityResetSession = resetClient.testReplicaSecret()!;
      await pool.query("SELECT ps8_test_set_time((SELECT last_client_observed_ack_at FROM ps8_replicas WHERE replica_id=$1) + interval '90 days 1 microsecond')", [beforeCapacityResetSession.replicaId]);
      resetClient.setUploadFault(undefined);
      await pollUntil("capacity reset required",async () => resetClient.resetRequired(),value => value,15_000,25);
      const replicaBeforeBlockedReset = await resetClient.readRawResources();
      await assert.rejects(resetClient.performReplicaReset(),/quarantine_capacity_exceeded/);
      assert.equal(await resetClient.uploadQueueCount(),1);
      assert.equal((await resetClient.readOptimisticResources()).length,58);
      assert.deepEqual(await resetClient.readQuarantinedCommands(),secondResetQuarantine);
      assert.deepEqual(await resetClient.readRawResources(),replicaBeforeBlockedReset);
      const acknowledgedQuarantineId = secondResetQuarantine[0]!.id;
      assert.equal(await resetClient.acknowledgeOrDiscardQuarantinedCommand(acknowledgedQuarantineId),true);
      assert.equal(await resetClient.acknowledgeOrDiscardQuarantinedCommand(acknowledgedQuarantineId),false);
      await resetClient.performReplicaReset();
      const exactCombinedQuarantine = await resetClient.readQuarantinedCommands();
      assert.equal(exactCombinedQuarantine.length,spikeCapacityLimits.maxOutstandingCommandsAndResults);
      assert.ok(!exactCombinedQuarantine.some((entry) => entry.id === acknowledgedQuarantineId));
      for (const prior of secondResetQuarantine.filter((entry) => entry.id !== acknowledgedQuarantineId)) {
        assert.deepEqual(exactCombinedQuarantine.find((entry) => entry.id === prior.id),prior);
      }
      assert.equal(await resetClient.uploadQueueCount(),0);
      assert.equal((await resetClient.readOptimisticResources()).length,0);
      assert.equal((await resetClient.outstandingCapacity()).count,spikeCapacityLimits.maxOutstandingCommandsAndResults);

      const r3RetainedTombstone = { id: randomUUID(), incarnation: randomUUID() };
      await pool.query(
        `INSERT INTO resources (id,resource_incarnation_id,workspace_id,journey_id,audience,party_id,payload,version)
         VALUES ($1,$2,$3,$4,'journey',NULL,'M3B_R3_RETAINED_TOMBSTONE',1)`,
        [r3RetainedTombstone.id, r3RetainedTombstone.incarnation, ids.workspaces.one, ids.journeys.one],
      );
      await pool.query("UPDATE resources SET deleted_at=ps8_now(),version=2 WHERE id=$1", [r3RetainedTombstone.id]);
      const graveyardBeforeR3 = Number((await pool.query("SELECT count(*) AS count FROM ps8_resource_graveyard")).rows[0].count);
      assert.ok(graveyardBeforeR3 > 0);

      // Runtime callers cannot bypass the expected-version invariant through
      // TypeScript casts or direct programmatic input. Rejection happens before
      // application-state, SDK-queue or quarantine mutation, and the empty
      // state remains valid when reopened.
      const invalidVersionClientName = `r3-invalid-version-${runId}`;
      const invalidExpectedVersions = [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1];
      const invalidVersionClient = await openSpikeClient({
        name:invalidVersionClientName, runtimeDirectory, endpoint:powerSyncEndpoint,
        commandEndpoint, token:tokens.eve,
      });
      try {
        for (const expectedRecordVersion of invalidExpectedVersions) {
          await assert.rejects(
            invalidVersionClient.queueCommands([{
              commandId:randomUUID(), type:"ps8.resource.update.v1", resourceId:randomUUID(),
              resourceIncarnationId:randomUUID(), expectedRecordVersion, payload:"MUST_NOT_PERSIST",
            }]),
            /expectedRecordVersion must be a positive safe integer/,
          );
        }
        assert.deepEqual(await invalidVersionClient.outstandingCapacity(),{ count:0,bytes:0 });
        assert.equal(await invalidVersionClient.uploadQueueCount(),0);
        assert.deepEqual(await invalidVersionClient.readOptimisticResources(),[]);
        assert.deepEqual(await invalidVersionClient.readCommandResults(),[]);
        assert.deepEqual(await invalidVersionClient.readQuarantinedCommands(),[]);
      } finally {
        await invalidVersionClient.close();
      }
      const reopenedInvalidVersionClient = await openSpikeClient({
        name:invalidVersionClientName, runtimeDirectory, endpoint:powerSyncEndpoint,
        commandEndpoint, token:tokens.eve,
      });
      clients.push(reopenedInvalidVersionClient);
      assert.deepEqual(await reopenedInvalidVersionClient.outstandingCapacity(),{ count:0,bytes:0 });
      assert.equal(await reopenedInvalidVersionClient.uploadQueueCount(),0);
      assert.deepEqual(await reopenedInvalidVersionClient.readOptimisticResources(),[]);
      assert.deepEqual(await reopenedInvalidVersionClient.readCommandResults(),[]);
      assert.deepEqual(await reopenedInvalidVersionClient.readQuarantinedCommands(),[]);

      // Five retryable failures become one explicit terminal local result;
      // the server never mutated, and unrelated later work progresses.
      const retryExhaustionResource = randomUUID();
      const retryExhaustionIncarnation = randomUUID();
      await pool.query(
        `INSERT INTO resources (id,resource_incarnation_id,workspace_id,journey_id,audience,party_id,payload,version)
         VALUES ($1,$2,$3,$4,'journey',NULL,'M3B_R3_RETRY_ORIGINAL',1)`,
        [retryExhaustionResource, retryExhaustionIncarnation, ids.workspaces.one, ids.journeys.one],
      );
      const retryExhaustionClient = await openSpikeClient({
        name: `r3-retry-${runId}`, runtimeDirectory, endpoint: powerSyncEndpoint, commandEndpoint,
        token: tokens.bob, uploadFault: { mode: "pre-commit-500", secret: faultSecret },
      });
      clients.push(retryExhaustionClient);
      const exhaustedCommand = {
        commandId: randomUUID(), type: "ps8.resource.update.v1" as const,
        resourceId: retryExhaustionResource, resourceIncarnationId: retryExhaustionIncarnation,
        expectedRecordVersion: 1, payload: "M3B_R3_MUST_NOT_APPLY",
      };
      await retryExhaustionClient.queueCommands([exhaustedCommand]);
      const exhaustedResult = await waitForResult(retryExhaustionClient, exhaustedCommand.commandId);
      assert.deepEqual(
        { code: exhaustedResult.result_code, attempts: exhaustedResult.attempt_number },
        { code: "retry_exhausted", attempts: 5 },
      );
      assert.deepEqual(
        (await pool.query("SELECT payload,version FROM resources WHERE id=$1", [retryExhaustionResource])).rows[0],
        { payload: "M3B_R3_RETRY_ORIGINAL", version: "1" },
      );
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM ps8_command_receipts WHERE command_id=$1", [exhaustedCommand.commandId])).rows[0].count), 0);
      retryExhaustionClient.setUploadFault(undefined);
      await pollUntil("retry-exhausted SDK completion",() => retryExhaustionClient.resultByteAccounting(exhaustedCommand.commandId),
        value => value?.sdkCompleted === true,5_000,20);
      assert.equal(await retryExhaustionClient.uploadQueueCount(), 0);
      assert.equal(await retryExhaustionClient.acknowledgeCommandResult(exhaustedCommand.commandId), true);
      const retryLaterCommand = { ...exhaustedCommand, commandId: randomUUID(), payload: "M3B_R3_LATER_PROGRESS" };
      await retryExhaustionClient.queueCommands([retryLaterCommand]);
      assert.equal((await waitForResult(retryExhaustionClient, retryLaterCommand.commandId)).result_code, "applied");

      // A terminal result cannot free capacity until the public SDK queue
      // completion succeeds. The injected hold is after result persistence.
      const acknowledgementClient = await openSpikeClient({
        name:`r3-ack-${runId}`,runtimeDirectory,endpoint:powerSyncEndpoint,commandEndpoint,token:tokens.alice,
        uploadFault:{ mode:"post-result-hold",secret:faultSecret },
      });
      clients.push(acknowledgementClient);
      const acknowledgementCommand = { ...retryLaterCommand,commandId:randomUUID(),expectedRecordVersion:2,
        payload:"M3B_R3_ACK_AFTER_SDK_COMPLETE" };
      await acknowledgementClient.queueCommands([acknowledgementCommand]);
      await pollUntil("result persisted before SDK completion",async () => ({
        held:acknowledgementClient.completionIsHeld(),result:(await acknowledgementClient.readCommandResults())[0],
      }),value => value.held && value.result?.id === acknowledgementCommand.commandId,15_000,25);
      assert.equal(await acknowledgementClient.uploadQueueCount(),1);
      assert.equal(await acknowledgementClient.acknowledgeCommandResult(acknowledgementCommand.commandId),false);
      const beforeCompletionAccounting = await acknowledgementClient.resultByteAccounting(acknowledgementCommand.commandId);
      assert.equal(beforeCompletionAccounting?.sdkCompleted,false);
      assert.ok((beforeCompletionAccounting?.actualBytes ?? Infinity) <= (beforeCompletionAccounting?.reservedBytes ?? 0));
      acknowledgementClient.releaseCompletionHold();
      await pollUntil("SDK completion marks result acknowledgeable",async () => ({
        queue:await acknowledgementClient.uploadQueueCount(),accounting:await acknowledgementClient.resultByteAccounting(acknowledgementCommand.commandId),
      }),value => value.queue === 0 && value.accounting?.sdkCompleted === true,15_000,25);
      assert.equal(await acknowledgementClient.acknowledgeCommandResult(acknowledgementCommand.commandId),true);
      assert.equal((await acknowledgementClient.outstandingCapacity()).count,0);

      // The application sidecar counts pending overlays and unresolved terminal
      // results together. Exact 64 is accepted under concurrent callers; the
      // 65th is rejected without SDK/overlay mutation. Acknowledgement frees one.
      const capacityClient = await openSpikeClient({
        name: `r3-capacity-${runId}`, runtimeDirectory, endpoint: powerSyncEndpoint, commandEndpoint,
        token: tokens.bob, uploadFault: { mode: "pre-commit-hold", secret: faultSecret },
      });
      clients.push(capacityClient);
      const capacityReplica = rememberReplica(capacityClient);
      const capacityCommands = Array.from({ length: spikeCapacityLimits.maxOutstandingCommandsAndResults }, () => ({
        commandId: randomUUID(), type: "ps8.resource.update.v1" as const, resourceId: randomUUID(),
        resourceIncarnationId: randomUUID(), expectedRecordVersion: 1, payload: "R3_BOUNDED",
      }));
      await capacityClient.queueCommands([capacityCommands[0]!]);
      const originalOverlay = (await capacityClient.readOptimisticResources())[0]!;
      const originalQueueCount = await capacityClient.uploadQueueCount();
      const originalUsage = await capacityClient.outstandingCapacity();
      await assert.rejects(capacityClient.queueCommands([{ ...capacityCommands[0]!,payload:"R3_DUPLICATE_MUST_NOT_OVERWRITE" }]), /command_id_already_active/);
      assert.deepEqual((await capacityClient.readOptimisticResources())[0],originalOverlay);
      assert.equal(await capacityClient.uploadQueueCount(),originalQueueCount);
      assert.deepEqual(await capacityClient.outstandingCapacity(),originalUsage);
      const concurrentDuplicate = await Promise.allSettled([
        capacityClient.queueCommands([capacityCommands[1]!] ),
        capacityClient.queueCommands([{ ...capacityCommands[1]!,payload:"R3_CONCURRENT_DUPLICATE" }]),
      ]);
      assert.equal(concurrentDuplicate.filter((outcome) => outcome.status === "fulfilled").length,1);
      assert.equal(concurrentDuplicate.filter((outcome) => outcome.status === "rejected" &&
        String(outcome.reason).includes("command_id_already_active")).length,1);
      assert.equal((await capacityClient.readOptimisticResources()).filter((entry) => entry.id === capacityCommands[1]!.commandId).length,1);
      await Promise.all(capacityCommands.slice(2).map((command) => capacityClient.queueCommands([command])));
      const exactCapacityUsage = await capacityClient.outstandingCapacity();
      assert.equal(exactCapacityUsage.count, spikeCapacityLimits.maxOutstandingCommandsAndResults);
      assert.ok(exactCapacityUsage.bytes > 0 && exactCapacityUsage.bytes <= spikeCapacityLimits.maxSerializedOutstandingBytes);
      const plusOneCommand = { ...capacityCommands[0]!, commandId: randomUUID(), resourceId: randomUUID(), resourceIncarnationId: randomUUID() };
      await assert.rejects(capacityClient.queueCommands([plusOneCommand]), /command_capacity_exceeded/);
      assert.equal((await capacityClient.readOptimisticResources()).length, 64);
      capacityClient.setUploadFault(undefined);
      await pollUntil("64 terminal capacity results and completed SDK queue", async () => ({
        results: await capacityClient.readCommandResults(), queue: await capacityClient.uploadQueueCount(),
        first:await capacityClient.resultByteAccounting(capacityCommands[0]!.commandId),
      }), (state) => state.results.length === 64 && state.queue === 0 && state.first?.sdkCompleted === true, 30_000, 50);
      assert.equal((await capacityClient.readCommandResults()).filter((row) => row.state === "denied").length, 64);
      const unresolvedBefore = (await capacityClient.readCommandResults()).find((row) => row.id === capacityCommands[1]!.commandId);
      await assert.rejects(capacityClient.queueCommands([{ ...capacityCommands[1]!,payload:"R3_RESULT_ID_COLLISION" }]), /command_id_already_active/);
      assert.deepEqual((await capacityClient.readCommandResults()).find((row) => row.id === capacityCommands[1]!.commandId),unresolvedBefore);
      assert.equal(await capacityClient.uploadQueueCount(),0);
      await assert.rejects(capacityClient.queueCommands([plusOneCommand]), /command_capacity_exceeded/);
      assert.equal(await capacityClient.acknowledgeCommandResult(capacityCommands[0]!.commandId), true);
      await testControl(`rate/${capacityReplica.replicaId}/reset`, "POST");
      await capacityClient.queueCommands([plusOneCommand]);
      assert.equal((await waitForResult(capacityClient, plusOneCommand.commandId)).result_code, "command_denied");
      assert.equal((await capacityClient.outstandingCapacity()).count, 64);

      // A DB-backed one-row window accepts exactly 64 authenticated command
      // requests, returns 429 before receipt/mutation for +1, then recovers.
      const rateReplica = await registerTestReplica(tokens.eve);
      replicaCredentialById.set(rateReplica.replicaId, rateReplica.credential);
      await challengeAndAck(tokens.eve, rateReplica);
      const invalidRateProbe = { commandId: randomUUID(), type: "ps8.resource.update.v1" as const,
        resourceId: randomUUID(), resourceIncarnationId: randomUUID(), expectedRecordVersion: 1, payload: "R3_INVALID_CREDENTIAL" };
      assert.equal((await commandRequest(tokens.eve, commandBody(invalidRateProbe, rateReplica), {
        "x-ps8-replica-credential": `r2_${randomBytes(32).toString("base64url")}`,
      })).status, 403);
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM ps8_command_rate_windows WHERE replica_id=$1", [rateReplica.replicaId])).rows[0].count), 0);
      for (let index = 0; index < 64; index += 1) {
        const denied = { commandId: randomUUID(), type: "ps8.resource.update.v1" as const,
          resourceId: randomUUID(), resourceIncarnationId: randomUUID(), expectedRecordVersion: 1, payload: "R3_RATE" };
        assert.equal((await commandRequest(tokens.eve, commandBody(denied, rateReplica))).status, 403);
      }
      const ratePlusOne = { commandId: randomUUID(), type: "ps8.resource.update.v1" as const,
        resourceId: randomUUID(), resourceIncarnationId: randomUUID(), expectedRecordVersion: 1, payload: "R3_RATE_PLUS_ONE" };
      assert.deepEqual(await commandRequest(tokens.eve, commandBody(ratePlusOne, rateReplica)), {
        status: 429, body: { error: "command_rate_limited" },
      });
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM ps8_command_receipts WHERE command_id=$1", [ratePlusOne.commandId])).rows[0].count), 0);
      assert.equal(Number((await pool.query("SELECT request_count FROM ps8_command_rate_windows WHERE replica_id=$1", [rateReplica.replicaId])).rows[0].request_count), 64);
      await testControl(`rate/${rateReplica.replicaId}/reset`, "POST");
      assert.equal((await commandRequest(tokens.eve, commandBody(ratePlusOne, rateReplica))).status, 403);

      // Four distinct replicas hold all process-local command slots after
      // authorisation. The fifth receives retryable 503 without a receipt and
      // succeeds after slots are released.
      const concurrencyReplicas: TestReplicaSession[] = [];
      for (let index = 0; index < 5; index += 1) {
        const replica = await registerTestReplica(tokens.casey);
        replicaCredentialById.set(replica.replicaId, replica.credential);
        await challengeAndAck(tokens.casey, replica);
        concurrencyReplicas.push(replica);
      }
      const concurrencyCommands = concurrencyReplicas.map((replica, index) => ({ replica, command: {
        commandId: randomUUID(), type: "ps8.resource.update.v1" as const,
        resourceId: quarantineResources.authorized.id, resourceIncarnationId: quarantineResources.authorized.incarnation,
        expectedRecordVersion: 1, payload: `R3_CONCURRENCY_${index}`,
      }}));
      const heldRequests = concurrencyCommands.slice(0, 4).map(({ replica, command }) =>
        commandRequest(tokens.casey, commandBody(command, replica), { "x-ps8-fault":"authorization-barrier", "x-ps8-fault-secret":faultSecret }));
      for (const { command } of concurrencyCommands.slice(0, 4)) {
        await pollUntil(`R3 concurrency barrier ${command.commandId}`, () => testControl(`barriers/${command.commandId}`), (body) => body.reached === true, 10_000, 25);
      }
      const fifth = concurrencyCommands[4]!;
      assert.deepEqual(await commandRequest(tokens.casey, commandBody(fifth.command, fifth.replica)), {
        status: 503, body: { error: "command_concurrency_backpressure" },
      });
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM ps8_command_receipts WHERE command_id=$1", [fifth.command.commandId])).rows[0].count), 0);
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM ps8_command_rate_windows WHERE replica_id=$1", [fifth.replica.replicaId])).rows[0].count), 0);
      for (const { command } of concurrencyCommands.slice(0, 4)) await testControl(`barriers/${command.commandId}/release`, "POST");
      assert.deepEqual((await Promise.all(heldRequests)).map((result) => result.status), [200, 200, 200, 200]);
      assert.equal((await commandRequest(tokens.casey, commandBody(fifth.command, fifth.replica))).status, 200);
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM ps8_resource_graveyard")).rows[0].count), graveyardBeforeR3);
      assert.deepEqual(
        (await pool.query("SELECT resource_incarnation_id,final_version FROM ps8_resource_graveyard WHERE resource_id=$1", [r3RetainedTombstone.id])).rows[0],
        { resource_incarnation_id: r3RetainedTombstone.incarnation, final_version: "2" },
      );

      const beforeLimit = Number((await pool.query("SELECT count(*) AS count FROM ps8_replicas WHERE user_id=$1", [ids.users.alice])).rows[0].count);
      assert.ok(beforeLimit <= 16);
      for (let index = beforeLimit; index < 16; index += 1) await registerTestReplica(tokens.alice);
      assert.deepEqual(await replicaRequest(tokens.alice, "register", {}), { status:429, body:{ error:"replica_limit_reached" } });
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM ps8_replicas WHERE user_id=$1", [ids.users.alice])).rows[0].count), 16);
      assert.ok(Number((await pool.query(`SELECT COALESCE(max(per_replica),0) AS maximum FROM (
        SELECT count(*) AS per_replica FROM ps8_replica_challenges GROUP BY replica_id, replica_epoch
      ) AS bounded`)).rows[0].maximum) <= 1);

      const withM3a = JSON.parse(await readFile(target, "utf8")) as Record<string, unknown>;
      await writeFile(target, `${JSON.stringify({ ...withM3a, experimentalM3bR1: {
        status: "executed-uncommitted",
        startedAt: r1StartedAt,
        policy: {
          payloadWindow: "P30D", connectedOfflineWindow: "P90D",
          configuredExtendedGraveyardWindow: "P120D", endpointTimeAuthoritative: true,
        },
        commandIds: {
          commandRetentionRace: retentionRaceCommand.commandId,
          postCommitRevokedRetry: postCommitRevocationCommand.commandId,
          postCommitLaterProgress: postCommitLaterProgress.commandId,
          purgedTarget: purgedTargetCommand.commandId,
          staleIncarnation: oldIncarnationCommand.commandId,
          laterProgress: afterIncarnationConflict.commandId,
          extendedRetentionDelete: extendedDelete.commandId,
        },
        outcomes: {
          graveyardContainsPayload: false,
          securityDefinerTempShadowBlocked: true,
          commandRetentionLockOrder: "command-committed-before-retention",
          limitedWriterSoftDeleteRetentionOverlap: "serialized-state-counter-no-deadlock",
          postCommitRevokedRetry: "derived-terminal-denial",
          postCommitAppliedReceiptRemainedImmutable: true,
          postCommitLaterProgress: "applied",
          purgedTargetTerminalDenial: true,
          exactP30DPayloadRetained: true, afterP30DPayloadCleared: true,
          exactP90DMarkerRetained: true, afterP90DMarkerPurged: true,
          reuseWhileRetained: "rejected", replacementIncarnationGeneration: 2,
          staleIncarnation: oldIncarnationResult.result_code,
          staleIncarnationReplay: "terminal", changedReplay: "idempotency_conflict",
          laterQueueProgress: "applied", firstRetainedFloor: 2,
          exactP90DExtendedMarkerRetained: true,
          afterP90DExtendedClientResetRequired: true,
          exactP120DMarkerRetained: true, afterP120DMarkerPurged: true,
          extendedRetentionFloor: extendedSequence + 1,
          outOfOrderHigherMarkerPurgedFirst: true,
          lowerRetainedMarkerNotSkipped: true,
          finalRetainedFloor: higherSequence + 1,
          maintenanceIdempotent: true,
        },
        unvalidated: [
          "trusted-replica-registration-and-checkpoint",
          "restart-and-offline-after-pull",
          "capacity-and-backpressure",
          "encryption-and-native-runtime",
        ],
        sanitized: true,
      } }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

      const withR1 = JSON.parse(await readFile(target, "utf8")) as Record<string, unknown>;
      await writeFile(target, `${JSON.stringify({ ...withR1, experimentalM3bR2: {
        status: "executed-uncommitted",
        startedAt: r2StartedAt,
        replicaCredentialBinding: "server-generated-digest-only",
        epochScope: "per-replica",
        checkpointProof: "client-observed-not-server-attested",
        actualResetAndFullResync: true,
        quarantineEncryption: "not-validated",
        outcomes: {
          registrationSecretBytes: 32,
          plaintextCredentialsPersisted: 0,
          genericInvalidReplicaRejections: invalidReplicaResponses.length,
          challengeReplayCode: "checkpoint_ack_rejected",
          expiredChallengeCode: "checkpoint_ack_rejected",
          belowFloorChallengeCode: "checkpoint_ack_rejected",
          exactP90Command: "applied",
          afterP90CommandHttpStatus: 428,
          staleMutationCount: 0,
          credentialRotations: 3,
          idempotentResetReplayRecoveredExactSession: true,
          postCommitResetResponseDropRecovered: true,
          preClearSessionPersistenceRecovery: true,
          postClearFullResyncRecovery: true,
          oldCredentialRetiredAfterResetAck: true,
          serverPlaintextRotatedCredentialsPersisted: 0,
          replicaLimitPerUser: 16,
          registrationLimitHttpStatus: 429,
          maximumChallengesPerReplicaEpoch: 1,
          payloadBearingTemporaryFilesRetained: 0,
          unaffectedReplicaCommandsApplied: 2,
          resetRaceCommandStatus: raceUpload.status,
          resetRaceMutationCount: 0,
          quarantinedCommands: quarantine.length,
          pendingReviewCommands: quarantine.filter((entry) => entry.state === "pending_review").length,
          invalidatedCommands: quarantine.filter((entry) => entry.state === "invalidated").length,
          autoRequeuedCommands: await resetClient.uploadQueueCount(),
          retainedOverlays: (await resetClient.readOptimisticResources()).length,
          applicationStateSidecarMode: "0600",
          applicationStateParentMode: "0700",
          powerSyncInternalSqlReferences: 0,
          quarantineSidecarMode: "0600",
          quarantineSidecarRetainedForReview: true,
          revokedOrReplacedPayloadsRetained: quarantine.filter((entry) => entry.state === "invalidated" && entry.payload !== null).length,
        },
        unvalidated: [
          "server-attested-powersync-checkpoint-completion",
          "quarantine-encryption-and-forensic-deletion",
          "cross-process-restart-and-offline-after-pull",
          "request-rate-limits-and-command-queue-storm-backpressure",
          "native-runtime",
        ],
        sanitized: true,
      } }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

      const withR2 = JSON.parse(await readFile(target, "utf8")) as Record<string, unknown>;
      await writeFile(target, `${JSON.stringify({ ...withR2, experimentalM3bR3: {
        status: "executed-uncommitted",
        startedAt: r3StartedAt,
        limits: {
          outstandingCommandsAndResults: spikeCapacityLimits.maxOutstandingCommandsAndResults,
          serializedOutstandingBytes: spikeCapacityLimits.maxSerializedOutstandingBytes,
          transientUploadAttempts: spikeCapacityLimits.maxTransientUploadAttempts,
          terminalResultReservationBytes: spikeCapacityLimits.terminalResultReservationBytes,
          applicationStateSchemaVersion: spikeCapacityLimits.applicationStateSchemaVersion,
          concurrentCommandRequests: 4,
          authenticatedCommandRequestsPerReplicaMinute: 64,
        },
        outcomes: {
          exactClientBoundaryAccepted: true,
          clientPlusOneRejected: "command_capacity_exceeded",
          invalidExpectedVersionRejections: invalidExpectedVersions.length,
          invalidExpectedVersionMutationCount: 0,
          invalidExpectedVersionReopenSucceeded: true,
          duplicateAdmissionPreservedOriginalQueueAndOverlay: true,
          concurrentDuplicateAdmissionsRejected: concurrentDuplicate.filter((outcome) => outcome.status === "rejected").length,
          unresolvedResultIdCollisionRejected: true,
          finalizedQuarantineIdCollisionRejected: true,
          orphanOverlayIntentsDiscovered: orphanCommands.length,
          authorizedOrphanPendingReview: authorizedOrphan.state === "pending_review",
          revokedOrReplacedOrphanPayloadsRetained: orphanCommands.filter((command) =>
            command.key !== "authorized" && orphanById.get(command.commandId)?.payload !== null).length,
          priorQuarantinePreservedAcrossSecondReset: firstResetQuarantine.length,
          persistedFinalizedQuarantineLoadedOnOpen: true,
          resetNPlusOneBlockedBeforeClear: true,
          explicitQuarantineAcknowledgementFreedCapacity: true,
          exactCombinedQuarantineAfterRepeatedReset: exactCombinedQuarantine.length,
          minimumQuarantineReservationBytes: spikeCapacityLimits.terminalResultReservationBytes,
          acknowledgementBeforeSdkCompletion: "rejected",
          acknowledgementAfterSdkCompletion: "accepted",
          appliedResultActualBytes: beforeCompletionAccounting?.actualBytes,
          appliedResultReservedBytes: beforeCompletionAccounting?.reservedBytes,
          acknowledgementFreedCapacity: true,
          retryExhaustedAt: exhaustedResult.attempt_number,
          retryExhaustedCode: exhaustedResult.result_code,
          retryLaterProgress: "applied",
          serverExactRateBoundaryAccepted: 64,
          serverPlusOneHttpStatus: 429,
          concurrentSlotsHeld: 4,
          concurrentPlusOneHttpStatus: 503,
          concurrencyRecovery: "accepted",
          rateWindowRowsPerReplica: 1,
          tombstonesPreserved: true,
          graveyardMarkersBefore: graveyardBeforeR3,
          graveyardMarkersAfter: Number((await pool.query("SELECT count(*) AS count FROM ps8_resource_graveyard")).rows[0].count),
          automaticallyEvictedResults: 0,
          automaticallyRequeuedQuarantineCommands: 0,
        },
        unvalidated: [
          "production-sizing-and-multi-node-fairness",
          "distributed-rate-limiter",
          "cross-process-restart-and-offline-after-pull",
          "quarantine-encryption-and-native-runtime",
        ],
        sanitized: true,
      } }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      const retainedObservation = await readFile(target, "utf8");
      assert.ok(!/r2_[A-Za-z0-9_-]{43}/.test(retainedObservation));
      assert.ok(!retainedObservation.includes("R3_BOUNDED"));
      assert.ok(!retainedObservation.includes("R3_RATE"));
    } finally {
      await closeAllAndPool(clients, pool);
    }
  },
);
