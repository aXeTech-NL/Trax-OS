import type { components } from "@trax-os/api-contract";

import type {
  InstanceInfo,
  InstanceRepository,
} from "../repositories/instance-repository";

type CapabilitiesResponse = components["schemas"]["CapabilitiesResponse"];
type ErrorResponse = components["schemas"]["ErrorResponse"];
type VersionResponse = components["schemas"]["VersionResponse"];

export class InstanceRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: string = "instance_unavailable",
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "InstanceRepositoryError";
  }
}

export class HttpInstanceRepository implements InstanceRepository {
  constructor(
    private readonly baseUrl = "/api/v1",
    private readonly request: typeof fetch = fetch,
  ) {}

  async getInstance(): Promise<InstanceInfo> {
    const [version, capabilities] = await Promise.all([
      this.get("/version", isVersionResponse),
      this.get("/capabilities", isCapabilitiesResponse),
    ]);

    return {
      application: version.application,
      version: version.version,
      apiVersion: version.api_version,
      capabilities: capabilities.capabilities,
    };
  }

  private async get<T>(
    path: string,
    isPayload: (payload: unknown) => payload is T,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.request(`${this.baseUrl}${path}`, {
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new InstanceRepositoryError(
        "The Trax OS API could not be reached.",
      );
    }

    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = readError(payload);
      throw new InstanceRepositoryError(
        error?.message ?? "The Trax OS API returned an error.",
        error?.code,
        error?.request_id,
      );
    }
    if (!isPayload(payload)) {
      throw new InstanceRepositoryError(
        "The Trax OS API returned an invalid response.",
        "invalid_response",
      );
    }
    return payload;
  }
}

function isVersionResponse(payload: unknown): payload is VersionResponse {
  return (
    isRecord(payload) &&
    payload.application === "Trax OS" &&
    typeof payload.version === "string" &&
    /^\d+\.\d+\.\d+$/.test(payload.version) &&
    payload.api_version === "1"
  );
}

function isCapabilitiesResponse(
  payload: unknown,
): payload is CapabilitiesResponse {
  return (
    isRecord(payload) &&
    payload.schema_version === "1" &&
    Array.isArray(payload.capabilities) &&
    payload.capabilities.every(
      (capability) =>
        isRecord(capability) &&
        typeof capability.key === "string" &&
        (capability.status === "available" ||
          capability.status === "unavailable"),
    )
  );
}

function isRecord(payload: unknown): payload is Record<string, unknown> {
  return typeof payload === "object" && payload !== null;
}

function readError(payload: unknown): ErrorResponse["error"] | undefined {
  if (typeof payload !== "object" || payload === null || !("error" in payload))
    return undefined;
  const error = payload.error;
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    typeof error.code !== "string" ||
    !("message" in error) ||
    typeof error.message !== "string" ||
    !("request_id" in error) ||
    typeof error.request_id !== "string"
  ) {
    return undefined;
  }
  return error as ErrorResponse["error"];
}
