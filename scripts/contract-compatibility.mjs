import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { apiCompare } from "api-smart-diff";

const ALLOWED_DIFFERENCE_TYPES = new Set([
  "annotation",
  "deprecated",
  "non-breaking",
]);
const MUTATION_OPERATIONS = new Set([
  "POST /api/v1/auth/logout",
  "POST /api/v1/journeys",
  "PUT /api/v1/journeys/{journey_id}",
  "DELETE /api/v1/journeys/{journey_id}",
  "POST /api/v1/journeys/{journey_id}/segments",
  "PUT /api/v1/journeys/{journey_id}/segments/{segment_id}",
  "POST /api/v1/journeys/{journey_id}/segments/{segment_id}/reorder",
  "DELETE /api/v1/journeys/{journey_id}/segments/{segment_id}",
  "POST /api/v1/journeys/{journey_id}/packing",
  "PUT /api/v1/journeys/{journey_id}/packing/{item_id}",
  "PUT /api/v1/journeys/{journey_id}/packing/{item_id}/progress",
  "DELETE /api/v1/journeys/{journey_id}/packing/{item_id}",
]);
const AUTHENTICATED_OPERATIONS = new Set([
  "GET /api/v1/auth/session",
  "GET /api/v1/journeys",
  "GET /api/v1/journeys/{journey_id}",
  "GET /api/v1/journeys/{journey_id}/segments",
  "GET /api/v1/journeys/{journey_id}/packing",
  ...MUTATION_OPERATIONS,
]);
const SESSION_SECURITY = [{ SessionCookie: [] }];
const SESSION_SCHEME = {
  type: "apiKey",
  description: "Opaque authenticated Trax OS session cookie.",
  in: "cookie",
  name: "trax_session",
};
const CSRF_PARAMETER = {
  name: "X-CSRF-Token",
  in: "header",
  required: true,
  description: "Double-submit token matching the trax_csrf cookie.",
  schema: { type: "string" },
};

export function loadOpenApi(path) {
  let document;
  try {
    document = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read OpenAPI contract ${path}: ${error.message}`);
  }

  if (
    typeof document !== "object" ||
    document === null ||
    Array.isArray(document) ||
    typeof document.openapi !== "string" ||
    !/^3\.1\.\d+$/.test(document.openapi) ||
    typeof document.paths !== "object" ||
    document.paths === null
  ) {
    throw new Error(`${path} is not a supported OpenAPI 3.1 document.`);
  }
  assertLocalReferences(document, path);
  return document;
}

export function compareOpenApi(source, destination) {
  const result = apiCompare(
    structuredClone(source),
    structuredClone(destination),
  );
  const securityMetadataCorrection = qualifiesLegacySecurityMetadataCorrection(
    source,
    destination,
  );
  const blockingDifferences = result.diffs.filter(
    (difference) =>
      (!ALLOWED_DIFFERENCE_TYPES.has(difference.type) ||
        violatesTraxCompatibilityPolicy(difference)) &&
      !(
        securityMetadataCorrection &&
        isLegacySecurityMetadataDifference(difference)
      ),
  );
  return {
    differences: result.diffs,
    blockingDifferences,
    securityMetadataCorrection,
  };
}

export function assertLocalReferences(
  value,
  location,
  pointer = "$",
  document = value,
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertLocalReferences(item, location, `${pointer}/${index}`, document),
    );
    return;
  }
  if (typeof value !== "object" || value === null) return;

  for (const [key, child] of Object.entries(value)) {
    const childPointer = `${pointer}/${escapePointerToken(key)}`;
    if (key === "$ref") {
      if (typeof child !== "string" || !child.startsWith("#/")) {
        throw new Error(
          `${location} contains a non-local $ref at ${childPointer}; compatibility checks never resolve external references.`,
        );
      }
      if (!resolvesLocalReference(document, child)) {
        throw new Error(
          `${location} contains a dangling local $ref at ${childPointer}: ${child}`,
        );
      }
    }
    assertLocalReferences(child, location, childPointer, document);
  }
}

function resolvesLocalReference(document, reference) {
  let current = document;
  let tokens;
  try {
    tokens = decodeURIComponent(reference.slice(1))
      .slice(1)
      .split("/")
      .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
  } catch {
    return false;
  }

  for (const token of tokens) {
    if (
      typeof current !== "object" ||
      current === null ||
      !Object.hasOwn(current, token)
    ) {
      return false;
    }
    current = current[token];
  }
  return true;
}

function violatesTraxCompatibilityPolicy(difference) {
  const path = difference.path;
  if (
    path.some(
      (item) =>
        item === "security" ||
        item === "securitySchemes" ||
        item === "servers" ||
        item === "operationId",
    )
  ) {
    return true;
  }

  const parametersIndex = path.indexOf("parameters");
  if (parametersIndex >= 0) {
    return !isOptionalParameterAddition(difference, parametersIndex);
  }

  const requestBodyIndex = path.indexOf("requestBody");
  const propertiesIndex = path.indexOf("properties", requestBodyIndex);
  if (requestBodyIndex >= 0 && propertiesIndex >= 0) {
    const isOptionalPropertyAddition =
      difference.action === "add" && path.length === propertiesIndex + 2;
    return !isOptionalPropertyAddition;
  }

  return false;
}

function isOptionalParameterAddition(difference, parametersIndex) {
  if (
    difference.action !== "add" ||
    difference.path.length > parametersIndex + 1
  ) {
    return false;
  }
  const parameters = Array.isArray(difference.after)
    ? difference.after
    : [difference.after];
  return parameters.every(
    (parameter) =>
      typeof parameter === "object" &&
      parameter !== null &&
      parameter.required !== true,
  );
}

function qualifiesLegacySecurityMetadataCorrection(source, destination) {
  if (
    source.components?.securitySchemes !== undefined ||
    !isDeepStrictEqual(destination.components?.securitySchemes, {
      SessionCookie: SESSION_SCHEME,
    })
  ) {
    return false;
  }

  for (const operationKey of AUTHENTICATED_OPERATIONS) {
    const sourceOperation = findOperation(source, operationKey);
    const destinationOperation = findOperation(destination, operationKey);
    if (
      !sourceOperation ||
      !destinationOperation ||
      sourceOperation.security !== undefined ||
      !isDeepStrictEqual(destinationOperation.security, SESSION_SECURITY)
    ) {
      return false;
    }

    const sourceParameters = sourceOperation.parameters ?? [];
    const expectedParameters = MUTATION_OPERATIONS.has(operationKey)
      ? [...sourceParameters, CSRF_PARAMETER]
      : sourceParameters;
    if (
      hasCsrfParameter(sourceOperation) ||
      !isDeepStrictEqual(
        destinationOperation.parameters ?? [],
        expectedParameters,
      )
    ) {
      return false;
    }
  }
  return true;
}

function findOperation(document, operationKey) {
  const separator = operationKey.indexOf(" ");
  const method = operationKey.slice(0, separator).toLowerCase();
  const path = operationKey.slice(separator + 1);
  return document.paths?.[path]?.[method];
}

function hasCsrfParameter(operation) {
  return (
    Array.isArray(operation.parameters) &&
    operation.parameters.some((parameter) =>
      isDeepStrictEqual(parameter, CSRF_PARAMETER),
    )
  );
}

function isLegacySecurityMetadataDifference(difference) {
  if (difference.action !== "add") return false;
  if (isDeepStrictEqual(difference.path, ["components", "securitySchemes"])) {
    return true;
  }
  if (difference.path[0] !== "paths") return false;

  const operationKey = `${String(difference.path[2]).toUpperCase()} ${difference.path[1]}`;
  if (
    difference.path[3] === "security" &&
    AUTHENTICATED_OPERATIONS.has(operationKey)
  ) {
    return true;
  }
  return (
    difference.path[3] === "parameters" && MUTATION_OPERATIONS.has(operationKey)
  );
}

function escapePointerToken(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function describeDifference(difference) {
  const path = difference.path
    .map((item) => escapePointerToken(String(item)))
    .join("/");
  return `${difference.type}: ${difference.action} /${path}`;
}

function main() {
  const [sourcePath, destinationPath, ...extra] = process.argv.slice(2);
  if (!sourcePath || !destinationPath || extra.length > 0) {
    console.error(
      "Usage: node scripts/contract-compatibility.mjs BASE_OPENAPI CANDIDATE_OPENAPI",
    );
    process.exitCode = 2;
    return;
  }

  try {
    const source = loadOpenApi(sourcePath);
    const destination = loadOpenApi(destinationPath);
    const { differences, blockingDifferences, securityMetadataCorrection } =
      compareOpenApi(source, destination);

    if (blockingDifferences.length > 0) {
      console.error(
        `Contract compatibility failed with ${blockingDifferences.length} breaking or unclassified difference(s):`,
      );
      for (const difference of blockingDifferences.slice(0, 20)) {
        console.error(`- ${describeDifference(difference)}`);
      }
      if (blockingDifferences.length > 20) {
        console.error(`- … ${blockingDifferences.length - 20} more`);
      }
      process.exitCode = 1;
      return;
    }

    const correction = securityMetadataCorrection
      ? "; exact legacy security metadata correction qualified"
      : "";
    console.log(
      `Contract compatibility passed (${differences.length} accepted difference(s)${correction}).`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) main();
