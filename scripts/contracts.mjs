import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractOutputDirectory = join(
  root,
  "packages",
  "api-contract",
  "generated",
);
const clientOutputDirectory = join(root, "packages", "api-client", "generated");
const generatedFiles = ["openapi.json", "schema.ts", "runtime-fixtures.json"];
const allGeneratedFiles = [...generatedFiles, "client.ts"];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? 1}.`);
  }
}

function generate(directory) {
  const openapi = join(directory, "openapi.json");
  const schema = join(directory, "schema.ts");
  const runtimeFixtures = join(directory, "runtime-fixtures.json");
  run("uv", [
    "run",
    "--project",
    "apps/api",
    "--locked",
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
  run("uv", [
    "run",
    "--project",
    "apps/api",
    "--locked",
    "python",
    "apps/api/scripts/generate_runtime_fixtures.py",
    runtimeFixtures,
  ]);
  const client = join(directory, "client.ts");
  run("node", [
    "scripts/generate-api-client.mjs",
    openapi,
    runtimeFixtures,
    client,
  ]);
  run("npm", ["exec", "--", "prettier", "--write", client]);
}

function differingFiles(files, leftDirectory, rightDirectory) {
  return files.filter((file) => {
    try {
      return !readFileSync(join(leftDirectory, file)).equals(
        readFileSync(join(rightDirectory, file)),
      );
    } catch {
      return true;
    }
  });
}

export function differingGeneratedFiles(leftDirectory, rightDirectory) {
  return generatedFiles.filter((file) => {
    try {
      return !readFileSync(join(leftDirectory, file)).equals(
        readFileSync(join(rightDirectory, file)),
      );
    } catch {
      return true;
    }
  });
}

function main() {
  const mode = process.argv[2];
  if (mode !== "generate" && mode !== "check") {
    console.error("Usage: node scripts/contracts.mjs <generate|check>");
    process.exitCode = 2;
    return;
  }

  const firstDirectory = mkdtempSync(join(tmpdir(), "trax-contract-first-"));
  const secondDirectory =
    mode === "check"
      ? mkdtempSync(join(tmpdir(), "trax-contract-second-"))
      : undefined;

  try {
    generate(firstDirectory);

    if (mode === "generate") {
      mkdirSync(contractOutputDirectory, { recursive: true });
      mkdirSync(clientOutputDirectory, { recursive: true });
      for (const file of generatedFiles) {
        copyFileSync(
          join(firstDirectory, file),
          join(contractOutputDirectory, file),
        );
      }
      copyFileSync(
        join(firstDirectory, "client.ts"),
        join(clientOutputDirectory, "client.ts"),
      );
      console.log(
        "Generated OpenAPI, TypeScript, runtime fixtures and validated-client metadata.",
      );
      return;
    }

    generate(secondDirectory);
    const nondeterministic = differingFiles(
      allGeneratedFiles,
      firstDirectory,
      secondDirectory,
    );
    if (nondeterministic.length > 0) {
      throw new Error(
        `Nondeterministic contract generation detected: ${nondeterministic.join(", ")}.`,
      );
    }

    const contractDrift = differingGeneratedFiles(
      firstDirectory,
      contractOutputDirectory,
    );
    const clientDrift = differingFiles(
      ["client.ts"],
      firstDirectory,
      clientOutputDirectory,
    );
    const drift = [
      ...contractDrift,
      ...clientDrift.map((file) => `api-client/${file}`),
    ];
    if (drift.length > 0) {
      throw new Error(
        `Contract drift detected: ${drift.join(", ")}. Run make generate.`,
      );
    }
    console.log(
      "Generated contracts are byte-identical across two runs and match committed artifacts.",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    rmSync(firstDirectory, { recursive: true, force: true });
    if (secondDirectory) {
      rmSync(secondDirectory, { recursive: true, force: true });
    }
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) main();
