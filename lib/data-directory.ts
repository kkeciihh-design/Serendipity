import os from "node:os";
import path from "node:path";

export function getDataDirectory() {
  if (process.env.SERENDIPITY_DATA_DIR) {
    return path.resolve(process.env.SERENDIPITY_DATA_DIR);
  }

  return path.join(
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
    "Serendipity",
  );
}

export function getDatabasePath() {
  return path.join(getDataDirectory(), "data", "serendipity.db");
}

export function getDatabaseUrl() {
  return `file:${getDatabasePath().replaceAll("\\", "/")}`;
}
