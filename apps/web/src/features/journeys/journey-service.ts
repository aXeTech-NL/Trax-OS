import {
  type Journey,
  type JourneyData,
  type JourneyInput,
  type JourneySegment,
  type PackingInput,
  type PackingItem,
  type SegmentInput,
  packingForJourney,
  segmentsForJourney,
  validateJourney,
  validatePacking,
  validateSegment,
} from "./domain";

export class JourneyValidationError extends Error {
  constructor(readonly codes: readonly string[]) {
    super(codes.join(","));
    this.name = "JourneyValidationError";
  }
}

export class JourneyOperationError extends Error {
  constructor(readonly code: "journey_not_found" | "item_not_found") {
    super(code);
    this.name = "JourneyOperationError";
  }
}

export interface Runtime {
  readonly id: () => string;
  readonly now: () => string;
}

export const browserRuntime: Runtime = {
  id: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

export function createJourney(
  data: JourneyData,
  input: JourneyInput,
  runtime: Runtime,
): { data: JourneyData; journey: Journey } {
  assertValid(validateJourney(input));
  const timestamp = runtime.now();
  const journey: Journey = {
    id: runtime.id(),
    name: input.name.trim(),
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    status: "planning",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    journey,
    data: { ...data, journeys: [...data.journeys, journey] },
  };
}

export function updateJourney(
  data: JourneyData,
  journeyId: string,
  input: JourneyInput,
  runtime: Runtime,
): JourneyData {
  assertJourneyExists(data, journeyId);
  assertValid(validateJourney(input));
  return {
    ...data,
    journeys: data.journeys.map((journey) =>
      journey.id === journeyId
        ? {
            ...journey,
            name: input.name.trim(),
            startDate: input.startDate || null,
            endDate: input.endDate || null,
            updatedAt: runtime.now(),
          }
        : journey,
    ),
  };
}

export function setJourneyStatus(
  data: JourneyData,
  journeyId: string,
  status: Journey["status"],
  runtime: Runtime,
): JourneyData {
  assertJourneyExists(data, journeyId);
  return {
    ...data,
    journeys: data.journeys.map((journey) =>
      journey.id === journeyId
        ? { ...journey, status, updatedAt: runtime.now() }
        : journey,
    ),
  };
}

export function deleteJourney(
  data: JourneyData,
  journeyId: string,
): JourneyData {
  assertJourneyExists(data, journeyId);
  return {
    ...data,
    journeys: data.journeys.filter((journey) => journey.id !== journeyId),
    segments: data.segments.filter(
      (segment) => segment.journeyId !== journeyId,
    ),
    packingItems: data.packingItems.filter(
      (item) => item.journeyId !== journeyId,
    ),
  };
}

export function saveSegment(
  data: JourneyData,
  journeyId: string,
  input: SegmentInput,
  runtime: Runtime,
  segmentId?: string,
): JourneyData {
  assertJourneyExists(data, journeyId);
  assertValid(validateSegment(input));
  const existing = segmentId
    ? data.segments.find(
        (segment) =>
          segment.id === segmentId && segment.journeyId === journeyId,
      )
    : undefined;
  if (segmentId && !existing) throw new JourneyOperationError("item_not_found");
  const position =
    existing?.position ?? segmentsForJourney(data, journeyId).length;
  const common = {
    id: existing?.id ?? runtime.id(),
    journeyId,
    position,
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    notes: input.notes.trim(),
  };
  const segment: JourneySegment =
    input.kind === "stay"
      ? { ...common, kind: "stay", placeName: input.placeName.trim() }
      : {
          ...common,
          kind: "move",
          originName: input.originName.trim(),
          destinationName: input.destinationName.trim(),
          transportMode: input.transportMode.trim(),
        };
  const segments = existing
    ? data.segments.map((item) => (item.id === existing.id ? segment : item))
    : [...data.segments, segment];
  return touchJourney({ ...data, segments }, journeyId, runtime);
}

export function deleteSegment(
  data: JourneyData,
  journeyId: string,
  segmentId: string,
  runtime: Runtime,
): JourneyData {
  assertJourneyExists(data, journeyId);
  assertOwnedItem(
    data.segments.some(
      (segment) => segment.id === segmentId && segment.journeyId === journeyId,
    ),
  );
  const remaining = data.segments.filter((segment) => segment.id !== segmentId);
  const ordered = remaining
    .filter((segment) => segment.journeyId === journeyId)
    .slice()
    .sort((left, right) => left.position - right.position);
  const positions = new Map(
    ordered.map((segment, index) => [segment.id, index]),
  );
  return touchJourney(
    {
      ...data,
      segments: remaining.map((segment) => ({
        ...segment,
        position: positions.get(segment.id) ?? segment.position,
      })),
    },
    journeyId,
    runtime,
  );
}

export function moveSegment(
  data: JourneyData,
  journeyId: string,
  segmentId: string,
  direction: -1 | 1,
  runtime: Runtime,
): JourneyData {
  assertJourneyExists(data, journeyId);
  const ordered = segmentsForJourney(data, journeyId);
  const index = ordered.findIndex((segment) => segment.id === segmentId);
  if (index < 0) throw new JourneyOperationError("item_not_found");
  const target = index + direction;
  if (target < 0 || target >= ordered.length) return data;
  const reordered = [...ordered];
  const current = reordered[index];
  const destination = reordered[target];
  if (!current || !destination) return data;
  reordered[index] = destination;
  reordered[target] = current;
  const positions = new Map(
    reordered.map((segment, position) => [segment.id, position]),
  );
  return touchJourney(
    {
      ...data,
      segments: data.segments.map((segment) => ({
        ...segment,
        position: positions.get(segment.id) ?? segment.position,
      })),
    },
    journeyId,
    runtime,
  );
}

export function savePackingItem(
  data: JourneyData,
  journeyId: string,
  input: PackingInput,
  runtime: Runtime,
  itemId?: string,
): JourneyData {
  assertJourneyExists(data, journeyId);
  assertValid(validatePacking(input));
  const existing = itemId
    ? data.packingItems.find(
        (item) => item.id === itemId && item.journeyId === journeyId,
      )
    : undefined;
  if (itemId && !existing) throw new JourneyOperationError("item_not_found");
  const item: PackingItem = {
    id: existing?.id ?? runtime.id(),
    journeyId,
    label: input.label.trim(),
    category: input.category,
    quantity: input.quantity,
    packedQuantity: Math.min(existing?.packedQuantity ?? 0, input.quantity),
    essential: input.essential,
  };
  const packingItems = existing
    ? data.packingItems.map((current) =>
        current.id === existing.id ? item : current,
      )
    : [...data.packingItems, item];
  return touchJourney({ ...data, packingItems }, journeyId, runtime);
}

export function setPackedQuantity(
  data: JourneyData,
  journeyId: string,
  itemId: string,
  packedQuantity: number,
  runtime: Runtime,
): JourneyData {
  assertJourneyExists(data, journeyId);
  assertOwnedItem(
    data.packingItems.some(
      (item) => item.id === itemId && item.journeyId === journeyId,
    ),
  );
  return touchJourney(
    {
      ...data,
      packingItems: data.packingItems.map((item) =>
        item.id === itemId
          ? {
              ...item,
              packedQuantity: Math.max(
                0,
                Math.min(item.quantity, packedQuantity),
              ),
            }
          : item,
      ),
    },
    journeyId,
    runtime,
  );
}

export function deletePackingItem(
  data: JourneyData,
  journeyId: string,
  itemId: string,
  runtime: Runtime,
): JourneyData {
  assertJourneyExists(data, journeyId);
  assertOwnedItem(
    data.packingItems.some(
      (item) => item.id === itemId && item.journeyId === journeyId,
    ),
  );
  return touchJourney(
    {
      ...data,
      packingItems: data.packingItems.filter((item) => item.id !== itemId),
    },
    journeyId,
    runtime,
  );
}

function touchJourney(
  data: JourneyData,
  journeyId: string,
  runtime: Runtime,
): JourneyData {
  return {
    ...data,
    journeys: data.journeys.map((journey) =>
      journey.id === journeyId
        ? { ...journey, updatedAt: runtime.now() }
        : journey,
    ),
  };
}

function assertValid(codes: readonly string[]) {
  if (codes.length > 0) throw new JourneyValidationError(codes);
}

function assertJourneyExists(data: JourneyData, journeyId: string): void {
  if (!data.journeys.some((journey) => journey.id === journeyId)) {
    throw new JourneyOperationError("journey_not_found");
  }
}

function assertOwnedItem(owned: boolean): void {
  if (!owned) throw new JourneyOperationError("item_not_found");
}

export function journeyPacking(data: JourneyData, journeyId: string) {
  return packingForJourney(data, journeyId);
}
