import { describe, expect, test } from "vitest";

import {
  EMPTY_JOURNEY_DATA,
  packingProgress,
  segmentsForJourney,
} from "./domain";
import {
  createJourney,
  deleteJourney,
  JourneyOperationError,
  JourneyValidationError,
  moveSegment,
  savePackingItem,
  saveSegment,
  setPackedQuantity,
  type Runtime,
} from "./journey-service";

function runtime(): Runtime {
  let sequence = 0;
  return {
    id: () => `id-${++sequence}`,
    now: () => "2026-08-02T10:00:00.000Z",
  };
}

test("creates one generic journey for simple or multi-stop routes", () => {
  const result = createJourney(
    EMPTY_JOURNEY_DATA,
    { name: " Europe ", startDate: "2027-05-01", endDate: "2027-05-20" },
    runtime(),
  );
  expect(result.journey).toMatchObject({
    id: "id-1",
    name: "Europe",
    status: "planning",
  });
  expect(result.data.journeys).toHaveLength(1);
});

test("rejects reversed local date ranges", () => {
  expect(() =>
    createJourney(
      EMPTY_JOURNEY_DATA,
      { name: "Invalid", startDate: "2027-06-02", endDate: "2027-06-01" },
      runtime(),
    ),
  ).toThrowError(JourneyValidationError);
});

describe("timeline and packing commands", () => {
  test("adds typed segments, reorders explicitly and cascades journey deletion", () => {
    const clock = runtime();
    const created = createJourney(
      EMPTY_JOURNEY_DATA,
      { name: "Route", startDate: "", endDate: "" },
      clock,
    );
    const first = saveSegment(
      created.data,
      created.journey.id,
      {
        kind: "stay",
        placeName: "Utrecht",
        startDate: "",
        endDate: "",
        notes: "",
      },
      clock,
    );
    const second = saveSegment(
      first,
      created.journey.id,
      {
        kind: "move",
        originName: "Utrecht",
        destinationName: "Paris",
        transportMode: "Train",
        startDate: "",
        endDate: "",
        notes: "",
      },
      clock,
    );
    const moveId = segmentsForJourney(second, created.journey.id)[1]!.id;
    const reordered = moveSegment(
      second,
      created.journey.id,
      moveId,
      -1,
      clock,
    );
    expect(
      segmentsForJourney(reordered, created.journey.id).map(
        (item) => item.kind,
      ),
    ).toEqual(["move", "stay"]);
    expect(deleteJourney(reordered, created.journey.id).segments).toHaveLength(
      0,
    );
  });

  test("rejects cross-journey item mutation", () => {
    const clock = runtime();
    const firstJourney = createJourney(
      EMPTY_JOURNEY_DATA,
      { name: "First", startDate: "", endDate: "" },
      clock,
    );
    const secondJourney = createJourney(
      firstJourney.data,
      { name: "Second", startDate: "", endDate: "" },
      clock,
    );
    const withSegment = saveSegment(
      secondJourney.data,
      firstJourney.journey.id,
      {
        kind: "stay",
        placeName: "Utrecht",
        startDate: "",
        endDate: "",
        notes: "",
      },
      clock,
    );
    const segmentId = withSegment.segments[0]!.id;

    expect(() =>
      saveSegment(
        withSegment,
        secondJourney.journey.id,
        {
          kind: "stay",
          placeName: "Paris",
          startDate: "",
          endDate: "",
          notes: "",
        },
        clock,
        segmentId,
      ),
    ).toThrowError(JourneyOperationError);
  });

  test("keeps packed quantity within the item quantity", () => {
    const clock = runtime();
    const created = createJourney(
      EMPTY_JOURNEY_DATA,
      { name: "Packing", startDate: "", endDate: "" },
      clock,
    );
    const withItem = savePackingItem(
      created.data,
      created.journey.id,
      { label: "Socks", category: "clothing", quantity: 3, essential: false },
      clock,
    );
    const item = withItem.packingItems[0]!;
    const packed = setPackedQuantity(
      withItem,
      created.journey.id,
      item.id,
      9,
      clock,
    );
    expect(packingProgress(packed.packingItems)).toEqual({
      packed: 3,
      total: 3,
    });
  });
});
