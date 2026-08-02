import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { JourneyRepository } from "../repositories/journey-repository";
import { en, type Locale, type MessageKey, nl } from "./catalog";

interface I18nValue {
  readonly locale: Locale;
  readonly setLocale: (locale: Locale) => void;
  readonly t: (
    key: MessageKey,
    values?: Record<string, string | number>,
  ) => string;
  readonly formatDate: (value: string | null) => string;
  readonly formatDateRange: (
    start: string | null,
    end: string | null,
  ) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function detectedLocale(): Locale {
  const languages = navigator.languages ?? [navigator.language];
  return languages.some((locale) => locale.toLowerCase().startsWith("nl"))
    ? "nl"
    : "en";
}

export function I18nProvider({
  repository,
  children,
}: {
  readonly repository: JourneyRepository;
  readonly children: ReactNode;
}) {
  const [locale, updateLocale] = useState<Locale>(detectedLocale);

  useEffect(() => {
    void repository
      .loadLocale()
      .then((saved) => {
        if (saved) updateLocale(saved);
      })
      .catch(() => undefined);
  }, [repository]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title =
      locale === "nl" ? "Trax OS · Reizen" : "Trax OS · Journeys";
  }, [locale]);

  const value = useMemo<I18nValue>(() => {
    const messages = locale === "nl" ? nl : en;
    const t = (key: MessageKey, values: Record<string, string | number> = {}) =>
      Object.entries(values).reduce(
        (message, [name, replacement]) =>
          message.replaceAll(`{${name}}`, String(replacement)),
        messages[key] ?? en[key],
      );
    const formatDate = (date: string | null) =>
      date
        ? new Intl.DateTimeFormat(locale, {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          }).format(new Date(`${date}T00:00:00Z`))
        : t("common.notSet");
    return {
      locale,
      setLocale: (next) => {
        updateLocale(next);
        void repository.saveLocale(next).catch(() => undefined);
      },
      t,
      formatDate,
      formatDateRange: (start, end) => {
        if (!start && !end) return t("journey.datesUnset");
        if (start && end) return `${formatDate(start)} — ${formatDate(end)}`;
        return formatDate(start ?? end);
      },
    };
  }, [locale, repository]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("I18nProvider is missing");
  return value;
}
