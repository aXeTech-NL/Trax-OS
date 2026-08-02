import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = join(root, "packages", "api-contract", "generated");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "trax-contract-"));
const generatedFiles = ["openapi.json", "schema.ts"];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function generate(directory) {
  const openapi = join(directory, "openapi.json");
  const schema = join(directory, "schema.ts");
  run("uv", [
    "run",
    "--project",
    "apps/api",
    "python",
    "apps/api/scripts/generate_openapi.py",
    openapi,
  ]);
  run("npm", [
    "exec",
    "--",
    "openapi-typescript",
    openapi,
    "--output",
    schema,
    "--immutable",
  ]);
}

try {
  generate(temporaryDirectory);
  const mode = process.argv[2];

  if (mode === "generate") {
    mkdirSync(outputDirectory, { recursive: true });
    for (const file of generatedFiles) {
      copyFileSync(join(temporaryDirectory, file), join(outputDirectory, file));
    }
    console.log("Generated OpenAPI and TypeScript contracts.");
  } else if (mode === "check") {
    const drift = generatedFiles.filter((file) => {
      try {
        return !readFileSync(join(temporaryDirectory, file)).equals(
          readFileSync(join(outputDirectory, file)),
        );
      } catch {
        return true;
      }
    });
    if (drift.length > 0) {
      console.error(`Contract drift detected: ${drift.join(", ")}. Run make generate.`);
      process.exitCode = 1;
    } else {
      console.log("Generated contracts are current and deterministic.");
    }
  } else {
    console.error("Usage: node scripts/contracts.mjs <generate|check>");
    process.exitCode = 2;
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
