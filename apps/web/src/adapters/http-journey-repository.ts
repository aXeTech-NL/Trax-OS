import { ApiClientError, TraxApiClient } from "@trax-os/api-client";

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
  private readonly pendingJourneyUpdates = new Map<
    string,
    { readonly commandId: string; readonly signature: string }
  >();

  constructor(
    private readonly client = new TraxApiClient(),
    private readonly commandId: () => string = () => crypto.randomUUID(),
  ) {}

  async load(): Promise<JourneyData> {
    return repositoryCall(async () => {
      const journeys = (
        await this.client.request("list_journeys_api_v1_journeys_get", {})
      ).items.map(journeyFrom);
      const details = await Promise.all(
        journeys.map(async (journey) => {
          const [segmentData, packingData] = await Promise.all([
            this.client.request(
              "list_segments_api_v1_journeys__journey_id__segments_get",
              { path: { journey_id: journey.id } },
            ),
            this.client.request(
              "list_packing_api_v1_journeys__journey_id__packing_get",
              { path: { journey_id: journey.id } },
            ),
          ]);
          return {
            segments: segmentData.items.map(segmentFrom),
            packing: packingData.items.map(packingFrom),
          };
        }),
      );
      this.current = {
        schemaVersion: 1,
        journeys,
        segments: details.flatMap((item) => item.segments),
        packingItems: details.flatMap((item) => item.packing),
      };
      this.pendingJourneyUpdates.clear();
      return structuredClone(this.current);
    });
  }

  async save(next: JourneyData): Promise<JourneyData> {
    return repositoryCall(async () => {
      const previous = this.current;
      for (const journey of previous.journeys.filter(
        (item) => !next.journeys.some((candidate) => candidate.id === item.id),
      )) {
        await this.client.request(
          "delete_journey_api_v1_journeys__journey_id__delete",
          { path: { journey_id: journey.id } },
        );
      }
      for (const journey of next.journeys) {
        const old = previous.journeys.find((item) => item.id === journey.id);
        if (!old) {
          await this.client.request("create_journey_api_v1_journeys_post", {
            body: journeyBody(journey, true),
          });
        } else if (journeyChanged(old, journey)) {
          const commandVersion =
            await this.client.commandVersion("journey.update");
          const payload = {
            journey_id: journey.id,
            ...journeyBody(journey, false),
            status: journey.status,
            expected_record_version: old.recordVersion,
          };
          const signature = JSON.stringify({
            command_type: "journey.update",
            command_version: commandVersion,
            payload,
          });
          const existing = this.pendingJourneyUpdates.get(journey.id);
          const commandId =
            existing?.signature === signature
              ? existing.commandId
              : this.commandId();
          this.pendingJourneyUpdates.set(journey.id, { commandId, signature });
          await this.client.request(
            "canonical_update_journey_api_v1_commands_journey_update_post",
            {
              body: {
                command_id: commandId,
                command_type: "journey.update",
                command_version: commandVersion,
                payload,
              },
            },
          );
        }
      }
      const livingJourneyIds = new Set(next.journeys.map((item) => item.id));
      for (const segment of previous.segments.filter(
        (item) =>
          livingJourneyIds.has(item.journeyId) &&
          !next.segments.some((candidate) => candidate.id === item.id),
      )) {
        await this.client.request(
          "delete_segment_api_v1_journeys__journey_id__segments__segment_id__delete",
          { path: { journey_id: segment.journeyId, segment_id: segment.id } },
        );
      }
      for (const segment of next.segments) {
        const old = previous.segments.find((item) => item.id === segment.id);
        if (!old) {
          await this.client.request(
            "create_segment_api_v1_journeys__journey_id__segments_post",
            {
              path: { journey_id: segment.journeyId },
              body: segmentBody(segment, true),
            },
          );
        } else if (segmentChanged(old, segment)) {
          await this.client.request(
            "update_segment_api_v1_journeys__journey_id__segments__segment_id__put",
            {
              path: { journey_id: segment.journeyId, segment_id: segment.id },
              body: {
                ...segmentBody(segment, false),
                expected_record_version: old.recordVersion,
              },
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
          await this.client.request(
            "reorder_segment_api_v1_journeys__journey_id__segments__segment_id__reorder_post",
            {
              path: { journey_id: journey.id, segment_id: moved.id },
              body: {
                expected_record_version: old.recordVersion,
                new_position: after.findIndex((item) => item.id === moved.id),
              },
            },
          );
        }
      }
      for (const item of previous.packingItems.filter(
        (old) =>
          livingJourneyIds.has(old.journeyId) &&
          !next.packingItems.some((candidate) => candidate.id === old.id),
      )) {
        await this.client.request(
          "delete_packing_api_v1_journeys__journey_id__packing__item_id__delete",
          { path: { journey_id: item.journeyId, item_id: item.id } },
        );
      }
      for (const item of next.packingItems) {
        const old = previous.packingItems.find(
          (candidate) => candidate.id === item.id,
        );
        if (!old) {
          await this.client.request(
            "create_packing_api_v1_journeys__journey_id__packing_post",
            {
              path: { journey_id: item.journeyId },
              body: packingBody(item, true),
            },
          );
        } else if (packingDefinitionChanged(old, item)) {
          await this.client.request(
            "update_packing_api_v1_journeys__journey_id__packing__item_id__put",
            {
              path: { journey_id: item.journeyId, item_id: item.id },
              body: {
                ...packingBody(item, false),
                expected_record_version: old.recordVersion,
              },
            },
          );
        } else if (old.packedQuantity !== item.packedQuantity) {
          await this.client.request(
            "update_packing_progress_api_v1_journeys__journey_id__packing__item_id__progress_put",
            {
              path: { journey_id: item.journeyId, item_id: item.id },
              body: {
                expected_record_version: old.recordVersion,
                packed_quantity: item.packedQuantity,
              },
            },
          );
        }
      }
      return this.load();
    });
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

function journeyBody(value: Journey, includeId: boolean) {
  return {
    ...(includeId ? { id: value.id } : {}),
    name: value.name,
    start_date: value.startDate,
    end_date: value.endDate,
  };
}
function segmentBody(value: JourneySegment, includeId: boolean) {
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
function packingBody(value: PackingItem, includeId: boolean) {
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

async function repositoryCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ApiClientError)) throw error;
    if (error.kind === "network")
      throw new RepositoryError("network_error", "Network unavailable");
    if (error.status === 401)
      throw new RepositoryError("authentication_required", error.code);
    if (error.status === 409)
      throw new RepositoryError("version_conflict", error.code);
    throw new RepositoryError(
      "server_error",
      error.kind === "contract" ? "invalid_response" : error.code,
    );
  }
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
