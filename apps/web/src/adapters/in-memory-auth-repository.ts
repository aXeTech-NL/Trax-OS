import type {
  AuthRepository,
  AuthUser,
  LoginInput,
  RegisterInput,
} from "../repositories/auth-repository";

const USER: AuthUser = {
  id: "user-1",
  email: "owner@example.com",
  displayName: "Owner",
  workspaceId: "workspace-1",
};
export class InMemoryAuthRepository implements AuthRepository {
  constructor(private user: AuthUser | null = USER) {}
  session(): Promise<AuthUser | null> {
    return Promise.resolve(this.user);
  }
  register(input: RegisterInput): Promise<AuthUser> {
    this.user = { ...USER, email: input.email, displayName: input.displayName };
    return Promise.resolve(this.user);
  }
  login(input: LoginInput): Promise<AuthUser> {
    this.user = { ...USER, email: input.email };
    return Promise.resolve(this.user);
  }
  logout(): Promise<void> {
    this.user = null;
    return Promise.resolve();
  }
}
