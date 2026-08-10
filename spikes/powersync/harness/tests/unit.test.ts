import assert from "node:assert/strict";
import { chmod, mkdtemp, open, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { generateKeyPair, jwtVerify, SignJWT } from "jose";
import BetterSqlite3 from "better-sqlite3";
import { assertAuthorizedReplica, pollUntil } from "../src/assertions.js";
import {
  ApplicationState,
  AsyncSerialGate,
  assertCombinedOutstandingCapacity,
  assertOutstandingCapacity,
  assertPositiveExpectedRecordVersion,
  assertPrivateRegularFile,
  isReplicaResetRequired,
  mergeFinalizedQuarantine,
  persistQuarantineAcknowledgement,
  parseResetState,
  ReplicaResetRequiredError,
  quarantineEntryReservationBytes,
  readQuarantineStore,
  reservedOutstandingBytes,
  spikeCapacityLimits,
  terminalResultSerializedBytes,
  transientAttemptDecision,
  validateQuarantineResetLink,
  validateQueuedCrud,
  waitForInitialSync,
  writePrivateJsonAtomically,
} from "../src/client.js";
import {
  commandDigest,
  parseCommandEnvelope,
  parseCommandResponse,
  parseReplicaSessionSecret,
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

test("empty durable quarantine sidecars remain resumable", () => {
  assert.doesNotThrow(() => validateQuarantineResetLink(true,0,"quarantined"));
  for (const phase of ["quarantined","session_staged","cleared"] as const) {
    assert.throws(
      () => validateQuarantineResetLink(false,0,phase),
      /reset_state_missing_quarantine_sidecar/,
    );
  }
  assert.throws(
    () => validateQuarantineResetLink(true,1,undefined),
    /pending_quarantine_requires_reset_state/,
  );
});

test("token requests authenticate identity and reject identity\/scope parameters", () => {
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
  const binding = { replicaId: "78888888-8888-4888-8888-888888888888", replicaEpoch: 1 };
  const envelope = {
    spikeProtocol: 1,
    ...binding,
    localTransactionId: "correlation",
    commands: [command],
  };
  assert.deepEqual(parseCommandEnvelope(envelope).commands, [command]);
  assert.throws(() => parseCommandEnvelope({ ...envelope, actorId: ids.users.alice }), /authority is forbidden/);
  assert.throws(() => parseCommandEnvelope({ ...envelope, commands: [{ ...command, workspaceId: ids.workspaces.one }] }), /authority is forbidden/);
  assert.throws(() => parseCommandEnvelope({ ...envelope, commands: [command, { ...command, commandId: "77777777-7777-4777-8777-777777777702" }] }), /exactly one command/);
  assert.throws(
    () => parseCommandResponse({ spikeProtocol: 1, results: [{ commandId: command.commandId, resourceId: command.resourceId, digest: "0".repeat(64), state: "applied", code: "applied", previousVersion: 1, currentVersion: 2, attemptNumber: 1 }] }, [command], binding),
    /digest mismatch/,
  );
  assert.equal(commandDigest(command, binding).length, 64);
  assert.notEqual(commandDigest(command, binding), commandDigest(command, { ...binding, replicaEpoch: 2 }));
  assert.notEqual(
    commandDigest(command, binding),
    commandDigest({ ...command, resourceIncarnationId: "79999999-9999-4999-8999-999999999999" }, binding),
  );
  assert.doesNotThrow(() => parseCommandResponse({ spikeProtocol: 1, results: [{ commandId: command.commandId, resourceId: command.resourceId, digest: commandDigest(command, binding), state: "conflict", code: "stale_incarnation", previousVersion: 1, currentVersion: 1, attemptNumber: 1 }] }, [command], binding));
});

test("replica lifecycle parsing binds a strict one-time secret and typed reset signal", () => {
  const session = {
    replicaId: "78888888-8888-4888-8888-888888888888",
    replicaEpoch: 1,
    credential: `r2_${Buffer.alloc(32, 7).toString("base64url")}`,
  };
  assert.deepEqual(parseReplicaSessionSecret(session), session);
  assert.throws(() => parseReplicaSessionSecret({ ...session, replicaEpoch: 0 }), /positive safe integer/);
  assert.throws(() => parseReplicaSessionSecret({ ...session, credential: `r2_${Buffer.alloc(31).toString("base64url")}` }), /32-byte secret/);
  assert.throws(() => parseReplicaSessionSecret({ ...session, credential: `${session.credential}=`, extra: true }), /unknown fields/);
  const reset = new ReplicaResetRequiredError();
  assert.equal(isReplicaResetRequired(reset), true);
  assert.equal(isReplicaResetRequired(new Error("replica_reset_required")), false);
});

test("capacity gate accepts exact count/bytes, rejects plus one and serializes concurrent callers", async () => {
  assert.doesNotThrow(() => assertOutstandingCapacity(
    spikeCapacityLimits.maxOutstandingCommandsAndResults - 1,
    spikeCapacityLimits.maxSerializedOutstandingBytes - 100,
    100,
  ));
  assert.throws(() => assertOutstandingCapacity(spikeCapacityLimits.maxOutstandingCommandsAndResults, 0, 1), /command_capacity_exceeded/);
  assert.throws(() => assertOutstandingCapacity(0, spikeCapacityLimits.maxSerializedOutstandingBytes - 100, 101), /command_byte_capacity_exceeded/);

  const gate = new AsyncSerialGate();
  let accepted = 0;
  const outcomes = await Promise.allSettled(Array.from({ length: 65 }, () => gate.run(async () => {
    assertOutstandingCapacity(accepted, accepted, 1);
    await Promise.resolve();
    accepted += 1;
  })));
  assert.equal(accepted, 64);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 64);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
});

test("durable attempt policy exhausts at five, excludes 428, and acknowledgement frees capacity", async () => {
  assert.equal(transientAttemptDecision(500, 3), "retry");
  assert.equal(transientAttemptDecision(500, 4), "exhausted");
  assert.equal(transientAttemptDecision(429, 4), "exhausted");
  assert.equal(transientAttemptDecision(428, 99), "reset");
  assert.equal(transientAttemptDecision(409, 4), "terminal");

  const directory = await mkdtemp(path.join(os.tmpdir(), "trax-ps8-capacity-"));
  const state = new ApplicationState(path.join(directory, "state.sqlite"));
  try {
    state.persistResults(Array.from({ length: 64 }, (_, index) => ({
      commandId: `command-${index}`, resourceId: `resource-${index}`, state: "conflict", code: "optimistic_conflict",
      previousVersion: 1, currentVersion: 2, digest: "a".repeat(64), attemptNumber: 1,
    })));
    assert.equal(state.capacityUsage().count, 64);
    assert.throws(() => assertOutstandingCapacity(state.capacityUsage().count, state.capacityUsage().bytes, 1), /command_capacity_exceeded/);
    assert.equal(state.acknowledgeResult("command-0"), false);
    state.markResultsSdkCompleted(Array.from({ length:64 }, (_, index) => `command-${index}`));
    assert.equal(state.acknowledgeResult("command-0"), true);
    assert.equal(state.capacityUsage().count, 63);
    assert.doesNotThrow(() => assertOutstandingCapacity(state.capacityUsage().count, state.capacityUsage().bytes, 1));
  } finally {
    state.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("insert-only overlay admission preserves an existing duplicate and truthful result reservations", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "trax-ps8-overlays-"));
  const state = new ApplicationState(path.join(directory, "state.sqlite"));
  const command = {
    commandId:"duplicate-command", type:"ps8.resource.update.v1" as const, resourceId:"resource-one",
    resourceIncarnationId:"incarnation-one", expectedRecordVersion:1, payload:"ORIGINAL",
    actualSerializedBytes:240, reservedBytes:reservedOutstandingBytes(240),
  };
  try {
    assert.deepEqual(state.addOverlays([command]), [command.commandId]);
    const before = state.readOverlays();
    const usage = state.capacityUsage();
    assert.throws(() => state.addOverlays([{ ...command, payload:"REPLACEMENT" }]), /UNIQUE constraint failed/);
    assert.deepEqual(state.readOverlays(), before);
    assert.deepEqual(state.capacityUsage(), usage);

    for (const code of ["applied", "optimistic_conflict", "command_denied", "retry_exhausted"] as const) {
      const result = { commandId:`result-${code}`, resourceId:"resource", state:code === "applied" ? "applied" : code === "command_denied" ? "denied" : code === "retry_exhausted" ? "failed" : "conflict",
        code, previousVersion:1, currentVersion:2, digest:"a".repeat(64), attemptNumber:5 };
      const actual = terminalResultSerializedBytes(result);
      assert.ok(actual <= spikeCapacityLimits.terminalResultReservationBytes, `${code} exceeded reservation`);
      assert.ok(reservedOutstandingBytes(actual) >= actual);
    }
  } finally {
    state.close();
    await rm(directory, { recursive:true, force:true });
  }
});

test("global command IDs and terminal replays fail closed without replacing unresolved state", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "trax-ps8-global-ids-"));
  const state = new ApplicationState(path.join(directory, "state.sqlite"));
  const command = {
    commandId:"active-id", type:"ps8.resource.update.v1" as const, resourceId:"resource-one",
    resourceIncarnationId:"incarnation-one", expectedRecordVersion:1, payload:"ORIGINAL",
    actualSerializedBytes:240, reservedBytes:reservedOutstandingBytes(240),
  };
  const result = {
    commandId:"terminal-id", resourceId:"resource-two", state:"applied" as const, code:"applied" as const,
    previousVersion:1, currentVersion:2, digest:"c".repeat(64), attemptNumber:1,
  };
  try {
    state.addOverlays([command]);
    const overlayBefore = state.readOverlays();
    assert.throws(() => state.addOverlays([{ ...command, payload:"REPLACEMENT" }]), /UNIQUE constraint failed/);
    assert.deepEqual(state.readOverlays(), overlayBefore);

    const duplicateBatch = [
      { ...command, commandId:"batch-id" },
      { ...command, commandId:"batch-id", payload:"SECOND" },
    ];
    assert.throws(() => state.addOverlays(duplicateBatch), /command_id_already_active|UNIQUE constraint failed/);
    assert.ok(!state.readOverlays().some((entry) => entry.id === "batch-id"));

    state.persistResults([result]);
    state.markResultsSdkCompleted([result.commandId]);
    const terminalBefore = state.readResults();
    const accountingBefore = state.resultByteAccounting(result.commandId);
    assert.throws(() => state.addOverlays([{ ...command, commandId:result.commandId }]), /command_id_already_active/);
    state.persistResults([{ ...result, code:"already_applied", attemptNumber:9 }]);
    assert.deepEqual(state.readResults(), terminalBefore);
    assert.deepEqual(state.resultByteAccounting(result.commandId), accountingBefore);
    assert.throws(() => state.persistResults([{ ...result, digest:"d".repeat(64) }]), /command_result_id_conflict/);
    assert.throws(() => state.persistResults([{ ...result, resourceId:"different-resource" }]), /command_result_id_conflict/);
    assert.deepEqual(state.readResults(), terminalBefore);
    assert.deepEqual(state.resultByteAccounting(result.commandId), accountingBefore);
  } finally {
    state.close();
    await rm(directory, { recursive:true, force:true });
  }
});

test("application-state reopen rejects one command ID in overlay and result states", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "trax-ps8-cross-state-id-"));
  const filename = path.join(directory,"state.sqlite");
  const state = new ApplicationState(filename);
  const command = { commandId:"cross-state-id",type:"ps8.resource.update.v1" as const,resourceId:"resource",
    resourceIncarnationId:"incarnation",expectedRecordVersion:1,payload:"PAYLOAD",
    actualSerializedBytes:240,reservedBytes:reservedOutstandingBytes(240) };
  state.addOverlays([command]);
  state.close();
  const raw = new BetterSqlite3(filename);
  raw.prepare(`INSERT INTO trax_app_command_results
    (id,resource_id,state,result_code,previous_version,current_version,digest,attempt_number,
     serialized_bytes,actual_serialized_bytes,sdk_completed) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      command.commandId,"resource","applied","applied",1,2,"e".repeat(64),1,512,256,0,
    );
  raw.close();
  try {
    assert.throws(() => new ApplicationState(filename),/command_id_already_active_in_multiple_states/);
  } finally {
    await rm(directory,{ recursive:true,force:true });
  }
});

test("combined unresolved-result and quarantine reservations reject N+1 and representation growth", () => {
  const entry = { id:"command",resource_id:"resource",resource_incarnation_id:"incarnation",
    command_type:"ps8.resource.update.v1",payload:"P".repeat(512),expected_record_version:1 };
  const reserved = quarantineEntryReservationBytes(entry);
  assert.ok(reserved >= spikeCapacityLimits.terminalResultReservationBytes);
  const pendingReview = { ...entry,state:"pending_review",exportable:1,reserved_bytes:reserved };
  const invalidated = { ...pendingReview,state:"invalidated",payload:null,exportable:0 };
  assert.ok(Buffer.byteLength(JSON.stringify(pendingReview), "utf8") <= reserved);
  assert.ok(Buffer.byteLength(JSON.stringify(invalidated), "utf8") <= reserved);
  assert.doesNotThrow(() => assertCombinedOutstandingCapacity(64, 65_536));
  assert.throws(() => assertCombinedOutstandingCapacity(65, reserved), /quarantine_capacity_exceeded/);
  assert.throws(() => assertCombinedOutstandingCapacity(64, 65_537), /quarantine_byte_capacity_exceeded/);
  const resultBytes = 63 * spikeCapacityLimits.terminalResultReservationBytes;
  assert.doesNotThrow(() => assertCombinedOutstandingCapacity(64, resultBytes + reserved));
  assert.throws(() => assertCombinedOutstandingCapacity(65, resultBytes + reserved * 2), /quarantine_capacity_exceeded/);
});

test("actual R2 v1 finalized quarantine migrates without inventing expected versions", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "trax-ps8-quarantine-migration-"));
  const filename = path.join(directory, "quarantine.json");
  // Exact finalized shape written by a037cfb: neither expected_record_version
  // nor serialized-byte accounting existed in the v1 sidecar.
  const legacy = { version:1,commands:[
    { id:"review",resource_id:"resource-one",resource_incarnation_id:"incarnation-one",
      command_type:"ps8.resource.update.v1",state:"pending_review",payload:"REVIEW",exportable:1 },
    { id:"invalidated",resource_id:"resource-two",resource_incarnation_id:"incarnation-two",
      command_type:"ps8.resource.update.v1",state:"invalidated",payload:null,exportable:0 },
  ] };
  await writeFile(filename,JSON.stringify(legacy));
  try {
    const migrated = await readQuarantineStore(filename);
    assert.equal(migrated.migrated,true);
    assert.equal(migrated.store.version,2);
    assert.deepEqual(migrated.store.pending,[]);
    assert.deepEqual(
      migrated.store.finalized.map((entry) => ({
        id:entry.id, expected:entry.expected_record_version, state:entry.state,
        payload:entry.payload, exportable:entry.exportable,
      })),
      [
        { id:"review",expected:null,state:"pending_review",payload:"REVIEW",exportable:1 },
        { id:"invalidated",expected:null,state:"invalidated",payload:null,exportable:0 },
      ],
    );
    assert.ok(migrated.store.finalized.every((entry) => entry.reserved_bytes >= 512));
    await writePrivateJsonAtomically(filename,migrated.store);
    const reopened = await readQuarantineStore(filename);
    assert.equal(reopened.migrated,false);
    assert.deepEqual(reopened.store,migrated.store);

    const unfinished = { version:1,commands:[{
      id:"unfinished",resource_id:"resource-three",resource_incarnation_id:"incarnation-three",
      command_type:"ps8.resource.update.v1",initiallyAuthorized:true,payload:"PENDING",
    }] };
    await writeFile(filename,JSON.stringify(unfinished));
    const before = await readFile(filename,"utf8");
    await assert.rejects(readQuarantineStore(filename),/legacy_unfinished_reset_missing_expected_record_version/);
    assert.equal(await readFile(filename,"utf8"),before);
  } finally {
    await rm(directory,{ recursive:true,force:true });
  }
});

test("quarantine duplicates and acknowledgement write failures preserve published state", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "trax-ps8-quarantine-ids-"));
  const filename = path.join(directory, "quarantine.json");
  const base = { id:"quarantine-id",resource_id:"resource",resource_incarnation_id:"incarnation",
    command_type:"ps8.resource.update.v1",payload:"REVIEW",expected_record_version:1 };
  const entry = { ...base,state:"pending_review" as const,exportable:1 as const,
    reserved_bytes:quarantineEntryReservationBytes(base) };
  const pending = { ...base,initiallyAuthorized:true,
    reserved_bytes:quarantineEntryReservationBytes(base) };
  try {
    for (const malformed of [
      { version:2,finalized:[entry,entry],pending:[] },
      { version:2,finalized:[entry],pending:[pending] },
      { version:1,commands:[entry,entry] },
    ]) {
      await writeFile(filename,JSON.stringify(malformed));
      await assert.rejects(readQuarantineStore(filename),/quarantine_duplicate_id_conflict/);
    }
    assert.throws(() => mergeFinalizedQuarantine([entry],[entry]),/quarantine_duplicate_id_conflict/);
    assert.throws(() => mergeFinalizedQuarantine([entry],[{ ...entry,payload:"DIFFERENT" }]),/quarantine_duplicate_id_conflict/);

    await writePrivateJsonAtomically(filename,{ version:2,finalized:[entry],pending:[] });
    const published = [entry];
    const publishedBytes = published.reduce((total,item) => total + item.reserved_bytes,0);
    const failingWriter = (async () => { throw new Error("injected quarantine acknowledgement write failure"); }) as typeof writePrivateJsonAtomically;
    await assert.rejects(
      persistQuarantineAcknowledgement(filename,published,entry.id,failingWriter),
      /injected quarantine acknowledgement write failure/,
    );
    assert.deepEqual(published,[entry]);
    assert.equal(published.reduce((total,item) => total + item.reserved_bytes,0),publishedBytes);
    assert.deepEqual((await readQuarantineStore(filename)).store.finalized,[entry]);

    const next = await persistQuarantineAcknowledgement(filename,published,entry.id);
    assert.deepEqual(next,[]);
    assert.deepEqual(published,[entry]);
    assert.deepEqual((await readQuarantineStore(filename)).store.finalized,[]);
  } finally {
    await rm(directory,{ recursive:true,force:true });
  }
});

test("R2 application sidecar migrates transactionally with conservative completion and idempotent reopen", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "trax-ps8-migration-"));
  const filename = path.join(directory, "state.sqlite");
  const legacy = new BetterSqlite3(filename);
  legacy.exec(`
    CREATE TABLE trax_app_command_results (
      id TEXT PRIMARY KEY,resource_id TEXT NOT NULL,state TEXT NOT NULL,result_code TEXT NOT NULL,
      previous_version INTEGER NOT NULL,current_version INTEGER NOT NULL,digest TEXT NOT NULL,attempt_number INTEGER NOT NULL
    );
    CREATE TABLE trax_app_optimistic_resources (
      id TEXT PRIMARY KEY,resource_id TEXT NOT NULL,resource_incarnation_id TEXT NOT NULL,
      command_type TEXT NOT NULL,payload TEXT,expected_record_version INTEGER NOT NULL
    );
    CREATE TABLE trax_app_replica_session (
      singleton INTEGER PRIMARY KEY,replica_id TEXT NOT NULL,replica_epoch INTEGER NOT NULL,
      checkpoint_state TEXT NOT NULL,reset_count INTEGER NOT NULL
    );
    INSERT INTO trax_app_command_results VALUES ('legacy-result','resource','conflict','optimistic_conflict',1,2,'${"b".repeat(64)}',1);
    INSERT INTO trax_app_optimistic_resources VALUES ('legacy-overlay','resource-two','incarnation','ps8.resource.update.v1','PAYLOAD',1);
    INSERT INTO trax_app_replica_session VALUES (1,'replica',1,'client_observed',0);
  `);
  legacy.close();
  try {
    const migrated = new ApplicationState(filename);
    assert.equal(migrated.schemaVersion(), spikeCapacityLimits.applicationStateSchemaVersion);
    assert.equal(migrated.capacityUsage().count, 2);
    assert.equal(migrated.readResults()[0]?.id, "legacy-result");
    assert.equal(migrated.readOverlays()[0]?.payload, "PAYLOAD");
    const accounting = migrated.resultByteAccounting("legacy-result")!;
    assert.ok(accounting.reservedBytes >= accounting.actualBytes);
    assert.equal(accounting.sdkCompleted, false);
    assert.equal(migrated.acknowledgeResult("legacy-result"), false);
    const before = migrated.capacityUsage();
    migrated.close();
    const reopened = new ApplicationState(filename);
    assert.equal(reopened.schemaVersion(), spikeCapacityLimits.applicationStateSchemaVersion);
    assert.deepEqual(reopened.capacityUsage(), before);
    assert.equal(reopened.acknowledgeResult("legacy-result"), false);
    reopened.close();
  } finally {
    await rm(directory, { recursive:true, force:true });
  }
});

test("restart session selection binds client name, principal and credential", async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),"trax-r4-session-"));
  const filename=path.join(directory,"state.sqlite");
  const session={replicaId:"11111111-1111-4111-8111-111111111111",replicaEpoch:3,
    credential:`r2_${Buffer.alloc(32,2).toString("base64url")}`};
  try {
    const state=new ApplicationState(filename);state.setReplicaSession(session,2,"device-a",ids.users.eve);state.close();
    await chmod(filename,0o600);
    const reopened=new ApplicationState(filename);
    assert.deepEqual(reopened.resumeReplicaSession("device-a",ids.users.eve),{session,resetCount:2});
    assert.throws(()=>reopened.resumeReplicaSession("device-b",ids.users.eve),/resume_session_owner_mismatch/);
    assert.throws(()=>reopened.resumeReplicaSession("device-a",ids.users.alice),/resume_session_owner_mismatch/);
    reopened.close();
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test("restart sidecars require strict private mode and known reset phases", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),"trax-r4-private-"));
  try {
    const target = path.join(directory,"state.json");
    await writeFile(target,"{}\n",{ mode:0o600 });
    assert.equal(await assertPrivateRegularFile(target),true);
    await chmod(target,0o644);
    await assert.rejects(assertPrivateRegularFile(target),/resume_sidecar_mode_invalid/);
    assert.equal(await assertPrivateRegularFile(path.join(directory,"missing")),false);
    const session = { replicaId:"11111111-1111-4111-8111-111111111111",replicaEpoch:2,
      credential:`r2_${Buffer.alloc(32,1).toString("base64url")}` };
    const requestId="22222222-2222-4222-8222-222222222222";
    assert.equal(parseResetState({ version:2,phase:"session_staged",resetRequestId:requestId,
      oldSession:{ ...session,replicaEpoch:1 },newSession:session }).phase,"session_staged");
    assert.throws(() => parseResetState({ version:2,phase:"unknown",resetRequestId:requestId,
      oldSession:session }),/invalid_reset_state/);
    assert.throws(() => parseResetState({ version:2,phase:"cleared",resetRequestId:requestId,
      oldSession:session }),/invalid_reset_state_phase/);
    for (const malformed of [
      "22222222-2222-2222-8222-222222222222",
      "22222222-2222-4222-7222-222222222222",
      "22222222-2222-4222-8222-22222222222-",
      "22222222-2222-4222-8222-22222222222Z",
      "22222222-2222-4222-A222-222222222222",
    ]) assert.throws(() => parseResetState({ version:2,phase:"quarantined",resetRequestId:malformed,
      oldSession:session }),/invalid_reset_state/);
  } finally { await rm(directory,{ recursive:true,force:true }); }
});

test("private atomic sidecar failures remove payload-bearing temporary files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "trax-ps8-private-write-"));
  const target = path.join(directory, "state.json");
  const renameFailure = (async () => { throw new Error("injected rename failure"); }) as typeof rename;
  await assert.rejects(
    writePrivateJsonAtomically(target, { payload: "MUST_NOT_REMAIN_IN_TMP" }, {
      open, chmod, unlink, rename: renameFailure,
    }),
    /injected rename failure/,
  );
  assert.deepEqual(await readdir(directory), []);

  const cleanupFailure = Object.assign(new Error("injected cleanup failure"), { code: "EACCES" });
  await assert.rejects(
    writePrivateJsonAtomically(target, { payload: "CLEANUP_FAILURE_MUST_SURFACE" }, {
      open, chmod, rename: renameFailure,
      unlink: (async () => { throw cleanupFailure; }) as typeof unlink,
    }),
    (error: unknown) => error instanceof AggregateError && error.errors.some((entry) => String(entry).includes("injected rename failure")) && error.errors.some((entry) => String(entry).includes("injected cleanup failure")),
  );
  for (const entry of await readdir(directory)) await unlink(path.join(directory, entry));

  const clientSource = await readFile(path.resolve("src/client.ts"), "utf8");
  assert.doesNotMatch(clientSource, /(?:FROM|INTO|UPDATE|DELETE\s+FROM)\s+ps_/i);
  assert.doesNotMatch(clientSource, /ps_data_local__/i);
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
  for (const invalidVersion of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => validateQueuedCrud([{ ...valid, opData: { ...valid.opData, expected_record_version: invalidVersion } }]),
      /positive safe integer/,
    );
    assert.throws(() => assertPositiveExpectedRecordVersion(invalidVersion), /positive safe integer/);
  }
  assert.doesNotThrow(() => assertPositiveExpectedRecordVersion(1));
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
