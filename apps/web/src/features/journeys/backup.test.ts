import { expect, test } from "vitest";

import { createLocalBackup, readLocalBackup } from "./backup";
import { EMPTY_JOURNEY_DATA } from "./domain";
import { createJourney } from "./journey-service";

const runtime = {
  id: () => "journey-1",
  now: () => "2026-08-02T10:00:00.000Z",
};

test("round-trips a versioned local backup", () => {
  const created = createJourney(
    EMPTY_JOURNEY_DATA,
    { name: "Portugal", startDate: "2027-04-01", endDate: "2027-04-10" },
    runtime,
  );
  const source = createLocalBackup(created.data, "2026-08-02T12:00:00.000Z");

  expect(readLocalBackup(source)).toEqual(created.data);
  expect(JSON.parse(source)).toMatchObject({
    format: "trax-os-local-backup",
    version: 1,
    exportedAt: "2026-08-02T12:00:00.000Z",
  });
});

test("rejects malformed and unsupported backups", () => {
  expect(() => readLocalBackup("not json")).toThrow("invalid_backup");
  expect(() =>
    readLocalBackup(
      JSON.stringify({
        format: "trax-os-local-backup",
        version: 2,
        exportedAt: "2026-08-02T12:00:00.000Z",
        data: EMPTY_JOURNEY_DATA,
      }),
    ),
  ).toThrow("invalid_backup");
});

test("rejects backups with orphaned records", () => {
  expect(() =>
    readLocalBackup(
      JSON.stringify({
        format: "trax-os-local-backup",
        version: 1,
        exportedAt: "2026-08-02T12:00:00.000Z",
        data: {
          ...EMPTY_JOURNEY_DATA,
          packingItems: [
            {
              id: "item-1",
              journeyId: "missing",
              label: "Passport",
              category: "documents",
              quantity: 1,
              packedQuantity: 0,
              essential: true,
            },
          ],
        },
      }),
    ),
  ).toThrow("invalid_backup");
});
