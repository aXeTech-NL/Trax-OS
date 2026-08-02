import { useInstance } from "../hooks/use-instance";
import { useI18n } from "../i18n/i18n";
import type { InstanceRepository } from "../repositories/instance-repository";

interface InstanceStatusProps {
  readonly repository: InstanceRepository;
}

export function InstanceStatus({ repository }: InstanceStatusProps) {
  const { state, retry } = useInstance(repository);
  const { t } = useI18n();

  if (state.status === "loading") {
    return (
      <div className="status-card" aria-live="polite" aria-busy="true">
        <span className="status-dot status-dot--loading" aria-hidden="true" />
        <div>
          <h3>{t("instance.connecting")}</h3>
          <p>{t("instance.reading")}</p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="status-card status-card--error" role="alert">
        <span className="status-dot status-dot--error" aria-hidden="true" />
        <div>
          <h3>{t("instance.unavailable")}</h3>
          <p>{t("instance.unavailableText")}</p>
          <button type="button" onClick={retry}>
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="status-card status-card--success" aria-live="polite">
      <span className="status-dot status-dot--success" aria-hidden="true" />
      <div>
        <p className="eyebrow">{t("instance.connected")}</p>
        <h3>{state.instance.application}</h3>
        <dl className="instance-details">
          <div>
            <dt>{t("instance.version")}</dt>
            <dd>{state.instance.version}</dd>
          </div>
          <div>
            <dt>{t("instance.api")}</dt>
            <dd>v{state.instance.apiVersion}</dd>
          </div>
          <div>
            <dt>{t("instance.capabilities")}</dt>
            <dd>{state.instance.capabilities.length}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
