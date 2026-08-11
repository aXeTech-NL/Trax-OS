import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runModuleBoundaryCheck } from "./module-boundaries.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pythonHelper = path.join(scriptDirectory, "python-imports.py");

function write(root, relative, content) {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function baseRegistry() {
  return {
    schemaVersion: 1,
    ownerAuthority: { path: ".github/CODEOWNERS", owner: "@owner" },
    ignoredDirectoryNames: [".git", "__pycache__", "dist", "node_modules"],
    activeRoots: [
      {
        path: "apps/api",
        ecosystem: "python",
        packageName: "fixture-api",
        owner: "@owner",
        kind: "application",
        publicExports: [],
      },
      {
        path: "apps/web",
        ecosystem: "npm",
        packageName: "@trax-os/web",
        owner: "@owner",
        kind: "application",
        publicExports: [],
      },
      {
        path: "packages/api-contract",
        ecosystem: "npm",
        packageName: "@trax-os/api-contract",
        owner: "@owner",
        kind: "generated-projection",
        publicExports: [".", "./openapi.json", "./runtime-fixtures.json"],
      },
      {
        path: "packages/api-client",
        ecosystem: "npm",
        packageName: "@trax-os/api-client",
        owner: "@owner",
        kind: "runtime-client",
        publicExports: ["."],
      },
    ],
    reservedRoots: [
      {
        path: "apps/mobile",
        status: "inactive",
        required: false,
        activationGate: "approved issue and boundary update",
      },
    ],
    rootEdges: [
      { from: "apps/web", to: "packages/api-client" },
      { from: "packages/api-client", to: "packages/api-contract" },
    ],
    typescript: {
      sourceExtensions: [".js", ".ts"],
      layerRules: [
        { root: "apps/web", prefix: "src/features", layer: "feature" },
        { root: "apps/web", prefix: "src/repositories", layer: "repository" },
        { root: "apps/web", prefix: "src/adapters", layer: "adapter" },
        { root: "apps/web", prefix: "src", layer: "application" },
        {
          root: "packages/api-contract",
          prefix: "generated",
          layer: "generated",
        },
        {
          root: "packages/api-client",
          prefix: "generated",
          layer: "generated",
        },
        {
          root: "packages/api-client",
          prefix: "src",
          layer: "client-runtime",
        },
      ],
      forbiddenLayerEdges: [
        { from: "feature", to: "adapter" },
        { from: "repository", to: "adapter" },
        { from: "generated", to: "application" },
        { from: "generated", to: "feature" },
        { from: "generated", to: "repository" },
        { from: "generated", to: "adapter" },
        { from: "generated", to: "client-runtime" },
        { from: "client-runtime", to: "application" },
        { from: "client-runtime", to: "feature" },
        { from: "client-runtime", to: "repository" },
        { from: "client-runtime", to: "adapter" },
      ],
      generatedInventory: {
        root: "packages/api-contract",
        files: [
          "generated/openapi.json",
          "generated/runtime-fixtures.json",
          "generated/schema.ts",
          "package.json",
        ],
      },
      runtimeClientInventory: {
        root: "packages/api-client",
        files: ["generated/client.ts", "package.json", "src/index.ts"],
      },
    },
    python: {
      moduleRoot: "apps/api/src",
      package: "fixture",
      modules: [
        { module: "fixture", layer: "foundation" },
        { module: "fixture.foundation", layer: "foundation" },
        { module: "fixture.app", layer: "application" },
        { module: "fixture.transport", layer: "transport" },
      ],
      allowedLayerEdges: [
        { from: "application", to: "foundation" },
        { from: "transport", to: "foundation" },
      ],
      exceptions: [
        {
          from: "fixture.app",
          to: "fixture.transport",
          importedNames: ["AppError"],
          rationale: "Temporary application error ownership debt.",
          removalIssue: "#14",
        },
      ],
    },
  };
}

function createFixture(mutator) {
  const root = mkdtempSync(path.join(os.tmpdir(), "trax-boundaries-"));
  write(root, ".github/CODEOWNERS", "* @owner\n");
  write(
    root,
    "package.json",
    JSON.stringify({
      private: true,
      workspaces: ["apps/web", "packages/api-client", "packages/api-contract"],
    }),
  );
  write(
    root,
    "apps/web/package.json",
    JSON.stringify({
      name: "@trax-os/web",
      dependencies: { "@trax-os/api-client": "0.1.0" },
    }),
  );
  write(
    root,
    "apps/web/src/features/use-contract.ts",
    "import type { Client } from '@trax-os/api-client';\nimport type { Port } from '../repositories/port';\nexport type Value = Client & Port;\n",
  );
  write(
    root,
    "apps/web/src/repositories/port.ts",
    "export interface Port { readonly ok: true }\n",
  );
  write(
    root,
    "apps/web/src/adapters/adapter.ts",
    "import type { Port } from '../repositories/port'; export const adapter: Port = { ok: true };\n",
  );
  write(
    root,
    "packages/api-client/package.json",
    JSON.stringify({
      name: "@trax-os/api-client",
      exports: { ".": "./src/index.ts" },
      dependencies: { "@trax-os/api-contract": "0.1.0" },
    }),
  );
  write(
    root,
    "packages/api-client/src/index.ts",
    "import type { Api } from '@trax-os/api-contract'; export type Client = Api;\n",
  );
  write(
    root,
    "packages/api-client/generated/client.ts",
    "export const operations = {};\n",
  );
  write(
    root,
    "packages/api-contract/package.json",
    JSON.stringify({
      name: "@trax-os/api-contract",
      exports: {
        ".": { types: "./generated/schema.ts" },
        "./openapi.json": "./generated/openapi.json",
        "./runtime-fixtures.json": "./generated/runtime-fixtures.json",
      },
    }),
  );
  write(
    root,
    "packages/api-contract/generated/schema.ts",
    "export interface Api { readonly value?: string }\n",
  );
  write(root, "packages/api-contract/generated/openapi.json", "{}\n");
  write(root, "packages/api-contract/generated/runtime-fixtures.json", "{}\n");
  write(root, "apps/api/pyproject.toml", '[project]\nname = "fixture-api"\n');
  write(root, "apps/api/src/fixture/__init__.py", "");
  write(root, "apps/api/src/fixture/foundation.py", "VALUE = 1\n");
  write(
    root,
    "apps/api/src/fixture/transport.py",
    "class AppError(Exception):\n    pass\n",
  );
  write(
    root,
    "apps/api/src/fixture/app.py",
    "from fixture.transport import AppError\n\ndef build() -> type[AppError]:\n    return AppError\n",
  );
  const registry = baseRegistry();
  mutator?.({
    root,
    registry,
    write: (relative, content) => write(root, relative, content),
  });
  write(
    root,
    "docs/architecture/module-boundaries.json",
    JSON.stringify(registry),
  );
  return root;
}

function check(root) {
  return runModuleBoundaryCheck({
    root,
    registryPath: "docs/architecture/module-boundaries.json",
    pythonHelper,
  });
}

function rejects(name, mutation, pattern) {
  test(name, () => {
    const root = createFixture(mutation);
    try {
      assert.throws(() => check(root), pattern);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("accepts the exact active graph, exact Python debt exception and absent reserved root", () => {
  const root = createFixture();
  try {
    assert.deepEqual(check(root), {
      activeRoots: 4,
      reservedRoots: 1,
      rootEdges: 2,
      pythonModules: 4,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

rejects(
  "rejects cross-active-root relative imports",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "import type { Api } from '../../../../packages/api-contract/generated/schema'; export type Value = Api;\n",
    );
  },
  /path import outside its active root into packages\/api-contract/,
);

rejects(
  "rejects undeclared internal package dependencies",
  ({ write }) => {
    write("apps/web/package.json", JSON.stringify({ name: "@trax-os/web" }));
  },
  /undeclared internal dependency/,
);

rejects(
  "rejects declared but disallowed internal package edges",
  ({ registry }) => {
    registry.rootEdges = [];
  },
  /manifest has disallowed internal dependency/,
);

rejects(
  "rejects unknown internal packages",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "import type { Value } from '@trax-os/unknown'; export type X = Value;\n",
    );
  },
  /unknown internal package/,
);

rejects(
  "rejects unexported deep package imports",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "import type { Client } from '@trax-os/api-client/src/index'; export type Value = Client;\n",
    );
  },
  /unexported deep import/,
);

rejects(
  "rejects feature imports of concrete adapters",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "import { adapter } from '../adapters/adapter'; export const value = adapter;\n",
    );
  },
  /forbidden feature->adapter import/,
);

rejects(
  "rejects repository imports of concrete adapters",
  ({ write }) => {
    write(
      "apps/web/src/repositories/port.ts",
      "import { adapter } from '../adapters/adapter'; export const port = adapter;\n",
    );
  },
  /forbidden repository->adapter import/,
);

rejects(
  "checks literal dynamic imports through the same boundary rules",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "export const value = import('../adapters/adapter');\n",
    );
  },
  /forbidden feature->adapter import/,
);

rejects(
  "rejects non-literal dynamic import evasion",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "const target = '../adapters/adapter'; export const value = import(target);\n",
    );
  },
  /dynamic import target must be a string literal/,
);

rejects(
  "rejects generated projection reverse imports",
  ({ write }) => {
    write(
      "packages/api-contract/generated/schema.ts",
      "import type { Value } from '../../../apps/web/src/features/use-contract'; export type Api = Value;\n",
    );
  },
  /path import outside its active root into apps\/web/,
);

rejects(
  "rejects root dependency cycles",
  ({ registry }) => {
    registry.rootEdges.push({ from: "packages/api-contract", to: "apps/web" });
  },
  /root dependency graph contains cycle/,
);

rejects(
  "rejects unregistered package manifests",
  ({ write }) => {
    write(
      "packages/rogue/package.json",
      JSON.stringify({ name: "@trax-os/rogue" }),
    );
  },
  /unregistered project manifest/,
);

rejects(
  "rejects silent activation of an inactive reserved root",
  ({ write }) => {
    write(
      "apps/mobile/package.json",
      JSON.stringify({ name: "@trax-os/mobile" }),
    );
  },
  /inactive reserved root apps\/mobile contains package.json/,
);

rejects(
  "rejects unclassified TypeScript source",
  ({ write }) => {
    write("apps/web/unclassified.ts", "export const value = true;\n");
  },
  /unclassified TypeScript/,
);

rejects(
  "rejects unclassified Python modules",
  ({ write }) => {
    write("apps/api/src/fixture/new_module.py", "VALUE = 1\n");
  },
  /Python module classification drift; unclassified=fixture.new_module/,
);

rejects(
  "rejects reverse Python layer imports",
  ({ write }) => {
    write(
      "apps/api/src/fixture/foundation.py",
      "from fixture.app import build\n",
    );
  },
  /forbidden Python layer edge foundation->application/,
);

rejects(
  "resolves from-package submodule imports before layer checks",
  ({ write }) => {
    write("apps/api/src/fixture/foundation.py", "from fixture import app\n");
  },
  /forbidden Python layer edge foundation->application/,
);

rejects(
  "rejects stale Python exceptions",
  ({ write }) => {
    write(
      "apps/api/src/fixture/app.py",
      "from fixture.foundation import VALUE\n",
    );
  },
  /exception fixture.app->fixture.transport is stale/,
);

rejects(
  "rejects widened Python exceptions",
  ({ write }) => {
    write(
      "apps/api/src/fixture/transport.py",
      "class AppError(Exception):\n    pass\nclass Other: pass\n",
    );
    write(
      "apps/api/src/fixture/app.py",
      "from fixture.transport import AppError, Other\n",
    );
  },
  /exception fixture.app->fixture.transport widened/,
);

rejects(
  "checks literal dynamic Python imports through layer rules",
  ({ write }) => {
    write(
      "apps/api/src/fixture/foundation.py",
      "import importlib\nVALUE = importlib.import_module('fixture.app')\n",
    );
  },
  /forbidden Python layer edge foundation->application/,
);

rejects(
  "rejects source symlinks",
  ({ root }) => {
    write(root, "outside.ts", "export const outside = true;\n");
    symlinkSync(
      path.join(root, "outside.ts"),
      path.join(root, "apps/web/src/features/link.ts"),
    );
  },
  /source tree contains symlink/,
);

rejects(
  "rejects registry path traversal",
  ({ registry }) => {
    registry.reservedRoots[0].path = "../mobile";
  },
  /normalized repository-relative path/,
);

rejects(
  "rejects unknown registry fields",
  ({ registry }) => {
    registry.unreviewed = true;
  },
  /registry keys must be exactly/,
);

rejects(
  "rejects duplicate roots",
  ({ registry }) => {
    registry.activeRoots.push({ ...registry.activeRoots[1] });
  },
  /activeRoots contains duplicate apps\/web/,
);

test("rejects duplicate JSON object keys before parsing", () => {
  const root = createFixture();
  try {
    const filename = path.join(
      root,
      "docs/architecture/module-boundaries.json",
    );
    const source = readFileSync(filename, "utf8").replace(
      '{"schemaVersion":1',
      '{"schemaVersion":1,"schemaVersion":1',
    );
    writeFileSync(filename, source);
    assert.throws(() => check(root), /duplicate JSON key schemaVersion/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

rejects(
  "rejects owner drift from CODEOWNERS authority",
  ({ registry }) => {
    registry.activeRoots[1].owner = "@someone-else";
  },
  /owner must equal CODEOWNERS authority/,
);

rejects(
  "rejects generated contract inventory drift",
  ({ write }) => {
    write(
      "packages/api-contract/generated/manual.ts",
      "export const manual = true;\n",
    );
  },
  /generated contract inventory must be exactly/,
);

rejects(
  "rejects runtime client inventory drift",
  ({ write }) => {
    write(
      "packages/api-client/src/manual-transport.ts",
      "export const manual = true;\n",
    );
  },
  /runtime client inventory must be exactly/,
);

rejects(
  "rejects runtime client files hidden under globally ignored directories",
  ({ write }) => {
    write(
      "packages/api-client/dist/hidden.ts",
      "export const hidden = true;\n",
    );
  },
  /runtime client inventory must be exactly/,
);

rejects(
  "rejects imports into ignored or unclassified active-root source",
  ({ write }) => {
    write("apps/web/dist/hidden.ts", "export const hidden = true;\n");
    write(
      "apps/web/src/features/use-contract.ts",
      "import { hidden } from '../../dist/hidden'; export const value = hidden;\n",
    );
  },
  /ignored or unclassified source/,
);

rejects(
  "rejects package export drift",
  ({ write }) => {
    write(
      "packages/api-contract/package.json",
      JSON.stringify({
        name: "@trax-os/api-contract",
        exports: {
          ".": { types: "./generated/schema.ts" },
          "./openapi.json": "./generated/openapi.json",
        },
      }),
    );
  },
  /exports must be exactly/,
);

rejects(
  "rejects direct CommonJS require calls",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "export const value = require('../adapters/adapter');\n",
    );
  },
  /CommonJS loader construct.*require call/,
);

rejects(
  "rejects aliased CommonJS require references",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "const loader = require; export const value = loader('../adapters/adapter');\n",
    );
  },
  /CommonJS loader construct.*require alias\/reference/,
);

rejects(
  "rejects module.require loaders",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "const loader = module.require; export const value = loader('../adapters/adapter');\n",
    );
  },
  /CommonJS loader construct.*module.require/,
);

rejects(
  "rejects TypeScript import-equals external modules",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "import adapter = require('../adapters/adapter'); export const value = adapter;\n",
    );
  },
  /CommonJS loader construct.*import-equals require/,
);

rejects(
  "rejects aliased createRequire imports",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "import { createRequire as loaderFactory } from 'node:module'; export const value = loaderFactory(import.meta.url);\n",
    );
  },
  /CommonJS loader construct.*module import\/export.*createRequire/,
);

rejects(
  "rejects namespace createRequire aliases",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "import * as nodeModule from 'node:module'; const loaderFactory = nodeModule.createRequire; export const value = loaderFactory(import.meta.url);\n",
    );
  },
  /CommonJS loader construct.*module import\/export.*createRequire/,
);

rejects(
  "rejects node module re-exports",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "export { createRequire as loaderFactory } from 'node:module';\n",
    );
  },
  /CommonJS loader construct.*module import\/export.*createRequire/,
);

rejects(
  "rejects bare module imports that expose createRequire",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "import * as nodeModule from 'module'; export const value = nodeModule.createRequire;\n",
    );
  },
  /CommonJS loader construct.*module import\/export.*createRequire/,
);

rejects(
  "rejects computed require properties",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "export const value = globalThis['require']('../adapters/adapter');\n",
    );
  },
  /CommonJS loader construct.*computed require loader/,
);

rejects(
  "rejects aliased module references",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "const commonJsModule = module; export const value = commonJsModule.require('../adapters/adapter');\n",
    );
  },
  /CommonJS loader construct.*module alias\/reference/,
);

rejects(
  "rejects dynamic node module loading that can expose createRequire",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "export const value = import('node:module');\n",
    );
  },
  /CommonJS loader construct.*dynamic node:module import/,
);

rejects(
  "rejects direct process.getBuiltinModule access",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "export const value = process.getBuiltinModule('node:module');\n",
    );
  },
  /process\.getBuiltinModule loader construct.*direct or extracted property reference/,
);

rejects(
  "rejects aliased process.getBuiltinModule properties",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "const processAlias = process; const loader = processAlias.getBuiltinModule; export const value = loader('node:module');\n",
    );
  },
  /process\.getBuiltinModule loader construct.*direct or extracted property reference/,
);

rejects(
  "rejects destructured process getBuiltinModule extraction",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "const { getBuiltinModule: loader } = process; export const value = loader('node:module').createRequire(import.meta.url);\n",
    );
  },
  /process\.getBuiltinModule loader construct.*direct or extracted property reference/,
);

rejects(
  "rejects computed process getBuiltinModule extraction",
  ({ write }) => {
    write(
      "apps/web/src/features/use-contract.ts",
      "const loader = process['getBuiltinModule']; export const value = loader('node:module');\n",
    );
  },
  /process\.getBuiltinModule loader construct.*computed property reference/,
);

rejects(
  "rejects feature to adapter tsconfig path aliases",
  ({ write }) => {
    write(
      "apps/web/tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          moduleResolution: "bundler",
          baseUrl: ".",
          paths: { "@adapter/*": ["src/adapters/*"] },
        },
      }),
    );
    write(
      "apps/web/src/features/use-contract.ts",
      "import { adapter } from '@adapter/adapter'; export const value = adapter;\n",
    );
  },
  /forbidden feature->adapter import/,
);

rejects(
  "rejects internal package aliases shadowed by a same-root adapter",
  ({ write }) => {
    write(
      "apps/web/tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          moduleResolution: "bundler",
          baseUrl: ".",
          paths: { "@trax-os/api-client": ["src/adapters/adapter.ts"] },
        },
      }),
    );
  },
  /internal package alias shadowing.*resolved apps\/web\/src\/adapters\/adapter\.ts/,
);

rejects(
  "still rejects undeclared package edges after exact internal export alias resolution",
  ({ write }) => {
    write(
      "apps/web/tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          moduleResolution: "bundler",
          baseUrl: ".",
          paths: {
            "@trax-os/api-client": ["../../packages/api-client/src/index.ts"],
          },
        },
      }),
    );
    write(
      "apps/web/package.json",
      JSON.stringify({ name: "@trax-os/web", dependencies: {} }),
    );
  },
  /undeclared internal dependency @trax-os\/api-client/,
);

rejects(
  "rejects internal package aliases shadowed by inactive source",
  ({ write }) => {
    write(
      "apps/mobile/src/shadow.ts",
      "export interface Api { readonly shadow: true }\n",
    );
    write(
      "apps/web/tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          moduleResolution: "bundler",
          baseUrl: ".",
          paths: { "@trax-os/api-client": ["../mobile/src/shadow.ts"] },
        },
      }),
    );
  },
  /internal package alias shadowing.*resolved apps\/mobile\/src\/shadow\.ts/,
);

rejects(
  "rejects cross-root tsconfig path aliases",
  ({ write }) => {
    write(
      "apps/web/tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          moduleResolution: "bundler",
          baseUrl: ".",
          paths: {
            "@contract/*": ["../../packages/api-contract/generated/*"],
          },
        },
      }),
    );
    write(
      "apps/web/src/features/use-contract.ts",
      "import type { Api } from '@contract/schema'; export type Value = Api;\n",
    );
  },
  /path import outside its active root into packages\/api-contract/,
);

rejects(
  "rejects imports into inactive reserved source",
  ({ write }) => {
    write("apps/mobile/src/secret.ts", "export const secret = true;\n");
    write(
      "apps/web/src/features/use-contract.ts",
      "import { secret } from '../../../mobile/src/secret'; export const value = secret;\n",
    );
  },
  /path import outside its active root into apps\/mobile/,
);

rejects(
  "rejects tsconfig aliases into inactive reserved source",
  ({ write }) => {
    write("apps/mobile/src/secret.ts", "export const secret = true;\n");
    write(
      "apps/web/tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          moduleResolution: "bundler",
          baseUrl: ".",
          paths: { "@reserved/*": ["../mobile/src/*"] },
        },
      }),
    );
    write(
      "apps/web/src/features/use-contract.ts",
      "import { secret } from '@reserved/secret'; export const value = secret;\n",
    );
  },
  /path import outside its active root into apps\/mobile/,
);

rejects(
  "rejects unresolved configured aliases instead of treating them as external",
  ({ write }) => {
    write(
      "apps/web/tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          moduleResolution: "bundler",
          baseUrl: ".",
          paths: { "@internal/*": ["../../outside/*"] },
        },
      }),
    );
    write(
      "apps/web/src/features/use-contract.ts",
      "import value from '@internal/missing'; export { value };\n",
    );
  },
  /unresolved configured path alias/,
);

test("accepts an intra-root tsconfig alias that respects layers", () => {
  const root = createFixture(({ write }) => {
    write(
      "apps/web/tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          moduleResolution: "bundler",
          baseUrl: ".",
          paths: { "@repository/*": ["src/repositories/*"] },
        },
      }),
    );
    write(
      "apps/web/src/features/use-contract.ts",
      "import type { Port } from '@repository/port'; export type Value = Port;\n",
    );
  });
  try {
    assert.equal(check(root).activeRoots, 4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

rejects(
  "rejects unused unknown internal manifest dependencies",
  ({ write }) => {
    write(
      "apps/web/package.json",
      JSON.stringify({
        name: "@trax-os/web",
        dependencies: {
          "@trax-os/api-client": "0.1.0",
          "@trax-os/unknown": "0.1.0",
        },
      }),
    );
  },
  /manifest references unknown internal package/,
);

rejects(
  "rejects unused reverse internal manifest dependencies",
  ({ write }) => {
    write(
      "packages/api-contract/package.json",
      JSON.stringify({
        name: "@trax-os/api-contract",
        devDependencies: { "@trax-os/web": "0.1.0" },
        exports: {
          ".": { types: "./generated/schema.ts" },
          "./openapi.json": "./generated/openapi.json",
          "./runtime-fixtures.json": "./generated/runtime-fixtures.json",
        },
      }),
    );
  },
  /manifest has disallowed internal dependency/,
);

rejects(
  "rejects manifest dependency cycles through the reviewed graph",
  ({ registry, write }) => {
    registry.rootEdges.push({
      from: "packages/api-contract",
      to: "apps/web",
    });
    write(
      "packages/api-contract/package.json",
      JSON.stringify({
        name: "@trax-os/api-contract",
        devDependencies: { "@trax-os/web": "0.1.0" },
        exports: {
          ".": { types: "./generated/schema.ts" },
          "./openapi.json": "./generated/openapi.json",
          "./runtime-fixtures.json": "./generated/runtime-fixtures.json",
        },
      }),
    );
  },
  /root dependency graph contains cycle/,
);

rejects(
  "rejects decoy pyproject names outside project table",
  ({ write }) => {
    write(
      "apps/api/pyproject.toml",
      '[tool.decoy]\nname = "fixture-api"\n[project]\nname = "wrong-api"\n',
    );
  },
  /exact \[project\]\.name must be fixture-api; received wrong-api/,
);

rejects(
  "rejects rogue Python project manifests",
  ({ write }) => {
    write("packages/rogue/pyproject.toml", '[project]\nname = "rogue"\n');
  },
  /unregistered project manifest at packages\/rogue\/pyproject.toml/,
);

rejects(
  "rejects a second active Python root in schema version one",
  ({ registry }) => {
    registry.activeRoots.push({
      path: "packages/python-two",
      ecosystem: "python",
      packageName: "python-two",
      owner: "@owner",
      kind: "application",
      publicExports: [],
    });
  },
  /requires exactly one active Python root/,
);

rejects(
  "rejects Python module roots outside the active Python project",
  ({ registry }) => {
    registry.python.moduleRoot = "packages/api-contract/generated";
  },
  /python.moduleRoot must be contained/,
);

rejects(
  "rejects tuple-destructured Python dynamic loaders",
  ({ write }) => {
    write(
      "apps/api/src/fixture/app.py",
      "import importlib\n(loader, unused) = (importlib.import_module, None)\nvalue = loader('fixture.transport')\n",
    );
  },
  /dynamic-loader-destructuring.*tuple\/list\/starred/,
);

rejects(
  "rejects list-destructured Python dynamic loaders",
  ({ write }) => {
    write(
      "apps/api/src/fixture/app.py",
      "from builtins import __import__ as builtin_import\n[loader] = [builtin_import]\nvalue = loader('fixture.transport')\n",
    );
  },
  /dynamic-loader-destructuring.*tuple\/list\/starred/,
);

rejects(
  "rejects aliased importlib module calls through layer rules",
  ({ write }) => {
    write(
      "apps/api/src/fixture/foundation.py",
      "import importlib as il\nVALUE = il.import_module('fixture.app')\n",
    );
  },
  /forbidden Python layer edge foundation->application/,
);

rejects(
  "rejects aliased import_module function calls through layer rules",
  ({ write }) => {
    write(
      "apps/api/src/fixture/foundation.py",
      "from importlib import import_module as load\nVALUE = load('fixture.app')\n",
    );
  },
  /forbidden Python layer edge foundation->application/,
);

rejects(
  "rejects aliased builtins import calls through layer rules",
  ({ write }) => {
    write(
      "apps/api/src/fixture/foundation.py",
      "from builtins import __import__ as load\nVALUE = load('fixture.app')\n",
    );
  },
  /forbidden Python layer edge foundation->application/,
);

rejects(
  "rejects simple assignment aliases for dynamic Python importers",
  ({ write }) => {
    write(
      "apps/api/src/fixture/foundation.py",
      "import importlib as il\nload = il.import_module\nVALUE = load('fixture.app')\n",
    );
  },
  /forbidden Python layer edge foundation->application/,
);

rejects(
  "resolves relative import_module aliases before layer checks",
  ({ write }) => {
    write(
      "apps/api/src/fixture/foundation.py",
      "from importlib import import_module as load\nVALUE = load('.app', 'fixture')\n",
    );
  },
  /forbidden Python layer edge foundation->application/,
);

rejects(
  "resolves relative builtins import aliases before layer checks",
  ({ write }) => {
    write(
      "apps/api/src/fixture/foundation.py",
      "from builtins import __import__ as load\nVALUE = load('app', globals(), locals(), (), 1)\n",
    );
  },
  /forbidden Python layer edge foundation->application/,
);

rejects(
  "rejects nonliteral dynamic Python imports through aliases",
  ({ write }) => {
    write(
      "apps/api/src/fixture/app.py",
      "import importlib as il\nfrom fixture.transport import AppError\nload = il.import_module\ntarget = 'fixture.foundation'\nVALUE = load(target)\n",
    );
  },
  /dynamic-import-nonliteral/,
);

rejects(
  "rejects Python source file symlinks",
  ({ root }) => {
    write(root, "outside.py", "VALUE = 1\n");
    symlinkSync(
      path.join(root, "outside.py"),
      path.join(root, "apps/api/src/fixture/link.py"),
    );
  },
  /Python source tree contains file symlink/,
);

rejects(
  "rejects Python source directory symlinks",
  ({ root }) => {
    write(root, "outside-python/value.py", "VALUE = 1\n");
    symlinkSync(
      path.join(root, "outside-python"),
      path.join(root, "apps/api/src/fixture/linkdir"),
    );
  },
  /Python source tree contains directory symlink/,
);

rejects(
  "rejects Python module collisions before classification",
  ({ registry, write }) => {
    registry.python.modules.push({
      module: "fixture.duplicate",
      layer: "foundation",
    });
    write("apps/api/src/fixture/duplicate.py", "VALUE = 1\n");
    write("apps/api/src/fixture/duplicate/__init__.py", "VALUE = 2\n");
  },
  /Python module collision for fixture.duplicate/,
);

rejects(
  "rejects unknown TypeScript layer names in forbidden edges",
  ({ registry }) => {
    registry.typescript.forbiddenLayerEdges.push({
      from: "missing",
      to: "adapter",
    });
  },
  /references unknown layer/,
);

rejects(
  "rejects unknown Python layer names in allowed edges",
  ({ registry }) => {
    registry.python.allowedLayerEdges.push({
      from: "missing",
      to: "foundation",
    });
  },
  /references unknown layer/,
);

rejects(
  "binds generated inventory root to the generated projection package",
  ({ registry }) => {
    registry.typescript.generatedInventory.root =
      "packages/api-contract/generated";
  },
  /generatedInventory.root must equal/,
);

rejects(
  "binds runtime client inventory root to the runtime-client package",
  ({ registry }) => {
    registry.activeRoots.find(
      (root) => root.path === "packages/api-client",
    ).kind = "application";
  },
  /runtimeClientInventory.root must equal/,
);

rejects(
  "rejects CODEOWNERS wildcard rules with an additional owner",
  ({ write }) => {
    write(".github/CODEOWNERS", "* @owner @other\n");
  },
  /CODEOWNERS v0 policy must contain exactly/,
);

rejects(
  "rejects CODEOWNERS path overrides for active roots",
  ({ write }) => {
    write(".github/CODEOWNERS", "* @owner\n/apps/web @other\n");
  },
  /CODEOWNERS v0 policy must contain exactly/,
);
