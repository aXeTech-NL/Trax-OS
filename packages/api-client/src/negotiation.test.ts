import { describe, expect, test } from "vitest";

import {
  negotiateContract,
  negotiateRange,
  type ContractDiscovery,
  VersionNegotiationError,
} from "./negotiation";

const command = {
  command_type: "journey.update",
  current: 1,
  minimum_supported: 1,
  maximum_supported: 1,
};
const contract: ContractDiscovery = {
  schema_version: "1",
  api: { current: 1, minimum_supported: 1, maximum_supported: 1 },
  commands: [command],
};

describe("inclusive version negotiation", () => {
  test.each([
    ["exact", [1, 1], [1, 1], 1],
    ["partial overlap", [1, 4], [3, 6], 4],
    ["touching overlap", [1, 3], [3, 6], 3],
  ])("selects the highest %s", (_name, client, server, expected) => {
    expect(
      negotiateRange(
        { minimum_supported: client[0]!, maximum_supported: client[1]! },
        { minimum_supported: server[0]!, maximum_supported: server[1]! },
      ),
    ).toBe(expected);
  });

  test.each([
    ["client_too_old", [1, 2], [3, 5]],
    ["client_too_new", [6, 8], [3, 5]],
  ])("fails clearly for %s", (code, client, server) => {
    expect(() =>
      negotiateRange(
        { minimum_supported: client[0]!, maximum_supported: client[1]! },
        { minimum_supported: server[0]!, maximum_supported: server[1]! },
      ),
    ).toThrow(expect.objectContaining({ code }));
  });

  test.each([
    { minimum_supported: 0, maximum_supported: 1 },
    { minimum_supported: 1.5, maximum_supported: 2 },
    { minimum_supported: 2, maximum_supported: 1 },
    { minimum_supported: 1, maximum_supported: Number.MAX_SAFE_INTEGER + 1 },
    { minimum_supported: undefined, maximum_supported: 1 },
  ])("rejects malformed range %#", (range) => {
    expect(() =>
      negotiateRange(
        range as { minimum_supported: number; maximum_supported: number },
        { minimum_supported: 1, maximum_supported: 1 },
      ),
    ).toThrow(expect.objectContaining({ code: "invalid_contract_metadata" }));
  });

  test("validates current, duplicate command metadata and command overlap", () => {
    expect(() =>
      negotiateContract({
        ...contract,
        api: { ...contract.api, current: 2 },
      }),
    ).toThrow(expect.objectContaining({ code: "invalid_contract_metadata" }));
    expect(() =>
      negotiateContract({ ...contract, commands: [command, command] }),
    ).toThrow(expect.objectContaining({ code: "invalid_contract_metadata" }));
    expect(() =>
      negotiateContract({
        ...contract,
        commands: [
          {
            ...command,
            current: 2,
            minimum_supported: 2,
            maximum_supported: 2,
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "command_version_no_overlap" }));
  });

  test("does not treat API overlap as command overlap or unknown support", () => {
    expect(() => negotiateContract({ ...contract, commands: [] })).toThrow(
      expect.objectContaining({ code: "unsupported_command" }),
    );
    const negotiated = negotiateContract({
      ...contract,
      commands: [
        command,
        {
          command_type: "future.command",
          current: 3,
          minimum_supported: 3,
          maximum_supported: 3,
        },
      ],
    });
    expect(negotiated.commandVersions.get("journey.update")).toBe(1);
    expect(negotiated.commandVersions.has("future.command")).toBe(false);
  });

  test("uses stable negotiation error messages without metadata values", () => {
    const error = new VersionNegotiationError("client_too_old");
    expect(error.message).not.toContain("1");
  });
});
