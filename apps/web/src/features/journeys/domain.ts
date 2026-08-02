export type JourneyStatus = "planning" | "active" | "completed" | "archived";
export type SegmentKind = "stay" | "move";
export type PackingCategory =
  | "documents"
  | "clothing"
  | "toiletries"
  | "electronics"
  | "other";

export interface Journey {
  readonly id: string;
  readonly name: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly status: JourneyStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface SegmentBase {
  readonly id: string;
  readonly journeyId: string;
  readonly kind: SegmentKind;
  readonly position: number;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly notes: string;
}

export interface StaySegment extends SegmentBase {
  readonly kind: "stay";
  readonly placeName: string;
}

export interface MoveSegment extends SegmentBase {
  readonly kind: "move";
  readonly originName: string;
  readonly destinationName: string;
  readonly transportMode: string;
}

export type JourneySegment = StaySegment | MoveSegment;

export interface PackingItem {
  readonly id: string;
  readonly journeyId: string;
  readonly label: string;
  readonly category: PackingCategory;
  readonly quantity: number;
  readonly packedQuantity: number;
  readonly essential: boolean;
}

export interface JourneyData {
  readonly schemaVersion: 1;
  readonly journeys: readonly Journey[];
  readonly segments: readonly JourneySegment[];
  readonly packingItems: readonly PackingItem[];
}

export const EMPTY_JOURNEY_DATA: JourneyData = {
  schemaVersion: 1,
  journeys: [],
  segments: [],
  packingItems: [],
};

export interface JourneyInput {
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
}

export type SegmentInput =
  | {
      readonly kind: "stay";
      readonly placeName: string;
      readonly startDate: string;
      readonly endDate: string;
      readonly notes: string;
    }
  | {
      readonly kind: "move";
      readonly originName: string;
      readonly destinationName: string;
      readonly transportMode: string;
      readonly startDate: string;
      readonly endDate: string;
      readonly notes: string;
    };

export interface PackingInput {
  readonly label: string;
  readonly category: PackingCategory;
  readonly quantity: number;
  readonly essential: boolean;
}

export type ValidationErrorCode =
  | "name_required"
  | "date_order"
  | "place_required"
  | "route_required"
  | "packing_label_required"
  | "quantity_invalid";

export function validateJourney(input: JourneyInput): ValidationErrorCode[] {
  const errors: ValidationErrorCode[] = [];
  if (input.name.trim().length === 0) errors.push("name_required");
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    errors.push("date_order");
  }
  return errors;
}

export function validateSegment(input: SegmentInput): ValidationErrorCode[] {
  const errors: ValidationErrorCode[] = [];
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    errors.push("date_order");
  }
  if (input.kind === "stay" && input.placeName.trim().length === 0) {
    errors.push("place_required");
  }
  if (
    input.kind === "move" &&
    (input.originName.trim().length === 0 ||
      input.destinationName.trim().length === 0)
  ) {
    errors.push("route_required");
  }
  return errors;
}

export function validatePacking(input: PackingInput): ValidationErrorCode[] {
  const errors: ValidationErrorCode[] = [];
  if (input.label.trim().length === 0) errors.push("packing_label_required");
  if (
    !Number.isInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > 99
  ) {
    errors.push("quantity_invalid");
  }
  return errors;
}

export function segmentsForJourney(
  data: JourneyData,
  journeyId: string,
): JourneySegment[] {
  return data.segments
    .filter((segment) => segment.journeyId === journeyId)
    .slice()
    .sort((left, right) => left.position - right.position);
}

export function packingForJourney(
  data: JourneyData,
  journeyId: string,
): PackingItem[] {
  return data.packingItems.filter((item) => item.journeyId === journeyId);
}

export function packingProgress(items: readonly PackingItem[]) {
  return items.reduce(
    (progress, item) => ({
      packed: progress.packed + item.packedQuantity,
      total: progress.total + item.quantity,
    }),
    { packed: 0, total: 0 },
  );
}

const JOURNEY_STATUSES: ReadonlySet<string> = new Set([
  "planning",
  "active",
  "completed",
  "archived",
]);
const PACKING_CATEGORIES: ReadonlySet<string> = new Set([
  "documents",
  "clothing",
  "toiletries",
  "electronics",
  "other",
]);
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseJourneyData(value: unknown): JourneyData {
  if (!isRecord(value) || value.schemaVersion !== 1) invalidLocalData();
  const journeys = value.journeys;
  const segments = value.segments;
  const packingItems = value.packingItems;
  if (
    !Array.isArray(journeys) ||
    !Array.isArray(segments) ||
    !Array.isArray(packingItems)
  ) {
    invalidLocalData();
  }

  const journeyIds = new Set<string>();
  for (const journey of journeys) {
    if (
      !isRecord(journey) ||
      !nonEmptyString(journey.id) ||
      journeyIds.has(journey.id) ||
      !nonEmptyString(journey.name) ||
      typeof journey.status !== "string" ||
      !JOURNEY_STATUSES.has(journey.status) ||
      !nullableDate(journey.startDate) ||
      !nullableDate(journey.endDate) ||
      (journey.startDate &&
        journey.endDate &&
        journey.endDate < journey.startDate) ||
      !isoTimestamp(journey.createdAt) ||
      !isoTimestamp(journey.updatedAt)
    ) {
      invalidLocalData();
    }
    journeyIds.add(journey.id);
  }

  const segmentIds = new Set<string>();
  const positionsByJourney = new Map<string, Set<number>>();
  for (const segment of segments) {
    if (
      !isRecord(segment) ||
      !nonEmptyString(segment.id) ||
      segmentIds.has(segment.id) ||
      !nonEmptyString(segment.journeyId) ||
      !journeyIds.has(segment.journeyId) ||
      !Number.isInteger(segment.position) ||
      (segment.position as number) < 0 ||
      !nullableDate(segment.startDate) ||
      !nullableDate(segment.endDate) ||
      (segment.startDate &&
        segment.endDate &&
        segment.endDate < segment.startDate) ||
      typeof segment.notes !== "string"
    ) {
      invalidLocalData();
    }
    if (segment.kind === "stay") {
      if (!nonEmptyString(segment.placeName)) invalidLocalData();
    } else if (segment.kind === "move") {
      if (
        !nonEmptyString(segment.originName) ||
        !nonEmptyString(segment.destinationName) ||
        typeof segment.transportMode !== "string"
      ) {
        invalidLocalData();
      }
    } else {
      invalidLocalData();
    }
    const positions = positionsByJourney.get(segment.journeyId) ?? new Set();
    if (positions.has(segment.position as number)) invalidLocalData();
    positions.add(segment.position as number);
    positionsByJourney.set(segment.journeyId, positions);
    segmentIds.add(segment.id);
  }

  const packingIds = new Set<string>();
  for (const item of packingItems) {
    if (
      !isRecord(item) ||
      !nonEmptyString(item.id) ||
      packingIds.has(item.id) ||
      !nonEmptyString(item.journeyId) ||
      !journeyIds.has(item.journeyId) ||
      !nonEmptyString(item.label) ||
      typeof item.category !== "string" ||
      !PACKING_CATEGORIES.has(item.category) ||
      !Number.isInteger(item.quantity) ||
      !Number.isInteger(item.packedQuantity) ||
      (item.quantity as number) < 1 ||
      (item.quantity as number) > 99 ||
      (item.packedQuantity as number) < 0 ||
      (item.packedQuantity as number) > (item.quantity as number) ||
      typeof item.essential !== "boolean"
    ) {
      invalidLocalData();
    }
    packingIds.add(item.id);
  }

  return structuredClone(value) as unknown as JourneyData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableDate(value: unknown): value is string | null {
  return (
    value === null || (typeof value === "string" && LOCAL_DATE.test(value))
  );
}

function isoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    value.includes("T")
  );
}

function invalidLocalData(): never {
  throw new Error("invalid_local_data");
}
