import { type FormEvent, useState } from "react";

import { AppLink } from "../../components/app-link";
import { useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/catalog";
import { routes } from "../../routes";
import {
  type Journey,
  type JourneyInput,
  packingForJourney,
  packingProgress,
  segmentsForJourney,
} from "./domain";
import { useJourneyData } from "./journey-data";
import {
  browserRuntime,
  createJourney,
  deleteJourney,
  JourneyValidationError,
  setJourneyStatus,
  updateJourney,
} from "./journey-service";

function navigate(to: string) {
  window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function JourneyLibraryPage() {
  const { data } = useJourneyData();
  const { t, formatDateRange } = useI18n();
  const active = data.journeys.filter(
    (journey) => journey.status !== "archived",
  );
  const archived = data.journeys.filter(
    (journey) => journey.status === "archived",
  );
  return (
    <div className="page-stack">
      <header className="page-header split-header">
        <div>
          <p className="eyebrow">{t("journeys.eyebrow")}</p>
          <h1>{t("journeys.title")}</h1>
          <p>{t("journeys.intro")}</p>
        </div>
        <AppLink className="button-link primary" to={routes.newJourney}>
          {t("journeys.new")}
        </AppLink>
      </header>
      {active.length === 0 && archived.length === 0 ? (
        <section className="empty-state">
          <div className="route-mark" aria-hidden="true">
            ⌁
          </div>
          <h2>{t("journeys.emptyTitle")}</h2>
          <p>{t("journeys.emptyText")}</p>
          <AppLink className="button-link primary" to={routes.newJourney}>
            {t("journey.create")}
          </AppLink>
        </section>
      ) : (
        <>
          <JourneyCards
            sectionId="active-journeys"
            title={t("journeys.active")}
            journeys={active}
            formatDateRange={formatDateRange}
          />
          {archived.length > 0 && (
            <JourneyCards
              sectionId="archived-journeys"
              title={t("journeys.archived")}
              journeys={archived}
              formatDateRange={formatDateRange}
            />
          )}
        </>
      )}
    </div>
  );
}

function JourneyCards({
  sectionId,
  title,
  journeys,
  formatDateRange,
}: {
  readonly sectionId: string;
  readonly title: string;
  readonly journeys: readonly Journey[];
  readonly formatDateRange: (
    start: string | null,
    end: string | null,
  ) => string;
}) {
  const { data } = useJourneyData();
  const { t } = useI18n();
  if (journeys.length === 0) return null;
  return (
    <section aria-labelledby={sectionId}>
      <h2 id={sectionId}>{title}</h2>
      <div className="card-grid">
        {journeys.map((journey) => {
          const progress = packingProgress(packingForJourney(data, journey.id));
          return (
            <article className="journey-card" key={journey.id}>
              <div className="card-topline">
                <span className={`status-badge status-${journey.status}`}>
                  {t(`journey.status.${journey.status}` as MessageKey)}
                </span>
                <span>{t("common.saved")}</span>
              </div>
              <h3>{journey.name}</h3>
              <p>{formatDateRange(journey.startDate, journey.endDate)}</p>
              <p>{t("journey.packingSummary", progress)}</p>
              <AppLink className="card-link" to={routes.journey(journey.id)}>
                {t("journeys.open")} <span aria-hidden="true">→</span>
              </AppLink>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function JourneyEditorPage() {
  const { data, commit } = useJourneyData();
  const { t } = useI18n();
  const [input, setInput] = useState<JourneyInput>({
    name: "",
    startDate: "",
    endDate: "",
  });
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const result = createJourney(data, input, browserRuntime);
      setSaving(true);
      if (await commit(result.data))
        navigate(routes.journey(result.journey.id));
    } catch (error) {
      if (error instanceof JourneyValidationError) setErrors(error.codes);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="narrow-page">
      <AppLink className="back-link" to={routes.journeys}>
        ← {t("journey.back")}
      </AppLink>
      <p className="eyebrow">{t("journeys.eyebrow")}</p>
      <h1>{t("journey.createTitle")}</h1>
      <JourneyForm
        input={input}
        setInput={setInput}
        errors={errors}
        onSubmit={(event) => void submit(event)}
        submitLabel={t("journey.create")}
        saving={saving}
      />
    </div>
  );
}

export function JourneyOverviewPage({
  journey,
}: {
  readonly journey: Journey;
}) {
  const { data, commit } = useJourneyData();
  const { t, formatDateRange, formatDate } = useI18n();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [input, setInput] = useState<JourneyInput>({
    name: journey.name,
    startDate: journey.startDate ?? "",
    endDate: journey.endDate ?? "",
  });
  const [errors, setErrors] = useState<readonly string[]>([]);
  const timeline = segmentsForJourney(data, journey.id);
  const items = packingForJourney(data, journey.id);
  const progress = packingProgress(items);
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const next = timeline.find(
    (segment) => !segment.endDate || segment.endDate >= today,
  );
  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    try {
      const nextData = updateJourney(data, journey.id, input, browserRuntime);
      if (await commit(nextData)) setEditing(false);
    } catch (error) {
      if (error instanceof JourneyValidationError) setErrors(error.codes);
    }
  }
  async function remove() {
    if (await commit(deleteJourney(data, journey.id)))
      navigate(routes.journeys);
  }
  async function archive() {
    await commit(
      setJourneyStatus(
        data,
        journey.id,
        journey.status === "archived" ? "planning" : "archived",
        browserRuntime,
      ),
    );
  }
  async function advanceStatus() {
    const status =
      journey.status === "planning"
        ? "active"
        : journey.status === "active"
          ? "completed"
          : "planning";
    await commit(setJourneyStatus(data, journey.id, status, browserRuntime));
  }
  const statusAction =
    journey.status === "planning"
      ? t("journey.start")
      : journey.status === "active"
        ? t("journey.complete")
        : t("journey.reopen");
  const nextName =
    next?.kind === "stay"
      ? next.placeName
      : next
        ? `${next.originName} → ${next.destinationName}`
        : null;
  return (
    <div className="page-stack">
      <AppLink className="back-link" to={routes.journeys}>
        ← {t("journey.back")}
      </AppLink>
      <header className="page-header split-header">
        <div>
          <p className="eyebrow">
            {t(`journey.status.${journey.status}` as MessageKey)}
          </p>
          <h1>{journey.name}</h1>
          <p>{formatDateRange(journey.startDate, journey.endDate)}</p>
        </div>
        <span className="local-chip">{t("common.saved")}</span>
      </header>
      {editing ? (
        <JourneyForm
          input={input}
          setInput={setInput}
          errors={errors}
          onSubmit={(event) => void saveEdit(event)}
          submitLabel={t("common.save")}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="action-row">
          <button type="button" onClick={() => setEditing(true)}>
            {t("common.edit")}
          </button>
          {journey.status !== "archived" && (
            <button
              className="secondary"
              type="button"
              onClick={() => void advanceStatus()}
            >
              {statusAction}
            </button>
          )}
          <button
            className="secondary"
            type="button"
            onClick={() => void archive()}
          >
            {journey.status === "archived"
              ? t("common.restore")
              : t("common.archive")}
          </button>
          <button
            className="danger secondary"
            type="button"
            onClick={() => setConfirming(true)}
          >
            {t("common.delete")}
          </button>
        </div>
      )}
      {confirming && (
        <section
          className="confirmation"
          role="alertdialog"
          aria-labelledby="delete-title"
        >
          <h2 id="delete-title">{t("journey.deleteTitle")}</h2>
          <p>{t("journey.deleteText")}</p>
          <div className="action-row">
            <button
              className="danger"
              type="button"
              onClick={() => void remove()}
            >
              {t("journey.deleteConfirm")}
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => setConfirming(false)}
            >
              {t("common.cancel")}
            </button>
          </div>
        </section>
      )}
      <section className="spotlight">
        <div>
          <p className="eyebrow">{t("journey.next")}</p>
          <h2>{nextName ?? t("journey.nextEmpty")}</h2>
          {next && <p>{formatDate(next.startDate)}</p>}
        </div>
        <div className="route-mark" aria-hidden="true">
          ⌁
        </div>
      </section>
      <div className="summary-grid">
        <AppLink className="summary-card" to={routes.timeline(journey.id)}>
          <span className="summary-icon" aria-hidden="true">
            ↝
          </span>
          <div>
            <h2>{t("nav.timeline")}</h2>
            <p>{t("journey.timelineSummary", { count: timeline.length })}</p>
          </div>
        </AppLink>
        <AppLink className="summary-card" to={routes.packing(journey.id)}>
          <span className="summary-icon" aria-hidden="true">
            ✓
          </span>
          <div>
            <h2>{t("nav.packing")}</h2>
            <p>{t("journey.packingSummary", progress)}</p>
            <progress max={progress.total || 1} value={progress.packed}>
              {progress.packed}
            </progress>
          </div>
        </AppLink>
      </div>
    </div>
  );
}

function JourneyForm({
  input,
  setInput,
  errors,
  onSubmit,
  submitLabel,
  saving = false,
  onCancel,
}: {
  readonly input: JourneyInput;
  readonly setInput: (input: JourneyInput) => void;
  readonly errors: readonly string[];
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly submitLabel: string;
  readonly saving?: boolean;
  readonly onCancel?: () => void;
}) {
  const { t } = useI18n();
  return (
    <form className="form-card" onSubmit={onSubmit} noValidate>
      {errors.length > 0 && (
        <div className="form-errors" role="alert">
          {errors.map((error) => (
            <p key={error}>{t(`error.${error}` as MessageKey)}</p>
          ))}
        </div>
      )}
      <label>
        {t("journey.name")} <span aria-hidden="true">*</span>
        <input
          required
          value={input.name}
          onChange={(event) => setInput({ ...input, name: event.target.value })}
        />
      </label>
      <div className="field-grid">
        <label>
          {t("journey.startDate")}
          <input
            type="date"
            value={input.startDate}
            onChange={(event) =>
              setInput({ ...input, startDate: event.target.value })
            }
          />
        </label>
        <label>
          {t("journey.endDate")}
          <input
            type="date"
            value={input.endDate}
            onChange={(event) =>
              setInput({ ...input, endDate: event.target.value })
            }
          />
        </label>
      </div>
      <div className="action-row">
        <button disabled={saving} type="submit">
          {submitLabel}
        </button>
        {onCancel && (
          <button className="secondary" type="button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
