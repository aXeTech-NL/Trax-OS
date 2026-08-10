import { createHash } from "node:crypto";

export const spikeProtocol = 1 as const;
export const supportedCommandTypes = [
  "ps8.resource.update.v1",
  "ps8.resource.soft_delete.v1",
] as const;
export type SpikeCommandType = (typeof supportedCommandTypes)[number];

export interface SpikeCommand {
  commandId: string;
  type: SpikeCommandType;
  resourceId: string;
  resourceIncarnationId: string;
  expectedRecordVersion: number;
  payload?: string;
}

export interface SpikeCommandEnvelope {
  spikeProtocol: 1;
  deviceId: string;
  localTransactionId: string;
  commands: SpikeCommand[];
}

export interface SpikeCommandResult {
  commandId: string;
  resourceId: string;
  digest: string;
  state: "applied" | "conflict" | "denied";
  code: "applied" | "already_applied" | "optimistic_conflict" | "stale_incarnation" | "command_denied";
  previousVersion: number;
  currentVersion: number;
  attemptNumber: number;
}

export interface SpikeCommandResponse {
  spikeProtocol: 1;
  results: SpikeCommandResult[];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const commandUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const authorityFields = new Set([
  "actor", "actorId", "user", "userId", "representedUser", "representedUserId",
  "workspace", "workspaceId", "workspace_id", "journey", "journeyId", "journey_id",
  "party", "partyId", "party_id", "audience", "owner", "ownerId", "grant", "grants",
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  const authority = unknown.filter((key) => authorityFields.has(key));
  if (authority.length) throw new Error(`Client-supplied authority is forbidden: ${authority.sort().join(", ")}.`);
  if (unknown.length) throw new Error(`${label} has unknown fields: ${unknown.sort().join(", ")}.`);
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new Error(`${label} must be a non-empty string of at most ${maximum} characters.`);
  }
  return value;
}

export function parseCommandEnvelope(value: unknown): SpikeCommandEnvelope {
  const input = record(value, "Command envelope");
  exactKeys(input, ["spikeProtocol", "deviceId", "localTransactionId", "commands"], "Command envelope");
  if (input.spikeProtocol !== spikeProtocol) throw new Error("Unsupported spike protocol.");
  const deviceId = boundedString(input.deviceId, "deviceId", 128);
  const localTransactionId = boundedString(input.localTransactionId, "localTransactionId", 128);
  if (!Array.isArray(input.commands) || input.commands.length !== 1) {
    throw new Error("The M3a envelope must contain exactly one command.");
  }
  const targets = new Set<string>();
  const commandIds = new Set<string>();
  const commands = input.commands.map((raw, index): SpikeCommand => {
    const command = record(raw, `commands[${index}]`);
    exactKeys(command, ["commandId", "type", "resourceId", "resourceIncarnationId", "expectedRecordVersion", "payload"], `commands[${index}]`);
    const commandId = boundedString(command.commandId, "commandId", 36).toLowerCase();
    const resourceId = boundedString(command.resourceId, "resourceId", 36).toLowerCase();
    const resourceIncarnationId = boundedString(command.resourceIncarnationId, "resourceIncarnationId", 36).toLowerCase();
    if (!commandUuid.test(commandId)) throw new Error("commandId must be a version-4 UUID.");
    if (!uuid.test(resourceId)) throw new Error("resourceId must be a UUID.");
    if (!uuid.test(resourceIncarnationId)) throw new Error("resourceIncarnationId must be a UUID.");
    if (!supportedCommandTypes.includes(command.type as SpikeCommandType)) throw new Error("Unsupported spike command type.");
    const type = command.type as SpikeCommandType;
    if (!Number.isSafeInteger(command.expectedRecordVersion) || Number(command.expectedRecordVersion) < 1) {
      throw new Error("expectedRecordVersion must be a positive safe integer.");
    }
    let payload: string | undefined;
    if (type === "ps8.resource.update.v1") payload = boundedString(command.payload, "payload", 512);
    else if (command.payload !== undefined) throw new Error("soft_delete commands do not accept payload.");
    if (commandIds.has(commandId)) throw new Error("A transaction cannot contain duplicate command IDs.");
    if (targets.has(resourceId)) throw new Error("A transaction cannot contain duplicate resource targets.");
    commandIds.add(commandId);
    targets.add(resourceId);
    return { commandId, type, resourceId, resourceIncarnationId, expectedRecordVersion: Number(command.expectedRecordVersion), ...(payload === undefined ? {} : { payload }) };
  });
  return { spikeProtocol, deviceId, localTransactionId, commands };
}

export function commandDigest(command: SpikeCommand): string {
  const normalized = JSON.stringify({
    commandId: command.commandId,
    type: command.type,
    resourceId: command.resourceId,
    resourceIncarnationId: command.resourceIncarnationId,
    expectedRecordVersion: command.expectedRecordVersion,
    payload: command.payload ?? null,
  });
  return createHash("sha256").update(normalized).digest("hex");
}

export function parseCommandResponse(value: unknown, commands: readonly SpikeCommand[]): SpikeCommandResponse {
  const input = record(value, "Command response");
  exactKeys(input, ["spikeProtocol", "results"], "Command response");
  if (input.spikeProtocol !== spikeProtocol || !Array.isArray(input.results) || input.results.length !== commands.length) {
    throw new Error("Command response does not match the request.");
  }
  const expected = new Map(commands.map((command) => [command.commandId, command]));
  const results = input.results.map((raw): SpikeCommandResult => {
    const result = record(raw, "Command result");
    exactKeys(result, ["commandId", "resourceId", "digest", "state", "code", "previousVersion", "currentVersion", "attemptNumber"], "Command result");
    const command = expected.get(String(result.commandId));
    if (!command || result.resourceId !== command.resourceId || result.digest !== commandDigest(command)) throw new Error("Command result identity or digest mismatch.");
    expected.delete(command.commandId);
    if (result.state !== "applied" && result.state !== "conflict" && result.state !== "denied") throw new Error("Unknown command result state.");
    if (!["applied", "already_applied", "optimistic_conflict", "stale_incarnation", "command_denied"].includes(String(result.code))) throw new Error("Unknown command result code.");
    const expectedState = result.code === "optimistic_conflict" || result.code === "stale_incarnation" ? "conflict" : result.code === "command_denied" ? "denied" : "applied";
    if (result.state !== expectedState) throw new Error("Inconsistent command result state and code.");
    for (const field of ["previousVersion", "currentVersion", "attemptNumber"] as const) {
      if (!Number.isSafeInteger(result[field]) || Number(result[field]) < 1) throw new Error(`Invalid ${field}.`);
    }
    return result as unknown as SpikeCommandResult;
  });
  if (expected.size) throw new Error("Command response omitted results.");
  return { spikeProtocol, results };
}
