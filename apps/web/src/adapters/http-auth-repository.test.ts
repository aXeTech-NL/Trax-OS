import { afterEach, expect, test, vi } from "vitest";

import { HttpAuthRepository } from "./http-auth-repository";

afterEach(() => vi.unstubAllGlobals());

const userResponse = {
  authenticated: true,
  user: {
    id: "u1",
    email: "owner@example.com",
    display_name: "Owner",
    workspace_id: "w1",
  },
};

test("bootstraps anonymous and maps registration", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: "authentication_required" } }),
        { status: 401 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(userResponse), { status: 201 }),
    );
  vi.stubGlobal("fetch", fetch);
  const repository = new HttpAuthRepository();
  await expect(repository.session()).resolves.toBeNull();
  await expect(
    repository.register({
      email: "owner@example.com",
      password: "correct horse battery staple",
      displayName: "Owner",
    }),
  ).resolves.toEqual({
    id: "u1",
    email: "owner@example.com",
    displayName: "Owner",
    workspaceId: "w1",
  });
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({
    method: "POST",
    credentials: "same-origin",
  });
});

test("sends the double-submit CSRF token on logout", async () => {
  document.cookie = "trax_csrf=csrf-value; path=/";
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ authenticated: false }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetch);
  await new HttpAuthRepository().logout();
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    headers: { "X-CSRF-Token": "csrf-value" },
  });
});
