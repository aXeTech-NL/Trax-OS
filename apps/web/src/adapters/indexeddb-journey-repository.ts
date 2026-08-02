import {
  type Journey,
  type JourneyData,
  type JourneySegment,
  type PackingItem,
  parseJourneyData,
} from "../features/journeys/domain";
import type { Locale } from "../i18n/catalog";
import type { JourneyRepository } from "../repositories/journey-repository";

const DATABASE_NAME = "trax-os-local";
const DATABASE_VERSION = 1;
const JOURNEYS = "journeys";
const SEGMENTS = "segments";
const PACKING = "packing";
const PREFERENCES = "preferences";

export class IndexedDbJourneyRepository implements JourneyRepository {
  private databasePromise: Promise<IDBDatabase> | null = null;

  async load(): Promise<JourneyData> {
    const database = await this.database();
    const transaction = database.transaction(
      [JOURNEYS, SEGMENTS, PACKING],
      "readonly",
    );
    const completed = complete(transaction);
    const [journeys, segments, packingItems] = await Promise.all([
      getAll<Journey>(transaction.objectStore(JOURNEYS)),
      getAll<JourneySegment>(transaction.objectStore(SEGMENTS)),
      getAll<PackingItem>(transaction.objectStore(PACKING)),
    ]);
    await completed;
    return parseJourneyData({
      schemaVersion: 1,
      journeys,
      segments,
      packingItems,
    });
  }

  async save(data: JourneyData): Promise<void> {
    const validated = parseJourneyData(data);
    const database = await this.database();
    const transaction = database.transaction(
      [JOURNEYS, SEGMENTS, PACKING],
      "readwrite",
    );
    const completed = complete(transaction);
    const journeyStore = transaction.objectStore(JOURNEYS);
    const segmentStore = transaction.objectStore(SEGMENTS);
    const packingStore = transaction.objectStore(PACKING);
    journeyStore.clear();
    segmentStore.clear();
    packingStore.clear();
    for (const journey of validated.journeys) journeyStore.put(journey);
    for (const segment of validated.segments) segmentStore.put(segment);
    for (const item of validated.packingItems) packingStore.put(item);
    await completed;
  }

  async loadLocale(): Promise<Locale | null> {
    const database = await this.database();
    const transaction = database.transaction(PREFERENCES, "readonly");
    const completed = complete(transaction);
    const value = await request<unknown>(
      transaction.objectStore(PREFERENCES).get("locale"),
    );
    await completed;
    return value === "en" || value === "nl" ? value : null;
  }

  async saveLocale(locale: Locale): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(PREFERENCES, "readwrite");
    const completed = complete(transaction);
    transaction.objectStore(PREFERENCES).put(locale, "locale");
    await completed;
  }

  private database(): Promise<IDBDatabase> {
    this.databasePromise ??= new Promise((resolve, reject) => {
      const opening = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      opening.onupgradeneeded = () => {
        const database = opening.result;
        if (!database.objectStoreNames.contains(JOURNEYS)) {
          database.createObjectStore(JOURNEYS, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(SEGMENTS)) {
          const store = database.createObjectStore(SEGMENTS, { keyPath: "id" });
          store.createIndex("journeyId", "journeyId");
        }
        if (!database.objectStoreNames.contains(PACKING)) {
          const store = database.createObjectStore(PACKING, { keyPath: "id" });
          store.createIndex("journeyId", "journeyId");
        }
        if (!database.objectStoreNames.contains(PREFERENCES)) {
          database.createObjectStore(PREFERENCES);
        }
      };
      opening.onerror = () =>
        reject(opening.error ?? new Error("indexeddb_open_failed"));
      opening.onsuccess = () => resolve(opening.result);
    });
    return this.databasePromise;
  }
}

async function getAll<T>(store: IDBObjectStore): Promise<T[]> {
  const value = await request<unknown>(
    store.getAll() as unknown as IDBRequest<unknown>,
  );
  if (!Array.isArray(value)) throw new Error("invalid_local_data");
  return value as T[];
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () =>
      reject(value.error ?? new Error("indexeddb_request_failed"));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("indexeddb_failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("indexeddb_aborted"));
  });
}
