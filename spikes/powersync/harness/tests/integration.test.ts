import assert from "node:assert/strict";
import { rename, rm, stat, writeFile } from "node:fs/promises";
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
