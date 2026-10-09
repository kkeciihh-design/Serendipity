import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const projectRoot = process.cwd();
const testDataDirectory = path.join(projectRoot, "test-data", "phase04");
const allowedTestRoot = path.join(projectRoot, "test-data");
const testDatabaseDirectory = path.join(testDataDirectory, "data");
const databasePath = path.join(testDataDirectory, "data", "serendipity.db");
const baseUrl = "http://127.0.0.1:3101";
const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const testApiKey = "phase04-integration-key";
const testPassword = "phase04-integration-password";

if (
  path.resolve(testDataDirectory) !== testDataDirectory ||
  !testDataDirectory.startsWith(`${allowedTestRoot}${path.sep}`)
) {
  throw new Error("Refusing to clean an unexpected test data path.");
}

fs.rmSync(testDataDirectory, { recursive: true, force: true });
fs.mkdirSync(testDatabaseDirectory, { recursive: true });

const migrations = [
  "20261008173000_init_trip",
  "20261008210000_add_app_settings",
];
const testDatabase = new DatabaseSync(databasePath);
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

for (const migrationName of migrations) {
  const migrationPath = path.join(
    projectRoot,
    "prisma",
    "migrations",
    migrationName,
    "migration.sql",
  );
  const migrationSql = fs.readFileSync(migrationPath, "utf8");
  const checksum = createHash("sha256").update(migrationSql).digest("hex");
  testDatabase.exec(migrationSql);
  testDatabase
    .prepare(
      `INSERT INTO "_prisma_migrations"
        ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
       VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)`,
    )
    .run(randomUUID(), checksum, Date.now(), migrationName, Date.now());
}
testDatabase.close();

let aiServer;
let aiPort;

function startAIServer() {
  aiServer = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.resume();
    request.on("end", () => {
      const challenge = body.match(/SRD-[a-z0-9]{8}/i)?.[0] ?? "SRD-unknown";
      const authorization = request.headers.authorization ?? "";
      if (authorization !== `Bearer ${testApiKey}`) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Invalid key" } }));
        return;
      }

      if (request.url?.includes("model-missing")) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            error: { message: "The model phase04-model was not found" },
          }),
        );
        return;
      }

      if (request.url?.endsWith("/models")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            data: [{ id: "phase04-model" }],
          }),
        );
        return;
      }

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: challenge } }],
        }),
      );
    });
  });

  return new Promise((resolve) => {
    aiServer.listen(0, "127.0.0.1", () => {
      const address = aiServer.address();
      aiPort = address.port;
      resolve(`http://127.0.0.1:${aiPort}/v1`);
    });
  });
}

function startServer() {
  const child = spawn(process.execPath, [nextCli, "start", "-p", "3101"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      SERENDIPITY_DATA_DIR: testDataDirectory,
    },
    stdio: "inherit",
  });
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

function cookiesFromResponse(response) {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  return setCookies
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function requestJson(path, options = {}, cookies = "", csrfToken = "") {
  const headers = {
    "Content-Type": "application/json",
    ...(cookies ? { Cookie: cookies } : {}),
    ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
    ...options.headers,
  };
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  return { response, payload, text };
}

function csrfFromCookies(cookies) {
  const match = cookies.match(/(?:^|;\s*)serendipity_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

let server;
const result = {
  testDatabase: databasePath,
  unauthenticatedSettingsRejected: false,
  remoteApiWithoutCookieRejected: false,
  remoteApiWithFakeCookieRejected: false,
  remotePageWithFakeCookieRedirected: false,
  remotePlainHttpLoginRejected: false,
  remotePlainHttpLoginStatus: null,
  passwordSetUp: false,
  modelListFetched: false,
  wrongKeyClassified: false,
  modelMissingClassified: false,
  successfulTestReturnedToken: false,
  configurationSaved: false,
  apiKeyNotReturned: false,
  mismatchedSaveRejected: false,
  oldConfigurationPreserved: false,
  promptSaved: false,
  tripUnchangedAfterPromptSave: false,
  restarted: false,
  configurationPersistedAfterRestart: false,
  promptPersistedAfterRestart: false,
  apiKeyEncryptedOnDisk: false,
  passwordHashedOnDisk: false,
  logoutWorked: false,
  loginRateLimitWorks: false,
  loginRateLimitStatuses: [],
};

try {
  const aiBaseUrl = await startAIServer();
  server = startServer();
  await waitForServer();

  const unauthenticated = await requestJson("/api/settings");
  result.unauthenticatedSettingsRejected = unauthenticated.response.status === 401;

  const networkAddress = Object.values(os.networkInterfaces())
    .flat()
    .find((info) => info && info.family === "IPv4" && !info.internal)?.address;
  if (networkAddress) {
    const remoteBaseUrl = `http://${networkAddress}:3101`;
    const remoteApi = await fetch(`${remoteBaseUrl}/api/trips`, {
      redirect: "manual",
    });
    result.remoteApiWithoutCookieRejected = remoteApi.status === 401;

    const remoteApiWithFakeCookie = await fetch(
      `${remoteBaseUrl}/api/trips`,
      {
        redirect: "manual",
        headers: { Cookie: "serendipity_session=fake-token" },
      },
    );
    result.remoteApiWithFakeCookieRejected =
      remoteApiWithFakeCookie.status === 401;

    const remotePageWithFakeCookie = await fetch(`${remoteBaseUrl}/`, {
      redirect: "manual",
      headers: { Cookie: "serendipity_session=fake-token" },
    });
    result.remotePageWithFakeCookieRedirected =
      remotePageWithFakeCookie.status >= 300 &&
      remotePageWithFakeCookie.status < 400 &&
      (remotePageWithFakeCookie.headers.get("location") ?? "").includes(
        "/settings",
      );

    const remotePlainHttpLogin = await fetch(
      `${remoteBaseUrl}/api/settings/session`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong-password" }),
      },
    );
    result.remotePlainHttpLoginStatus = remotePlainHttpLogin.status;
    result.remotePlainHttpLoginRejected = remotePlainHttpLogin.status === 400;
  }

  const passwordResponse = await requestJson("/api/settings/password", {
    method: "POST",
    body: JSON.stringify({
      password: testPassword,
      confirmation: testPassword,
    }),
  });
  const cookies = cookiesFromResponse(passwordResponse.response);
  const csrfToken = csrfFromCookies(cookies);
  result.passwordSetUp =
    passwordResponse.response.status === 200 && Boolean(cookies && csrfToken);

  const modelList = await requestJson(
    "/api/settings/models",
    {
      method: "POST",
      body: JSON.stringify({
        provider: "openai-chat-completions",
        baseUrl: aiBaseUrl,
        apiKey: testApiKey,
      }),
    },
    cookies,
    csrfToken,
  );
  result.modelListFetched =
    modelList.response.status === 200 &&
    modelList.payload?.ok === true &&
    Array.isArray(modelList.payload?.models) &&
    modelList.payload.models.includes("phase04-model");

  const tripResponse = await requestJson("/api/trips", {
    method: "POST",
    body: JSON.stringify({
      originalRequest: "阶段04集成测试：Prompt 保存不能改写这趟旅行。",
    }),
  });
  const tripId = tripResponse.payload?.trip?.id;

  const wrongKey = await requestJson(
    "/api/settings/test",
    {
      method: "POST",
      body: JSON.stringify({
        provider: "openai-chat-completions",
        baseUrl: aiBaseUrl,
        model: "phase04-model",
        apiKey: "wrong-key",
      }),
    },
    cookies,
    csrfToken,
  );
  result.wrongKeyClassified =
    wrongKey.response.status === 200 &&
    wrongKey.payload?.ok === false &&
    wrongKey.payload?.category === "auth";

  const missingModel = await requestJson(
    "/api/settings/test",
    {
      method: "POST",
      body: JSON.stringify({
        provider: "openai-chat-completions",
        baseUrl: `${aiBaseUrl}/model-missing`,
        model: "phase04-model",
        apiKey: testApiKey,
      }),
    },
    cookies,
    csrfToken,
  );
  result.modelMissingClassified =
    missingModel.response.status === 200 &&
    missingModel.payload?.ok === false &&
    missingModel.payload?.category === "model";

  const successfulTest = await requestJson(
    "/api/settings/test",
    {
      method: "POST",
      body: JSON.stringify({
        provider: "openai-chat-completions",
        baseUrl: aiBaseUrl,
        model: "phase04-model",
        apiKey: testApiKey,
      }),
    },
    cookies,
    csrfToken,
  );
  const testToken = successfulTest.payload?.testToken;
  result.successfulTestReturnedToken =
    successfulTest.response.status === 200 &&
    successfulTest.payload?.ok === true &&
    typeof testToken === "string";

  const saveResponse = await requestJson(
    "/api/settings",
    {
      method: "POST",
      body: JSON.stringify({
        provider: "openai-chat-completions",
        baseUrl: aiBaseUrl,
        model: "phase04-model",
        apiKey: testApiKey,
        testToken,
      }),
    },
    cookies,
    csrfToken,
  );
  result.configurationSaved =
    saveResponse.response.status === 200 &&
    saveResponse.payload?.ai?.keyConfigured === true;
  result.apiKeyNotReturned =
    saveResponse.text.includes(testApiKey) === false;

  const mismatchedSave = await requestJson(
    "/api/settings",
    {
      method: "POST",
      body: JSON.stringify({
        provider: "openai-chat-completions",
        baseUrl: aiBaseUrl,
        model: "different-model",
        apiKey: testApiKey,
        testToken,
      }),
    },
    cookies,
    csrfToken,
  );
  result.mismatchedSaveRejected = mismatchedSave.response.status === 400;

  const preservedSettings = await requestJson(
    "/api/settings",
    {},
    cookies,
    csrfToken,
  );
  result.oldConfigurationPreserved =
    preservedSettings.response.status === 200 &&
    preservedSettings.payload?.ai?.model === "phase04-model" &&
    preservedSettings.payload?.ai?.connectionStatus === "connected" &&
    preservedSettings.text.includes(testApiKey) === false;

  const promptSave = await requestJson(
    "/api/settings/prompt",
    {
      method: "PATCH",
      body: JSON.stringify({
        basePrompt: "阶段04测试基础 Prompt",
        systemPrompt: "阶段04测试系统 Prompt",
      }),
    },
    cookies,
    csrfToken,
  );
  result.promptSaved =
    promptSave.response.status === 200 &&
    promptSave.payload?.prompts?.version === 2;

  const unchangedTrip = await requestJson(`/api/trips/${tripId}`);
  result.tripUnchangedAfterPromptSave =
    unchangedTrip.response.status === 200 &&
    unchangedTrip.payload?.trip?.originalRequest ===
      "阶段04集成测试：Prompt 保存不能改写这趟旅行。";

  await stopServer(server);
  server = startServer();
  await waitForServer();
  result.restarted = true;

  const settingsAfterRestart = await requestJson(
    "/api/settings",
    {},
    cookies,
    csrfToken,
  );
  result.configurationPersistedAfterRestart =
    settingsAfterRestart.response.status === 200 &&
    settingsAfterRestart.payload?.ai?.model === "phase04-model" &&
    settingsAfterRestart.payload?.ai?.connectionStatus === "connected";
  result.promptPersistedAfterRestart =
    settingsAfterRestart.payload?.prompts?.basePrompt ===
      "阶段04测试基础 Prompt";

  const database = new DatabaseSync(databasePath);
  const settingsRow = database
    .prepare("SELECT * FROM AppSettings WHERE id = 'singleton'")
    .get();
  const tripRow = database
    .prepare("SELECT originalRequest FROM Trip WHERE id = ?")
    .get(tripId);
  database.close();
  result.apiKeyEncryptedOnDisk =
    typeof settingsRow?.apiKeyCiphertext === "string" &&
    settingsRow.apiKeyCiphertext !== testApiKey &&
    !settingsRow.apiKeyCiphertext.includes(testApiKey);
  result.passwordHashedOnDisk =
    typeof settingsRow?.passwordHash === "string" &&
    typeof settingsRow?.passwordSalt === "string" &&
    settingsRow.passwordHash !== testPassword;
  result.tripUnchangedAfterPromptSave =
    result.tripUnchangedAfterPromptSave &&
    tripRow?.originalRequest ===
      "阶段04集成测试：Prompt 保存不能改写这趟旅行。";

  const logout = await requestJson(
    "/api/settings/session",
    { method: "DELETE" },
    cookies,
    csrfToken,
  );
  const afterLogout = await fetch(`${baseUrl}/api/settings`);
  result.logoutWorked =
    logout.response.status === 200 && afterLogout.status === 401;

  let rateLimitRejected = false;
  const rateLimitStatuses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const attemptResponse = await requestJson("/api/settings/session", {
      method: "POST",
      body: JSON.stringify({ password: `wrong-password-${attempt}` }),
    });
    if (attempt === 5) {
      rateLimitRejected = attemptResponse.response.status === 429;
    }
    rateLimitStatuses.push(attemptResponse.response.status);
  }
  result.loginRateLimitStatuses = rateLimitStatuses;
  result.loginRateLimitWorks = rateLimitRejected;
} finally {
  await stopServer(server);
  await new Promise((resolve) => {
    if (!aiServer) {
      resolve();
      return;
    }
    aiServer.close(() => resolve());
  });
  if (fs.existsSync(databasePath)) {
    fs.chmodSync(databasePath, 0o666);
  }
}

const evidencePath = path.join(
  projectRoot,
  "docs",
  "阶段验收",
  "证据",
  "阶段-04-persistence.json",
);
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`);

console.log(JSON.stringify(result, null, 2));

const allPassed = Object.entries(result)
  .filter(
    ([key]) =>
      key !== "testDatabase" &&
      !key.endsWith("Status") &&
      !key.endsWith("Statuses"),
  )
  .every(([, value]) => value === true);

if (!allPassed) {
  process.exit(1);
}
