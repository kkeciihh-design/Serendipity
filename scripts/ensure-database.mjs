import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = process.cwd();
const dataDirectory = process.env.SERENDIPITY_DATA_DIR
  ? path.resolve(process.env.SERENDIPITY_DATA_DIR)
  : path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
      "Serendipity",
    );
const databaseDirectory = path.join(dataDirectory, "data");
const databasePath = path.join(databaseDirectory, "serendipity.db");
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
const prismaCli = path.join(projectRoot, "node_modules", "prisma", "build", "index.js");

fs.mkdirSync(databaseDirectory, { recursive: true });

let migration;

for (let attempt = 1; attempt <= 5; attempt += 1) {
  migration = spawnSync(
    process.execPath,
    [prismaCli, "migrate", "deploy"],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        RUST_LOG: process.env.RUST_LOG ?? "info",
      },
      stdio: "inherit",
    },
  );

  if (!migration.error && migration.status === 0) {
    break;
  }

  if (attempt < 5) {
    console.warn(`数据库迁移第 ${attempt} 次尝试失败，正在重试...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

if (migration.error || migration.status !== 0) {
  console.error("数据库初始化失败：迁移未完成。");
  process.exit(migration.status ?? 1);
}

console.log(`Serendipity 数据库已就绪：${databasePath}`);
