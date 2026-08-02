import type { JourneyData } from "../features/journeys/domain";
import type { Locale } from "../i18n/catalog";

export class RepositoryError extends Error {
  constructor(
    readonly code:
      | "authentication_required"
      | "version_conflict"
      | "network_error"
      | "server_error",
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

export interface JourneyRepository {
  load(): Promise<JourneyData>;
  save(data: JourneyData): Promise<JourneyData>;
  loadLocale(): Promise<Locale | null>;
  saveLocale(locale: Locale): Promise<void>;
}
