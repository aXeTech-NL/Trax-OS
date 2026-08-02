import type {
  AuthRepository,
  AuthUser,
  LoginInput,
  RegisterInput,
} from "../repositories/auth-repository";

export class HttpAuthRepository implements AuthRepository {
  async session(): Promise<AuthUser | null> {
    const response = await fetch("/api/v1/auth/session", {
      credentials: "same-origin",
    });
    if (response.status === 401) return null;
    return userFrom(await json(response));
  }

  async register(input: RegisterInput): Promise<AuthUser> {
    return userFrom(
      await json(
        await fetch("/api/v1/auth/register", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: input.email,
            password: input.password,
            display_name: input.displayName,
          }),
        }),
      ),
    );
  }

  async login(input: LoginInput): Promise<AuthUser> {
    return userFrom(
      await json(
        await fetch("/api/v1/auth/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      ),
    );
  }

  async logout(): Promise<void> {
    await json(
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": csrfToken() },
      }),
    );
  }
}

function csrfToken(): string {
  const value = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith("trax_csrf="))
    ?.split("=")[1];
  return value ? decodeURIComponent(value) : "";
}

async function json(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = errorCode(body);
    throw new Error(
      code === "invalid_credentials" ? code : code || "server_error",
    );
  }
  return body;
}

function errorCode(value: unknown): string {
  if (!record(value) || !record(value.error)) return "";
  return typeof value.error.code === "string" ? value.error.code : "";
}

function userFrom(value: unknown): AuthUser {
  if (!record(value) || !record(value.user))
    throw new Error("invalid_response");
  const user = value.user;
  if (
    typeof user.id !== "string" ||
    typeof user.email !== "string" ||
    typeof user.display_name !== "string" ||
    typeof user.workspace_id !== "string"
  ) {
    throw new Error("invalid_response");
  }
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    workspaceId: user.workspace_id,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
