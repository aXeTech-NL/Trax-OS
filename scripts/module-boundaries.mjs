#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY = "docs/architecture/module-boundaries.json";
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function fail(message) {
  throw new Error(message);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    fail(
      `${label} keys must be exactly ${expected.join(", ")}; received ${actual.join(", ")}`,
    );
}

function array(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0)
    fail(`${label} must be a non-empty trimmed string`);
  return value;
}

function relativePath(value, label) {
  const text = nonEmptyString(value, label);
  if (
    path.isAbsolute(text) ||
    text.includes("\\") ||
    text.split("/").some((part) => part === ".." || part === "") ||
    path.posix.normalize(text) !== text ||
    text === "."
  )
    fail(`${label} must be a normalized repository-relative path`);
  return text;
}

function unique(values, label, key = (value) => value) {
  const seen = new Set();
  for (const value of values) {
    const identity = key(value);
    if (seen.has(identity)) fail(`${label} contains duplicate ${identity}`);
    seen.add(identity);
  }
}

function assertAcyclic(nodes, edges, label) {
  const outgoing = new Map(nodes.map((node) => [node, []]));
  for (const edge of edges) outgoing.get(edge.from)?.push(edge.to);
  const visiting = new Set();
  const visited = new Set();
  function visit(node, trail) {
    if (visiting.has(node))
      fail(`${label} contains cycle: ${[...trail, node].join(" -> ")}`);
    if (visited.has(node)) return;
    visiting.add(node);
    for (const target of outgoing.get(node) ?? [])
      visit(target, [...trail, node]);
    visiting.delete(node);
    visited.add(node);
  }
  for (const node of nodes) visit(node, []);
}

function validateRegistry(raw) {
  exactKeys(
    raw,
    [
      "schemaVersion",
      "ownerAuthority",
      "ignoredDirectoryNames",
      "activeRoots",
      "reservedRoots",
      "rootEdges",
      "typescript",
      "python",
    ],
    "registry",
  );
  if (raw.schemaVersion !== 1) fail("registry.schemaVersion must equal 1");
  exactKeys(raw.ownerAuthority, ["path", "owner"], "ownerAuthority");
  relativePath(raw.ownerAuthority.path, "ownerAuthority.path");
  if (
    !nonEmptyString(
      raw.ownerAuthority.owner,
      "ownerAuthority.owner",
    ).startsWith("@")
  )
    fail("ownerAuthority.owner must be a CODEOWNERS handle");

  const ignored = array(raw.ignoredDirectoryNames, "ignoredDirectoryNames");
  unique(ignored, "ignoredDirectoryNames");
  for (const item of ignored) {
    nonEmptyString(item, "ignoredDirectoryNames entry");
    if (item.includes("/") || item === "." || item === "..")
      fail("ignoredDirectoryNames entries must be names, not paths");
  }

  const active = array(raw.activeRoots, "activeRoots");
  unique(active, "activeRoots", (item) => item.path);
  unique(active, "activeRoots packageName", (item) => item.packageName);
  for (const [index, item] of active.entries()) {
    exactKeys(
      item,
      ["path", "ecosystem", "packageName", "owner", "kind", "publicExports"],
      `activeRoots[${index}]`,
    );
    relativePath(item.path, `activeRoots[${index}].path`);
    if (!["npm", "python"].includes(item.ecosystem))
      fail(`activeRoots[${index}].ecosystem is unsupported`);
    nonEmptyString(item.packageName, `activeRoots[${index}].packageName`);
    if (item.owner !== raw.ownerAuthority.owner)
      fail(`active root ${item.path} owner must equal CODEOWNERS authority`);
    if (!["application", "generated-projection"].includes(item.kind))
      fail(`active root ${item.path} has unsupported kind`);
    const exports = array(
      item.publicExports,
      `active root ${item.path} publicExports`,
    );
    unique(exports, `active root ${item.path} publicExports`);
    for (const entry of exports) {
      nonEmptyString(entry, `active root ${item.path} export`);
      if (entry !== "." && !entry.startsWith("./"))
        fail(`active root ${item.path} has invalid public export ${entry}`);
    }
    if (item.ecosystem === "python" && exports.length)
      fail(`Python active root ${item.path} cannot declare npm exports`);
  }
  const pythonRoots = active.filter((item) => item.ecosystem === "python");
  if (pythonRoots.length !== 1)
    fail("schema version 1 requires exactly one active Python root");

  const reserved = array(raw.reservedRoots, "reservedRoots");
  unique(reserved, "reservedRoots", (item) => item.path);
  for (const [index, item] of reserved.entries()) {
    exactKeys(
      item,
      ["path", "status", "required", "activationGate"],
      `reservedRoots[${index}]`,
    );
    relativePath(item.path, `reservedRoots[${index}].path`);
    if (item.status !== "inactive" || item.required !== false)
      fail(`reserved root ${item.path} must remain inactive and non-required`);
    nonEmptyString(
      item.activationGate,
      `reserved root ${item.path} activationGate`,
    );
  }
  unique(
    [...active.map((item) => item.path), ...reserved.map((item) => item.path)],
    "active and reserved roots",
  );

  const activePaths = new Set(active.map((item) => item.path));
  const edges = array(raw.rootEdges, "rootEdges");
  unique(edges, "rootEdges", (edge) => `${edge.from}->${edge.to}`);
  for (const [index, edge] of edges.entries()) {
    exactKeys(edge, ["from", "to"], `rootEdges[${index}]`);
    nonEmptyString(edge.from, `rootEdges[${index}].from`);
    nonEmptyString(edge.to, `rootEdges[${index}].to`);
    if (!activePaths.has(edge.from) || !activePaths.has(edge.to))
      fail(
        `root edge ${edge.from}->${edge.to} references an inactive or unknown root`,
      );
    if (edge.from === edge.to)
      fail(`root edge ${edge.from}->${edge.to} is self-referential`);
  }
  assertAcyclic(
    active.map((item) => item.path),
    edges,
    "root dependency graph",
  );

  exactKeys(
    raw.typescript,
    [
      "sourceExtensions",
      "layerRules",
      "forbiddenLayerEdges",
      "generatedInventory",
    ],
    "typescript",
  );
  const extensions = array(
    raw.typescript.sourceExtensions,
    "typescript.sourceExtensions",
  );
  unique(extensions, "typescript.sourceExtensions");
  for (const extension of extensions)
    if (typeof extension !== "string" || !/^\.[a-z]+$/.test(extension))
      fail(`invalid TypeScript source extension ${extension}`);
  const layerRules = array(raw.typescript.layerRules, "typescript.layerRules");
  unique(
    layerRules,
    "typescript.layerRules",
    (rule) => `${rule.root}:${rule.prefix}`,
  );
  const tsLayers = new Set();
  for (const [index, rule] of layerRules.entries()) {
    exactKeys(
      rule,
      ["root", "prefix", "layer"],
      `typescript.layerRules[${index}]`,
    );
    if (!activePaths.has(rule.root))
      fail(`TypeScript layer rule references unknown root ${rule.root}`);
    relativePath(rule.prefix, `typescript.layerRules[${index}].prefix`);
    tsLayers.add(
      nonEmptyString(rule.layer, `typescript.layerRules[${index}].layer`),
    );
  }
  const forbidden = array(
    raw.typescript.forbiddenLayerEdges,
    "typescript.forbiddenLayerEdges",
  );
  unique(
    forbidden,
    "typescript.forbiddenLayerEdges",
    (edge) => `${edge.from}->${edge.to}`,
  );
  for (const [index, edge] of forbidden.entries()) {
    exactKeys(edge, ["from", "to"], `typescript.forbiddenLayerEdges[${index}]`);
    nonEmptyString(edge.from, `typescript.forbiddenLayerEdges[${index}].from`);
    nonEmptyString(edge.to, `typescript.forbiddenLayerEdges[${index}].to`);
    if (!tsLayers.has(edge.from) || !tsLayers.has(edge.to))
      fail(
        `TypeScript forbidden layer edge ${edge.from}->${edge.to} references unknown layer`,
      );
  }
  exactKeys(
    raw.typescript.generatedInventory,
    ["root", "files"],
    "typescript.generatedInventory",
  );
  relativePath(
    raw.typescript.generatedInventory.root,
    "typescript.generatedInventory.root",
  );
  const generatedRoots = active.filter(
    (item) => item.kind === "generated-projection",
  );
  if (
    generatedRoots.length !== 1 ||
    raw.typescript.generatedInventory.root !== generatedRoots[0].path
  )
    fail(
      "typescript.generatedInventory.root must equal the sole active generated-projection root",
    );
  const generatedFiles = array(
    raw.typescript.generatedInventory.files,
    "typescript.generatedInventory.files",
  );
  unique(generatedFiles, "typescript.generatedInventory.files");
  for (const item of generatedFiles)
    relativePath(item, "typescript.generatedInventory file");

  exactKeys(
    raw.python,
    ["moduleRoot", "package", "modules", "allowedLayerEdges", "exceptions"],
    "python",
  );
  relativePath(raw.python.moduleRoot, "python.moduleRoot");
  const pythonRoot = pythonRoots[0].path;
  if (
    raw.python.moduleRoot !== pythonRoot &&
    !raw.python.moduleRoot.startsWith(`${pythonRoot}/`)
  )
    fail("python.moduleRoot must be contained by the sole active Python root");
  nonEmptyString(raw.python.package, "python.package");
  const modules = array(raw.python.modules, "python.modules");
  unique(modules, "python.modules", (item) => item.module);
  const pythonLayers = new Set();
  for (const [index, item] of modules.entries()) {
    exactKeys(item, ["module", "layer"], `python.modules[${index}]`);
    nonEmptyString(item.module, `python.modules[${index}].module`);
    if (
      item.module !== raw.python.package &&
      !item.module.startsWith(`${raw.python.package}.`)
    )
      fail(`Python module ${item.module} is outside ${raw.python.package}`);
    pythonLayers.add(
      nonEmptyString(item.layer, `python.modules[${index}].layer`),
    );
  }
  const layerEdges = array(
    raw.python.allowedLayerEdges,
    "python.allowedLayerEdges",
  );
  unique(
    layerEdges,
    "python.allowedLayerEdges",
    (edge) => `${edge.from}->${edge.to}`,
  );
  for (const [index, edge] of layerEdges.entries()) {
    exactKeys(edge, ["from", "to"], `python.allowedLayerEdges[${index}]`);
    nonEmptyString(edge.from, `python.allowedLayerEdges[${index}].from`);
    nonEmptyString(edge.to, `python.allowedLayerEdges[${index}].to`);
    if (!pythonLayers.has(edge.from) || !pythonLayers.has(edge.to))
      fail(
        `Python allowed layer edge ${edge.from}->${edge.to} references unknown layer`,
      );
  }
  const exceptions = array(raw.python.exceptions, "python.exceptions");
  unique(exceptions, "python.exceptions", (item) => `${item.from}->${item.to}`);
  const knownModules = new Set(modules.map((item) => item.module));
  for (const [index, item] of exceptions.entries()) {
    exactKeys(
      item,
      ["from", "to", "importedNames", "rationale", "removalIssue"],
      `python.exceptions[${index}]`,
    );
    if (!knownModules.has(item.from) || !knownModules.has(item.to))
      fail(
        `Python exception ${item.from}->${item.to} references unknown module`,
      );
    const names = array(
      item.importedNames,
      `python exception ${item.from}->${item.to} importedNames`,
    );
    if (!names.length)
      fail(`Python exception ${item.from}->${item.to} must name exact imports`);
    unique(names, `Python exception ${item.from}->${item.to} importedNames`);
    for (const name of names)
      nonEmptyString(name, "Python exception imported name");
    nonEmptyString(
      item.rationale,
      `Python exception ${item.from}->${item.to} rationale`,
    );
    if (!/^#[1-9][0-9]*$/.test(item.removalIssue))
      fail(
        `Python exception ${item.from}->${item.to} must have a removal issue`,
      );
  }
  return raw;
}

function assertNoSymlinkComponents(root, target, label) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    fail(`${label} escapes repository`);
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = lstatSync(current);
    if (info.isSymbolicLink())
      fail(
        `${label} contains symlink component ${path.relative(root, current)}`,
      );
  }
}

function safeRepositoryPath(root, relative, label, mustExist = true) {
  relativePath(relative, label);
  const target = path.resolve(root, relative);
  const relation = path.relative(root, target);
  if (relation.startsWith("..") || path.isAbsolute(relation))
    fail(`${label} escapes repository`);
  if (mustExist) {
    assertNoSymlinkComponents(root, target, label);
    const real = realpathSync(target);
    const realRelation = path.relative(realpathSync(root), real);
    if (realRelation.startsWith("..") || path.isAbsolute(realRelation))
      fail(`${label} resolves outside repository`);
  }
  return target;
}

function walkFiles(root, directory, ignoredNames) {
  const files = [];
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (ignoredNames.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink())
        fail(`source tree contains symlink ${path.relative(root, absolute)}`);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  return files.sort();
}

function assertNoDuplicateJsonKeys(source, filename, label) {
  const sourceFile = ts.parseJsonText(filename, source);
  if (sourceFile.parseDiagnostics.length)
    fail(
      `${label} is not valid JSON: ${ts.flattenDiagnosticMessageText(sourceFile.parseDiagnostics[0].messageText, " ")}`,
    );
  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const seen = new Set();
      for (const property of node.properties) {
        if (
          !ts.isPropertyAssignment(property) ||
          (!ts.isStringLiteralLike(property.name) &&
            !ts.isIdentifier(property.name))
        )
          continue;
        const key = property.name.text;
        if (seen.has(key)) {
          const line =
            sourceFile.getLineAndCharacterOfPosition(
              property.name.getStart(sourceFile),
            ).line + 1;
          fail(`${label}:${line} contains duplicate JSON key ${key}`);
        }
        seen.add(key);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function readJson(filename, label) {
  const source = readFileSync(filename, "utf8");
  assertNoDuplicateJsonKeys(source, filename, label);
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function packageExports(manifest) {
  if (
    !manifest.exports ||
    typeof manifest.exports !== "object" ||
    Array.isArray(manifest.exports)
  )
    return [];
  return Object.keys(manifest.exports).sort();
}

function exportTargets(value, label) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must resolve to a string or condition object`);
  const targets = Object.values(value).flatMap((entry) =>
    exportTargets(entry, label),
  );
  if (!targets.length) fail(`${label} has no target`);
  return targets;
}

function internalPackageName(specifier) {
  if (!specifier.startsWith("@trax-os/")) return undefined;
  return specifier.split("/").slice(0, 2).join("/");
}

function verifyCodeowners(root, registry) {
  const ownerFile = safeRepositoryPath(
    root,
    registry.ownerAuthority.path,
    "ownerAuthority.path",
  );
  const rules = readFileSync(ownerFile, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const expected = `* ${registry.ownerAuthority.owner}`;
  if (rules.length !== 1 || rules[0] !== expected)
    fail(
      `CODEOWNERS v0 policy must contain exactly '${expected}' and no path override or additional owner`,
    );
}

function manifestDependencies(manifest) {
  const entries = [];
  for (const field of DEPENDENCY_FIELDS)
    for (const name of Object.keys(manifest[field] ?? {}))
      entries.push({ field, name });
  return entries;
}

function inventoryProjectManifests(root) {
  const found = [];
  for (const base of ["apps", "packages"]) {
    const basePath = path.join(root, base);
    for (const entry of readdirSync(basePath, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        fail(`${base} contains symlink root ${entry.name}`);
      if (!entry.isDirectory()) continue;
      for (const manifestName of ["package.json", "pyproject.toml"]) {
        const manifest = path.join(basePath, entry.name, manifestName);
        try {
          const info = lstatSync(manifest);
          if (info.isSymbolicLink())
            fail(
              `project manifest is a symlink at ${base}/${entry.name}/${manifestName}`,
            );
          if (info.isFile())
            found.push({ root: `${base}/${entry.name}`, manifestName });
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
  }
  return found;
}

function invokePythonScanner(root, registry, options) {
  const pythonRoot = registry.activeRoots.find(
    (item) => item.ecosystem === "python",
  );
  const helper =
    options.pythonHelper ?? path.join(SCRIPT_DIRECTORY, "python-imports.py");
  const python = options.pythonExecutable ?? process.env.PYTHON ?? "python3";
  const result = spawnSync(
    python,
    [
      helper,
      "--root",
      root,
      "--project-root",
      pythonRoot.path,
      "--module-root",
      registry.python.moduleRoot,
      "--package",
      registry.python.package,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    fail(
      `Python import scanner failed: ${(result.stderr || result.stdout).trim()}`,
    );
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`Python import scanner emitted invalid JSON: ${error.message}`);
  }
}

function verifyRoots(root, registry, options) {
  verifyCodeowners(root, registry);
  const activeByPath = new Map(
    registry.activeRoots.map((item) => [item.path, item]),
  );
  const activeByPackage = new Map(
    registry.activeRoots.map((item) => [item.packageName, item]),
  );
  const allowedEdges = new Set(
    registry.rootEdges.map((edge) => `${edge.from}->${edge.to}`),
  );
  const manifests = new Map();
  for (const active of registry.activeRoots) {
    const absolute = safeRepositoryPath(
      root,
      active.path,
      `active root ${active.path}`,
    );
    if (!statSync(absolute).isDirectory())
      fail(`active root ${active.path} is not a directory`);
    if (active.ecosystem === "npm") {
      const manifest = readJson(
        safeRepositoryPath(
          root,
          `${active.path}/package.json`,
          `${active.path}/package.json`,
        ),
        `${active.path}/package.json`,
      );
      manifests.set(active.path, manifest);
      if (manifest.name !== active.packageName)
        fail(`${active.path} package name must be ${active.packageName}`);
      const actualExports = packageExports(manifest);
      const expectedExports = [...active.publicExports].sort();
      if (JSON.stringify(actualExports) !== JSON.stringify(expectedExports))
        fail(
          `${active.path} exports must be exactly ${expectedExports.join(", ")}; received ${actualExports.join(", ")}`,
        );
      for (const subpath of expectedExports) {
        for (const target of exportTargets(
          manifest.exports[subpath],
          `${active.path} export ${subpath}`,
        )) {
          if (!target.startsWith("./"))
            fail(
              `${active.path} export ${subpath} target must be package-relative`,
            );
          const resolved = safeRepositoryPath(
            root,
            `${active.path}/${target.slice(2)}`,
            `${active.path} export ${subpath}`,
          );
          if (!statSync(resolved).isFile())
            fail(`${active.path} export ${subpath} target is not a file`);
          const relation = path.relative(absolute, resolved);
          if (relation.startsWith("..") || path.isAbsolute(relation))
            fail(`${active.path} export ${subpath} escapes its package`);
        }
      }
      for (const { name } of manifestDependencies(manifest)) {
        const packageName = internalPackageName(name);
        if (!packageName) continue;
        const target = activeByPackage.get(packageName);
        if (!target)
          fail(
            `${active.path} manifest references unknown internal package ${packageName}`,
          );
        if (target.ecosystem !== "npm")
          fail(
            `${active.path} manifest internal dependency ${packageName} is not npm`,
          );
        if (target.path === active.path)
          fail(`${active.path} manifest cannot depend on itself`);
        if (!allowedEdges.has(`${active.path}->${target.path}`))
          fail(
            `${active.path} manifest has disallowed internal dependency ${active.path}->${target.path}`,
          );
      }
    }
  }
  const report = invokePythonScanner(root, registry, options);
  const pythonRoot = registry.activeRoots.find(
    (item) => item.ecosystem === "python",
  );
  if (report.projectName !== pythonRoot.packageName)
    fail(
      `${pythonRoot.path} exact [project].name must be ${pythonRoot.packageName}; received ${report.projectName}`,
    );
  for (const reserved of registry.reservedRoots) {
    for (const manifestName of ["package.json", "pyproject.toml"]) {
      try {
        if (lstatSync(path.join(root, reserved.path, manifestName)).isFile())
          fail(
            `inactive reserved root ${reserved.path} contains ${manifestName}; activate it through review first`,
          );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  for (const item of inventoryProjectManifests(root)) {
    const active = activeByPath.get(item.root);
    if (!active)
      fail(
        `unregistered project manifest at ${item.root}/${item.manifestName}`,
      );
    const expectedManifest =
      active.ecosystem === "npm" ? "package.json" : "pyproject.toml";
    if (item.manifestName !== expectedManifest)
      fail(
        `${item.root}/${item.manifestName} does not match registered ${active.ecosystem} ecosystem`,
      );
  }
  const rootManifest = readJson(
    path.join(root, "package.json"),
    "root package.json",
  );
  const actualWorkspaces = [...(rootManifest.workspaces ?? [])].sort();
  const expectedWorkspaces = registry.activeRoots
    .filter((item) => item.ecosystem === "npm")
    .map((item) => item.path)
    .sort();
  if (JSON.stringify(actualWorkspaces) !== JSON.stringify(expectedWorkspaces))
    fail(
      `root npm workspaces must be exactly active npm roots ${expectedWorkspaces.join(", ")}`,
    );
  return { pythonReport: report, manifests };
}

function classifyLayer(registry, rootPath, relative) {
  return registry.typescript.layerRules
    .filter(
      (rule) =>
        rule.root === rootPath &&
        (relative === rule.prefix || relative.startsWith(`${rule.prefix}/`)),
    )
    .sort((left, right) => right.prefix.length - left.prefix.length)[0]?.layer;
}

function resolveRelativeImport(source, specifier, extensions) {
  const base = path.resolve(path.dirname(source), specifier);
  const candidates = [base];
  for (const extension of [...extensions, ".json"])
    candidates.push(`${base}${extension}`);
  for (const extension of [...extensions, ".json"])
    candidates.push(path.join(base, `index${extension}`));
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
  }
  fail(`${source}: cannot resolve relative import ${specifier}`);
}

function collectSpecifiers(filename) {
  const source = readFileSync(filename, "utf8");
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const imports = [];
  function line(node) {
    return (
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1
    );
  }
  function rejectCommonJs(node, detail) {
    fail(
      `${filename}:${line(node)}: CommonJS loader construct is forbidden in active ESM source: ${detail}`,
    );
  }
  function rejectBuiltinLoader(node, detail) {
    fail(
      `${filename}:${line(node)}: process.getBuiltinModule loader construct is forbidden in active source: ${detail}`,
    );
  }
  function add(node, specifier, dynamic) {
    if (ts.isStringLiteralLike(specifier))
      imports.push({ value: specifier.text, line: line(node), dynamic });
    else
      fail(
        `${filename}:${line(node)}: dynamic import target must be a string literal`,
      );
  }
  function visit(node) {
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      rejectCommonJs(node, "import-equals require");
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      add(node, node.moduleSpecifier, false);
      if (["module", "node:module"].includes(node.moduleSpecifier.text))
        rejectCommonJs(
          node,
          "module import/export can expose createRequire (including namespace/default/named aliases)",
        );
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      add(node, node.arguments[0], true);
      if (
        ts.isStringLiteralLike(node.arguments[0]) &&
        ["module", "node:module"].includes(node.arguments[0].text)
      )
        rejectCommonJs(
          node,
          "dynamic node:module import can expose createRequire",
        );
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    )
      rejectCommonJs(node, "require call");
    if (ts.isPropertyAccessExpression(node) && node.name.text === "require")
      rejectCommonJs(
        node,
        "property require loader (including module.require aliases)",
      );
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "require"
    )
      rejectCommonJs(node, "computed require loader");
    if (ts.isIdentifier(node) && node.text === "module")
      rejectCommonJs(node, "module alias/reference");
    // Node 22 exposes built-ins without an import edge. Conservatively reject
    // every syntactic reference/extraction so aliases cannot recover
    // node:module.createRequire outside the import graph.
    if (ts.isIdentifier(node) && node.text === "getBuiltinModule")
      rejectBuiltinLoader(node, "direct or extracted property reference");
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "getBuiltinModule"
    )
      rejectBuiltinLoader(node, "computed property reference");
    if (
      (ts.isBindingElement(node) || ts.isPropertyAssignment(node)) &&
      node.propertyName &&
      ts.isStringLiteralLike(node.propertyName) &&
      node.propertyName.text === "getBuiltinModule"
    )
      rejectBuiltinLoader(node, "computed property extraction");
    if (ts.isIdentifier(node) && node.text === "require") {
      const parent = node.parent;
      const isCallTarget =
        ts.isCallExpression(parent) && parent.expression === node;
      const isPropertyName =
        ts.isPropertyAccessExpression(parent) && parent.name === node;
      if (!isCallTarget && !isPropertyName)
        rejectCommonJs(node, "require alias/reference");
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return imports;
}

function compilerOptionsFor(filename, cache) {
  const configPath = ts.findConfigFile(
    path.dirname(filename),
    ts.sys.fileExists,
    "tsconfig.json",
  );
  if (!configPath)
    return {
      options: {
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        allowJs: true,
        resolveJsonModule: true,
      },
      aliasPatterns: [],
    };
  if (cache.has(configPath)) return cache.get(configPath);
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error)
    fail(
      `${configPath}: ${ts.flattenDiagnosticMessageText(read.error.messageText, " ")}`,
    );
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    path.dirname(configPath),
  );
  if (parsed.errors.length)
    fail(
      `${configPath}: ${ts.flattenDiagnosticMessageText(parsed.errors[0].messageText, " ")}`,
    );
  const value = {
    options: parsed.options,
    aliasPatterns: Object.keys(parsed.options.paths ?? {}),
  };
  cache.set(configPath, value);
  return value;
}

function aliasPatternMatches(pattern, specifier) {
  if (!pattern.includes("*")) return pattern === specifier;
  const [prefix, suffix] = pattern.split("*");
  return specifier.startsWith(prefix) && specifier.endsWith(suffix);
}

function publicSubpath(specifier, packageName) {
  return specifier === packageName
    ? "."
    : `.${specifier.slice(packageName.length)}`;
}

function verifyTypeScript(root, registry, manifests) {
  const ignored = new Set(registry.ignoredDirectoryNames);
  const extensions = new Set(registry.typescript.sourceExtensions);
  const activeNpm = registry.activeRoots.filter(
    (item) => item.ecosystem === "npm",
  );
  const activeByPackage = new Map(
    activeNpm.map((item) => [item.packageName, item]),
  );
  const allowedRootEdges = new Set(
    registry.rootEdges.map((edge) => `${edge.from}->${edge.to}`),
  );
  const forbiddenLayers = new Set(
    registry.typescript.forbiddenLayerEdges.map(
      (edge) => `${edge.from}->${edge.to}`,
    ),
  );
  const reservedAbsolute = registry.reservedRoots.map((item) => ({
    item,
    absolute: path.resolve(root, item.path),
  }));
  const files = [];
  const fileInfo = new Map();
  for (const active of activeNpm) {
    const absolute = safeRepositoryPath(
      root,
      active.path,
      `active root ${active.path}`,
    );
    for (const filename of walkFiles(root, absolute, ignored)) {
      if (!extensions.has(path.extname(filename))) continue;
      const relative = path
        .relative(absolute, filename)
        .split(path.sep)
        .join("/");
      const layer = classifyLayer(registry, active.path, relative);
      if (!layer)
        fail(
          `${active.path}/${relative} is unclassified TypeScript/JavaScript source`,
        );
      const item = { filename, active, relative, layer };
      files.push(item);
      fileInfo.set(realpathSync(filename), item);
    }
  }
  const configCache = new Map();
  function inspectPathTarget(source, target, imported) {
    const sourceRoot = path.resolve(root, source.active.path);
    const repositoryRelation = path.relative(root, target);
    if (
      repositoryRelation.startsWith("..") ||
      path.isAbsolute(repositoryRelation)
    )
      fail(
        `${source.active.path}/${source.relative}:${imported.line}: import resolves outside repository`,
      );
    assertNoSymlinkComponents(
      root,
      target,
      `${source.active.path}/${source.relative}:${imported.line}`,
    );
    const realTarget = realpathSync(target);
    const ownRelation = path.relative(sourceRoot, realTarget);
    if (ownRelation.startsWith("..") || path.isAbsolute(ownRelation)) {
      const activeTarget = registry.activeRoots.find((item) => {
        const relation = path.relative(
          path.resolve(root, item.path),
          realTarget,
        );
        return (
          relation === "" ||
          (!relation.startsWith("..") && !path.isAbsolute(relation))
        );
      });
      const reservedTarget = reservedAbsolute.find(({ absolute }) => {
        const relation = path.relative(absolute, realTarget);
        return (
          relation === "" ||
          (!relation.startsWith("..") && !path.isAbsolute(relation))
        );
      });
      const label =
        activeTarget?.path ?? reservedTarget?.item.path ?? repositoryRelation;
      fail(
        `${source.active.path}/${source.relative}:${imported.line}: path import outside its active root into ${label}; use a declared public npm package export`,
      );
    }
    const targetInfo = fileInfo.get(realTarget);
    if (
      targetInfo &&
      forbiddenLayers.has(`${source.layer}->${targetInfo.layer}`)
    )
      fail(
        `${source.active.path}/${source.relative}:${imported.line}: forbidden ${source.layer}->${targetInfo.layer} import`,
      );
  }
  for (const source of files) {
    const manifest = manifests.get(source.active.path);
    const declared = new Set(
      manifestDependencies(manifest).map((item) => item.name),
    );
    const compiler = compilerOptionsFor(source.filename, configCache);
    for (const imported of collectSpecifiers(source.filename)) {
      if (imported.value.startsWith(".")) {
        inspectPathTarget(
          source,
          resolveRelativeImport(
            source.filename,
            imported.value,
            registry.typescript.sourceExtensions,
          ),
          imported,
        );
        continue;
      }
      const packageName = internalPackageName(imported.value);
      if (packageName) {
        const target = activeByPackage.get(packageName);
        if (!target)
          fail(
            `${source.active.path}/${source.relative}:${imported.line}: unknown internal package ${packageName}`,
          );
        const subpath = publicSubpath(imported.value, packageName);
        // Resolve first so a tsconfig path cannot shadow a trusted package name
        // with an adapter, inactive source or another unexported repository
        // file. A normal workspace resolution must land on one of the exact
        // targets declared for this public export.
        const resolution = ts.resolveModuleName(
          imported.value,
          source.filename,
          compiler.options,
          ts.sys,
        ).resolvedModule;
        if (resolution && target.publicExports.includes(subpath)) {
          let resolved;
          try {
            resolved = realpathSync(path.resolve(resolution.resolvedFileName));
          } catch (error) {
            fail(
              `${source.active.path}/${source.relative}:${imported.line}: internal package ${packageName} resolution cannot be inspected: ${error.message}`,
            );
          }
          const targetManifest = manifests.get(target.path);
          const declaredTargets = new Set(
            exportTargets(
              targetManifest.exports[subpath],
              `${target.path} export ${subpath}`,
            ).map((entry) =>
              realpathSync(path.resolve(root, target.path, entry.slice(2))),
            ),
          );
          if (!declaredTargets.has(resolved))
            fail(
              `${source.active.path}/${source.relative}:${imported.line}: internal package alias shadowing for ${imported.value}; resolved ${path.relative(root, resolved)} outside declared ${target.path} export ${subpath}`,
            );
        }
        if (target.path !== source.active.path) {
          if (!declared.has(packageName))
            fail(
              `${source.active.path}/${source.relative}:${imported.line}: undeclared internal dependency ${packageName}`,
            );
          if (!allowedRootEdges.has(`${source.active.path}->${target.path}`))
            fail(
              `${source.active.path}/${source.relative}:${imported.line}: disallowed root dependency ${source.active.path}->${target.path}`,
            );
        }
        if (!target.publicExports.includes(subpath))
          fail(
            `${source.active.path}/${source.relative}:${imported.line}: unexported deep import ${imported.value}`,
          );
        continue;
      }
      const resolution = ts.resolveModuleName(
        imported.value,
        source.filename,
        compiler.options,
        ts.sys,
      ).resolvedModule;
      const aliasMatched = compiler.aliasPatterns.some((pattern) =>
        aliasPatternMatches(pattern, imported.value),
      );
      if (!resolution) {
        if (aliasMatched)
          fail(
            `${source.active.path}/${source.relative}:${imported.line}: unresolved configured path alias ${imported.value}`,
          );
        continue;
      }
      if (resolution.isExternalLibraryImport && !aliasMatched) continue;
      const target = path.resolve(resolution.resolvedFileName);
      const relation = path.relative(root, target);
      const insideRepository =
        relation === "" ||
        (!relation.startsWith("..") && !path.isAbsolute(relation));
      if (aliasMatched || insideRepository) {
        if (!insideRepository)
          fail(
            `${source.active.path}/${source.relative}:${imported.line}: configured path alias ${imported.value} resolves outside repository`,
          );
        inspectPathTarget(source, target, imported);
      }
    }
  }
  const inventoryRoot = safeRepositoryPath(
    root,
    registry.typescript.generatedInventory.root,
    "typescript.generatedInventory.root",
  );
  const actual = walkFiles(root, inventoryRoot, ignored)
    .map((filename) =>
      path.relative(inventoryRoot, filename).split(path.sep).join("/"),
    )
    .sort();
  const expected = [...registry.typescript.generatedInventory.files].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    fail(
      `generated contract inventory must be exactly ${expected.join(", ")}; received ${actual.join(", ")}`,
    );
}

function verifyPython(registry, report) {
  if (report.schemaVersion !== 2 || report.package !== registry.python.package)
    fail("Python import scanner returned incompatible report");
  if (report.diagnostics.length) {
    const item = report.diagnostics[0];
    fail(`${item.source}:${item.line}: ${item.kind}: ${item.detail}`);
  }
  const configured = new Map(
    registry.python.modules.map((item) => [item.module, item.layer]),
  );
  const actualModules = [...report.modules].sort();
  const configuredModules = [...configured.keys()].sort();
  if (JSON.stringify(actualModules) !== JSON.stringify(configuredModules)) {
    const missing = actualModules.filter((item) => !configured.has(item));
    const stale = configuredModules.filter(
      (item) => !actualModules.includes(item),
    );
    fail(
      `Python module classification drift; unclassified=${missing.join(",") || "none"}; stale=${stale.join(",") || "none"}`,
    );
  }
  const allowed = new Set(
    registry.python.allowedLayerEdges.map((edge) => `${edge.from}->${edge.to}`),
  );
  const exceptions = new Map(
    registry.python.exceptions.map((item) => [
      `${item.from}->${item.to}`,
      item,
    ]),
  );
  const usedExceptions = new Set();
  for (const edge of report.edges) {
    if (!configured.has(edge.source))
      fail(`unclassified Python source ${edge.source}`);
    let target = edge.target;
    while (!configured.has(target) && target.includes("."))
      target = target.slice(0, target.lastIndexOf("."));
    if (!configured.has(target))
      fail(
        `${edge.source}:${edge.line}: internal import target ${edge.target} is unclassified`,
      );
    const layerEdge = `${configured.get(edge.source)}->${configured.get(target)}`;
    if (allowed.has(layerEdge)) continue;
    const key = `${edge.source}->${target}`;
    const exception = exceptions.get(key);
    if (!exception)
      fail(
        `${edge.source}:${edge.line}: forbidden Python layer edge ${layerEdge} to ${target}`,
      );
    const actualNames = [...edge.names].sort();
    const expectedNames = [...exception.importedNames].sort();
    if (
      edge.dynamic ||
      JSON.stringify(actualNames) !== JSON.stringify(expectedNames)
    )
      fail(
        `${edge.source}:${edge.line}: Python exception ${key} widened; expected exact static imports ${expectedNames.join(", ")}`,
      );
    usedExceptions.add(key);
  }
  for (const key of exceptions.keys())
    if (!usedExceptions.has(key))
      fail(`Python exception ${key} is stale or no longer needed`);
}

export function runModuleBoundaryCheck(options = {}) {
  const root = realpathSync(
    options.root ?? path.resolve(SCRIPT_DIRECTORY, ".."),
  );
  const registryPath = safeRepositoryPath(
    root,
    options.registryPath ?? DEFAULT_REGISTRY,
    "registry path",
  );
  const registry = validateRegistry(
    readJson(registryPath, "module boundary registry"),
  );
  const facts = verifyRoots(root, registry, options);
  verifyTypeScript(root, registry, facts.manifests);
  verifyPython(registry, facts.pythonReport);
  return {
    activeRoots: registry.activeRoots.length,
    reservedRoots: registry.reservedRoots.length,
    rootEdges: registry.rootEdges.length,
    pythonModules: registry.python.modules.length,
  };
}

function main() {
  try {
    const result = runModuleBoundaryCheck();
    console.log(
      `Module boundaries are consistent: ${result.activeRoots} active roots, ${result.reservedRoots} inactive reservations, ${result.rootEdges} allowed root edge and ${result.pythonModules} classified Python modules.`,
    );
  } catch (error) {
    console.error(`Module boundary check failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
)
  main();
