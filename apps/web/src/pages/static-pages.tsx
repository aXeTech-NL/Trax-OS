import { AppLink } from "../components/app-link";
import { InstanceStatus } from "../components/instance-status";
import { useI18n } from "../i18n/i18n";
import type { InstanceRepository } from "../repositories/instance-repository";
import { routes } from "../routes";

export function DataSettingsPage() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="narrow-page page-stack">
      <header className="page-header">
        <p className="eyebrow">{t("settings.eyebrow")}</p>
        <h1>{t("settings.title")}</h1>
      </header>
      <section className="info-card">
        <h2>{t("settings.languageTitle")}</h2>
        <label htmlFor="settings-locale">
          {t("locale.label")}
          <select
            id="settings-locale"
            value={locale}
            onChange={(event) =>
              setLocale(event.target.value === "nl" ? "nl" : "en")
            }
          >
            <option value="en">{t("locale.en")}</option>
            <option value="nl">{t("locale.nl")}</option>
          </select>
        </label>
      </section>
      <section className="info-card">
        <h2>{t("settings.storageTitle")}</h2>
        <p>{t("settings.storageText")}</p>
        <p className="warning">
          <strong>{t("common.serverBacked")}:</strong>{" "}
          {t("settings.storageWarning")}
        </p>
      </section>
      <section className="info-card">
        <h2>{t("settings.offlineTitle")}</h2>
        <p>{t("settings.offlineText")}</p>
      </section>
    </div>
  );
}

export function AboutPage({
  repository,
}: {
  readonly repository: InstanceRepository;
}) {
  const { t } = useI18n();
  return (
    <div className="page-stack">
      <article className="content-page">
        <p className="eyebrow">{t("about.eyebrow")}</p>
        <h1>{t("about.title")}</h1>
        <p>{t("about.text")}</p>
      </article>
      <section aria-labelledby="instance-title">
        <h2 id="instance-title">{t("about.instance")}</h2>
        <InstanceStatus repository={repository} />
      </section>
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <article className="content-page">
      <p className="eyebrow">{t("notFound.eyebrow")}</p>
      <h1>{t("notFound.title")}</h1>
      <p>{t("notFound.text")}</p>
      <AppLink className="button-link primary" to={routes.journeys}>
        {t("journey.back")}
      </AppLink>
    </article>
  );
}
