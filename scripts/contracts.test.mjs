import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { differingGeneratedFiles } from "./contracts.mjs";

function writeGenerated(directory, openapi, schema, runtimeFixtures = "{}\n") {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "openapi.json"), openapi);
  writeFileSync(join(directory, "schema.ts"), schema);
  writeFileSync(join(directory, "runtime-fixtures.json"), runtimeFixtures);
}

test("generated-file comparison detects a nondeterministic byte", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "trax-contract-test-"));
  const first = join(temporaryDirectory, "first");
  const second = join(temporaryDirectory, "second");

  try {
    writeGenerated(first, '{"openapi":"3.1.0"}\n', "export type A = 1;\n");
    writeGenerated(second, '{"openapi":"3.1.0"}\n', "export type A = 2;\n");

    assert.deepEqual(differingGeneratedFiles(first, first), []);
    assert.deepEqual(differingGeneratedFiles(first, second), ["schema.ts"]);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("generated-file comparison fails closed when output is missing", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "trax-contract-test-"));
  const complete = join(temporaryDirectory, "complete");
  const incomplete = join(temporaryDirectory, "incomplete");

  try {
    writeGenerated(complete, "{}\n", "export {};\n");
    mkdirSync(incomplete);
    writeFileSync(join(incomplete, "openapi.json"), "{}\n");

    assert.deepEqual(differingGeneratedFiles(complete, incomplete), [
      "schema.ts",
      "runtime-fixtures.json",
    ]);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
