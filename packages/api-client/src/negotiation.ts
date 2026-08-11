import type { components } from "@trax-os/api-contract";

import { clientSupport } from "../generated/client";

export type ContractDiscovery =
  components["schemas"]["ContractDiscoveryResponse"];

export interface InclusiveVersionRange {
  readonly minimum_supported: number;
  readonly maximum_supported: number;
}

export type NegotiationFailureCode =
  | "invalid_contract_metadata"
  | "client_too_old"
  | "client_too_new"
  | "unsupported_command"
  | "command_version_no_overlap";

export class VersionNegotiationError extends Error {
  constructor(readonly code: NegotiationFailureCode) {
    super(messageFor(code));
    this.name = "VersionNegotiationError";
  }
}

export interface NegotiatedContract {
  readonly apiVersion: number;
  readonly commandVersions: ReadonlyMap<string, number>;
}

export function negotiateContract(
  metadata: ContractDiscovery,
): NegotiatedContract {
  if (metadata.schema_version !== "1") invalid();
  validateServerRange(metadata.api);
  const commandTypes = new Set<string>();
  const serverCommands = new Map(
    metadata.commands.map((command) => [command.command_type, command]),
  );
  for (const command of metadata.commands) {
    if (commandTypes.has(command.command_type)) invalid();
    commandTypes.add(command.command_type);
    validateServerRange(command);
  }
  const apiVersion = negotiateRange(clientSupport.api, metadata.api);
  const commandVersions = new Map<string, number>();
  for (const [commandType, clientRange] of Object.entries(
    clientSupport.commands,
  )) {
    const serverRange = serverCommands.get(commandType);
    if (!serverRange) throw new VersionNegotiationError("unsupported_command");
    try {
      commandVersions.set(
        commandType,
        negotiateRange(clientRange, serverRange),
      );
    } catch (error) {
      if (
        error instanceof VersionNegotiationError &&
        (error.code === "client_too_old" || error.code === "client_too_new")
      )
        throw new VersionNegotiationError("command_version_no_overlap");
      throw error;
    }
  }
  return { apiVersion, commandVersions };
}

export function negotiateRange(
  client: InclusiveVersionRange,
  server: InclusiveVersionRange,
): number {
  validateRange(client);
  validateRange(server);
  if (client.maximum_supported < server.minimum_supported)
    throw new VersionNegotiationError("client_too_old");
  if (client.minimum_supported > server.maximum_supported)
    throw new VersionNegotiationError("client_too_new");
  return Math.min(client.maximum_supported, server.maximum_supported);
}

function validateServerRange(
  range: InclusiveVersionRange & { readonly current: number },
): void {
  validateRange(range);
  if (!positiveSafeInteger(range.current)) invalid();
  if (
    range.current < range.minimum_supported ||
    range.current > range.maximum_supported
  )
    invalid();
}

function validateRange(range: InclusiveVersionRange): void {
  if (
    !positiveSafeInteger(range.minimum_supported) ||
    !positiveSafeInteger(range.maximum_supported) ||
    range.minimum_supported > range.maximum_supported
  )
    invalid();
}

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function invalid(): never {
  throw new VersionNegotiationError("invalid_contract_metadata");
}

function messageFor(code: NegotiationFailureCode): string {
  const messages: Record<NegotiationFailureCode, string> = {
    invalid_contract_metadata: "The server returned invalid contract metadata.",
    client_too_old:
      "This client is older than the server's supported API range.",
    client_too_new:
      "This client is newer than the server's supported API range.",
    unsupported_command: "The server does not advertise a required command.",
    command_version_no_overlap:
      "The client and server command versions do not overlap.",
  };
  return messages[code];
}
