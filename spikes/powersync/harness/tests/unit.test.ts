import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { generateKeyPair, jwtVerify, SignJWT } from "jose";
import { assertAuthorizedReplica, pollUntil } from "../src/assertions.js";
import { validateQueuedCrud, waitForInitialSync } from "../src/client.js";
import {
  commandDigest,
  parseCommandEnvelope,
  parseCommandResponse,
} from "../src/command-protocol.js";
import {
  validateEvidenceEntry,
  writeEvidenceEntry,
  type EvidenceEntry,
} from "../src/evidence.js";
import { expectedResources, ids, resourceIncarnations, type Principal } from "../src/fixtures.js";
import { tamperJwtSignature } from "../src/jwt-test.js";
import {
  parseTokenRequest,
  type PrincipalCredentials,
} from "../src/token-policy.js";

const credentials: PrincipalCredentials = Object.fromEntries(
  (Object.keys(ids.users) as Principal[]).map((principal) => [
    principal,
    `${principal}-`.padEnd(40, principal[0]),
  ]),
) as PrincipalCredentials;

function basic(principal: Principal, secret = credentials[principal]): string {
  return `Basic ${Buffer.from(`${principal}:${secret}`).toString("base64")}`;
}

test("token requests authenticate identity and reject identity/scope parameters", () => {
  const accepted = parseTokenRequest(
    new URL("http://token/token"),
    basic("casey"),
    credentials,
  );
  assert.deepEqual(accepted, { principal: "casey", subject: ids.users.casey });

  assert.throws(
    () =>
      parseTokenRequest(
        new URL(`http://token/token?party_id=${ids.parties.charlie}`),
        basic("casey"),
        credentials,
      ),
    /Client-supplied identity or scope is forbidden/,
  );
  assert.throws(
    () =>
      parseTokenRequest(
        new URL("http://token/token?principal=eve&scope=all"),
        basic("alice"),
        credentials,
      ),
    /principal, scope/,
  );
  assert.throws(
    () =>
      parseTokenRequest(
        new URL("http://token/token"),
        basic("eve", credentials.alice),
        credentials,
      ),
    /Invalid test credential/,
  );
  assert.throws(
    () =>
      parseTokenRequest(new URL("http://token/token"), undefined, credentials),
    /Authenticated test principal is required/,
  );
});

test("JWT signature tampering changes decoded bytes and fails local verification", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const token = await new SignJWT({ spike: "issue-8" })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject("synthetic-principal")
    .setAudience("powersync-dev")
    .setExpirationTime("5m")
    .sign(privateKey);
  const tampered = tamperJwtSignature(token);
  const originalSignature = Buffer.from(token.split(".")[2]!, "base64url");
  const tamperedSignature = Buffer.from(tampered.split(".")[2]!, "base64url");

  assert.notDeepEqual(tamperedSignature, originalSignature);
  assert.equal(tamperedSignature.length, originalSignature.length);
  await assert.rejects(
    jwtVerify(tampered, publicKey, { audience: "powersync-dev" }),
    /signature verification failed/i,
  );
});

test("replica assertions require exact IDs and their immutable payload markers", () => {
  const rows = [
    { id: ids.resources.sharedOne, payload: "MARKER_W1_J1_SHARED" },
    { id: ids.resources.alphaPrivate, payload: "MARKER_PARTY_ALPHA_PRIVATE" },
    {
      id: ids.resources.aliceOnlySameWorkspaceJourney,
      payload: "MARKER_W1_SECOND_JOURNEY_ALICE_ONLY",
    },
  ];
  assert.doesNotThrow(() =>
    assertAuthorizedReplica("alice", rows, expectedResources.alice),
  );
  assert.throws(
    () =>
      assertAuthorizedReplica(
        "alice",
        [
          ...rows,
          {
            id: ids.resources.sharedTwo,
            payload: "MARKER_W2_FORBIDDEN_SHARED",
          },
        ],
        expectedResources.alice,
      ),
    /SQLite row IDs differ/,
  );
  assert.throws(
    () =>
      assertAuthorizedReplica(
        "alice",
        [
          rows[0]!,
          rows[1]!,
          {
            id: ids.resources.aliceOnlySameWorkspaceJourney,
            payload: "MARKER_W2_FORBIDDEN_PRIVATE",
          },
        ],
        expectedResources.alice,
      ),
    /payload marker does not match/,
  );
});

test("experimental command protocol rejects authority, batches and mismatched results", () => {
  const command = {
    commandId: "77777777-7777-4777-8777-777777777701",
    type: "ps8.resource.update.v1" as const,
    resourceId: ids.resources.sharedOne,
    resourceIncarnationId: resourceIncarnations[ids.resources.sharedOne]!,
    expectedRecordVersion: 1,
    payload: "bounded replacement",
  };
  const envelope = {
    spikeProtocol: 1,
    deviceId: "telemetry",
    localTransactionId: "correlation",
    commands: [command],
  };
  assert.deepEqual(parseCommandEnvelope(envelope).commands, [command]);
  assert.throws(() => parseCommandEnvelope({ ...envelope, actorId: ids.users.alice }), /authority is forbidden/);
  assert.throws(() => parseCommandEnvelope({ ...envelope, commands: [{ ...command, workspaceId: ids.workspaces.one }] }), /authority is forbidden/);
  assert.throws(() => parseCommandEnvelope({ ...envelope, commands: [command, { ...command, commandId: "77777777-7777-4777-8777-777777777702" }] }), /exactly one command/);
  assert.throws(
    () => parseCommandResponse({ spikeProtocol: 1, results: [{ commandId: command.commandId, resourceId: command.resourceId, digest: "0".repeat(64), state: "applied", code: "applied", previousVersion: 1, currentVersion: 2, attemptNumber: 1 }] }, [command]),
    /digest mismatch/,
  );
  assert.equal(commandDigest(command).length, 64);
  assert.notEqual(
    commandDigest(command),
    commandDigest({ ...command, resourceIncarnationId: "79999999-9999-4999-8999-999999999999" }),
  );
  assert.doesNotThrow(() => parseCommandResponse({ spikeProtocol: 1, results: [{ commandId: command.commandId, resourceId: command.resourceId, digest: commandDigest(command), state: "conflict", code: "stale_incarnation", previousVersion: 1, currentVersion: 1, attemptNumber: 1 }] }, [command]));
});

test("queue CRUD validation accepts only strict insert-only command PUTs", () => {
  const valid = {
    table: "command_queue",
    op: "PUT",
    id: "77777777-7777-4777-8777-777777777703",
    opData: {
      command_type: "ps8.resource.soft_delete.v1",
      command_version: 1,
      resource_id: ids.resources.sharedOne,
      resource_incarnation_id: resourceIncarnations[ids.resources.sharedOne],
      expected_record_version: 1,
      payload: null,
      upload_correlation_id: "test",
    },
  };
  assert.equal(validateQueuedCrud([valid])[0]?.type, "ps8.resource.soft_delete.v1");
  for (const invalid of [
    { ...valid, table: "resources", op: "PUT" },
    { ...valid, table: "resources", op: "PATCH" },
    { ...valid, table: "resources", op: "DELETE", opData: undefined },
    { ...valid, op: "PATCH" },
    { ...valid, opData: { ...valid.opData, actor_id: ids.users.alice } },
  ]) assert.throws(() => validateQueuedCrud([invalid]), /Unsupported local CRUD|Malformed command_queue/);
  assert.throws(() => validateQueuedCrud([valid, { ...valid, id: "77777777-7777-4777-8777-777777777704" }]), /exactly one command/);
});

test("initial sync timeout and false checkpoint both reject", async () => {
  await assert.rejects(
    waitForInitialSync(
      {
        currentStatus: { hasSynced: false },
        waitForFirstSync: ({ signal }) =>
          new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          ),
      },
      10,
    ),
    /timed out/,
  );
  await assert.rejects(
    waitForInitialSync(
      {
        currentStatus: { hasSynced: false },
        waitForFirstSync: async () => undefined,
      },
      100,
    ),
    /without a completed checkpoint/,
  );
});

test("bounded polling rejects a read that exceeds the hard deadline", async () => {
  await assert.rejects(
    pollUntil(
      "slow read",
      () =>
        new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 50)),
      Boolean,
      10,
    ),
    /timed out/,
  );
});

test("evidence states cannot claim execution without executable context", async () => {
  const incomplete = {
    check: "integration",
    state: "executed-uncommitted",
    command: "run",
    executedAt: "2026-08-09T00:00:00Z",
    exitCode: 0,
    platform: "synthetic-test",
    details: "claims execution without run context",
  } as EvidenceEntry;
  assert.throws(() => validateEvidenceEntry(incomplete), /requires run/);

  const directory = await mkdtemp(path.join(os.tmpdir(), "trax-ps8-evidence-"));
  const target = await writeEvidenceEntry(directory, {
    check: "static-policy",
    state: "executed-uncommitted",
    command:
      "cd spikes/powersync/harness && npx --yes npm@10.9.4 run test:unit",
    executedAt: "2026-08-09T00:00:00Z",
    exitCode: 0,
    platform: "synthetic-test",
    details: "Unit policy checks executed on an uncommitted candidate.",
    context: {
      runId: "12345678-1234-4234-8234-123456789abc",
      composeProject: "trax-ps8-test",
      wrapperCommand: "spikes/powersync/scripts/run.sh",
      candidate: {
        revision: "0".repeat(40),
        dirty: true,
        sourceTreeDigest: "1".repeat(64),
        sourceScope: "synthetic executable sources",
      },
    },
  });
  const payload = JSON.parse(await readFile(target, "utf8")) as EvidenceEntry;
  assert.equal(payload.state, "executed-uncommitted");
  assert.equal(payload.context?.runId, "12345678-1234-4234-8234-123456789abc");
});

test("cleanup refuses non-spike, missing and mismatched ownership before Docker", async () => {
  const script = path.resolve("..", "scripts", "clean.sh");
  const invalid = spawnSync(script, [], {
    encoding: "utf8",
    env: {
      ...process.env,
      COMPOSE_PROJECT_NAME: "trax-os-foundation",
      PS8_RUN_ID: "12345678-1234-4234-8234-123456789abc",
    },
  });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Refusing destructive cleanup/);

  const missing = spawnSync(script, [], {
    encoding: "utf8",
    env: {
      ...process.env,
      COMPOSE_PROJECT_NAME: "trax-ps8-safe-test",
      PS8_RUN_ID: "12345678-1234-4234-8234-123456789abc",
      PS8_OWNER_FILE: path.join(os.tmpdir(), "definitely-absent-ps8-owner"),
    },
  });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /ownership marker is absent/);

  const directory = await mkdtemp(path.join(os.tmpdir(), "trax-ps8-owner-"));
  const marker = path.join(directory, "owner");
  await writeFile(
    marker,
    "trax-ps8-other|12345678-1234-4234-8234-123456789abc",
  );
  const mismatch = spawnSync(script, [], {
    encoding: "utf8",
    env: {
      ...process.env,
      COMPOSE_PROJECT_NAME: "trax-ps8-safe-test",
      PS8_RUN_ID: "12345678-1234-4234-8234-123456789abc",
      PS8_OWNER_FILE: marker,
    },
  });
  assert.equal(mismatch.status, 2);
  assert.match(mismatch.stderr, /does not match/);
});
