import { TraxApiClient } from "@trax-os/api-client";
import { afterEach, expect, test, vi } from "vitest";

import { HttpAuthRepository } from "./http-auth-repository";

afterEach(() => vi.unstubAllGlobals());

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
const userResponse = {
  authenticated: true,
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "owner@example.com",
    display_name: "Owner",
    workspace_id: "00000000-0000-4000-8000-000000000002",
  },
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("bootstraps anonymous and maps registration", async () => {
  const request = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(json(contract))
    .mockResolvedValueOnce(
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
    )
    .mockResolvedValueOnce(json(userResponse, 201));
  const repository = new HttpAuthRepository(new TraxApiClient({ request }));
  await expect(repository.session()).resolves.toBeNull();
  await expect(
    repository.register({
      email: "owner@example.com",
      password: "correct horse battery staple",
      displayName: "Owner",
    }),
  ).resolves.toEqual({
    id: userResponse.user.id,
    email: "owner@example.com",
    displayName: "Owner",
    workspaceId: userResponse.user.workspace_id,
  });
  expect(request.mock.calls[2]?.[1]).toMatchObject({
    method: "POST",
    credentials: "same-origin",
  });
});

test("sends the double-submit CSRF token on logout", async () => {
  const request = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(json(contract))
    .mockResolvedValueOnce(json({ authenticated: false }));
  const repository = new HttpAuthRepository(
    new TraxApiClient({ request, csrfToken: () => "csrf-value" }),
  );
  await repository.logout();
  expect(
    new Headers(request.mock.calls[1]?.[1]?.headers).get("X-CSRF-Token"),
  ).toBe("csrf-value");
});
