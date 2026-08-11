import { describe, expect, test, vi } from "vitest";

import { ApiClientError, TraxApiClient } from "./client";

const id = "00000000-0000-4000-8000-000000000001";
const contract = {
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
};
const version = {
  application: "Trax OS",
  version: "0.1.0",
  api_version: "1",
};
const capabilities = {
  schema_version: "1",
  capabilities: [{ key: "foundation.contract-discovery", status: "available" }],
};
const journey = {
  id,
  name: "Japan",
  start_date: null,
  end_date: null,
  status: "planning",
  record_version: 1,
  created_at: "2026-08-11T08:00:00Z",
  updated_at: "2026-08-11T08:00:00Z",
};

function json(
  body: unknown,
  status = 200,
  contentType = "application/json",
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": contentType },
  });
}

async function apiFailure(promise: Promise<unknown>): Promise<ApiClientError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiClientError);
    return error as ApiClientError;
  }
  throw new Error("Expected API client failure");
}

function address(input: string | URL | Request): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
}

describe("TraxApiClient", () => {
  test("shares one cached negotiation across concurrent versioned traffic", async () => {
    let bootstrapCalls = 0;
    const request = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = address(input);
      if (url === "/api/contract") {
        bootstrapCalls += 1;
        return Promise.resolve(json(contract));
      }
      if (url.endsWith("/version")) return Promise.resolve(json(version));
      return Promise.resolve(json(capabilities));
    });
    const client = new TraxApiClient({ request });

    const [actualVersion, actualCapabilities] = await Promise.all([
      client.request("version_api_v1_version_get", {}),
      client.request("capabilities_api_v1_capabilities_get", {}),
    ]);

    expect(actualVersion).toEqual(version);
    expect(actualCapabilities).toEqual(capabilities);
    expect(bootstrapCalls).toBe(1);
    expect(await client.negotiatedApiVersion()).toBe(1);
    expect(await client.commandVersion("journey.update")).toBe(1);
    await expect(
      client.commandVersion("missing.command"),
    ).rejects.toMatchObject({
      code: "unsupported_command",
    });
  });

  test.each([
    [
      {
        ...contract,
        api: { current: 1, minimum_supported: 2, maximum_supported: 1 },
      },
    ],
    [
      {
        ...contract,
        api: { current: 1.5, minimum_supported: 1, maximum_supported: 2 },
      },
    ],
    [{ ...contract, commands: [contract.commands[0], contract.commands[0]] }],
  ])("normalizes malformed bootstrap metadata", async (metadata) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json(metadata));
    await expect(
      new TraxApiClient({ request }).request("version_api_v1_version_get", {}),
    ).rejects.toMatchObject({ code: "invalid_contract_metadata" });
  });

  test("retries after a shared transient bootstrap failure and caches success", async () => {
    let bootstrapCalls = 0;
    const request = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = address(input);
      if (url === "/api/contract") {
        bootstrapCalls += 1;
        return bootstrapCalls === 1
          ? Promise.reject(new Error("temporary"))
          : Promise.resolve(json(contract));
      }
      return Promise.resolve(json(version));
    });
    const client = new TraxApiClient({ request });
    const first = await Promise.allSettled([
      client.request("version_api_v1_version_get", {}),
      client.request("version_api_v1_version_get", {}),
    ]);
    expect(first.every((result) => result.status === "rejected")).toBe(true);
    expect(bootstrapCalls).toBe(1);
    await expect(
      client.request("version_api_v1_version_get", {}),
    ).resolves.toEqual(version);
    await client.request("version_api_v1_version_get", {});
    expect(bootstrapCalls).toBe(2);
  });

  test("uses immutable security defaults, CSRF and validates path responses", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation((input, init) => {
      const url = address(input);
      if (url === "/api/contract") return Promise.resolve(json(contract));
      expect(url).toBe(`/api/v1/journeys/${id}`);
      expect(init?.credentials).toBe("same-origin");
      expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
      return Promise.resolve(json(journey));
    });
    const client = new TraxApiClient({
      request,
      csrfToken: () => "csrf-secret",
    });
    await expect(
      client.request("get_journey_api_v1_journeys__journey_id__get", {
        path: { journey_id: id },
      }),
    ).resolves.toEqual(journey);

    request.mockImplementation((input, init) => {
      if (address(input) === "/api/contract")
        return Promise.resolve(json(contract));
      expect(init?.credentials).toBe("same-origin");
      expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe(
        "csrf-secret",
      );
      return Promise.resolve(json({ authenticated: false }));
    });
    await new TraxApiClient({
      request,
      csrfToken: () => "csrf-secret",
    }).request("logout_route_api_v1_auth_logout_post", {});
  });

  test("validates requests before versioned operation traffic", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json(contract));
    const client = new TraxApiClient({ request });
    await expect(
      client.request("create_journey_api_v1_journeys_post", {
        body: {
          name: "Japan",
          start_date: null,
          end_date: null,
          extra: "forbidden",
        },
      } as never),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  test("tolerates additive response fields but rejects malformed known fields", async () => {
    const additive = { ...version, future_field: true };
    const validRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(contract))
      .mockResolvedValueOnce(json(additive));
    await expect(
      new TraxApiClient({ request: validRequest }).request(
        "version_api_v1_version_get",
        {},
      ),
    ).resolves.toEqual(additive);

    const invalidRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(contract))
      .mockResolvedValueOnce(json({ ...version, api_version: 1 }));
    await expect(
      new TraxApiClient({ request: invalidRequest }).request(
        "version_api_v1_version_get",
        {},
      ),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  test("accepts declared empty 204 and rejects a body on it", async () => {
    const empty = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(contract))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(
      new TraxApiClient({ request: empty }).request(
        "delete_journey_api_v1_journeys__journey_id__delete",
        { path: { journey_id: id } },
      ),
    ).resolves.toBeNull();

    const responseWithForbidden204Body = {
      status: 204,
      ok: true,
      headers: new Headers(),
      text: () => Promise.resolve("unexpected"),
    } as Response;
    const body = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(contract))
      .mockResolvedValueOnce(responseWithForbidden204Body);
    await expect(
      new TraxApiClient({ request: body }).request(
        "delete_journey_api_v1_journeys__journey_id__delete",
        { path: { journey_id: id } },
      ),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  test("validates a declared noncanonical readiness failure without decoding it as ErrorResponse", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(contract))
      .mockResolvedValueOnce(
        json(
          {
            status: "not_ready",
            checks: { api: "ready", database: "unavailable" },
          },
          503,
        ),
      );
    await expect(
      new TraxApiClient({ request }).request("ready_health_ready_get", {}),
    ).rejects.toMatchObject({
      kind: "api",
      code: "http_error",
      status: 503,
      requestId: undefined,
    });
  });

  test.each([
    [
      new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      "invalid_response",
    ],
    [json(version, 200, "text/plain"), "unexpected_content_type"],
    [json(version, 418), "unexpected_status"],
  ])("rejects undeclared transport response %#", async (response, code) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(contract))
      .mockResolvedValueOnce(response);
    await expect(
      new TraxApiClient({ request }).request("version_api_v1_version_get", {}),
    ).rejects.toMatchObject({ code });
  });

  test("validates canonical errors and preserves only their request ID", async () => {
    const response = {
      error: {
        code: "resource_not_found",
        message: "Not found.",
        details: {},
        request_id: "req_safe",
      },
      additive: "allowed",
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(contract))
      .mockResolvedValueOnce(json(response, 404));
    await expect(
      new TraxApiClient({ request }).request(
        "get_journey_api_v1_journeys__journey_id__get",
        { path: { journey_id: id } },
      ),
    ).rejects.toMatchObject({
      kind: "api",
      code: "resource_not_found",
      requestId: "req_safe",
    });

    const secret = "raw-secret-payload";
    const malformed = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(contract))
      .mockResolvedValueOnce(json({ error: { code: secret } }, 404));
    const failure = await apiFailure(
      new TraxApiClient({ request: malformed }).request(
        "get_journey_api_v1_journeys__journey_id__get",
        { path: { journey_id: id } },
      ),
    );
    expect(failure.code).toBe("invalid_error_response");
    expect(failure.message).not.toContain(secret);
    expect(JSON.stringify(failure)).not.toContain(secret);
  });

  test("normalizes network failures without retaining their details", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("network-secret"));
    const failure = await apiFailure(
      new TraxApiClient({ request }).request("version_api_v1_version_get", {}),
    );
    expect(failure).toMatchObject({ kind: "network", code: "network_error" });
    expect(failure.message).not.toContain("network-secret");
  });

  test("requires the negotiated version on canonical commands", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json(contract));
    const client = new TraxApiClient({ request });
    await expect(
      client.request(
        "canonical_update_journey_api_v1_commands_journey_update_post",
        {
          body: {
            command_id: id,
            command_type: "journey.update",
            command_version: 2,
            payload: {
              journey_id: id,
              name: "Japan",
              start_date: null,
              end_date: null,
              status: "planning",
              expected_record_version: 1,
            },
          },
        },
      ),
    ).rejects.toMatchObject({ code: "command_version_mismatch" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  test.each([
    "https://example.test",
    "//example.test",
    "/\\\\example.test",
    "/\n/example.test",
    "/\t/example.test",
    " /api",
  ])(
    "rejects cross-origin or ambiguous base URL %j before any request",
    (baseUrl) => {
      const request = vi.fn<typeof fetch>();
      expect(() => new TraxApiClient({ baseUrl, request })).toThrow(
        "same-origin",
      );
      expect(request).not.toHaveBeenCalled();
    },
  );
});
