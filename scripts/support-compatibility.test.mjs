import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadSupport,
  supportBreakingChanges,
} from "./support-compatibility.mjs";

const command = {
  command_type: "journey.update",
  current: 2,
  minimum_supported: 1,
  maximum_supported: 2,
};
function fixture(
  api = { current: 2, minimum_supported: 1, maximum_supported: 2 },
  commands = [command],
) {
  return { contract: { schema_version: "1", api, commands } };
}
function load(value, options) {
  const root = mkdtempSync(path.join(os.tmpdir(), "trax-support-"));
  const file = path.join(root, "fixture.json");
  writeFileSync(file, JSON.stringify(value));
  try {
    return loadSupport(file, options);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("allows the one-time addition only when trusted legacy discovery is absent", () => {
  assert.equal(load({}, { allowMissing: true }), undefined);
  for (const malformed of [null, false, 0, ""]) {
    assert.throws(
      () => load({ contract: malformed }, { allowMissing: true }),
      /invalid contract metadata/,
    );
  }
  assert.equal(supportBreakingChanges(undefined, load(fixture())).length, 0);
});

test("allows exact, widening and additive command support", () => {
  const base = load(fixture());
  const wider = load(
    fixture({ current: 2, minimum_supported: 1, maximum_supported: 3 }, [
      command,
      {
        command_type: "future.command",
        current: 1,
        minimum_supported: 1,
        maximum_supported: 1,
      },
    ]),
  );
  assert.deepEqual(supportBreakingChanges(base, base), []);
  assert.deepEqual(supportBreakingChanges(base, wider), []);
});

test("blocks API and command contraction and command removal", () => {
  const base = load(fixture());
  assert.match(
    supportBreakingChanges(
      base,
      load(fixture({ current: 2, minimum_supported: 2, maximum_supported: 2 })),
    )[0],
    /API/,
  );
  assert.match(
    supportBreakingChanges(
      base,
      load(fixture(undefined, [{ ...command, minimum_supported: 2 }])),
    )[0],
    /contracted/,
  );
  assert.match(
    supportBreakingChanges(base, load(fixture(undefined, [])))[0],
    /removed/,
  );
});

test("rejects malformed and duplicate metadata", () => {
  assert.throws(
    () =>
      load(fixture({ current: 1, minimum_supported: 2, maximum_supported: 1 })),
    /invalid range/,
  );
  assert.throws(
    () => load(fixture(undefined, [command, command])),
    /duplicate/,
  );
});
