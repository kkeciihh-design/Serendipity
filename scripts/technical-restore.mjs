import fs from "node:fs";
import path from "node:path";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { previewRestore, restoreTravelBackup, resumeInterruptedRestore, readTravelBackup } from "./restore-core.mjs";
import { fileHash, MAX_BACKUP_BYTES } from "./travel-backup-format.mjs";

// Node 24 strips types; this source-only CLI resolves the same pure validators
// used by the app without a second schema implementation or extra dependency.
registerHooks({ load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".ts")) return { format: "module", shortCircuit: true, source: stripTypeScriptTypes(fs.readFileSync(fileURLToPath(url), "utf8"), { mode: "transform", sourceUrl: url }) };
  return nextLoad(url, context);
}, resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && /^\.\.?\//.test(specifier) && !path.extname(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });
const { validateTravelBackup } = await import(pathToFileURL(path.resolve(import.meta.dirname, "../lib/backup-validation.ts")).href);
const [directory, filename, option, token] = process.argv.slice(2);
if (!directory || !path.isAbsolute(directory)) throw new Error("必须明确指定实例数据根目录的绝对路径。");
const database = path.join(directory, "data", "serendipity.db");
if (!fs.existsSync(database)) throw new Error("目标数据库不存在；请先正常初始化独立实例。");
if (filename === "--resume") {
  resumeInterruptedRestore(database);
  console.log("未完成恢复已检查，普通重启不会更换数据代际。");
} else {
  if (!filename || !path.isAbsolute(filename) || ![undefined, "--confirm"].includes(option)) throw new Error("需要旅行JSON或技术SQLite备份的绝对路径；首次运行只预览。");
  const isDatabase = path.extname(filename).toLowerCase() === ".db";
  if (!isDatabase && fs.statSync(filename).size > MAX_BACKUP_BYTES) throw new Error("备份超过64 MiB上限。");
  // A historical SQLite backup is opened only to extract travel tables. Never
  // copy its admin settings, engine metadata, migration table or generation.
  const backup = validateTravelBackup(isDatabase ? readTravelBackup(filename) : fs.readFileSync(filename, "utf8"));
  const preview = previewRestore(database, backup);
  const digest = fileHash(JSON.stringify({ database: path.resolve(database), ...preview, incoming: { ...preview.incoming, createdAt: null }, current: { ...preview.current, createdAt: null } }));
  if (option !== "--confirm") console.log(JSON.stringify({ ...preview, target: database, confirmation: digest, impact: "替换全部旅行，清除旧候选与导出缓存，保留当前管理员和服务配置。先建立屏障并验证安全副本，失败保护/回退后也持久换代。" }, null, 2));
  else {
    if (token !== digest) throw new Error("确认摘要与当前数据/备份不符，请重新预览。");
    console.log(JSON.stringify(await restoreTravelBackup(database, backup, { ...preview, source: "technical" }), null, 2));
  }
}
