import { ApiClientError, TraxApiClient } from "@trax-os/api-client";

import type {
  AuthRepository,
  AuthUser,
  LoginInput,
  RegisterInput,
} from "../repositories/auth-repository";

export class HttpAuthRepository implements AuthRepository {
  constructor(private readonly client = new TraxApiClient()) {}

  async session(): Promise<AuthUser | null> {
    try {
      return userFrom(
        await this.client.request("session_route_api_v1_auth_session_get", {}),
      );
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) return null;
      throw repositoryError(error);
    }
  }

  async register(input: RegisterInput): Promise<AuthUser> {
    try {
      return userFrom(
        await this.client.request("register_route_api_v1_auth_register_post", {
          body: {
            email: input.email,
            password: input.password,
            display_name: input.displayName,
          },
        }),
      );
    } catch (error) {
      throw repositoryError(error);
    }
  }

  async login(input: LoginInput): Promise<AuthUser> {
    try {
      return userFrom(
        await this.client.request("login_route_api_v1_auth_login_post", {
          body: input,
        }),
      );
    } catch (error) {
      throw repositoryError(error);
    }
  }

  async logout(): Promise<void> {
    try {
      await this.client.request("logout_route_api_v1_auth_logout_post", {});
    } catch (error) {
      throw repositoryError(error);
    }
  }
}

function repositoryError(error: unknown): Error {
  if (error instanceof ApiClientError)
    return new Error(
      error.code === "invalid_credentials"
        ? error.code
        : error.code || "server_error",
    );
  return error instanceof Error ? error : new Error("server_error");
}

function userFrom(value: {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly display_name: string;
    readonly workspace_id: string;
  };
}): AuthUser {
  return {
    id: value.user.id,
    email: value.user.email,
    displayName: value.user.display_name,
    workspaceId: value.user.workspace_id,
  };
}
