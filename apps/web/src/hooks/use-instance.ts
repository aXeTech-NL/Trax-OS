import { useEffect, useState } from "react";

import type {
  InstanceInfo,
  InstanceRepository,
} from "../repositories/instance-repository";

type InstanceState =
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly instance: InstanceInfo }
  | { readonly status: "error" };

export function useInstance(repository: InstanceRepository): {
  readonly state: InstanceState;
  readonly retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<InstanceState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void repository.getInstance().then(
      (instance) => {
        if (active) setState({ status: "success", instance });
      },
      () => {
        if (active) setState({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, repository]);

  return { state, retry: () => setAttempt((current) => current + 1) };
}
