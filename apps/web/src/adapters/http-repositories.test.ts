import { TraxApiClient } from "@trax-os/api-client";
import { expect, test, vi } from "vitest";

import { createHttpRepositories } from "./http-repositories";

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

test("production repositories share one cached negotiated client", async () => {
  let bootstraps = 0;
  const request = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation((input) => {
      const url = address(input);
      if (url === "/api/contract") {
        bootstraps += 1;
        return Promise.resolve(
          json({
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
          }),
        );
      }
      if (url.endsWith("/auth/session"))
        return Promise.resolve(
          json(
            {
              error: {
                code: "authentication_required",
                message: "Authentication required.",
                details: {},
                request_id: "req_auth",
              },
            },
            401,
          ),
        );
      if (url.endsWith("/version"))
        return Promise.resolve(
          json({ application: "Trax OS", version: "0.1.0", api_version: "1" }),
        );
      return Promise.resolve(
        json({
          schema_version: "1",
          capabilities: [
            { key: "foundation.contract-discovery", status: "available" },
          ],
        }),
      );
    });
  const repositories = createHttpRepositories(new TraxApiClient({ request }));

  const [session, instance] = await Promise.all([
    repositories.authRepository.session(),
    repositories.instanceRepository.getInstance(),
  ]);

  expect(session).toBeNull();
  expect(instance.apiVersion).toBe("1");
  expect(bootstraps).toBe(1);
});
