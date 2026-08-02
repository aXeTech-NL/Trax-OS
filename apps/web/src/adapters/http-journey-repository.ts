import {
  EMPTY_JOURNEY_DATA,
  type Journey,
  type JourneyData,
  type JourneySegment,
  type PackingItem,
} from "../features/journeys/domain";
import type { Locale } from "../i18n/catalog";
import {
  RepositoryError,
  type JourneyRepository,
} from "../repositories/journey-repository";

export class HttpJourneyRepository implements JourneyRepository {
  private current: JourneyData = EMPTY_JOURNEY_DATA;

  async load(): Promise<JourneyData> {
    const list = asItems(await request("/api/v1/journeys"));
    const journeys = list.map(journeyFrom);
    const details = await Promise.all(
      journeys.map(async (journey) => {
        const [segmentData, packingData] = await Promise.all([
          request(`/api/v1/journeys/${journey.id}/segments`),
          request(`/api/v1/journeys/${journey.id}/packing`),
        ]);
        return {
          segments: asItems(segmentData).map(segmentFrom),
          packing: asItems(packingData).map(packingFrom),
        };
      }),
    );
    this.current = {
      schemaVersion: 1,
      journeys,
      segments: details.flatMap((item) => item.segments),
      packingItems: details.flatMap((item) => item.packing),
    };
    return structuredClone(this.current);
  }

  async save(next: JourneyData): Promise<JourneyData> {
    const previous = this.current;
    for (const journey of previous.journeys.filter(
      (item) => !next.journeys.some((candidate) => candidate.id === item.id),
    )) {
      await mutate(`/api/v1/journeys/${journey.id}`, "DELETE");
    }
    for (const journey of next.journeys) {
      const old = previous.journeys.find((item) => item.id === journey.id);
      if (!old) {
        await mutate("/api/v1/journeys", "POST", journeyBody(journey, true));
      } else if (journeyChanged(old, journey)) {
        await mutate(`/api/v1/journeys/${journey.id}`, "PUT", {
          ...journeyBody(journey, false),
          status: journey.status,
          expected_record_version: old.recordVersion,
        });
      }
    }
    const livingJourneyIds = new Set(next.journeys.map((item) => item.id));
    for (const segment of previous.segments.filter(
      (item) =>
        livingJourneyIds.has(item.journeyId) &&
        !next.segments.some((candidate) => candidate.id === item.id),
    )) {
      await mutate(
        `/api/v1/journeys/${segment.journeyId}/segments/${segment.id}`,
        "DELETE",
      );
    }
    for (const segment of next.segments) {
      const old = previous.segments.find((item) => item.id === segment.id);
      if (!old) {
        await mutate(
          `/api/v1/journeys/${segment.journeyId}/segments`,
          "POST",
          segmentBody(segment, true),
        );
      } else if (segmentChanged(old, segment)) {
        await mutate(
          `/api/v1/journeys/${segment.journeyId}/segments/${segment.id}`,
          "PUT",
          {
            ...segmentBody(segment, false),
            expected_record_version: old.recordVersion,
          },
        );
      }
    }
    for (const journey of next.journeys) {
      const before = previous.segments
        .filter((item) => item.journeyId === journey.id)
        .sort(byPosition);
      const after = next.segments
        .filter((item) => item.journeyId === journey.id)
        .sort(byPosition);
      const moved = after.find(
        (item, index) =>
          before[index]?.id !== item.id &&
          previous.segments.some((old) => old.id === item.id),
      );
      if (moved) {
        const old = previous.segments.find((item) => item.id === moved.id)!;
        await mutate(
          `/api/v1/journeys/${journey.id}/segments/${moved.id}/reorder`,
          "POST",
          {
            expected_record_version: old.recordVersion,
            new_position: after.findIndex((item) => item.id === moved.id),
          },
        );
      }
    }
    for (const item of previous.packingItems.filter(
      (old) =>
        livingJourneyIds.has(old.journeyId) &&
        !next.packingItems.some((candidate) => candidate.id === old.id),
    )) {
      await mutate(
        `/api/v1/journeys/${item.journeyId}/packing/${item.id}`,
        "DELETE",
      );
    }
    for (const item of next.packingItems) {
      const old = previous.packingItems.find(
        (candidate) => candidate.id === item.id,
      );
      if (!old) {
        await mutate(
          `/api/v1/journeys/${item.journeyId}/packing`,
          "POST",
          packingBody(item, true),
        );
      } else {
        if (packingDefinitionChanged(old, item)) {
          await mutate(
            `/api/v1/journeys/${item.journeyId}/packing/${item.id}`,
            "PUT",
            {
              ...packingBody(item, false),
              expected_record_version: old.recordVersion,
            },
          );
        } else if (old.packedQuantity !== item.packedQuantity) {
          await mutate(
            `/api/v1/journeys/${item.journeyId}/packing/${item.id}/progress`,
            "PUT",
            {
              expected_record_version: old.recordVersion,
              packed_quantity: item.packedQuantity,
            },
          );
        }
      }
    }
    return this.load();
  }

  loadLocale(): Promise<Locale | null> {
    const value = localStorage.getItem("trax.locale.v1");
    return Promise.resolve(value === "en" || value === "nl" ? value : null);
  }
  saveLocale(locale: Locale): Promise<void> {
    localStorage.setItem("trax.locale.v1", locale);
    return Promise.resolve();
  }
}

function journeyBody(
  value: Journey,
  includeId: boolean,
): Record<string, unknown> {
  return {
    ...(includeId ? { id: value.id } : {}),
    name: value.name,
    start_date: value.startDate,
    end_date: value.endDate,
  };
}
function segmentBody(
  value: JourneySegment,
  includeId: boolean,
): Record<string, unknown> {
  return {
    ...(includeId ? { id: value.id } : {}),
    kind: value.kind,
    start_date: value.startDate,
    end_date: value.endDate,
    notes: value.notes,
    place_name: value.kind === "stay" ? value.placeName : null,
    origin_name: value.kind === "move" ? value.originName : null,
    destination_name: value.kind === "move" ? value.destinationName : null,
    transport_mode: value.kind === "move" ? value.transportMode : "",
  };
}
function packingBody(
  value: PackingItem,
  includeId: boolean,
): Record<string, unknown> {
  return {
    ...(includeId ? { id: value.id } : {}),
    label: value.label,
    category: value.category,
    quantity: value.quantity,
    essential: value.essential,
  };
}
function journeyChanged(a: Journey, b: Journey) {
  return (
    a.name !== b.name ||
    a.startDate !== b.startDate ||
    a.endDate !== b.endDate ||
    a.status !== b.status
  );
}
function segmentChanged(a: JourneySegment, b: JourneySegment) {
  return (
    JSON.stringify(segmentBody(a, false)) !==
    JSON.stringify(segmentBody(b, false))
  );
}
function packingDefinitionChanged(a: PackingItem, b: PackingItem) {
  return (
    JSON.stringify(packingBody(a, false)) !==
    JSON.stringify(packingBody(b, false))
  );
}
function byPosition(a: JourneySegment, b: JourneySegment) {
  return a.position - b.position;
}

async function mutate(
  url: string,
  method: string,
  body?: unknown,
): Promise<void> {
  await request(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken(),
    },
  });
}
async function request(url: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, credentials: "same-origin" });
  } catch {
    throw new RepositoryError("network_error", "Network unavailable");
  }
  const body: unknown =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      record(body) && record(body.error) && typeof body.error.code === "string"
        ? body.error.code
        : "server_error";
    if (response.status === 401)
      throw new RepositoryError("authentication_required", code);
    if (response.status === 409)
      throw new RepositoryError("version_conflict", code);
    throw new RepositoryError("server_error", code);
  }
  return body;
}
function csrfToken() {
  const value = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith("trax_csrf="))
    ?.split("=")[1];
  return value ? decodeURIComponent(value) : "";
}
function asItems(value: unknown): unknown[] {
  if (!record(value) || !Array.isArray(value.items))
    throw new RepositoryError("server_error", "invalid_response");
  return value.items;
}
function journeyFrom(value: unknown): Journey {
  const row = required(value, [
    "id",
    "name",
    "status",
    "record_version",
    "created_at",
    "updated_at",
  ]);
  return {
    id: string(row.id),
    name: string(row.name),
    startDate: nullable(row.start_date),
    endDate: nullable(row.end_date),
    status: status(row.status),
    recordVersion: integer(row.record_version),
    createdAt: string(row.created_at),
    updatedAt: string(row.updated_at),
  };
}
function segmentFrom(value: unknown): JourneySegment {
  const row = required(value, [
    "id",
    "journey_id",
    "kind",
    "position",
    "record_version",
    "created_at",
    "updated_at",
    "notes",
  ]);
  const common = {
    id: string(row.id),
    journeyId: string(row.journey_id),
    position: integer(row.position),
    startDate: nullable(row.start_date),
    endDate: nullable(row.end_date),
    notes: string(row.notes),
    recordVersion: integer(row.record_version),
    createdAt: string(row.created_at),
    updatedAt: string(row.updated_at),
  };
  return row.kind === "stay"
    ? { ...common, kind: "stay", placeName: string(row.place_name) }
    : {
        ...common,
        kind: "move",
        originName: string(row.origin_name),
        destinationName: string(row.destination_name),
        transportMode: string(row.transport_mode),
      };
}
function packingFrom(value: unknown): PackingItem {
  const row = required(value, [
    "id",
    "journey_id",
    "label",
    "category",
    "quantity",
    "packed_quantity",
    "essential",
    "record_version",
    "created_at",
    "updated_at",
  ]);
  return {
    id: string(row.id),
    journeyId: string(row.journey_id),
    label: string(row.label),
    category: category(row.category),
    quantity: integer(row.quantity),
    packedQuantity: integer(row.packed_quantity),
    essential: boolean(row.essential),
    recordVersion: integer(row.record_version),
    createdAt: string(row.created_at),
    updatedAt: string(row.updated_at),
  };
}
function required(value: unknown, keys: string[]): Record<string, unknown> {
  if (!record(value) || keys.some((key) => !(key in value)))
    throw new RepositoryError("server_error", "invalid_response");
  return value;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function string(value: unknown): string {
  if (typeof value !== "string")
    throw new RepositoryError("server_error", "invalid_response");
  return value;
}
function nullable(value: unknown): string | null {
  return value === null ? null : string(value);
}
function integer(value: unknown): number {
  if (!Number.isInteger(value))
    throw new RepositoryError("server_error", "invalid_response");
  return value as number;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw new RepositoryError("server_error", "invalid_response");
  return value;
}
function status(value: unknown): Journey["status"] {
  if (
    value === "planning" ||
    value === "active" ||
    value === "completed" ||
    value === "archived"
  )
    return value;
  throw new RepositoryError("server_error", "invalid_response");
}
function category(value: unknown): PackingItem["category"] {
  if (
    value === "documents" ||
    value === "clothing" ||
    value === "toiletries" ||
    value === "electronics" ||
    value === "other"
  )
    return value;
  throw new RepositoryError("server_error", "invalid_response");
}
