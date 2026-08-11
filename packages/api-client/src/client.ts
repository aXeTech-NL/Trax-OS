import type { components } from "@trax-os/api-contract";

import {
  operationMetadata,
  type OperationId,
  type OperationInputMap,
  type OperationSuccessMap,
} from "../generated/client";
import {
  negotiateContract,
  type ContractDiscovery,
  type NegotiatedContract,
  VersionNegotiationError,
} from "./negotiation";
import { assertValid, SchemaValidationError } from "./validator";

const CONTRACT_OPERATION = "contract_discovery_api_contract_get" as const;

type ErrorResponse = components["schemas"]["ErrorResponse"];
type ErrorKind = "api" | "contract" | "network" | "negotiation";

interface RuntimeOperation {
  readonly bodySchema: unknown | null;
  readonly canonicalErrorStatuses: readonly string[];
  readonly commandType: string | null;
  readonly csrf: boolean;
  readonly method: string;
  readonly path: string;
  readonly pathSchemas: Readonly<Record<string, unknown>>;
  readonly responses: Readonly<Record<string, unknown | null>>;
}

export class ApiClientError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly code: string,
    message: string,
    readonly operationId?: OperationId,
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface TraxApiClientOptions {
  readonly baseUrl?: string;
  readonly request?: typeof fetch;
  readonly csrfToken?: () => string;
}

export class TraxApiClient {
  private readonly baseUrl: string;
  private readonly requestFunction: typeof fetch;
  private readonly csrfTokenProvider: () => string;
  private negotiation: Promise<NegotiatedContract> | undefined;

  constructor(options: TraxApiClientOptions = {}) {
    this.baseUrl = validBaseUrl(options.baseUrl ?? "");
    this.requestFunction = options.request ?? globalThis.fetch.bind(globalThis);
    this.csrfTokenProvider = options.csrfToken ?? browserCsrfToken;
  }

  async request<K extends OperationId>(
    operationId: K,
    input: OperationInputMap[K],
  ): Promise<OperationSuccessMap[K]> {
    const negotiated =
      operationId === CONTRACT_OPERATION
        ? undefined
        : await this.ensureNegotiated();
    return this.execute(operationId, input, negotiated);
  }

  async commandVersion(commandType: string): Promise<number> {
    const negotiated = await this.ensureNegotiated();
    const version = negotiated.commandVersions.get(commandType);
    if (version === undefined)
      throw new ApiClientError(
        "negotiation",
        "unsupported_command",
        "The command is not supported by this client and server.",
      );
    return version;
  }

  async negotiatedApiVersion(): Promise<number> {
    return (await this.ensureNegotiated()).apiVersion;
  }

  private ensureNegotiated(): Promise<NegotiatedContract> {
    if (this.negotiation) return this.negotiation;
    const pending = this.bootstrap();
    this.negotiation = pending;
    void pending.catch(() => {
      if (this.negotiation === pending) this.negotiation = undefined;
    });
    return pending;
  }

  private async bootstrap(): Promise<NegotiatedContract> {
    try {
      const metadata = await this.execute(CONTRACT_OPERATION, {}, undefined);
      return negotiateContract(metadata as ContractDiscovery);
    } catch (error) {
      if (error instanceof VersionNegotiationError)
        throw new ApiClientError("negotiation", error.code, error.message);
      if (error instanceof ApiClientError && error.kind === "contract")
        throw new ApiClientError(
          "negotiation",
          "invalid_contract_metadata",
          "The server returned invalid contract metadata.",
        );
      throw error;
    }
  }

  private async execute<K extends OperationId>(
    operationId: K,
    input: OperationInputMap[K],
    negotiated: NegotiatedContract | undefined,
  ): Promise<OperationSuccessMap[K]> {
    const operation = operationMetadata[operationId] as RuntimeOperation;
    if (!operation)
      throw new ApiClientError(
        "contract",
        "unknown_operation",
        "Unknown API operation.",
      );
    const candidateInput: unknown = input;
    if (!isRecord(candidateInput)) invalidRequest(operationId);
    const allowedInput = new Set<string>();
    if (Object.keys(operation.pathSchemas).length) allowedInput.add("path");
    if (operation.bodySchema) allowedInput.add("body");
    if (Object.keys(candidateInput).some((key) => !allowedInput.has(key)))
      invalidRequest(operationId);

    let path = operation.path;
    if (Object.keys(operation.pathSchemas).length) {
      if (!isRecord(candidateInput.path)) invalidRequest(operationId);
      const supplied = candidateInput.path;
      if (
        Object.keys(supplied).length !==
          Object.keys(operation.pathSchemas).length ||
        Object.keys(supplied).some((key) => !(key in operation.pathSchemas))
      )
        invalidRequest(operationId);
      for (const [name, schema] of Object.entries(operation.pathSchemas)) {
        const value = supplied[name];
        validateRequest(schema, value, operationId);
        path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
      }
    }
    if (operation.bodySchema) {
      if (!("body" in candidateInput)) invalidRequest(operationId);
      validateRequest(operation.bodySchema, candidateInput.body, operationId);
    }
    if (operation.commandType) {
      if (!negotiated || !isRecord(candidateInput.body))
        invalidRequest(operationId);
      const selected = negotiated.commandVersions.get(operation.commandType);
      if (
        selected === undefined ||
        candidateInput.body.command_type !== operation.commandType ||
        candidateInput.body.command_version !== selected
      )
        throw new ApiClientError(
          "negotiation",
          selected === undefined
            ? "unsupported_command"
            : "command_version_mismatch",
          "The command does not use the negotiated version.",
          operationId,
        );
    }

    const headers = new Headers({ Accept: "application/json" });
    if (operation.bodySchema) headers.set("Content-Type", "application/json");
    if (operation.csrf) headers.set("X-CSRF-Token", this.csrfTokenProvider());
    let response: Response;
    try {
      response = await this.requestFunction(`${this.baseUrl}${path}`, {
        method: operation.method,
        credentials: "same-origin",
        headers,
        ...(operation.bodySchema
          ? { body: JSON.stringify(candidateInput.body) }
          : {}),
      });
    } catch {
      throw new ApiClientError(
        "network",
        "network_error",
        "The Trax OS API could not be reached.",
        operationId,
      );
    }

    const responseSchema = operation.responses[String(response.status)];
    if (responseSchema === undefined)
      throw new ApiClientError(
        "contract",
        "unexpected_status",
        "The Trax OS API returned an undeclared status.",
        operationId,
        response.status,
      );
    if (responseSchema === null) {
      const body = await response.text();
      if (body.length !== 0)
        throw invalidResponse(operationId, response.status, response.ok);
      return null as OperationSuccessMap[K];
    }
    if (!isJsonContentType(response.headers.get("Content-Type")))
      throw new ApiClientError(
        "contract",
        "unexpected_content_type",
        "The Trax OS API returned an undeclared content type.",
        operationId,
        response.status,
      );
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw invalidResponse(operationId, response.status, response.ok);
    }
    try {
      assertValid(responseSchema, payload, "response");
    } catch (error) {
      if (error instanceof SchemaValidationError)
        throw invalidResponse(operationId, response.status, response.ok);
      throw error;
    }
    if (!response.ok) {
      if (operation.canonicalErrorStatuses.includes(String(response.status))) {
        const error = payload as ErrorResponse;
        throw new ApiClientError(
          "api",
          error.error.code,
          error.error.message,
          operationId,
          response.status,
          error.error.request_id,
        );
      }
      throw new ApiClientError(
        "api",
        "http_error",
        "The Trax OS API returned a declared non-success response.",
        operationId,
        response.status,
      );
    }
    return payload as OperationSuccessMap[K];
  }
}

function validateRequest(
  schema: unknown,
  value: unknown,
  operationId: OperationId,
): void {
  try {
    assertValid(schema, value, "request");
  } catch (error) {
    if (error instanceof SchemaValidationError) invalidRequest(operationId);
    throw error;
  }
}

function invalidRequest(operationId: OperationId): never {
  throw new ApiClientError(
    "contract",
    "invalid_request",
    "The API request does not match the canonical contract.",
    operationId,
  );
}

function invalidResponse(
  operationId: OperationId,
  status: number,
  success: boolean,
): ApiClientError {
  return new ApiClientError(
    "contract",
    success ? "invalid_response" : "invalid_error_response",
    success
      ? "The Trax OS API returned an invalid response."
      : "The Trax OS API returned an invalid error response.",
    operationId,
    status,
  );
}

function validBaseUrl(value: string): string {
  const sentinel = new URL("https://trax.invalid/");
  if (
    value.includes("?") ||
    value.includes("#") ||
    value.includes("\\") ||
    /[\u0000-\u0020\u007f]/.test(value) ||
    (value !== "" && !value.startsWith("/"))
  )
    throw new TypeError("The API client only accepts a same-origin base URL.");
  let resolved: URL;
  try {
    resolved = new URL(value || "/", sentinel);
  } catch {
    throw new TypeError("The API client only accepts a same-origin base URL.");
  }
  if (
    resolved.origin !== sentinel.origin ||
    resolved.username ||
    resolved.password
  )
    throw new TypeError("The API client only accepts a same-origin base URL.");
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function browserCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const value = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith("trax_csrf="))
    ?.slice("trax_csrf=".length);
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
