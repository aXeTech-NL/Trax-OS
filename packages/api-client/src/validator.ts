import { componentSchemas } from "../generated/client";

type Schema = Record<string, unknown>;
type ValidationMode = "request" | "response";

export class SchemaValidationError extends Error {
  constructor(readonly pointer: string) {
    super(`Contract validation failed at ${pointer}`);
    this.name = "SchemaValidationError";
  }
}

export function assertValid(
  schema: unknown,
  value: unknown,
  mode: ValidationMode,
  pointer = "$",
): void {
  validate(asSchema(schema, pointer), value, mode, pointer);
}

function validate(
  schema: Schema,
  value: unknown,
  mode: ValidationMode,
  pointer: string,
): void {
  if (typeof schema.$ref === "string") {
    const prefix = "#/components/schemas/";
    if (!schema.$ref.startsWith(prefix))
      throw new SchemaValidationError(pointer);
    const name = schema.$ref.slice(
      prefix.length,
    ) as keyof typeof componentSchemas;
    const target: unknown = componentSchemas[name];
    if (!target) throw new SchemaValidationError(pointer);
    validate(asSchema(target, pointer), value, mode, pointer);
    return;
  }
  if (Array.isArray(schema.anyOf)) {
    for (const candidate of schema.anyOf) {
      try {
        validate(asSchema(candidate, pointer), value, mode, pointer);
        return;
      } catch (error) {
        if (!(error instanceof SchemaValidationError)) throw error;
      }
    }
    throw new SchemaValidationError(pointer);
  }
  if ("const" in schema && !Object.is(value, schema.const))
    throw new SchemaValidationError(pointer);
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((candidate) => Object.is(candidate, value))
  )
    throw new SchemaValidationError(pointer);

  switch (schema.type) {
    case "null":
      if (value !== null) throw new SchemaValidationError(pointer);
      return;
    case "boolean":
      if (typeof value !== "boolean") throw new SchemaValidationError(pointer);
      return;
    case "integer":
      if (!Number.isSafeInteger(value))
        throw new SchemaValidationError(pointer);
      validateNumber(schema, value as number, pointer);
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new SchemaValidationError(pointer);
      validateNumber(schema, value, pointer);
      return;
    case "string":
      validateString(schema, value, pointer);
      return;
    case "array":
      if (!Array.isArray(value) || !schema.items)
        throw new SchemaValidationError(pointer);
      value.forEach((item, index) =>
        validate(
          asSchema(schema.items, `${pointer}/${index}`),
          item,
          mode,
          `${pointer}/${index}`,
        ),
      );
      return;
    case "object":
      validateObject(schema, value, mode, pointer);
      return;
    default:
      throw new SchemaValidationError(pointer);
  }
}

function validateNumber(schema: Schema, value: number, pointer: string): void {
  if (typeof schema.minimum === "number" && value < schema.minimum)
    throw new SchemaValidationError(pointer);
  if (typeof schema.maximum === "number" && value > schema.maximum)
    throw new SchemaValidationError(pointer);
}

function validateString(schema: Schema, value: unknown, pointer: string): void {
  if (typeof value !== "string") throw new SchemaValidationError(pointer);
  const codePoints = [...value].length;
  if (typeof schema.minLength === "number" && codePoints < schema.minLength)
    throw new SchemaValidationError(pointer);
  if (typeof schema.maxLength === "number" && codePoints > schema.maxLength)
    throw new SchemaValidationError(pointer);
  if (
    typeof schema.pattern === "string" &&
    !new RegExp(schema.pattern).test(value)
  )
    throw new SchemaValidationError(pointer);
  if (typeof schema.format === "string" && !validFormat(schema.format, value))
    throw new SchemaValidationError(pointer);
}

function validFormat(format: string, value: string): boolean {
  if (format === "uuid")
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
  if (format === "date") return validDate(value);
  if (format === "date-time") {
    const match =
      /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(
        value,
      );
    if (!match || !validDate(match[1]!)) return false;
    const hour = Number(match[2]);
    const minute = Number(match[3]);
    const second = Number(match[4]);
    const offsetHour = Number(match[6] ?? 0);
    const offsetMinute = Number(match[7] ?? 0);
    return (
      hour <= 23 &&
      minute <= 59 &&
      second <= 59 &&
      offsetHour <= 23 &&
      offsetMinute <= 59 &&
      Number.isFinite(Date.parse(value))
    );
  }
  if (format === "email")
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
  return false;
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validateObject(
  schema: Schema,
  value: unknown,
  mode: ValidationMode,
  pointer: string,
): void {
  if (!isRecord(value)) throw new SchemaValidationError(pointer);
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required)
    if (typeof key !== "string" || !(key in value))
      throw new SchemaValidationError(`${pointer}/${String(key)}`);
  for (const [key, propertyValue] of Object.entries(value)) {
    const propertySchema = properties[key];
    if (propertySchema) {
      validate(
        asSchema(propertySchema, `${pointer}/${key}`),
        propertyValue,
        mode,
        `${pointer}/${key}`,
      );
      continue;
    }
    if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === "object"
    ) {
      validate(
        asSchema(schema.additionalProperties, `${pointer}/${key}`),
        propertyValue,
        mode,
        `${pointer}/${key}`,
      );
    } else if (mode === "request" && schema.additionalProperties === false) {
      throw new SchemaValidationError(`${pointer}/${key}`);
    }
  }
}

function asSchema(value: unknown, pointer: string): Schema {
  if (!isRecord(value)) throw new SchemaValidationError(pointer);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
