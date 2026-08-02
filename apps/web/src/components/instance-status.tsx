import { useInstance } from "../hooks/use-instance";
import type { InstanceRepository } from "../repositories/instance-repository";

interface InstanceStatusProps {
  readonly repository: InstanceRepository;
}

export function InstanceStatus({ repository }: InstanceStatusProps) {
  const { state, retry } = useInstance(repository);

  if (state.status === "loading") {
    return (
      <section className="status-card" aria-live="polite" aria-busy="true">
        <span className="status-dot status-dot--loading" aria-hidden="true" />
        <div>
          <h2>Connecting to this instance</h2>
          <p>Reading its public version and capabilities…</p>
        </div>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="status-card status-card--error" role="alert">
        <span className="status-dot status-dot--error" aria-hidden="true" />
        <div>
          <h2>Instance unavailable</h2>
          <p>
            The public API could not be reached. Check that the API development
            server is running.
          </p>
          <button type="button" onClick={retry}>
            Try again
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="status-card status-card--success" aria-live="polite">
      <span className="status-dot status-dot--success" aria-hidden="true" />
      <div>
        <p className="eyebrow">Instance connected</p>
        <h2>{state.instance.application}</h2>
        <dl className="instance-details">
          <div>
            <dt>Version</dt>
            <dd>{state.instance.version}</dd>
          </div>
          <div>
            <dt>API contract</dt>
            <dd>v{state.instance.apiVersion}</dd>
          </div>
          <div>
            <dt>Capabilities</dt>
            <dd>{state.instance.capabilities.length}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
