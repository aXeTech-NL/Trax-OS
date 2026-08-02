import { expect, test } from "vitest";

import { parseRoute, routes } from "./routes";

test("builds and parses encoded journey routes", () => {
  const path = routes.timeline("journey / nl");
  expect(path).toBe("/journeys/journey%20%2F%20nl/timeline");
  expect(parseRoute(path)).toEqual({
    name: "timeline",
    journeyId: "journey / nl",
  });
});

test("rejects unknown and malformed routes", () => {
  expect(parseRoute("/journeys/id/unknown")).toEqual({ name: "not-found" });
  expect(parseRoute("/journeys/%E0%A4%A")).toEqual({ name: "not-found" });
});
