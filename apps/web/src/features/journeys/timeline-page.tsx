import { type FormEvent, useState } from "react";

import { AppLink } from "../../components/app-link";
import { useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/catalog";
import { routes } from "../../routes";
import type {
  Journey,
  JourneySegment,
  SegmentKind,
  SegmentInput,
} from "./domain";
import { segmentsForJourney } from "./domain";
import { useJourneyData } from "./journey-data";
import {
  browserRuntime,
  deleteSegment,
  JourneyValidationError,
  moveSegment,
  saveSegment,
} from "./journey-service";

interface SegmentDraft {
  readonly kind: SegmentKind;
  readonly placeName: string;
  readonly originName: string;
  readonly destinationName: string;
  readonly transportMode: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly notes: string;
}

const EMPTY_DRAFT: SegmentDraft = {
  kind: "stay",
  placeName: "",
  originName: "",
  destinationName: "",
  transportMode: "",
  startDate: "",
  endDate: "",
  notes: "",
};

export function TimelinePage({ journey }: { readonly journey: Journey }) {
  const { data, commit } = useJourneyData();
  const { t, formatDateRange } = useI18n();
  const [draft, setDraft] = useState<SegmentDraft | null>(null);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const timeline = segmentsForJourney(data, journey.id);

  function begin(kind: SegmentKind, segment?: JourneySegment) {
    setEditingId(segment?.id);
    setErrors([]);
    if (!segment) {
      setDraft({ ...EMPTY_DRAFT, kind });
    } else if (segment.kind === "stay") {
      setDraft({
        ...EMPTY_DRAFT,
        kind: "stay",
        placeName: segment.placeName,
        startDate: segment.startDate ?? "",
        endDate: segment.endDate ?? "",
        notes: segment.notes,
      });
    } else {
      setDraft({
        ...EMPTY_DRAFT,
        kind: "move",
        originName: segment.originName,
        destinationName: segment.destinationName,
        transportMode: segment.transportMode,
        startDate: segment.startDate ?? "",
        endDate: segment.endDate ?? "",
        notes: segment.notes,
      });
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const input: SegmentInput =
      draft.kind === "stay"
        ? {
            kind: "stay",
            placeName: draft.placeName,
            startDate: draft.startDate,
            endDate: draft.endDate,
            notes: draft.notes,
          }
        : {
            kind: "move",
            originName: draft.originName,
            destinationName: draft.destinationName,
            transportMode: draft.transportMode,
            startDate: draft.startDate,
            endDate: draft.endDate,
            notes: draft.notes,
          };
    try {
      const next = saveSegment(
        data,
        journey.id,
        input,
        browserRuntime,
        editingId,
      );
      if (await commit(next)) {
        setDraft(null);
        setEditingId(undefined);
        setAnnouncement(t("timeline.saved"));
      }
    } catch (error) {
      if (error instanceof JourneyValidationError) setErrors(error.codes);
    }
  }

  async function reorder(id: string, direction: -1 | 1) {
    if (
      await commit(moveSegment(data, journey.id, id, direction, browserRuntime))
    )
      setAnnouncement(t("timeline.reordered"));
  }

  return (
    <div className="page-stack">
      <AppLink className="back-link" to={routes.journey(journey.id)}>
        ← {journey.name}
      </AppLink>
      <header className="page-header split-header">
        <div>
          <p className="eyebrow">{t("timeline.eyebrow")}</p>
          <h1>{t("timeline.title")}</h1>
        </div>
        <div className="action-row">
          <button type="button" onClick={() => begin("stay")}>
            {t("timeline.addStay")}
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => begin("move")}
          >
            {t("timeline.addMove")}
          </button>
        </div>
      </header>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {draft && (
        <SegmentForm
          draft={draft}
          setDraft={setDraft}
          errors={errors}
          onSubmit={(event) => void submit(event)}
          onCancel={() => setDraft(null)}
          editing={Boolean(editingId)}
        />
      )}
      {timeline.length === 0 ? (
        <section className="empty-state">
          <div className="route-mark" aria-hidden="true">
            ↝
          </div>
          <h2>{t("timeline.emptyTitle")}</h2>
          <p>{t("timeline.emptyText")}</p>
        </section>
      ) : (
        <ol className="timeline-list">
          {timeline.map((segment, index) => {
            const title =
              segment.kind === "stay"
                ? segment.placeName
                : `${segment.originName} → ${segment.destinationName}`;
            return (
              <li key={segment.id} className="timeline-item">
                <div className="timeline-marker" aria-hidden="true">
                  {index + 1}
                </div>
                <article>
                  <div className="card-topline">
                    <span className="status-badge">
                      {t(
                        segment.kind === "stay"
                          ? "timeline.stay"
                          : "timeline.move",
                      )}
                    </span>
                    <span>
                      {t("timeline.position", {
                        current: index + 1,
                        total: timeline.length,
                      })}
                    </span>
                  </div>
                  <h2>{title}</h2>
                  <p>
                    {segment.startDate || segment.endDate
                      ? formatDateRange(segment.startDate, segment.endDate)
                      : t("timeline.noDate")}
                  </p>
                  {segment.kind === "move" && segment.transportMode && (
                    <p>{segment.transportMode}</p>
                  )}
                  {segment.notes && <p>{segment.notes}</p>}
                  <div className="icon-actions">
                    <button
                      className="icon-button"
                      type="button"
                      disabled={index === 0}
                      onClick={() => void reorder(segment.id, -1)}
                      aria-label={t("timeline.up")}
                    >
                      ↑
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      disabled={index === timeline.length - 1}
                      onClick={() => void reorder(segment.id, 1)}
                      aria-label={t("timeline.down")}
                    >
                      ↓
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => begin(segment.kind, segment)}
                    >
                      {t("common.edit")}
                    </button>
                    <button
                      className="danger secondary"
                      type="button"
                      onClick={() =>
                        void commit(
                          deleteSegment(
                            data,
                            journey.id,
                            segment.id,
                            browserRuntime,
                          ),
                        )
                      }
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function SegmentForm({
  draft,
  setDraft,
  errors,
  onSubmit,
  onCancel,
  editing,
}: {
  readonly draft: SegmentDraft;
  readonly setDraft: (draft: SegmentDraft) => void;
  readonly errors: readonly string[];
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly onCancel: () => void;
  readonly editing: boolean;
}) {
  const { t } = useI18n();
  return (
    <form className="form-card route-form" onSubmit={onSubmit} noValidate>
      <div className="split-header">
        <h2>
          {editing
            ? t(
                draft.kind === "stay"
                  ? "timeline.editStay"
                  : "timeline.editMove",
              )
            : t(
                draft.kind === "stay" ? "timeline.addStay" : "timeline.addMove",
              )}
        </h2>
        <button className="text-button" type="button" onClick={onCancel}>
          {t("common.close")}
        </button>
      </div>
      {errors.length > 0 && (
        <div className="form-errors" role="alert">
          {errors.map((error) => (
            <p key={error}>{t(`error.${error}` as MessageKey)}</p>
          ))}
        </div>
      )}
      {!editing && (
        <fieldset>
          <legend>{t("timeline.kind")}</legend>
          <label className="radio-label">
            <input
              type="radio"
              name="kind"
              checked={draft.kind === "stay"}
              onChange={() => setDraft({ ...draft, kind: "stay" })}
            />
            {t("timeline.stay")}
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="kind"
              checked={draft.kind === "move"}
              onChange={() => setDraft({ ...draft, kind: "move" })}
            />
            {t("timeline.move")}
          </label>
        </fieldset>
      )}
      {draft.kind === "stay" ? (
        <label>
          {t("timeline.place")}
          <input
            value={draft.placeName}
            onChange={(event) =>
              setDraft({ ...draft, placeName: event.target.value })
            }
          />
        </label>
      ) : (
        <div className="field-grid">
          <label>
            {t("timeline.origin")}
            <input
              value={draft.originName}
              onChange={(event) =>
                setDraft({ ...draft, originName: event.target.value })
              }
            />
          </label>
          <label>
            {t("timeline.destination")}
            <input
              value={draft.destinationName}
              onChange={(event) =>
                setDraft({ ...draft, destinationName: event.target.value })
              }
            />
          </label>
          <label>
            {t("timeline.transport")}
            <input
              value={draft.transportMode}
              onChange={(event) =>
                setDraft({ ...draft, transportMode: event.target.value })
              }
            />
          </label>
        </div>
      )}
      <div className="field-grid">
        <label>
          {t("journey.startDate")}
          <input
            type="date"
            value={draft.startDate}
            onChange={(event) =>
              setDraft({ ...draft, startDate: event.target.value })
            }
          />
        </label>
        <label>
          {t("journey.endDate")}
          <input
            type="date"
            value={draft.endDate}
            onChange={(event) =>
              setDraft({ ...draft, endDate: event.target.value })
            }
          />
        </label>
      </div>
      <label>
        {t("timeline.notes")}
        <textarea
          rows={3}
          value={draft.notes}
          onChange={(event) =>
            setDraft({ ...draft, notes: event.target.value })
          }
        />
      </label>
      <div className="action-row">
        <button type="submit">{t("common.save")}</button>
        <button className="secondary" type="button" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
