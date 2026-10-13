import { spawn } from "node:child_process";
import path from "node:path";
import { assertSafeTestWorkspace } from "./verification-safety.mjs";

assertSafeTestWorkspace();
// Every current database suite selects its own guarded test directory. Drop
// inherited application configuration so an accidental import cannot use it.
const env = { ...process.env };
env.SERENDIPITY_DATA_DIR = path.resolve("test-data", "unconfigured-test-store");
env.DATABASE_URL = `file:${path.resolve("test-data", "unconfigured-test-store", "data", "serendipity.db").replaceAll("\\", "/")}`;
delete env.SERENDIPITY_PUBLIC_ORIGIN;
delete env.SERENDIPITY_TRUST_PROXY;
delete env.SERENDIPITY_LOCAL_PORT;
const child = spawn(process.execPath, [path.resolve("node_modules/vitest/vitest.mjs"), "run", ...process.argv.slice(2)], {
  env, stdio: "inherit", windowsHide: true,
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
