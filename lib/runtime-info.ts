import { getDataDirectory, getDatabasePath } from "./data-directory";
import { readInstanceState } from "@/scripts/restore-core.mjs";

export function getRuntimeInfo() {
  const state = readInstanceState(getDatabasePath());
  return {
    status: state.activeRestoreId ? "restore-paused" : "ready",
    restoreActive: Boolean(state.activeRestoreId),
    managed: Boolean(process.env.SERENDIPITY_INSTANCE_ID),
    instanceId: process.env.SERENDIPITY_INSTANCE_ID ?? null,
    pid: process.pid,
    startedAt: process.env.SERENDIPITY_STARTED_AT ?? null,
    buildDirectory: process.env.SERENDIPITY_BUILD_DIR ?? ".next",
    dataDirectory: getDataDirectory(),
    databasePath: getDatabasePath(),
    localOnly: Boolean(process.env.SERENDIPITY_LOCAL_PORT),
    port: process.env.SERENDIPITY_LOCAL_PORT ?? null,
  };
}
