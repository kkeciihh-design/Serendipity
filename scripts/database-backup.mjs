import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function backupBeforeMigration(databasePath, migrationDirectory) {
  if (!fs.existsSync(databasePath)) return null;
  const source = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const migrationNames = fs.readdirSync(migrationDirectory, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name);
    let applied = [];
    try { applied = source.prepare('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL').all().map((item) => item.migration_name); } catch { /* Pre-migration database. */ }
    if (migrationNames.every((name) => applied.includes(name))) return null;
    if (Object.values(source.prepare("PRAGMA integrity_check").get())[0] !== "ok") throw new Error("数据库完整性检查失败，迁移已停止。");
    const backupDirectory = path.resolve(path.dirname(databasePath), "..", "backups");
    fs.mkdirSync(backupDirectory, { recursive: true });
    const backupPath = path.join(backupDirectory, `before-migration-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
    // SQLite produces a consistent snapshot, including committed WAL contents.
    source.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
    const backup = new DatabaseSync(backupPath, { readOnly: true });
    try {
      if (Object.values(backup.prepare("PRAGMA integrity_check").get())[0] !== "ok") throw new Error("备份完整性检查失败，迁移已停止。");
      backup.prepare('SELECT count(*) AS count FROM "Trip"').get();
    } finally { backup.close(); }
    console.log(`迁移前一致性备份已验证：${backupPath}`);
    return backupPath;
  } finally { source.close(); }
}
