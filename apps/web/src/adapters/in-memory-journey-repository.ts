import {
  EMPTY_JOURNEY_DATA,
  type JourneyData,
} from "../features/journeys/domain";
import type { Locale } from "../i18n/catalog";
import type { JourneyRepository } from "../repositories/journey-repository";

export class InMemoryJourneyRepository implements JourneyRepository {
  private data: JourneyData;
  private locale: Locale | null;

  constructor(
    data: JourneyData = EMPTY_JOURNEY_DATA,
    locale: Locale | null = "en",
  ) {
    this.data = structuredClone(data);
    this.locale = locale;
  }

  load(): Promise<JourneyData> {
    return Promise.resolve(structuredClone(this.data));
  }

  save(data: JourneyData): Promise<void> {
    this.data = structuredClone(data);
    return Promise.resolve();
  }

  loadLocale(): Promise<Locale | null> {
    return Promise.resolve(this.locale);
  }

  saveLocale(locale: Locale): Promise<void> {
    this.locale = locale;
    return Promise.resolve();
  }
}
