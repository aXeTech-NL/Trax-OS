import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = path.resolve("scripts/generate-api-client.mjs");
const fixture = {
  contract: {
    api: { current: 1, minimum_supported: 1, maximum_supported: 1 },
    commands: [],
  },
};

function spec(schema) {
  return {
    openapi: "3.1.0",
    components: { schemas: { Result: schema } },
    paths: {
      "/api/example": {
        get: {
          operationId: "example_get",
          responses: {
            200: {
              description: "ok",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Result" },
                },
              },
            },
          },
        },
      },
    },
  };
}

function run(root, openapi, output, runtimeFixture = fixture) {
  const openapiPath = path.join(root, "openapi.json");
  const fixturePath = path.join(root, "fixtures.json");
  writeFileSync(openapiPath, JSON.stringify(openapi));
  writeFileSync(fixturePath, JSON.stringify(runtimeFixture));
  return spawnSync(
    process.execPath,
    [script, openapiPath, fixturePath, output],
    {
      encoding: "utf8",
    },
  );
}

test("client projection is byte deterministic", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "trax-client-generator-"));
  try {
    const first = path.join(root, "first.ts");
    const second = path.join(root, "second.ts");
    assert.equal(
      run(
        root,
        spec({
          type: "object",
          required: ["value"],
          additionalProperties: false,
          properties: { value: { type: "string" } },
        }),
        first,
      ).status,
      0,
    );
    assert.equal(run(root, spec({ type: "string" }), second).status, 0);
    assert.notEqual(readFileSync(first, "utf8"), readFileSync(second, "utf8"));
    const third = path.join(root, "third.ts");
    assert.equal(run(root, spec({ type: "string" }), third).status, 0);
    assert.equal(readFileSync(second, "utf8"), readFileSync(third, "utf8"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("client generator fails closed on unsupported keywords and references", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "trax-client-generator-"));
  try {
    const unsupported = run(
      root,
      spec({ type: "string", unevaluatedProperties: false }),
      path.join(root, "unsupported.ts"),
    );
    assert.notEqual(unsupported.status, 0);
    assert.match(unsupported.stderr, /unsupported schema keyword/);

    const external = run(
      root,
      spec({ $ref: "https://example.test/schema.json" }),
      path.join(root, "external.ts"),
    );
    assert.notEqual(external.status, 0);
    assert.match(external.stderr, /external or unsupported/);

    for (const malformed of [
      { type: "mystery" },
      { type: "object", required: "value", properties: {} },
      { type: "string", minLength: 2, maxLength: 1 },
      { type: "string", pattern: "[" },
      { $ref: "#/components/schemas/Missing" },
      { $ref: "#/components/schemas/Result", minLength: 1 },
    ]) {
      const result = run(
        root,
        spec(malformed),
        path.join(root, "malformed.ts"),
      );
      assert.notEqual(result.status, 0);
    }

    const unsupportedMethod = spec({ type: "string" });
    unsupportedMethod.paths["/api/example"].head = structuredClone(
      unsupportedMethod.paths["/api/example"].get,
    );
    const method = run(root, unsupportedMethod, path.join(root, "method.ts"));
    assert.notEqual(method.status, 0);
    assert.match(method.stderr, /unsupported path-item field head/);

    const unsupportedOperation = spec({ type: "string" });
    unsupportedOperation.paths["/api/example"].get.callbacks = {};
    const operation = run(
      root,
      unsupportedOperation,
      path.join(root, "operation.ts"),
    );
    assert.notEqual(operation.status, 0);
    assert.match(operation.stderr, /unsupported operation field callbacks/);

    const unsupportedSecurity = spec({ type: "string" });
    unsupportedSecurity.paths["/api/example"].get.security = [
      { BearerAuth: [] },
    ];
    const security = run(
      root,
      unsupportedSecurity,
      path.join(root, "security.ts"),
    );
    assert.notEqual(security.status, 0);
    assert.match(security.stderr, /unsupported security metadata/);

    const withHeader = spec({ type: "string" });
    withHeader.paths["/api/example"].get.parameters = [
      {
        name: "X-Required",
        in: "header",
        required: true,
        schema: { type: "string" },
      },
    ];
    const header = run(root, withHeader, path.join(root, "header.ts"));
    assert.notEqual(header.status, 0);
    assert.match(header.stderr, /unsupported header parameter/);

    const duplicateCommand = {
      contract: {
        api: { current: 1, minimum_supported: 1, maximum_supported: 1 },
        commands: [
          {
            command_type: "journey.update",
            current: 1,
            minimum_supported: 1,
            maximum_supported: 1,
          },
          {
            command_type: "journey.update",
            current: 1,
            minimum_supported: 1,
            maximum_supported: 1,
          },
        ],
      },
    };
    const support = run(
      root,
      spec({ type: "string" }),
      path.join(root, "support.ts"),
      duplicateCommand,
    );
    assert.notEqual(support.status, 0);
    assert.match(support.stderr, /invalid or duplicate support metadata/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("command projection binds marker, request literal and discovery", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "trax-client-generator-"));
  try {
    const openapi = spec({ type: "string" });
    openapi.components.schemas.Command = {
      type: "object",
      required: ["command_type"],
      additionalProperties: false,
      properties: {
        command_type: { type: "string", const: "journey.update" },
      },
    };
    const operation = openapi.paths["/api/example"].get;
    operation["x-trax-command-type"] = "journey.update";
    operation.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Command" },
        },
      },
    };
    const support = {
      contract: {
        api: { current: 1, minimum_supported: 1, maximum_supported: 1 },
        commands: [
          {
            command_type: "journey.update",
            current: 1,
            minimum_supported: 1,
            maximum_supported: 1,
          },
        ],
      },
    };
    assert.equal(
      run(root, openapi, path.join(root, "valid.ts"), support).status,
      0,
    );

    const mismatch = structuredClone(openapi);
    mismatch.paths["/api/example"].get["x-trax-command-type"] = "journey.other";
    assert.notEqual(
      run(root, mismatch, path.join(root, "mismatch.ts"), support).status,
      0,
    );
    assert.notEqual(
      run(root, openapi, path.join(root, "missing.ts"), fixture).status,
      0,
    );

    const extra = structuredClone(support);
    extra.contract.commands.push({
      command_type: "future.command",
      current: 1,
      minimum_supported: 1,
      maximum_supported: 1,
    });
    assert.equal(
      run(root, openapi, path.join(root, "extra.ts"), extra).status,
      0,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
