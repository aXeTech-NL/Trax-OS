import { type JourneyData, parseJourneyData } from "./domain";

const BACKUP_FORMAT = "trax-os-local-backup";
const BACKUP_VERSION = 1;

interface LocalBackupEnvelope {
  readonly format: typeof BACKUP_FORMAT;
  readonly version: typeof BACKUP_VERSION;
  readonly exportedAt: string;
  readonly data: JourneyData;
}

export function createLocalBackup(
  data: JourneyData,
  exportedAt = new Date().toISOString(),
): string {
  const envelope: LocalBackupEnvelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    data: parseJourneyData(data),
  };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export function readLocalBackup(source: string): JourneyData {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("invalid_backup");
  }
  if (
    !isRecord(value) ||
    value.format !== BACKUP_FORMAT ||
    value.version !== BACKUP_VERSION ||
    typeof value.exportedAt !== "string" ||
    Number.isNaN(Date.parse(value.exportedAt)) ||
    !("data" in value)
  ) {
    throw new Error("invalid_backup");
  }
  try {
    return parseJourneyData(value.data);
  } catch {
    throw new Error("invalid_backup");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
