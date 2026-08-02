import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useI18n } from "../i18n/i18n";
import type { AuthRepository, AuthUser } from "../repositories/auth-repository";

type AuthState =
  | { readonly status: "loading" }
  | { readonly status: "anonymous" }
  | { readonly status: "authenticated"; readonly user: AuthUser }
  | { readonly status: "error" };

interface AuthValue {
  readonly state: AuthState;
  readonly anonymous: () => void;
  readonly logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({
  repository,
  children,
}: {
  readonly repository: AuthRepository;
  readonly children: ReactNode;
}) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    void repository
      .session()
      .then((user) => {
        if (active)
          setState(
            user ? { status: "authenticated", user } : { status: "anonymous" },
          );
      })
      .catch(() => active && setState({ status: "error" }));
    return () => {
      active = false;
    };
  }, [repository]);
  const value = useMemo<AuthValue>(
    () => ({
      state,
      anonymous: () => setState({ status: "anonymous" }),
      logout: async () => {
        await repository.logout();
        setState({ status: "anonymous" });
      },
    }),
    [repository, state],
  );
  if (state.status === "anonymous")
    return (
      <AuthScreen
        repository={repository}
        onAuthenticated={(user) => setState({ status: "authenticated", user })}
      />
    );
  if (state.status === "loading") return <AuthLoading />;
  if (state.status === "error")
    return (
      <AuthFrame>
        <AuthError />
      </AuthFrame>
    );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function AuthScreen({
  repository,
  onAuthenticated,
}: {
  readonly repository: AuthRepository;
  readonly onAuthenticated: (user: AuthUser) => void;
}) {
  const { t } = useI18n();
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const email = formString(form, "email");
      const password = formString(form, "password");
      const user = registering
        ? await repository.register({
            email,
            password,
            displayName: formString(form, "displayName"),
          })
        : await repository.login({ email, password });
      onAuthenticated(user);
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message === "invalid_credentials"
          ? t("auth.invalid")
          : t("auth.failed"),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthFrame>
      <p className="eyebrow">{t("auth.eyebrow")}</p>
      <h1>{registering ? t("auth.registerTitle") : t("auth.loginTitle")}</h1>
      <p>{t("auth.serverText")}</p>
      <form className="form-card" onSubmit={(event) => void submit(event)}>
        {error && (
          <p role="alert" className="form-errors">
            {error}
          </p>
        )}
        {registering && (
          <label>
            {t("auth.name")}
            <input
              name="displayName"
              required
              minLength={1}
              maxLength={120}
              autoComplete="name"
            />
          </label>
        )}
        <label>
          {t("auth.email")}
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          {t("auth.password")}
          <input
            name="password"
            type="password"
            required
            minLength={registering ? 12 : 1}
            maxLength={256}
            autoComplete={registering ? "new-password" : "current-password"}
          />
        </label>
        <button disabled={busy} type="submit">
          {registering ? t("auth.register") : t("auth.login")}
        </button>
      </form>
      <button
        className="text-button"
        type="button"
        onClick={() => {
          setRegistering(!registering);
          setError("");
        }}
      >
        {registering ? t("auth.haveAccount") : t("auth.needAccount")}
      </button>
    </AuthFrame>
  );
}

function AuthFrame({ children }: { readonly children: ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            X
          </span>
          <span>TRAX OS</span>
        </div>
        {children}
      </section>
    </main>
  );
}
function AuthLoading() {
  const { t } = useI18n();
  return (
    <AuthFrame>
      <p aria-live="polite">{t("common.loading")}</p>
    </AuthFrame>
  );
}

function AuthError() {
  const { t } = useI18n();
  return (
    <div role="alert">
      <h1>{t("auth.unavailable")}</h1>
      <p>{t("auth.unavailableText")}</p>
      <button type="button" onClick={() => window.location.reload()}>
        {t("common.retry")}
      </button>
    </div>
  );
}

function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}
