import assert from "node:assert/strict";
import { payloadByResourceId } from "./fixtures.js";

export interface ReplicaResource {
  id: string;
  payload: string;
}

export function assertAuthorizedReplica(
  principal: string,
  rows: readonly ReplicaResource[],
  expectedIds: readonly string[],
): void {
  const actualIds = rows.map((row) => row.id).sort();
  const sortedExpected = [...expectedIds].sort();
  assert.deepEqual(
    actualIds,
    sortedExpected,
    `${principal} SQLite row IDs differ from server-derived scope`,
  );

  const duplicateIds = actualIds.filter(
    (id, index) => index > 0 && id === actualIds[index - 1],
  );
  assert.deepEqual(
    duplicateIds,
    [],
    `${principal} SQLite contains duplicate resource IDs`,
  );

  const actualById = new Map(rows.map((row) => [row.id, row.payload]));
  for (const expectedId of expectedIds) {
    assert.equal(
      actualById.get(expectedId),
      payloadByResourceId[expectedId],
      `${principal} SQLite payload marker does not match resource ${expectedId}`,
    );
  }
}

export async function withTimeout<T>(
  description: string,
  operation: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${description} timed out after ${timeoutMs} ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function pollUntil<T>(
  description: string,
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs: number,
  intervalMs = 100,
): Promise<T> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let last: T | undefined;
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(
        `Timed out after ${timeoutMs} ms waiting for ${description}: ${JSON.stringify(last)}`,
      );
    }
    last = await withTimeout(`${description} read`, read, remaining);
    if (Date.now() <= deadline && accept(last)) return last;
    const sleepMs = Math.min(intervalMs, deadline - Date.now());
    if (sleepMs <= 0) continue;
    await new Promise<void>((resolve) => setTimeout(resolve, sleepMs));
  }
}
