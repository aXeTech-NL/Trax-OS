import { describe, expect, test, vi } from "vitest";

import {
  HttpInstanceRepository,
  InstanceRepositoryError,
} from "./http-instance-repository";

describe("HttpInstanceRepository", () => {
  test("maps version and capabilities from the public contract", async () => {
    const request = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((url) => {
        const address =
          typeof url === "string"
            ? url
            : url instanceof URL
              ? url.href
              : url.url;
        const body = address.endsWith("/version")
          ? { application: "Trax OS", version: "0.1.0", api_version: "1" }
          : {
              schema_version: "1",
              capabilities: [
                { key: "foundation.contract-discovery", status: "available" },
              ],
            };
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      });

    const result = await new HttpInstanceRepository(
      "https://example.test/api/v1",
      request,
    ).getInstance();

    expect(result).toEqual({
      application: "Trax OS",
      version: "0.1.0",
      apiVersion: "1",
      capabilities: [
        { key: "foundation.contract-discovery", status: "available" },
      ],
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  test("normalizes malformed JSON from a successful response", async () => {
    const request = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response("{not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      new HttpInstanceRepository("/api/v1", request).getInstance(),
    ).rejects.toEqual(
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
      { schema_version: "1", capabilities: [] },
    ],
    [
      "capabilities",
      { application: "Trax OS", version: "0.1.0", api_version: "1" },
      { schema_version: "1", capabilities: { key: "not-an-array" } },
    ],
  ])(
    "normalizes a wrong %s payload shape",
    async (_name, version, capabilities) => {
      const request = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation((url) => {
          const address =
            typeof url === "string"
              ? url
              : url instanceof URL
                ? url.href
                : url.url;
          const body = address.endsWith("/version") ? version : capabilities;
          return Promise.resolve(
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        });

      await expect(
        new HttpInstanceRepository("/api/v1", request).getInstance(),
      ).rejects.toEqual(
        expect.objectContaining<Partial<InstanceRepositoryError>>({
          code: "invalid_response",
          message: "The Trax OS API returned an invalid response.",
        }),
      );
    },
  );

  test("maps a stable API error without component-level HTTP knowledge", async () => {
    const request = vi.fn<typeof globalThis.fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: "provider_unavailable",
              message: "Temporarily unavailable.",
              details: {},
              request_id: "req_test",
            },
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const repository = new HttpInstanceRepository("/api/v1", request);

    await expect(repository.getInstance()).rejects.toEqual(
      expect.objectContaining<Partial<InstanceRepositoryError>>({
        code: "provider_unavailable",
        requestId: "req_test",
      }),
    );
  });

  test("normalizes network failures", async () => {
    const request = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError("network detail"));

    await expect(
      new HttpInstanceRepository("/api/v1", request).getInstance(),
    ).rejects.toThrow("The Trax OS API could not be reached.");
  });
});
