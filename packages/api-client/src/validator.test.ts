import { describe, expect, test } from "vitest";

import { assertValid, SchemaValidationError } from "./validator";

function rejects(schema: unknown, value: unknown): void {
  expect(() => assertValid(schema, value, "request")).toThrow(
    SchemaValidationError,
  );
}

describe("OpenAPI 3.1 runtime schema validation", () => {
  test("resolves local refs and enforces object required fields", () => {
    const schema = { $ref: "#/components/schemas/Capability" };
    expect(() =>
      assertValid(schema, { key: "feature", status: "available" }, "response"),
    ).not.toThrow();
    rejects(schema, { status: "available" });
  });

  test("rejects unknown request fields and tolerates additive response fields", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: { name: { type: "string" } },
    };
    rejects(schema, { name: "Trax", extra: true });
    expect(() =>
      assertValid(schema, { name: "Trax", extra: true }, "response"),
    ).not.toThrow();
  });

  test("enforces arrays, anyOf/null, const, enum and additional-property schemas", () => {
    const schema = {
      type: "object",
      additionalProperties: { type: "integer", minimum: 1 },
      properties: {},
    };
    assertValid(schema, { one: 1 }, "request");
    rejects(schema, { one: 0 });
    assertValid(
      { type: "array", items: { enum: ["a", "b"], type: "string" } },
      ["a"],
      "request",
    );
    rejects({ type: "array", items: { const: "a", type: "string" } }, ["b"]);
    assertValid(
      { anyOf: [{ type: "string" }, { type: "null" }] },
      null,
      "request",
    );
    rejects({ anyOf: [{ type: "string" }, { type: "null" }] }, 1);
  });

  test("enforces numeric, length and pattern constraints", () => {
    assertValid({ type: "integer", minimum: 1, maximum: 3 }, 2, "request");
    rejects({ type: "integer", minimum: 1 }, 0);
    rejects({ type: "integer" }, 1.5);
    rejects({ type: "integer" }, Number.MAX_SAFE_INTEGER + 1);
    assertValid(
      { type: "string", minLength: 2, maxLength: 4, pattern: "^[a-z]+$" },
      "abc",
      "request",
    );
    rejects({ type: "string", minLength: 2 }, "a");
    rejects({ type: "string", pattern: "^[a-z]+$" }, "ABC");
  });

  test("counts JSON Schema string lengths as Unicode code points", () => {
    assertValid({ type: "string", maxLength: 1 }, "😀", "request");
    rejects({ type: "string", maxLength: 1 }, "😀a");
  });

  test.each([
    ["uuid", "00000000-0000-0000-0000-000000000000", "not-uuid"],
    ["date", "2026-08-11", "2026-02-30"],
    ["date-time", "2026-08-11T08:00:00Z", "2026-08-11 08:00:00"],
    ["email", "owner@example.com", "owner-at-example"],
    ["date-time", "2026-08-11T08:00:00+02:00", "2026-02-30T08:00:00Z"],
    ["date-time", "2026-08-11T23:59:59Z", "2026-08-11T24:00:00Z"],
  ])("enforces the %s format", (format, valid, invalid) => {
    assertValid({ type: "string", format }, valid, "request");
    rejects({ type: "string", format }, invalid);
  });
});
