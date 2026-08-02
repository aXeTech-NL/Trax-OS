import "fake-indexeddb/auto";

import { expect, test } from "vitest";

import { EMPTY_JOURNEY_DATA } from "../features/journeys/domain";
import { createJourney } from "../features/journeys/journey-service";
import { IndexedDbJourneyRepository } from "./indexeddb-journey-repository";

test("persists journeys and preferences across repository instances", async () => {
  const first = new IndexedDbJourneyRepository();
  const created = createJourney(
    EMPTY_JOURNEY_DATA,
    { name: "Durable route", startDate: "", endDate: "" },
    { id: () => "journey-1", now: () => "2026-08-02T00:00:00Z" },
  );
  await first.save(created.data);
  await first.saveLocale("nl");

  const second = new IndexedDbJourneyRepository();
  await expect(second.load()).resolves.toMatchObject({
    schemaVersion: 1,
    journeys: [{ id: "journey-1", name: "Durable route" }],
  });
  await expect(second.loadLocale()).resolves.toBe("nl");

  await expect(
    second.save({
      ...created.data,
      packingItems: [
        {
          id: "orphan",
          journeyId: "missing",
          label: "Passport",
          category: "documents",
          quantity: 1,
          packedQuantity: 0,
          essential: true,
        },
      ],
    }),
  ).rejects.toThrow("invalid_local_data");
  await expect(second.load()).resolves.toMatchObject({
    journeys: [{ id: "journey-1", name: "Durable route" }],
    packingItems: [],
  });
});
