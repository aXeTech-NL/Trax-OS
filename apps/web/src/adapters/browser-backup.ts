import type { JourneyData } from "../features/journeys/domain";
import { createLocalBackup } from "../features/journeys/backup";

export function downloadLocalBackup(data: JourneyData): void {
  const timestamp = new Date().toISOString();
  const blob = new Blob([createLocalBackup(data, timestamp)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `trax-os-backup-${timestamp.slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
