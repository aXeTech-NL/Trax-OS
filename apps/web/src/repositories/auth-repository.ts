export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly workspaceId: string;
}

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export interface AuthRepository {
  session(): Promise<AuthUser | null>;
  register(input: RegisterInput): Promise<AuthUser>;
  login(input: LoginInput): Promise<AuthUser>;
  logout(): Promise<void>;
}
