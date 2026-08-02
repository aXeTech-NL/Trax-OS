import { type FormEvent, useState } from "react";

import { AppLink } from "../../components/app-link";
import { useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/catalog";
import { routes } from "../../routes";
import {
  type Journey,
  type PackingCategory,
  type PackingInput,
  type PackingItem,
  packingForJourney,
  packingProgress,
} from "./domain";
import { useJourneyData } from "./journey-data";
import {
  browserRuntime,
  deletePackingItem,
  JourneyValidationError,
  savePackingItem,
  setPackedQuantity,
} from "./journey-service";

const CATEGORIES: readonly PackingCategory[] = [
  "documents",
  "clothing",
  "toiletries",
  "electronics",
  "other",
];
const EMPTY_INPUT: PackingInput = {
  label: "",
  category: "other",
  quantity: 1,
  essential: false,
};

export function PackingPage({ journey }: { readonly journey: Journey }) {
  const { data, commit } = useJourneyData();
  const { t } = useI18n();
  const [draft, setDraft] = useState<PackingInput | null>(null);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const items = packingForJourney(data, journey.id);
  const progress = packingProgress(items);

  function begin(item?: PackingItem) {
    setErrors([]);
    setEditingId(item?.id);
    setDraft(
      item
        ? {
            label: item.label,
            category: item.category,
            quantity: item.quantity,
            essential: item.essential,
          }
        : EMPTY_INPUT,
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    try {
      const next = savePackingItem(
        data,
        journey.id,
        draft,
        browserRuntime,
        editingId,
      );
      if (await commit(next)) {
        setDraft(null);
        setEditingId(undefined);
        setAnnouncement(t("packing.saved"));
      }
    } catch (error) {
      if (error instanceof JourneyValidationError) setErrors(error.codes);
    }
  }
  async function pack(item: PackingItem, next: number) {
    if (
      await commit(
        setPackedQuantity(data, journey.id, item.id, next, browserRuntime),
      )
    )
      setAnnouncement(t("packing.saved"));
  }

  return (
    <div className="page-stack">
      <AppLink className="back-link" to={routes.journey(journey.id)}>
        ← {journey.name}
      </AppLink>
      <header className="page-header split-header">
        <div>
          <p className="eyebrow">{t("packing.eyebrow")}</p>
          <h1>{t("packing.title")}</h1>
          <p>{t("packing.progress", progress)}</p>
          <progress
            className="wide-progress"
            max={progress.total || 1}
            value={progress.packed}
          >
            {progress.packed}
          </progress>
        </div>
        <button type="button" onClick={() => begin()}>
          {t("packing.add")}
        </button>
      </header>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {draft && (
        <PackingForm
          input={draft}
          setInput={setDraft}
          errors={errors}
          editing={Boolean(editingId)}
          onSubmit={(event) => void submit(event)}
          onCancel={() => setDraft(null)}
        />
      )}
      {items.length === 0 ? (
        <section className="empty-state">
          <div className="route-mark" aria-hidden="true">
            ✓
          </div>
          <h2>{t("packing.emptyTitle")}</h2>
          <p>{t("packing.emptyText")}</p>
        </section>
      ) : (
        CATEGORIES.map((category) => {
          const grouped = items.filter((item) => item.category === category);
          if (grouped.length === 0) return null;
          return (
            <section key={category} aria-labelledby={`category-${category}`}>
              <h2 id={`category-${category}`}>{t(`category.${category}`)}</h2>
              <ul className="packing-list">
                {grouped.map((item) => (
                  <li key={item.id} className="packing-item">
                    <div className="packing-main">
                      {item.quantity === 1 ? (
                        <input
                          type="checkbox"
                          aria-label={item.label}
                          checked={item.packedQuantity === 1}
                          onChange={(event) =>
                            void pack(item, event.target.checked ? 1 : 0)
                          }
                        />
                      ) : (
                        <div className="quantity-control">
                          <button
                            className="icon-button"
                            type="button"
                            aria-label={t("packing.decrease")}
                            disabled={item.packedQuantity === 0}
                            onClick={() =>
                              void pack(item, item.packedQuantity - 1)
                            }
                          >
                            −
                          </button>
                          <strong>
                            {item.packedQuantity}/{item.quantity}
                          </strong>
                          <button
                            className="icon-button"
                            type="button"
                            aria-label={t("packing.increase")}
                            disabled={item.packedQuantity === item.quantity}
                            onClick={() =>
                              void pack(item, item.packedQuantity + 1)
                            }
                          >
                            +
                          </button>
                        </div>
                      )}
                      <div>
                        <h3>{item.label}</h3>
                        {item.essential && (
                          <p className="essential">
                            ★ {t("packing.essential")}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="icon-actions">
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => begin(item)}
                      >
                        {t("common.edit")}
                      </button>
                      <button
                        className="danger secondary"
                        type="button"
                        aria-label={`${t("packing.remove")}: ${item.label}`}
                        onClick={() =>
                          void commit(
                            deletePackingItem(
                              data,
                              journey.id,
                              item.id,
                              browserRuntime,
                            ),
                          )
                        }
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

function PackingForm({
  input,
  setInput,
  errors,
  editing,
  onSubmit,
  onCancel,
}: {
  readonly input: PackingInput;
  readonly setInput: (input: PackingInput) => void;
  readonly errors: readonly string[];
  readonly editing: boolean;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <form className="form-card" onSubmit={onSubmit} noValidate>
      <div className="split-header">
        <h2>{editing ? t("packing.edit") : t("packing.add")}</h2>
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
      <div className="field-grid">
        <label>
          {t("packing.item")}
          <input
            value={input.label}
            onChange={(event) =>
              setInput({ ...input, label: event.target.value })
            }
          />
        </label>
        <label>
          {t("packing.category")}
          <select
            value={input.category}
            onChange={(event) =>
              setInput({
                ...input,
                category: event.target.value as PackingCategory,
              })
            }
          >
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(`category.${category}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("packing.quantity")}
          <input
            type="number"
            min="1"
            max="99"
            value={input.quantity}
            onChange={(event) =>
              setInput({ ...input, quantity: Number(event.target.value) })
            }
          />
        </label>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={input.essential}
          onChange={(event) =>
            setInput({ ...input, essential: event.target.checked })
          }
        />
        {t("packing.essential")}
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
