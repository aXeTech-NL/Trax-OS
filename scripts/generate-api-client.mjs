#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const HTTP_METHODS = new Set(["delete", "get", "patch", "post", "put"]);
const PATH_ITEM_ANNOTATIONS = new Set(["description", "parameters", "summary"]);
const OPERATION_KEYS = new Set([
  "deprecated",
  "description",
  "operationId",
  "parameters",
  "requestBody",
  "responses",
  "security",
  "summary",
  "tags",
  "x-trax-command-type",
]);
const SCHEMA_TYPES = new Set([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
]);
const SCHEMA_FORMATS = new Set(["date", "date-time", "email", "uuid"]);
let componentNames = new Set();

const SCHEMA_KEYS = new Set([
  "$ref",
  "additionalProperties",
  "anyOf",
  "const",
  "default",
  "description",
  "enum",
  "format",
  "items",
  "maxLength",
  "maximum",
  "minLength",
  "minimum",
  "pattern",
  "properties",
  "required",
  "title",
  "type",
]);

function fail(message) {
  throw new Error(`API client generation failed: ${message}`);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object`);
  return value;
}

function validateSchema(schema, label) {
  object(schema, label);
  for (const key of Object.keys(schema))
    if (!SCHEMA_KEYS.has(key))
      fail(`${label} uses unsupported schema keyword ${key}`);
  if (schema.$ref !== undefined) {
    const prefix = "#/components/schemas/";
    if (typeof schema.$ref !== "string" || !schema.$ref.startsWith(prefix))
      fail(`${label} has an external or unsupported $ref`);
    if (!componentNames.has(schema.$ref.slice(prefix.length)))
      fail(`${label} has a dangling local $ref`);
    if (
      Object.keys(schema).some(
        (key) => !["$ref", "description", "title"].includes(key),
      )
    )
      fail(`${label} has unsupported validation siblings beside $ref`);
  }
  if (
    schema.type !== undefined &&
    (!SCHEMA_TYPES.has(schema.type) || typeof schema.type !== "string")
  )
    fail(`${label}.type is unsupported`);
  for (const key of ["description", "format", "pattern", "title"])
    if (schema[key] !== undefined && typeof schema[key] !== "string")
      fail(`${label}.${key} must be a string`);
  if (schema.format !== undefined && !SCHEMA_FORMATS.has(schema.format))
    fail(`${label}.format is unsupported`);
  if (schema.pattern !== undefined) {
    try {
      new RegExp(schema.pattern);
    } catch {
      fail(`${label}.pattern is invalid`);
    }
  }
  for (const key of ["minLength", "maxLength"])
    if (
      schema[key] !== undefined &&
      (!Number.isSafeInteger(schema[key]) || schema[key] < 0)
    )
      fail(`${label}.${key} must be a non-negative safe integer`);
  if (
    schema.minLength !== undefined &&
    schema.maxLength !== undefined &&
    schema.minLength > schema.maxLength
  )
    fail(`${label} has inverted length bounds`);
  for (const key of ["minimum", "maximum"])
    if (
      schema[key] !== undefined &&
      (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))
    )
      fail(`${label}.${key} must be finite`);
  if (
    schema.minimum !== undefined &&
    schema.maximum !== undefined &&
    schema.minimum > schema.maximum
  )
    fail(`${label} has inverted numeric bounds`);
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) ||
      new Set(schema.required).size !== schema.required.length ||
      schema.required.some((value) => typeof value !== "string"))
  )
    fail(`${label}.required must contain unique strings`);
  if (
    schema.enum !== undefined &&
    (!Array.isArray(schema.enum) || schema.enum.length === 0)
  )
    fail(`${label}.enum must be a non-empty array`);
  if (schema.properties !== undefined) {
    const properties = object(schema.properties, `${label}.properties`);
    for (const [name, property] of Object.entries(properties))
      validateSchema(property, `${label}.properties.${name}`);
  }
  if (schema.items !== undefined)
    validateSchema(schema.items, `${label}.items`);
  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0)
      fail(`${label}.anyOf must be a non-empty array`);
    schema.anyOf.forEach((candidate, index) =>
      validateSchema(candidate, `${label}.anyOf[${index}]`),
    );
  }
  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties !== "boolean"
  )
    validateSchema(
      schema.additionalProperties,
      `${label}.additionalProperties`,
    );
}

function schemaType(schema, label) {
  validateSchema(schema, label);
  if (schema.$ref) {
    const name = schema.$ref.slice("#/components/schemas/".length);
    return `components["schemas"][${JSON.stringify(name)}]`;
  }
  if (schema.type === "string") return "string";
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "null") return "null";
  fail(`${label} cannot be projected to a TypeScript operation type`);
}

function jsonSchemaContent(container, label, required) {
  if (container.content === undefined) {
    if (required) fail(`${label} must declare application/json content`);
    return undefined;
  }
  const content = object(container.content, `${label}.content`);
  const mediaTypes = Object.keys(content);
  if (mediaTypes.length !== 1 || mediaTypes[0] !== "application/json")
    fail(`${label} must declare exactly application/json content`);
  const media = object(
    content["application/json"],
    `${label}.content.application/json`,
  );
  if (!media.schema) fail(`${label} is missing its schema`);
  validateSchema(media.schema, `${label}.schema`);
  return media.schema;
}

function resolveRequestBody(value, openapi, label) {
  if (!value) return undefined;
  if (value.$ref) {
    const prefix = "#/components/requestBodies/";
    if (typeof value.$ref !== "string" || !value.$ref.startsWith(prefix))
      fail(`${label} has an unsupported request-body reference`);
    const name = value.$ref.slice(prefix.length);
    return object(
      openapi.components?.requestBodies?.[name],
      `${label} reference`,
    );
  }
  return object(value, label);
}

function generate(openapi, fixtures) {
  if (openapi.openapi !== "3.1.0")
    fail(`expected OpenAPI 3.1.0, received ${openapi.openapi}`);
  const schemas = object(openapi.components?.schemas, "components.schemas");
  componentNames = new Set(Object.keys(schemas));
  for (const [name, schema] of Object.entries(schemas))
    validateSchema(schema, `components.schemas.${name}`);

  const operations = {};
  const inputs = [];
  const successes = [];
  const seenIds = new Set();
  for (const [path, pathItemValue] of Object.entries(
    object(openapi.paths, "paths"),
  )) {
    const pathItem = object(pathItemValue, `paths.${path}`);
    for (const key of Object.keys(pathItem)) {
      if (!HTTP_METHODS.has(key) && !PATH_ITEM_ANNOTATIONS.has(key))
        fail(`${path} uses unsupported path-item field ${key}`);
    }
    for (const [method, operationValue] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      const operation = object(
        operationValue,
        `${method.toUpperCase()} ${path}`,
      );
      for (const key of Object.keys(operation))
        if (!OPERATION_KEYS.has(key))
          fail(
            `${method.toUpperCase()} ${path} uses unsupported operation field ${key}`,
          );
      if (operation.security !== undefined) {
        const security = operation.security;
        const requirement = Array.isArray(security) ? security[0] : undefined;
        if (
          !Array.isArray(security) ||
          security.length !== 1 ||
          !requirement ||
          typeof requirement !== "object" ||
          Array.isArray(requirement) ||
          Object.keys(requirement).length !== 1 ||
          !Array.isArray(requirement.SessionCookie) ||
          requirement.SessionCookie.length !== 0
        )
          fail(
            `${method.toUpperCase()} ${path} uses unsupported security metadata`,
          );
      }
      const operationId = operation.operationId;
      if (typeof operationId !== "string" || operationId.length === 0)
        fail(`${method.toUpperCase()} ${path} has no operationId`);
      if (seenIds.has(operationId))
        fail(`duplicate operationId ${operationId}`);
      seenIds.add(operationId);

      const parameters = [
        ...(pathItem.parameters ?? []),
        ...(operation.parameters ?? []),
      ];
      const pathSchemas = {};
      let csrf = false;
      for (const parameterValue of parameters) {
        const parameter = object(parameterValue, `${operationId}.parameter`);
        if (parameter.$ref)
          fail(`${operationId} uses unsupported parameter $ref`);
        if (parameter.in === "path") {
          if (parameter.required !== true || typeof parameter.name !== "string")
            fail(`${operationId} has an invalid path parameter`);
          validateSchema(
            parameter.schema,
            `${operationId}.path.${parameter.name}`,
          );
          pathSchemas[parameter.name] = parameter.schema;
        } else if (
          parameter.in === "header" &&
          parameter.name === "X-CSRF-Token"
        ) {
          if (parameter.required !== true)
            fail(`${operationId} has optional CSRF metadata`);
          csrf = true;
        } else {
          fail(
            `${operationId} uses unsupported ${parameter.in} parameter ${parameter.name}`,
          );
        }
      }
      for (const placeholder of path.matchAll(/\{([^}]+)\}/g))
        if (!pathSchemas[placeholder[1]])
          fail(`${operationId} lacks path schema for ${placeholder[1]}`);

      const requestBody = resolveRequestBody(
        operation.requestBody,
        openapi,
        `${operationId}.requestBody`,
      );
      const bodySchema = requestBody
        ? jsonSchemaContent(requestBody, `${operationId}.requestBody`, true)
        : undefined;
      if (requestBody && requestBody.required !== true)
        fail(`${operationId} uses an optional JSON request body`);

      const responseSchemas = {};
      const canonicalErrorStatuses = [];
      const successTypes = [];
      for (const [status, responseValue] of Object.entries(
        object(operation.responses, `${operationId}.responses`),
      )) {
        if (!/^\d{3}$/.test(status))
          fail(`${operationId} uses unsupported response key ${status}`);
        const response = object(
          responseValue,
          `${operationId}.responses.${status}`,
        );
        if (response.$ref)
          fail(`${operationId} uses unsupported response $ref`);
        const schema = jsonSchemaContent(
          response,
          `${operationId}.responses.${status}`,
          status.startsWith("2") && status !== "204",
        );
        responseSchemas[status] = schema ?? null;
        if (schema?.$ref === "#/components/schemas/ErrorResponse")
          canonicalErrorStatuses.push(status);
        if (status.startsWith("2"))
          successTypes.push(
            schema ? schemaType(schema, `${operationId}.${status}`) : "null",
          );
      }
      if (successTypes.length === 0)
        fail(`${operationId} has no success response`);

      const inputParts = [];
      const pathEntries = Object.entries(pathSchemas);
      if (pathEntries.length)
        inputParts.push(
          `path: { ${pathEntries
            .map(
              ([name, schema]) =>
                `${JSON.stringify(name)}: ${schemaType(schema, `${operationId}.path.${name}`)}`,
            )
            .join("; ")} }`,
        );
      else inputParts.push("path?: never");
      if (bodySchema)
        inputParts.push(
          `body: ${schemaType(bodySchema, `${operationId}.body`)}`,
        );
      else inputParts.push("body?: never");
      inputs.push(
        `  ${JSON.stringify(operationId)}: { ${inputParts.join("; ")} };`,
      );
      successes.push(
        `  ${JSON.stringify(operationId)}: ${[...new Set(successTypes)].join(" | ")};`,
      );
      const commandType = operation["x-trax-command-type"] ?? null;
      if (
        commandType !== null &&
        (typeof commandType !== "string" || !bodySchema)
      )
        fail(`${operationId} has invalid x-trax-command-type metadata`);
      if (commandType !== null) {
        const envelope = bodySchema.$ref
          ? schemas[bodySchema.$ref.slice("#/components/schemas/".length)]
          : bodySchema;
        const declaredType = envelope?.properties?.command_type?.const;
        if (declaredType !== commandType)
          fail(
            `${operationId} command marker does not match request schema literal`,
          );
      }
      operations[operationId] = {
        bodySchema: bodySchema ?? null,
        canonicalErrorStatuses,
        commandType,
        csrf,
        method: method.toUpperCase(),
        path,
        pathSchemas,
        responses: responseSchemas,
      };
    }
  }

  const contract = object(fixtures.contract, "runtime fixture contract");
  const api = object(contract.api, "runtime fixture contract.api");
  if (
    !Number.isSafeInteger(api.current) ||
    api.current < 1 ||
    !Number.isSafeInteger(api.minimum_supported) ||
    !Number.isSafeInteger(api.maximum_supported) ||
    api.minimum_supported > api.current ||
    api.current > api.maximum_supported
  )
    fail("contract.api has an invalid supported range");
  const commands = Array.isArray(contract.commands)
    ? contract.commands
    : fail("contract.commands must be an array");
  const commandTypes = new Set();
  const discoveredCommands = new Map();
  for (const [index, value] of commands.entries()) {
    const command = object(value, `contract.commands[${index}]`);
    if (
      typeof command.command_type !== "string" ||
      commandTypes.has(command.command_type) ||
      !Number.isSafeInteger(command.current) ||
      command.current < 1 ||
      !Number.isSafeInteger(command.minimum_supported) ||
      !Number.isSafeInteger(command.maximum_supported) ||
      command.minimum_supported > command.current ||
      command.current > command.maximum_supported
    )
      fail(
        `contract.commands[${index}] has invalid or duplicate support metadata`,
      );
    commandTypes.add(command.command_type);
    discoveredCommands.set(command.command_type, command);
  }
  const markedCommands = [
    ...new Set(
      Object.values(operations)
        .map((operation) => operation.commandType)
        .filter((commandType) => commandType !== null),
    ),
  ].sort();
  for (const commandType of markedCommands)
    if (!discoveredCommands.has(commandType))
      fail(`marked command ${commandType} is absent from contract discovery`);
  const clientSupport = {
    api: { minimum_supported: api.current, maximum_supported: api.current },
    commands: Object.fromEntries(
      markedCommands.map((commandType) => {
        const command = discoveredCommands.get(commandType);
        return [
          commandType,
          {
            minimum_supported: command.current,
            maximum_supported: command.current,
          },
        ];
      }),
    ),
  };

  return `/* Generated by scripts/generate-api-client.mjs. Do not edit. */\nimport type { components } from "@trax-os/api-contract";\n\nexport interface OperationInputMap {\n${inputs.join("\n")}\n}\n\nexport interface OperationSuccessMap {\n${successes.join("\n")}\n}\n\nexport type OperationId = keyof OperationInputMap;\n\nexport const componentSchemas = ${JSON.stringify(schemas, null, 2)} as const;\n\nexport const operationMetadata = ${JSON.stringify(operations, null, 2)} as const;\n\nexport const clientSupport = ${JSON.stringify(clientSupport, null, 2)} as const;\n`;
}

if (process.argv.length !== 5)
  throw new Error(
    "usage: node scripts/generate-api-client.mjs OPENAPI FIXTURES OUTPUT",
  );
const openapi = JSON.parse(readFileSync(process.argv[2], "utf8"));
const fixtures = JSON.parse(readFileSync(process.argv[3], "utf8"));
writeFileSync(process.argv[4], generate(openapi, fixtures), "utf8");
