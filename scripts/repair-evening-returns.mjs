import fs from "node:fs";
import path from "node:path";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  "data-dir": { type: "string" }, trip: { type: "string" }, version: { type: "string" },
  "execution-revision": { type: "string" }, apply: { type: "boolean", default: false }, help: { type: "boolean", default: false },
} });
if (values.help) {
  console.log("预览：node scripts/repair-evening-returns.mjs --data-dir <绝对目录> --trip <ID> --version <当前版本> --execution-revision <当前执行版本>\n应用：在同一命令后添加 --apply。原版本和费用记录保留。");
  process.exit(0);
}
if (!values["data-dir"] || !values.trip || !values.version || values["execution-revision"] === undefined) {
  throw new Error("必须显式提供 --data-dir、--trip、--version 和 --execution-revision；默认仅预览。");
}
if (!path.isAbsolute(values["data-dir"])) throw new Error("必须明确指定实例数据根目录的绝对路径。");
const dataDirectory = path.resolve(values["data-dir"]);
const databasePath = path.join(dataDirectory, "data", "serendipity.db");
if (!fs.statSync(databasePath).isFile()) throw new Error("指定目录中没有现有旅行数据库。");
process.env.SERENDIPITY_DATA_DIR = dataDirectory;

// Same Node 24 source loader as technical-restore: reuse the app's guarded
// service without introducing an HTTP endpoint or a second database write path.
registerHooks({ load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".ts")) return { format: "module", shortCircuit: true,
    source: stripTypeScriptTypes(fs.readFileSync(fileURLToPath(url), "utf8"), { mode: "transform", sourceUrl: url }) };
  // The app's bundler accepts data imports without Node's JSON attributes.
  if (url.startsWith("file:") && url.endsWith(".json")) return { format: "module", shortCircuit: true,
    source: `export default JSON.parse(${JSON.stringify(fs.readFileSync(fileURLToPath(url), "utf8"))});` };
  return nextLoad(url, context);
}, resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const filename = path.resolve(import.meta.dirname, "..", specifier.slice(2));
    specifier = pathToFileURL(path.extname(filename) ? filename : `${filename}.ts`).href;
  }
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && /^\.\.?\//.test(specifier) && !path.extname(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });
const service = await import(pathToFileURL(path.resolve(import.meta.dirname, "../lib/plan-service.ts")).href);
try {
  const result = await service.repairPlanEveningReturns({
    tripId: values.trip, expectedPlanVersion: Number(values.version),
    expectedExecutionRevision: Number(values["execution-revision"]), dryRun: !values.apply,
  });
  console.log(JSON.stringify({ dataDirectory, expectedPlanVersion: Number(values.version), expectedExecutionRevision: Number(values["execution-revision"]), outcome: result.outcome,
    planId: result.plan.id, planVersion: result.plan.versionNumber, addedEvents: result.addedEvents }, null, 2));
} finally {
  await service.closePlanStore();
}
