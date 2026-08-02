import { type ChangeEvent, useState } from "react";

import { downloadLocalBackup } from "../adapters/browser-backup";
import { AppLink } from "../components/app-link";
import { readLocalBackup } from "../features/journeys/backup";
import { useJourneyData } from "../features/journeys/journey-data";
import type { JourneyData } from "../features/journeys/domain";
import { InstanceStatus } from "../components/instance-status";
import { useI18n } from "../i18n/i18n";
import type { InstanceRepository } from "../repositories/instance-repository";
import { routes } from "../routes";

export function DataSettingsPage() {
  const { data, commit } = useJourneyData();
  const { locale, setLocale, t } = useI18n();
  const [pendingImport, setPendingImport] = useState<JourneyData | null>(null);
  const [message, setMessage] = useState("");
  const [importError, setImportError] = useState(false);

  async function chooseBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPendingImport(null);
    setMessage("");
    setImportError(false);
    if (!file) return;
    try {
      const source = await file.text();
      setPendingImport(readLocalBackup(source));
    } catch (error) {
      setImportError(true);
      setMessage(
        error instanceof Error && error.message === "invalid_backup"
          ? t("settings.importInvalid")
          : t("settings.importReadError"),
      );
    } finally {
      event.target.value = "";
    }
  }

  async function restoreBackup() {
    if (!pendingImport) return;
    if (await commit(pendingImport)) {
      setPendingImport(null);
      setImportError(false);
      setMessage(t("settings.importSuccess"));
    }
  }

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
          <strong>{t("common.localOnly")}:</strong>{" "}
          {t("settings.storageWarning")}
        </p>
      </section>
      <section className="info-card">
        <h2>{t("settings.backupTitle")}</h2>
        <p>{t("settings.backupText")}</p>
        <div className="action-row">
          <button type="button" onClick={() => downloadLocalBackup(data)}>
            {t("settings.export")}
          </button>
          <label className="button-link secondary file-button">
            {t("settings.import")}
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => void chooseBackup(event)}
            />
          </label>
        </div>
        {pendingImport && (
          <div
            className="confirmation"
            role="alertdialog"
            aria-labelledby="restore-title"
            aria-describedby="restore-description"
          >
            <h3 id="restore-title">{t("settings.importConfirm")}</h3>
            <p id="restore-description">
              {t("settings.importPreview", {
                count: pendingImport.journeys.length,
              })}
            </p>
            <div className="action-row">
              <button
                className="danger"
                type="button"
                onClick={() => void restoreBackup()}
              >
                {t("settings.importConfirm")}
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => setPendingImport(null)}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        )}
        {message && (
          <p role={importError ? "alert" : "status"} aria-live="polite">
            {message}
          </p>
        )}
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
