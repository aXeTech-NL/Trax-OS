import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

export const evidenceStates = [
  "designed",
  "executed",
  "executed-uncommitted",
  "passed",
  "failed",
  "not-validated",
] as const;
export type EvidenceState = (typeof evidenceStates)[number];

export interface EvidenceContext {
  runId: string;
  composeProject: string;
  wrapperCommand: string;
  candidate?: {
    revision: string;
    dirty: boolean;
    sourceTreeDigest: string;
    sourceScope: string;
  };
  environment?: {
    platform: string;
    nodeVersion: string;
    npmVersion: string;
    dockerClientVersion: string;
    dockerServerVersion: string;
    dockerComposeVersion: string;
  };
  serviceMetadata?: unknown;
}

export interface EvidenceEntry {
  check: string;
  state: EvidenceState;
  command?: string;
  executedAt?: string;
  exitCode?: number;
  platform?: string;
  details: string;
  context?: EvidenceContext;
  observations?: Record<string, unknown>;
}

export function validateM3bR5Observation(value: unknown): void {
  const expected = {
    status: "executed-uncommitted",
    verdict: "limitation-demonstrated",
    checkpointProof: "client-observed-not-server-attested",
    rawReplicaClient: "http-only-no-powersync-or-sqlite",
    falseAckRenewedEligibility: true,
    unchangedOldIntentApplied: true,
    authorizationIndependent: true,
    conflictIndependent: true,
    incarnationIndependent: true,
    missingTargetIndependent: true,
    idempotencyIndependent: true,
    resetAckWithoutClearAccepted: true,
    oldEpochRejected: true,
    unseenIntentReboundAcrossEpoch: true,
    createCommands: { validated: false },
    technicalRecommendation: "do-not-use-checkpoint-ack-as-authority",
    riskAcceptance: "pending-human-decision",
    architectureGate: "blocked-pending-alternative-or-policy-revision",
    codes: {
      staleBeforeFalseAck: "replica_reset_required",
      unchangedOldIntent: "applied",
      authorization: "command_denied",
      conflict: "optimistic_conflict",
      incarnation: "stale_incarnation",
      missingTarget: "command_denied",
      idempotency: "idempotency_conflict",
      oldEpoch: "invalid_replica",
      reboundIntent: "applied",
    },
    resourceMutationCounts: {
      staleBeforeFalseAck: 0,
      unchangedOldIntent: 1,
      authorization: 0,
      conflict: 0,
      incarnation: 0,
      missingTarget: 0,
      idempotencyReplay: 0,
      oldEpoch: 0,
      reboundIntent: 1,
    },
    eventDeltas: {
      staleBeforeFalseAck: 0,
      unchangedOldIntent: 1,
      authorization: 0,
      conflict: 0,
      incarnation: 0,
      missingTarget: 0,
      idempotencyReplay: 0,
      oldEpoch: 0,
      reboundIntent: 1,
    },
    receiptDeltas: {
      staleBeforeFalseAck: 0,
      unchangedOldIntent: 1,
      authorization: 1,
      conflict: 1,
      incarnation: 1,
      missingTarget: 1,
      idempotencyReplay: 0,
      oldEpoch: 0,
      reboundIntent: 1,
    },
    sanitized: true,
  };
  if (!isDeepStrictEqual(value, expected)) {
    throw new Error(
      "experimentalM3bR5 must retain the exact negative-capability semantics without identifiers or sensitive data.",
    );
  }
}

export function validateEvidenceEntry(entry: EvidenceEntry): EvidenceEntry {
  if (!entry.check.trim() || !entry.details.trim()) {
    throw new Error("Evidence check and details are required.");
  }
  if (!evidenceStates.includes(entry.state)) {
    throw new Error(`Unsupported evidence state: ${String(entry.state)}`);
  }
  if (
    entry.state === "passed" ||
    entry.state === "failed" ||
    entry.state === "executed" ||
    entry.state === "executed-uncommitted"
  ) {
    if (
      !entry.executedAt ||
      !entry.command ||
      entry.exitCode === undefined ||
      !entry.platform
    ) {
      throw new Error(
        `${entry.state} evidence requires command, executedAt, exitCode and platform.`,
      );
    }
  }
  if (
    (entry.state === "passed" || entry.state === "executed-uncommitted") &&
    entry.exitCode !== 0
  ) {
    throw new Error(`${entry.state} evidence requires exit code 0.`);
  }
  if (entry.state === "failed" && entry.exitCode === 0) {
    throw new Error("Failed evidence requires a non-zero exit code.");
  }
  if (entry.observations && "experimentalM3bR5" in entry.observations) {
    validateM3bR5Observation(entry.observations.experimentalM3bR5);
  }
  if (entry.state === "executed-uncommitted") {
    if (
      !entry.context?.runId ||
      !entry.context.composeProject ||
      !entry.context.wrapperCommand ||
      !entry.context.candidate?.revision.match(/^[0-9a-f]{40}$/) ||
      !entry.context.candidate.sourceTreeDigest.match(/^[0-9a-f]{64}$/) ||
      !entry.context.candidate.sourceScope.trim()
    ) {
      throw new Error(
        "Executed-uncommitted evidence requires run, project, wrapper and source identity context.",
      );
    }
  }
  return entry;
}

export async function writeEvidenceEntry(
  directory: string,
  entry: EvidenceEntry,
): Promise<string> {
  const valid = validateEvidenceEntry(entry);
  await mkdir(directory, { recursive: true });
  const safeCheck = valid.check
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const target = path.join(directory, `${safeCheck}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(valid, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, target);
  return target;
}
