export interface CapabilityInfo {
  readonly key: string;
  readonly status: "available" | "unavailable";
}

export interface InstanceInfo {
  readonly application: string;
  readonly version: string;
  readonly apiVersion: string;
  readonly capabilities: readonly CapabilityInfo[];
}

export interface InstanceRepository {
  getInstance(): Promise<InstanceInfo>;
}
