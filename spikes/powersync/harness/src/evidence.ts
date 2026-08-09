import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

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
  if (entry.state === "executed-uncommitted") {
    if (
      !entry.context?.runId ||
      !entry.context.composeProject ||
      !entry.context.wrapperCommand
    ) {
      throw new Error(
        "Executed-uncommitted evidence requires run, project and wrapper context.",
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
