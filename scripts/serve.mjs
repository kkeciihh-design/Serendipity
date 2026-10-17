import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { resumeInterruptedRestore } from "./restore-core.mjs";

// Keep listener selection and the anonymous-local policy in the same launcher.
// Never pass unchecked CLI arguments that could override the chosen hostname.
const [mode, ...args] = process.argv.slice(2);
if (mode !== "dev" && mode !== "start") throw new Error("Expected dev or start.");
let port = process.env.PORT ?? "3000";
let host = process.env.SERENDIPITY_HOST ?? "127.0.0.1";
for (let i = 0; i < args.length; i += 2) {
  if (args[i] === "-p" || args[i] === "--port") port = args[i + 1];
  else if (args[i] === "-H" || args[i] === "--hostname") host = args[i + 1];
  else throw new Error("Unsupported server option.");
}
if (!host || !/^\d+$/.test(port ?? "") || Number(port) < 1 || Number(port) > 65535) {
  throw new Error("Invalid listener configuration.");
}
const env = { ...process.env };
const root = env.SERENDIPITY_DATA_DIR ?? path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "Serendipity");
resumeInterruptedRestore(path.resolve(root, "data", "serendipity.db"));
delete env.SERENDIPITY_LOCAL_PORT;
if ((host === "127.0.0.1" || host === "::1") && !env.SERENDIPITY_PUBLIC_ORIGIN && !env.SERENDIPITY_TRUST_PROXY) {
  env.SERENDIPITY_LOCAL_PORT = port;
}
const server = spawn(process.execPath, [
  path.resolve("node_modules/next/dist/bin/next"), mode, "--hostname", host, "--port", port,
], { env, stdio: "inherit", windowsHide: true });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code) => process.exit(code ?? 1));
server.on("error", () => process.exit(1));
