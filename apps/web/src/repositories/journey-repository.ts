import type { JourneyData } from "../features/journeys/domain";
import type { Locale } from "../i18n/catalog";

export interface JourneyRepository {
  load(): Promise<JourneyData>;
  save(data: JourneyData): Promise<void>;
  loadLocale(): Promise<Locale | null>;
  saveLocale(locale: Locale): Promise<void>;
}
