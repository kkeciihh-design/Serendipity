import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { assertTestDataTree } from "./test-data-safety.mjs";

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || !["-p", "--port"].includes(args[0]) || !/^\d+$/.test(args[1]) || Number(args[1]) < 1 || Number(args[1]) > 65535)) {
  throw new Error("Test server accepts only an optional --port between 1 and 65535.");
}
const directory = assertTestDataTree(path.resolve(process.env.SERENDIPITY_DATA_DIR ?? "test-data/e2e"));
const env = { ...process.env, SERENDIPITY_DATA_DIR: directory, SERENDIPITY_HOST: "127.0.0.1" };
delete env.SERENDIPITY_PUBLIC_ORIGIN;
delete env.SERENDIPITY_TRUST_PROXY;
delete env.SERENDIPITY_LOCAL_PORT;
const migrated = spawnSync(process.execPath, [path.resolve("scripts/ensure-database.mjs")], {
  env, stdio: "inherit", windowsHide: true,
});
if (migrated.error || migrated.status !== 0) process.exit(migrated.status ?? 1);
const child = spawn(process.execPath, [path.resolve("scripts/serve.mjs"), "start", "-p", args[1] ?? "3100"], {
  env, stdio: "inherit", windowsHide: true,
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
