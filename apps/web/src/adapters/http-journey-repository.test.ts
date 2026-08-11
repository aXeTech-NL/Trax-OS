import { TraxApiClient } from "@trax-os/api-client";
import { afterEach, expect, test, vi } from "vitest";

import { EMPTY_JOURNEY_DATA } from "../features/journeys/domain";
import { createJourney } from "../features/journeys/journey-service";
import { HttpJourneyRepository } from "./http-journey-repository";

afterEach(() => vi.unstubAllGlobals());
const contract = {
  schema_version: "1",
  api: { current: 1, minimum_supported: 1, maximum_supported: 1 },
  commands: [
    {
      command_type: "journey.update",
      current: 1,
      minimum_supported: 1,
      maximum_supported: 1,
    },
  ],
};
const commandId = "00000000-0000-4000-8000-000000000099";
const wireJourney = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Japan",
  start_date: null,
  end_date: null,
  status: "planning",
  record_version: 1,
  created_at: "2026-08-02T00:00:00Z",
  updated_at: "2026-08-02T00:00:00Z",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("maps canonical server state and sends CSRF on mutations", async () => {
  document.cookie = "trax_csrf=csrf-value; path=/";
  let created = false;
  const fetch = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url === "/api/contract") return json(contract);
      if (init?.method === "POST" && url === "/api/v1/journeys") {
        created = true;
        return json(wireJourney, 201);
      }
      if (url.endsWith("/segments")) return json({ items: [] });
      if (url.endsWith("/packing")) return json({ items: [] });
      if (url === "/api/v1/journeys")
        return json({ items: created ? [wireJourney] : [] });
      throw new Error(`unexpected ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetch);
  localStorage.setItem("trax.locale.v1", "nl");
  localStorage.clear();
  const repository = new HttpJourneyRepository(
    new TraxApiClient({ request: fetch }),
    () => commandId,
  );
  await expect(repository.load()).resolves.toEqual(EMPTY_JOURNEY_DATA);
  const local = createJourney(
    EMPTY_JOURNEY_DATA,
    { name: "Japan", startDate: "", endDate: "" },
    { id: () => wireJourney.id, now: () => wireJourney.created_at },
  );
  const persisted = await repository.save(local.data);
  expect(persisted.journeys[0]).toMatchObject({
    id: wireJourney.id,
    name: "Japan",
    recordVersion: 1,
  });
  const mutation = fetch.mock.calls.find((call) => call[1]?.method === "POST");
  expect(new Headers(mutation?.[1]?.headers).get("X-CSRF-Token")).toBe(
    "csrf-value",
  );
});

test("maps edit, timeline reorder and packing progress to versioned endpoints", async () => {
  document.cookie = "trax_csrf=csrf-value; path=/";
  const journeyId = wireJourney.id;
  let journey = { ...wireJourney };
  let segments: any[] = [
    {
      id: "00000000-0000-4000-8000-000000000010",
      journey_id: journeyId,
      kind: "stay",
      position: 0,
      start_date: null,
      end_date: null,
      place_name: "Tokyo",
      origin_name: null,
      destination_name: null,
      transport_mode: "",
      notes: "",
      record_version: 1,
      created_at: wireJourney.created_at,
      updated_at: wireJourney.updated_at,
    },
    {
      id: "00000000-0000-4000-8000-000000000011",
      journey_id: journeyId,
      kind: "move",
      position: 1,
      start_date: null,
      end_date: null,
      place_name: null,
      origin_name: "Tokyo",
      destination_name: "Kyoto",
      transport_mode: "Train",
      notes: "",
      record_version: 1,
      created_at: wireJourney.created_at,
      updated_at: wireJourney.updated_at,
    },
  ];
  let packing: any[] = [
    {
      id: "00000000-0000-4000-8000-000000000020",
      journey_id: journeyId,
      label: "Passport",
      category: "documents",
      quantity: 1,
      packed_quantity: 0,
      essential: true,
      record_version: 1,
      created_at: wireJourney.created_at,
      updated_at: wireJourney.updated_at,
    },
  ];
  const calls: Array<{ url: string; method: string; body: any }> = [];
  const fetch = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      if (url === "/api/contract") return json(contract);
      if (method === "GET" && url === "/api/v1/journeys")
        return json({ items: [journey] });
      if (method === "GET" && url.endsWith("/segments"))
        return json({ items: segments });
      if (method === "GET" && url.endsWith("/packing"))
        return json({ items: packing });
      if (method === "POST" && url === "/api/v1/commands/journey.update") {
        journey = {
          ...journey,
          name: body.payload.name,
          status: body.payload.status,
          record_version: journey.record_version + 1,
        };
        return json({
          command_id: body.command_id,
          command_type: "journey.update",
          command_version: 1,
          outcome: "applied",
          replayed: false,
          change_set_id: "00000000-0000-4000-8000-000000000098",
          result: {
            entity_type: "journey",
            entity_id: journeyId,
            record_version: journey.record_version,
          },
        });
      }
      if (method === "POST" && url.endsWith("/reorder")) {
        const index = segments.findIndex((item) => url.includes(item.id));
        const [moved] = segments.splice(index, 1);
        if (!moved) throw new Error("missing moved segment");
        segments.splice(body.new_position, 0, {
          ...moved,
          record_version: moved.record_version + 1,
        });
        segments = segments.map((item, position) => ({ ...item, position }));
        return json(segments[body.new_position]);
      }
      if (method === "PUT" && url.endsWith("/progress")) {
        packing = packing.map((item) =>
          url.includes(item.id)
            ? {
                ...item,
                packed_quantity: body.packed_quantity,
                record_version: item.record_version + 1,
              }
            : item,
        );
        return json(packing[0]);
      }
      throw new Error(`unexpected ${method} ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetch);
  const repository = new HttpJourneyRepository(
    new TraxApiClient({ request: fetch }),
    () => commandId,
  );
  let data = await repository.load();
  data = {
    ...data,
    journeys: data.journeys.map((item) => ({ ...item, name: "Japan spring" })),
  };
  data = await repository.save(data);
  data = {
    ...data,
    segments: [data.segments[1]!, data.segments[0]!].map((item, position) => ({
      ...item,
      position,
    })),
  };
  data = await repository.save(data);
  data = {
    ...data,
    packingItems: data.packingItems.map((item) => ({
      ...item,
      packedQuantity: 1,
    })),
  };
  await repository.save(data);
  expect(
    calls.find(
      (call) =>
        call.method === "POST" &&
        call.url === "/api/v1/commands/journey.update",
    )?.body.payload.expected_record_version,
  ).toBe(1);
  expect(
    calls.some(
      (call) => call.url.endsWith("/reorder") && call.body.new_position === 0,
    ),
  ).toBe(true);
  expect(
    calls.some(
      (call) =>
        call.url.endsWith("/progress") && call.body.packed_quantity === 1,
    ),
  ).toBe(true);
});

test("reuses canonical command IDs across a partial save retry", async () => {
  const secondId = "00000000-0000-4000-8000-000000000002";
  let serverJourneys = [
    { ...wireJourney },
    { ...wireJourney, id: secondId, name: "Norway" },
  ];
  const calls: Array<{ journeyId: string; commandId: string }> = [];
  let failSecondOnce = true;
  const applied = new Set<string>();
  const client = {
    commandVersion: vi.fn().mockResolvedValue(1),
    request: vi.fn(async (operation: string, input: any) => {
      if (operation === "list_journeys_api_v1_journeys_get")
        return { items: serverJourneys };
      if (
        operation.includes("list_segments") ||
        operation.includes("list_packing")
      )
        return { items: [] };
      if (operation.includes("canonical_update_journey")) {
        const body = input.body;
        const journeyId = body.payload.journey_id;
        calls.push({ journeyId, commandId: body.command_id });
        if (journeyId === secondId && failSecondOnce) {
          failSecondOnce = false;
          throw new Error("temporary later failure");
        }
        if (!applied.has(body.command_id)) {
          applied.add(body.command_id);
          serverJourneys = serverJourneys.map((journey) =>
            journey.id === journeyId
              ? {
                  ...journey,
                  name: body.payload.name,
                  record_version: journey.record_version + 1,
                }
              : journey,
          );
        }
        return {};
      }
      throw new Error(`unexpected ${operation}`);
    }),
  };
  const generatedIds = [
    "00000000-0000-4000-8000-000000000091",
    "00000000-0000-4000-8000-000000000092",
    "00000000-0000-4000-8000-000000000093",
  ];
  const repository = new HttpJourneyRepository(
    client as unknown as TraxApiClient,
    () => generatedIds.shift()!,
  );
  const loaded = await repository.load();
  const edited = {
    ...loaded,
    journeys: loaded.journeys.map((journey) => ({
      ...journey,
      name: `${journey.name} updated`,
    })),
  };

  await expect(repository.save(edited)).rejects.toThrow(
    "temporary later failure",
  );
  await expect(repository.save(edited)).resolves.toMatchObject({
    journeys: [
      { name: "Japan updated", recordVersion: 2 },
      { name: "Norway updated", recordVersion: 2 },
    ],
  });
  expect(
    calls
      .filter((call) => call.journeyId === wireJourney.id)
      .map((call) => call.commandId),
  ).toEqual([
    "00000000-0000-4000-8000-000000000091",
    "00000000-0000-4000-8000-000000000091",
  ]);
  expect(
    calls
      .filter((call) => call.journeyId === secondId)
      .map((call) => call.commandId),
  ).toEqual([
    "00000000-0000-4000-8000-000000000092",
    "00000000-0000-4000-8000-000000000092",
  ]);

  const reloaded = await repository.load();
  await repository.save({
    ...reloaded,
    journeys: reloaded.journeys.map((journey) =>
      journey.id === wireJourney.id
        ? { ...journey, name: "Japan updated again" }
        : journey,
    ),
  });
  expect(
    calls.filter((call) => call.journeyId === wireJourney.id).at(-1)?.commandId,
  ).toBe("00000000-0000-4000-8000-000000000093");
});
