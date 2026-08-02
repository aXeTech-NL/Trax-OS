import type { components } from "@trax-os/api-contract";

type CapabilityContract = components["schemas"]["Capability"];

export interface InstanceInfo {
  readonly application: string;
  readonly version: string;
  readonly apiVersion: string;
  readonly capabilities: readonly CapabilityContract[];
}

export interface InstanceRepository {
  getInstance(): Promise<InstanceInfo>;
}
