import { ApiClientError, TraxApiClient } from "@trax-os/api-client";

import type {
  InstanceInfo,
  InstanceRepository,
} from "../repositories/instance-repository";

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
  constructor(private readonly client = new TraxApiClient()) {}

  async getInstance(): Promise<InstanceInfo> {
    try {
      const [version, capabilities] = await Promise.all([
        this.client.request("version_api_v1_version_get", {}),
        this.client.request("capabilities_api_v1_capabilities_get", {}),
      ]);
      return {
        application: version.application,
        version: version.version,
        apiVersion: version.api_version,
        capabilities: capabilities.capabilities,
      };
    } catch (error) {
      if (error instanceof ApiClientError) {
        const message =
          error.kind === "network"
            ? "The Trax OS API could not be reached."
            : error.kind === "api"
              ? error.message
              : "The Trax OS API returned an invalid response.";
        throw new InstanceRepositoryError(message, error.code, error.requestId);
      }
      throw error;
    }
  }
}
