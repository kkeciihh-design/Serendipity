import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const projectRoot = process.cwd();
const testDataDirectory = path.join(projectRoot, "test-data", "phase03");
const allowedTestRoot = path.join(projectRoot, "test-data");
const testDatabaseDirectory = path.join(testDataDirectory, "data");
const databasePath = path.join(testDataDirectory, "data", "serendipity.db");
const baseUrl = "http://127.0.0.1:3101";
const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");

if (
  path.resolve(testDataDirectory) !== testDataDirectory ||
  !testDataDirectory.startsWith(`${allowedTestRoot}${path.sep}`)
) {
  throw new Error("Refusing to clean an unexpected test data path.");
}

fs.mkdirSync(testDatabaseDirectory, { recursive: true });
for (const entry of fs.readdirSync(testDatabaseDirectory)) {
  const entryPath = path.join(testDatabaseDirectory, entry);
  if (fs.statSync(entryPath).isFile()) {
    fs.chmodSync(entryPath, 0o666);
  }
  fs.rmSync(entryPath, { recursive: true, force: true });
}

const migrationPath = path.join(
  projectRoot,
  "prisma",
  "migrations",
  "20261008173000_init_trip",
  "migration.sql",
);
const migrationSql = fs.readFileSync(migrationPath, "utf8");
const migrationChecksum = createHash("sha256").update(migrationSql).digest("hex");
const testDatabase = new DatabaseSync(databasePath);
testDatabase.exec(migrationSql);
testDatabase.exec(`
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id"                    TEXT PRIMARY KEY NOT NULL,
      "checksum"              TEXT NOT NULL,
      "finished_at"           DATETIME,
      "migration_name"        TEXT NOT NULL,
      "logs"                  TEXT,
      "rolled_back_at"        DATETIME,
      "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
  );
`);
testDatabase
  .prepare(
    `INSERT INTO "_prisma_migrations"
      ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
     VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)`,
  )
  .run(
    randomUUID(),
    migrationChecksum,
    Date.now(),
    "20261008173000_init_trip",
    Date.now(),
  );
testDatabase.close();

function startServer() {
  const child = spawn(
    process.execPath,
    [nextCli, "start", "-p", "3101"],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        SERENDIPITY_DATA_DIR: testDataDirectory,
      },
      stdio: "inherit",
    },
  );

  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill();
  await new Promise((resolve) => {
    child.once("exit", resolve);
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/trips`);
      if (response.ok) {
        return;
      }
    } catch {
      // The server is still binding to the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Test server did not become ready.");
}

async function readJson(response) {
  return response.json();
}

async function createTrip(text) {
  const response = await fetch(`${baseUrl}/api/trips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ originalRequest: text }),
  });

  if (response.status !== 201) {
    throw new Error(`Create returned HTTP ${response.status}.`);
  }

  const payload = await readJson(response);
  return payload.trip;
}

async function getTrip(id) {
  const response = await fetch(`${baseUrl}/api/trips/${id}`);
  return {
    status: response.status,
    payload: await readJson(response),
  };
}

const firstText = `第一趟测试旅行：杭州两日
预算 1500 元，想看西湖和老街。`;
const secondText = `第二趟测试旅行：成都三日
想安排美食和都江堰。`;

let server;
const result = {
  testDatabase: databasePath,
  started: false,
  restarted: false,
  firstTripCreated: false,
  secondTripCreated: false,
  firstTripUpdated: false,
  firstTripPersistedAfterRestart: false,
  secondTripUnchanged: false,
  firstTripDeleted: false,
  secondTripSurvivedDelete: false,
  writeFailureRejected: false,
  writeFailureDidNotCreateTrip: false,
};

try {
  server = startServer();
  await waitForServer();
  result.started = true;

  const firstTrip = await createTrip(firstText);
  const secondTrip = await createTrip(secondText);
  result.firstTripCreated =
    firstTrip.originalRequest === firstText &&
    firstTrip.title.includes("第一趟测试旅行");
  result.secondTripCreated = secondTrip.originalRequest === secondText;

  const updateResponse = await fetch(`${baseUrl}/api/trips/${firstTrip.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "杭州两日修改版",
      originalRequest: `${firstText}\n追加：第二天下午返程。`,
    }),
  });
  const updatedTrip = (await readJson(updateResponse)).trip;
  result.firstTripUpdated =
    updateResponse.status === 200 &&
    updatedTrip.title === "杭州两日修改版" &&
    updatedTrip.originalRequest === `${firstText}\n追加：第二天下午返程。`;

  await stopServer(server);
  server = startServer();
  await waitForServer();
  result.restarted = true;

  const persistedFirst = await getTrip(firstTrip.id);
  const persistedSecond = await getTrip(secondTrip.id);
  result.firstTripPersistedAfterRestart =
    persistedFirst.status === 200 &&
    persistedFirst.payload.trip.originalRequest ===
      `${firstText}\n追加：第二天下午返程。`;
  result.secondTripUnchanged =
    persistedSecond.status === 200 &&
    persistedSecond.payload.trip.originalRequest === secondText;

  const deleteResponse = await fetch(
    `${baseUrl}/api/trips/${firstTrip.id}`,
    { method: "DELETE" },
  );
  result.firstTripDeleted = deleteResponse.status === 200;

  const firstAfterDelete = await getTrip(firstTrip.id);
  const secondAfterDelete = await getTrip(secondTrip.id);
  result.secondTripSurvivedDelete =
    firstAfterDelete.status === 404 &&
    secondAfterDelete.status === 200 &&
    secondAfterDelete.payload.trip.originalRequest === secondText;

  await stopServer(server);
  server = null;

  fs.chmodSync(databasePath, 0o444);
  server = startServer();
  await waitForServer();

  const failedCreateResponse = await fetch(`${baseUrl}/api/trips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      originalRequest: "这趟写入失败测试不应该被保存。",
    }),
  });
  result.writeFailureRejected = failedCreateResponse.status >= 500;

  await stopServer(server);
  server = null;
  fs.chmodSync(databasePath, 0o666);

  server = startServer();
  await waitForServer();
  const listAfterFailure = await readJson(await fetch(`${baseUrl}/api/trips`));
  result.writeFailureDidNotCreateTrip = listAfterFailure.trips.every(
    (trip) => trip.originalRequest !== "这趟写入失败测试不应该被保存。",
  );
} finally {
  await stopServer(server);
  if (fs.existsSync(databasePath)) {
    fs.chmodSync(databasePath, 0o666);
  }
}

const evidencePath = path.join(
  projectRoot,
  "docs",
  "阶段验收",
  "证据",
  "阶段-03-persistence.json",
);
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`);

console.log(JSON.stringify(result, null, 2));

const allPassed = Object.entries(result)
  .filter(([key]) => key !== "testDatabase")
  .every(([, value]) => value === true);

if (!allPassed) {
  process.exit(1);
}
