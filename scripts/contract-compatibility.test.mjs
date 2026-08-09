import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertLocalReferences,
  compareOpenApi,
  loadOpenApi,
} from "./contract-compatibility.mjs";

const baselinePath = new URL(
  "../packages/api-contract/generated/openapi.json",
  import.meta.url,
);
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

function candidate(mutator) {
  const document = structuredClone(baseline);
  mutator(document);
  return document;
}

function blocking(document) {
  return compareOpenApi(baseline, document).blockingDifferences;
}

function withoutSecurityMetadata(document) {
  const legacy = structuredClone(document);
  delete legacy.components.securitySchemes;
  for (const pathItem of Object.values(legacy.paths)) {
    for (const operation of Object.values(pathItem)) {
      if (typeof operation !== "object" || operation === null) continue;
      delete operation.security;
      if (Array.isArray(operation.parameters)) {
        operation.parameters = operation.parameters.filter(
          (parameter) => parameter.name !== "X-CSRF-Token",
        );
        if (operation.parameters.length === 0) delete operation.parameters;
      }
    }
  }
  return legacy;
}

test("the checked-in OpenAPI document is supported and self-compatible", () => {
  const document = loadOpenApi(baselinePath);
  assert.equal(compareOpenApi(document, document).differences.length, 0);
});

test("compatible additive contract changes pass", () => {
  const document = candidate((value) => {
    value.components.schemas.VersionResponse.properties.release_label = {
      type: "string",
    };
    value.paths["/_compatibility_test"] = structuredClone(
      value.paths["/api/v1/version"],
    );
  });

  assert.deepEqual(blocking(document), []);
});

test("a newly required request field is rejected", () => {
  const document = candidate((value) => {
    const schema = value.components.schemas.RegisterRequest;
    schema.properties.server_actor_id = { type: "string" };
    schema.required.push("server_actor_id");
  });

  assert.ok(blocking(document).length > 0);
});

test("a removed optional request field is rejected", () => {
  const document = candidate((value) => {
    delete value.components.schemas.JourneyCreate.properties.end_date;
  });

  assert.ok(blocking(document).length > 0);
});

test("a newly required operation parameter is rejected", () => {
  const document = candidate((value) => {
    value.paths["/api/v1/version"].get.parameters = [
      {
        name: "X-Required-Contract-Test",
        in: "header",
        required: true,
        schema: { type: "string" },
      },
    ];
  });

  assert.ok(blocking(document).length > 0);
});

test("request-constraint narrowing is rejected", () => {
  const document = candidate((value) => {
    value.components.schemas.RegisterRequest.properties.email.enum = [
      "only@example.com",
    ];
  });

  assert.ok(blocking(document).length > 0);
});

test("an operation identifier change is rejected", () => {
  const document = candidate((value) => {
    value.paths["/api/v1/version"].get.operationId = "changed_operation_id";
  });

  assert.ok(blocking(document).length > 0);
});

test("a removed operation is rejected", () => {
  const document = candidate((value) => {
    delete value.paths["/api/v1/version"];
  });

  assert.ok(blocking(document).length > 0);
});

test("a removed response field is rejected", () => {
  const document = candidate((value) => {
    const schema = value.components.schemas.VersionResponse;
    delete schema.properties.version;
    schema.required = schema.required.filter((field) => field !== "version");
  });

  assert.ok(blocking(document).length > 0);
});

test("a widened response enum is rejected for exhaustive clients", () => {
  const document = candidate((value) => {
    value.components.schemas.Capability.properties.status.enum.push("degraded");
  });

  assert.ok(blocking(document).length > 0);
});

test("security-boundary changes require explicit architecture review", () => {
  const document = candidate((value) => {
    value.paths["/api/v1/version"].get.security = [{ NewAuth: [] }];
  });

  assert.ok(blocking(document).length > 0);
});

test("the exact legacy authentication metadata correction is allowed once", () => {
  const legacy = withoutSecurityMetadata(baseline);

  assert.deepEqual(compareOpenApi(legacy, baseline).blockingDifferences, []);
});

test("a partial legacy authentication metadata correction remains blocked", () => {
  const legacy = withoutSecurityMetadata(baseline);
  const incomplete = structuredClone(legacy);
  incomplete.components.securitySchemes = structuredClone(
    baseline.components.securitySchemes,
  );

  assert.ok(compareOpenApi(legacy, incomplete).blockingDifferences.length > 0);
});

test("external references fail closed without network access", () => {
  const document = candidate((value) => {
    value.components.schemas.Remote = {
      $ref: "https://example.invalid/remote-schema.json",
    };
  });

  assert.throws(
    () => assertLocalReferences(document, "candidate.json"),
    /non-local \$ref/,
  );
});

test("dangling local references fail closed", () => {
  const document = candidate((value) => {
    value.components.schemas.Dangling = {
      $ref: "#/components/schemas/DoesNotExist",
    };
  });

  assert.throws(
    () => assertLocalReferences(document, "candidate.json"),
    /dangling local \$ref/,
  );
});
