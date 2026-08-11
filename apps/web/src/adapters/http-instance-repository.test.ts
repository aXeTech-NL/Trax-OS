import { TraxApiClient } from "@trax-os/api-client";
import { describe, expect, test, vi } from "vitest";

import {
  HttpInstanceRepository,
  InstanceRepositoryError,
} from "./http-instance-repository";

const runtimeFixtures = {
  contract: {
    schema_version: "1",
    api: { current: 1, minimum_supported: 1, maximum_supported: 1 },
    commands: [
      {
        command_type: "journey.update",
        current: 1,
        minimum_supported: 1,
        maximum_supported: 1,
      },
    ],
  },
  version: { application: "Trax OS", version: "0.1.0", api_version: "1" },
  capabilities: {
    schema_version: "1",
    capabilities: [
      { key: "foundation.contract-discovery", status: "available" },
    ],
  },
} as const;

function repository(request: typeof globalThis.fetch): HttpInstanceRepository {
  return new HttpInstanceRepository(new TraxApiClient({ request }));
}

function address(input: string | URL | Request): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HttpInstanceRepository", () => {
  test("maps generated Python runtime fixtures through the validated client", async () => {
    const request = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input) => {
        const url = address(input);
        if (url.endsWith("/api/contract"))
          return Promise.resolve(json(runtimeFixtures.contract));
        const body = url.endsWith("/version")
          ? runtimeFixtures.version
          : runtimeFixtures.capabilities;
        return Promise.resolve(json(body));
      });

    const result = await repository(request).getInstance();

    expect(result).toEqual({
      application: runtimeFixtures.version.application,
      version: runtimeFixtures.version.version,
      apiVersion: runtimeFixtures.version.api_version,
      capabilities: runtimeFixtures.capabilities.capabilities,
    });
    expect(request).toHaveBeenCalledTimes(3);
  });

  test("normalizes malformed JSON from a successful response", async () => {
    const request = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input) => {
        const url = address(input);
        if (url.endsWith("/api/contract"))
          return Promise.resolve(json(runtimeFixtures.contract));
        return Promise.resolve(
          new Response("{not-json", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      });

    await expect(repository(request).getInstance()).rejects.toEqual(
      expect.objectContaining<Partial<InstanceRepositoryError>>({
        code: "invalid_response",
        message: "The Trax OS API returned an invalid response.",
      }),
    );
  });

  test.each([
    [
      "version",
      { application: "Trax OS", version: 1, api_version: "1" },
      runtimeFixtures.capabilities,
    ],
    [
      "capabilities",
      runtimeFixtures.version,
      { schema_version: "1", capabilities: { key: "not-an-array" } },
    ],
  ])(
    "normalizes a wrong %s payload shape",
    async (_name, version, capabilities) => {
      const request = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation((input) => {
          const url = address(input);
          if (url.endsWith("/api/contract"))
            return Promise.resolve(json(runtimeFixtures.contract));
          return Promise.resolve(
            json(url.endsWith("/version") ? version : capabilities),
          );
        });

      await expect(repository(request).getInstance()).rejects.toEqual(
        expect.objectContaining<Partial<InstanceRepositoryError>>({
          code: "invalid_response",
          message: "The Trax OS API returned an invalid response.",
        }),
      );
    },
  );

  test("maps a stable API error without component-level HTTP knowledge", async () => {
    const request = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input) => {
        if (address(input).endsWith("/api/contract"))
          return Promise.resolve(json(runtimeFixtures.contract));
        return Promise.resolve(
          json(
            {
              error: {
                code: "provider_unavailable",
                message: "Temporarily unavailable.",
                details: {},
                request_id: "req_test",
              },
            },
            500,
          ),
        );
      });

    await expect(repository(request).getInstance()).rejects.toEqual(
      expect.objectContaining<Partial<InstanceRepositoryError>>({
        code: "provider_unavailable",
        requestId: "req_test",
      }),
    );
  });

  test("normalizes network failures", async () => {
    const request = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError("detail"));
    await expect(repository(request).getInstance()).rejects.toThrow(
      "The Trax OS API could not be reached.",
    );
  });
});
