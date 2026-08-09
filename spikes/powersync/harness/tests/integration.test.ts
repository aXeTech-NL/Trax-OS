import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import {
  assertAuthorizedReplica,
  pollUntil,
  type ReplicaResource,
} from "../src/assertions.js";
import { openSpikeClient, type SpikeClient } from "../src/client.js";
import {
  expectedCaseyAfterAlphaRevocation,
  expectedResources,
  ids,
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

async function commandRequest(token: string | undefined, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${commandEndpoint}/spike/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  return { status: response.status, body: JSON.parse(await response.text()) as Record<string, unknown> };
}

function commandBody(command: { commandId: string; type: string; resourceId: string; expectedRecordVersion: number; payload?: string }) {
  return { spikeProtocol: 1, deviceId: "integration-telemetry", localTransactionId: randomUUID(), commands: [command] };
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

      const privilegeRows = await pool.query<{ role: string; resource_update: boolean; receipt_insert: boolean }>(
        `SELECT role,
           has_column_privilege(role, 'resources', 'payload', 'UPDATE') AS resource_update,
           has_table_privilege(role, 'ps8_command_receipts', 'INSERT') AS receipt_insert
         FROM unnest(ARRAY['ps8_replication','ps8_storage','ps8_token_reader','ps8_command_writer']) role`,
      );
      for (const row of privilegeRows.rows.filter((row) => row.role !== "ps8_command_writer")) {
        assert.equal(row.resource_update, false, `${row.role} can update resources`);
        assert.equal(row.receipt_insert, false, `${row.role} can insert receipts`);
      }
      assert.deepEqual(privilegeRows.rows.find((row) => row.role === "ps8_command_writer"), { role: "ps8_command_writer", resource_update: true, receipt_insert: true });

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

      const retryClient = await openSpikeClient({ name: `command-retry-${runId}`, runtimeDirectory, endpoint: powerSyncEndpoint, commandEndpoint, token: tokens.alice, uploadFault: { mode: "post-commit-drop", secret: faultSecret } });
      clients.push(retryClient);
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

      const exactReplay = await commandRequest(tokens.alice, commandBody(retryCommand));
      assert.equal(exactReplay.status, 200);
      assert.equal(((exactReplay.body.results as Array<Record<string, unknown>>)[0]?.code), "already_applied");
      for (const changed of [
        { ...retryCommand, payload: "M3A_CHANGED_REPLAY" },
        { ...retryCommand, expectedRecordVersion: 2 },
        { ...retryCommand, type: "ps8.resource.soft_delete.v1", payload: undefined },
      ]) {
        const changedReplay = await commandRequest(tokens.alice, commandBody(changed));
        assert.equal(changedReplay.status, 409);
        assert.equal(changedReplay.body.error, "idempotency_conflict");
      }

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

      const preCommitClient = await openSpikeClient({ name: `precommit-${runId}`, runtimeDirectory, endpoint: powerSyncEndpoint, commandEndpoint, token: tokens.bob, uploadFault: { mode: "pre-commit-500", secret: faultSecret } });
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
      const deniedCommand = { commandId: randomUUID(), type: "ps8.resource.update.v1" as const, resourceId: ids.resources.bravoPrivate, expectedRecordVersion: 1, payload: "M3A_DENIED_MUST_NOT_APPLY" };
      await deniedClient.queueCommands([deniedCommand]);
      const deniedResult = await waitForResult(deniedClient, deniedCommand.commandId);
      assert.deepEqual({ state: deniedResult.state, code: deniedResult.result_code }, { state: "denied", code: "command_denied" });
      await pollUntil("denied queue completion", () => deniedClient.uploadQueueCount(), (count) => count === 0, 10_000, 100);
      assert.ok(!(await deniedClient.readOptimisticResources()).some((row) => row.id === deniedCommand.commandId));
      const deniedReceipt = await pool.query("SELECT digest, result_state, result_code FROM ps8_command_receipts WHERE user_id = $1 AND command_id = $2", [ids.users.bob, deniedCommand.commandId]);
      assert.deepEqual({ state: deniedReceipt.rows[0]?.result_state, code: deniedReceipt.rows[0]?.result_code }, { state: "denied", code: "command_denied" });
      await deniedClient.close();
      clients.splice(clients.indexOf(deniedClient), 1);
      await pool.query("UPDATE journey_memberships SET active = true WHERE user_id = $1 AND journey_id = $2", [ids.users.bob, ids.journeys.one]);
      const deniedReplayClient = await openSpikeClient({ name: `denied-replay-${runId}`, runtimeDirectory, endpoint: powerSyncEndpoint, commandEndpoint, token: tokens.bob });
      clients.push(deniedReplayClient);
      await deniedReplayClient.queueCommands([deniedCommand]);
      assert.equal((await waitForResult(deniedReplayClient, deniedCommand.commandId)).state, "denied");
      assert.equal((await pool.query("SELECT payload, version FROM resources WHERE id = $1", [ids.resources.bravoPrivate])).rows[0].payload, "MARKER_PARTY_BRAVO_PRIVATE");
      const afterDeniedCommand = { commandId: randomUUID(), type: "ps8.resource.update.v1" as const, resourceId: ids.resources.bravoPrivate, expectedRecordVersion: 1, payload: "M3A_AFTER_DENIED_REPLAY" };
      await deniedReplayClient.queueCommands([afterDeniedCommand]);
      assert.equal((await waitForResult(deniedReplayClient, afterDeniedCommand.commandId)).state, "applied");

      const deleteClient = await openSpikeClient({ name: `delete-${runId}`, runtimeDirectory, endpoint: powerSyncEndpoint, commandEndpoint, token: tokens.bob });
      clients.push(deleteClient);
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
      assert.equal((await commandRequest(tokens.bob, commandBody(deleteCommand))).status, 403, "revoked replay returned historic receipt");
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
    } finally {
      await closeAllAndPool(clients, pool);
    }
  },
);
