import { afterEach, expect, test, vi } from "vitest";

import { EMPTY_JOURNEY_DATA } from "../features/journeys/domain";
import { createJourney } from "../features/journeys/journey-service";
import { HttpJourneyRepository } from "./http-journey-repository";

afterEach(() => vi.unstubAllGlobals());
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

test("maps canonical server state and sends CSRF on mutations", async () => {
  document.cookie = "trax_csrf=csrf-value; path=/";
  let created = false;
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (init?.method === "POST" && url === "/api/v1/journeys") {
      created = true;
      return new Response(JSON.stringify(wireJourney), { status: 201 });
    }
    if (url.endsWith("/segments"))
      return new Response(JSON.stringify({ items: [] }));
    if (url.endsWith("/packing"))
      return new Response(JSON.stringify({ items: [] }));
    if (url === "/api/v1/journeys")
      return new Response(
        JSON.stringify({ items: created ? [wireJourney] : [] }),
      );
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  localStorage.setItem("trax.locale.v1", "nl");
  localStorage.clear();
  const repository = new HttpJourneyRepository();
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
  expect(mutation?.[1]?.headers).toMatchObject({
    "X-CSRF-Token": "csrf-value",
  });
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
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
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
    if (method === "GET" && url === "/api/v1/journeys")
      return new Response(JSON.stringify({ items: [journey] }));
    if (method === "GET" && url.endsWith("/segments"))
      return new Response(JSON.stringify({ items: segments }));
    if (method === "GET" && url.endsWith("/packing"))
      return new Response(JSON.stringify({ items: packing }));
    if (method === "PUT" && url === `/api/v1/journeys/${journeyId}`) {
      journey = {
        ...journey,
        name: body.name,
        status: body.status,
        record_version: journey.record_version + 1,
      };
      return new Response(JSON.stringify(journey));
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
      return new Response(JSON.stringify(segments[body.new_position]));
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
      return new Response(JSON.stringify(packing[0]));
    }
    throw new Error(`unexpected ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  const repository = new HttpJourneyRepository();
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
        call.method === "PUT" && call.url === `/api/v1/journeys/${journeyId}`,
    )?.body.expected_record_version,
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
