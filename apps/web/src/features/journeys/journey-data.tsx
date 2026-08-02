import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  RepositoryError,
  type JourneyRepository,
} from "../../repositories/journey-repository";
import { EMPTY_JOURNEY_DATA, type JourneyData } from "./domain";

interface JourneyDataValue {
  readonly data: JourneyData;
  readonly status: "loading" | "ready" | "error";
  readonly storageError: boolean;
  readonly commit: (next: JourneyData) => Promise<boolean>;
  readonly retry: () => void;
}

const JourneyDataContext = createContext<JourneyDataValue | null>(null);

export function JourneyDataProvider({
  repository,
  onAuthenticationRequired,
  children,
}: {
  readonly repository: JourneyRepository;
  readonly onAuthenticationRequired?: () => void;
  readonly children: ReactNode;
}) {
  const [data, setData] = useState<JourneyData>(EMPTY_JOURNEY_DATA);
  const [status, setStatus] = useState<JourneyDataValue["status"]>("loading");
  const [storageError, setStorageError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    void repository
      .load()
      .then((stored) => {
        if (!active) return;
        setData(stored);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (
          error instanceof RepositoryError &&
          error.code === "authentication_required"
        ) {
          onAuthenticationRequired?.();
          return;
        }
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [repository, attempt, onAuthenticationRequired]);

  const commit = useCallback(
    async (next: JourneyData) => {
      try {
        const persisted = await repository.save(next);
        setData(persisted);
        setStorageError(false);
        return true;
      } catch (error) {
        if (
          error instanceof RepositoryError &&
          error.code === "authentication_required"
        ) {
          onAuthenticationRequired?.();
        }
        setStorageError(true);
        return false;
      }
    },
    [repository, onAuthenticationRequired],
  );

  const value = useMemo(
    () => ({
      data,
      status,
      storageError,
      commit,
      retry: () => setAttempt((value) => value + 1),
    }),
    [data, status, storageError, commit],
  );
  return (
    <JourneyDataContext.Provider value={value}>
      {children}
    </JourneyDataContext.Provider>
  );
}

export function useJourneyData() {
  const value = useContext(JourneyDataContext);
  if (!value) throw new Error("JourneyDataProvider is missing");
  return value;
}
