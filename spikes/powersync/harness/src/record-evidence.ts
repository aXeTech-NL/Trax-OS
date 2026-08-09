import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  writeEvidenceEntry,
  type EvidenceContext,
  type EvidenceEntry,
  type EvidenceState,
} from "./evidence.js";

async function loadContext(): Promise<EvidenceContext | undefined> {
  const filename = process.env.PS8_EVIDENCE_CONTEXT_FILE;
  if (!filename) return undefined;
  return JSON.parse(await readFile(filename, "utf8")) as EvidenceContext;
}

async function loadObservations(): Promise<
  Record<string, unknown> | undefined
> {
  const filename = process.env.PS8_EVIDENCE_OBSERVATIONS_FILE;
  if (!filename) return undefined;
  return JSON.parse(await readFile(filename, "utf8")) as Record<
    string,
    unknown
  >;
}

const entry: EvidenceEntry = {
  check: process.env.PS8_EVIDENCE_CHECK ?? "unspecified-check",
  state: (process.env.PS8_EVIDENCE_STATE ?? "not-validated") as EvidenceState,
  command: process.env.PS8_EVIDENCE_COMMAND,
  executedAt: process.env.PS8_EVIDENCE_EXECUTED_AT,
  exitCode: process.env.PS8_EVIDENCE_EXIT_CODE
    ? Number.parseInt(process.env.PS8_EVIDENCE_EXIT_CODE, 10)
    : undefined,
  platform:
    process.env.PS8_EVIDENCE_PLATFORM ?? `${os.platform()}-${os.arch()}`,
  details: process.env.PS8_EVIDENCE_DETAILS ?? "No details supplied.",
  context: await loadContext(),
  observations: await loadObservations(),
};

const directory =
  process.env.PS8_EVIDENCE_DIR ?? path.resolve("..", ".evidence");
console.log(await writeEvidenceEntry(directory, entry));
