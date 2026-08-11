import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function fail(message) {
  throw new Error(`Support compatibility failed: ${message}`);
}

function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1)
    fail(`${label} must be a positive safe integer`);
  return value;
}

function range(value, label, command = false) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object`);
  const minimum = positive(
    value.minimum_supported,
    `${label}.minimum_supported`,
  );
  const current = positive(value.current, `${label}.current`);
  const maximum = positive(
    value.maximum_supported,
    `${label}.maximum_supported`,
  );
  if (!(minimum <= current && current <= maximum))
    fail(`${label} has an invalid range`);
  if (
    command &&
    (typeof value.command_type !== "string" || !value.command_type)
  )
    fail(`${label}.command_type is invalid`);
  return {
    command_type: value.command_type,
    current,
    minimum_supported: minimum,
    maximum_supported: maximum,
  };
}

export function loadSupport(path, { allowMissing = false } = {}) {
  let document;
  try {
    document = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`);
  }
  if (!document || typeof document !== "object" || Array.isArray(document))
    fail(`${path} must contain a JSON object`);
  if (!Object.hasOwn(document, "contract")) {
    if (allowMissing) return undefined;
    fail(`${path} is missing contract metadata`);
  }
  const contract = document.contract;
  if (
    !contract ||
    typeof contract !== "object" ||
    Array.isArray(contract) ||
    contract.schema_version !== "1" ||
    !Array.isArray(contract.commands)
  )
    fail(`${path} has invalid contract metadata`);
  const api = range(contract.api, "contract.api");
  const commands = new Map();
  for (const [index, item] of contract.commands.entries()) {
    const parsed = range(item, `contract.commands[${index}]`, true);
    if (commands.has(parsed.command_type))
      fail(`duplicate command ${parsed.command_type}`);
    commands.set(parsed.command_type, parsed);
  }
  return { api, commands };
}

export function supportBreakingChanges(base, candidate) {
  const changes = [];
  if (!base) return changes;
  if (
    candidate.api.minimum_supported > base.api.minimum_supported ||
    candidate.api.maximum_supported < base.api.maximum_supported
  )
    changes.push("API supported range contracted");
  for (const [name, oldRange] of base.commands) {
    const next = candidate.commands.get(name);
    if (!next) changes.push(`command removed: ${name}`);
    else if (
      next.minimum_supported > oldRange.minimum_supported ||
      next.maximum_supported < oldRange.maximum_supported
    )
      changes.push(`command supported range contracted: ${name}`);
  }
  return changes;
}

function main() {
  if (process.argv.length !== 4)
    fail("usage: support-compatibility BASE CURRENT");
  const changes = supportBreakingChanges(
    loadSupport(process.argv[2], { allowMissing: true }),
    loadSupport(process.argv[3]),
  );
  if (changes.length) fail(changes.join("; "));
  console.log(
    "Advertised API and command support ranges are compatible with the trusted base.",
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
