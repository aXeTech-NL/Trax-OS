import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  type AbstractPowerSyncDatabase,
  column,
  PowerSyncDatabase,
  type PowerSyncBackendConnector,
  Schema,
  Table,
} from "@powersync/node";
import type { ReplicaResource } from "./assertions.js";

const resources = new Table({
  workspace_id: column.text,
  journey_id: column.text,
  audience: column.text,
  party_id: column.text,
  payload: column.text,
  version: column.integer,
});

const spikeSchema = new Schema({ resources });

class ReadOnlyConnector implements PowerSyncBackendConnector {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
  ) {}

  async fetchCredentials() {
    return { endpoint: this.endpoint, token: this.token };
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const batch = await database.getCrudBatch();
    if (batch) {
      throw new Error(
        "Issue #8 first slice is read-only; upload tests belong to a later milestone.",
      );
    }
  }
}

export interface InitialSyncDatabase {
  waitForFirstSync(options: { signal: AbortSignal }): Promise<void>;
  readonly currentStatus: { readonly hasSynced: boolean | undefined };
}

export async function waitForInitialSync(
  database: InitialSyncDatabase,
  timeoutMs: number,
): Promise<void> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(
        new Error(`Initial PowerSync checkpoint timed out after ${timeoutMs} ms.`),
      );
      controller.abort();
    }, timeoutMs);
  });
  try {
    await Promise.race([
      database.waitForFirstSync({ signal: controller.signal }),
      deadline,
    ]);
    if (!database.currentStatus.hasSynced) {
      throw new Error(
        "PowerSync waitForFirstSync returned without a completed checkpoint.",
      );
    }
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function closeDatabase(database: PowerSyncDatabase): Promise<void> {
  const failures: unknown[] = [];
  try {
    await database.disconnect();
  } catch (error) {
    failures.push(error);
  }
  try {
    await database.close();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "PowerSync client cleanup failed.");
  }
}

export interface SpikeClient {
  database: PowerSyncDatabase;
  filename: string;
  readResources(): Promise<ReplicaResource[]>;
  close(): Promise<void>;
}

export async function openSpikeClient(options: {
  name: string;
  runtimeDirectory: string;
  endpoint: string;
  token: string;
  forgedConnectionParams?: Record<string, string>;
  firstSyncTimeoutMs?: number;
}): Promise<SpikeClient> {
  await mkdir(options.runtimeDirectory, { recursive: true });
  const filename = `${options.name}.db`;
  const database = new PowerSyncDatabase({
    schema: spikeSchema,
    database: {
      dbFilename: filename,
      dbLocation: options.runtimeDirectory,
    },
  });

  try {
    await database.connect(
      new ReadOnlyConnector(options.endpoint, options.token),
      {
        params: options.forgedConnectionParams,
        retryDelayMs: 100,
      },
    );
    await waitForInitialSync(
      database,
      options.firstSyncTimeoutMs ?? 30_000,
    );
  } catch (error) {
    try {
      await closeDatabase(database);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Opening PowerSync client ${options.name} and cleanup both failed.`,
      );
    }
    throw error;
  }

  return {
    database,
    filename: path.join(options.runtimeDirectory, filename),
    async readResources() {
      return database.getAll<ReplicaResource>(
        "SELECT id, payload FROM resources ORDER BY id",
      );
    },
    async close() {
      await closeDatabase(database);
    },
  };
}
