import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { JourneyRepository } from "../../repositories/journey-repository";
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
  children,
}: {
  readonly repository: JourneyRepository;
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
      .catch(() => {
        if (!active) return;
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [repository, attempt]);

  const commit = useCallback(
    async (next: JourneyData) => {
      try {
        await repository.save(next);
        setData(next);
        setStorageError(false);
        return true;
      } catch {
        setStorageError(true);
        return false;
      }
    },
    [repository],
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
