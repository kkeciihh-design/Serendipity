import http from "node:http";
import { type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isolatedDatabase } from "./helpers/test-database";

type Handler = (request: Request, context: { params: Promise<{ id: string; versionNumber: string }> }) => Promise<Response>;
let server: http.Server;
let origin: string;
let port: string;
let database: ReturnType<typeof isolatedDatabase>;
let trips: typeof import("../lib/trips");
let security: typeof import("../lib/security");
const routes = new Map<string, Handler>();
const writes = [
  ["POST", "/api/trips"], ["PATCH", "/api/trips/target"], ["DELETE", "/api/trips/target"],
  ["PATCH", "/api/trips/target/request"], ["POST", "/api/trips/target/request/confirm"],
  ["POST", "/api/trips/target/request/extract"], ["POST", "/api/trips/target/plans/generate"],
  ["PATCH", "/api/trips/target/plans/1"], ["POST", "/api/trips/target/plans/1/evidence"],
];

beforeAll(async () => {
  database = isolatedDatabase("phase10r-http");
  trips = await import("../lib/trips");
  security = await import("../lib/security");
  const modules = [
    ["/api/trips", await import("../app/api/trips/route")],
    ["/api/trips/target", await import("../app/api/trips/[id]/route")],
    ["/api/trips/target/request", await import("../app/api/trips/[id]/request/route")],
    ["/api/trips/target/request/confirm", await import("../app/api/trips/[id]/request/confirm/route")],
    ["/api/trips/target/request/extract", await import("../app/api/trips/[id]/request/extract/route")],
    ["/api/trips/target/plans/generate", await import("../app/api/trips/[id]/plans/generate/route")],
    ["/api/trips/target/plans/1", await import("../app/api/trips/[id]/plans/[versionNumber]/route")],
    ["/api/trips/target/plans/1/evidence", await import("../app/api/trips/[id]/plans/[versionNumber]/evidence/route")],
    ["/api/settings", await import("../app/api/settings/route")],
    ["/api/settings/session", await import("../app/api/settings/session/route")],
    ["/api/settings/password", await import("../app/api/settings/password/route")],
    ["/api/settings/models", await import("../app/api/settings/models/route")],
    ["/api/settings/test", await import("../app/api/settings/test/route")],
    ["/api/settings/prompt", await import("../app/api/settings/prompt/route")],
    ["/api/settings/search", await import("../app/api/settings/search/route")],
    ["/api/settings/search/test", await import("../app/api/settings/search/test/route")],
  ] as const;
  for (const [pathname, module] of modules) {
    for (const [method, handler] of Object.entries(module)) {
      if (["GET", "POST", "PATCH", "DELETE"].includes(method)) routes.set(`${method} ${pathname}`, handler as Handler);
    }
  }
  server = http.createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join("; ") : value);
    }
    const request = new Request(`${origin}${incoming.url}`, {
      method: incoming.method, headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const result = await routes.get(`${incoming.method} ${incoming.url}`)!(request, {
      params: Promise.resolve({ id: "target", versionNumber: "1" }),
    });
    outgoing.writeHead(result.status, Object.fromEntries(result.headers));
    outgoing.end(await result.text());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = String((server.address() as AddressInfo).port);
  origin = `http://127.0.0.1:${port}`;
  process.env.SERENDIPITY_LOCAL_PORT = port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await trips.closeTripStore();
  await (await import("../lib/trip-request-service")).closeTripRequestStore();
  await (await import("../lib/plan-service")).closePlanStore();
  await (await import("../lib/evidence-service")).closeEvidenceStore();
  await (await import("../lib/settings")).closeSettingsStore();
  database.cleanup();
  delete process.env.SERENDIPITY_LOCAL_PORT;
  delete process.env.SERENDIPITY_PUBLIC_ORIGIN;
  delete process.env.SERENDIPITY_TRUST_PROXY;
});

async function send(method: string, pathname: string, headers: Record<string, string | undefined> = {}, body = "{}") {
  const { readInstanceState } = await import("../scripts/restore-core.mjs");
  const { getDatabasePath } = await import("../lib/data-directory");
  // node:http permits a deliberately forged Host; undici/fetch may rewrite it.
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(`${origin}${pathname}`, {
      method, headers: {
        "Content-Type": "application/json",
        "x-data-generation": readInstanceState(getDatabasePath()).dataGeneration,
        ...(method === "GET" ? {} : { "Content-Length": String(Buffer.byteLength(body)) }),
        ...headers,
      },
    }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, body: text }));
    });
    req.on("error", reject);
    req.end(method === "GET" ? undefined : body);
  });
}

describe("HTTP access and mutation boundary", () => {
  it("rejects forged localhost and forwarding headers without a loopback-only deployment", async () => {
    delete process.env.SERENDIPITY_LOCAL_PORT;
    try {
      const response = await send("POST", "/api/trips", {
        Host: `localhost:${port}`, Origin: `http://localhost:${port}`,
        "X-Forwarded-Host": `localhost:${port}`, "X-Forwarded-Proto": "https", "X-Forwarded-For": "127.0.0.1",
      }, '{"originalRequest":"forged host must not write"}');
      expect(response.status).toBe(401);
      expect((await send("GET", "/api/trips", { Host: `localhost:${port}` })).status).toBe(401);
    } finally { process.env.SERENDIPITY_LOCAL_PORT = port; }
  });

  it("requires authenticated remote access and an explicitly configured HTTPS origin", async () => {
    delete process.env.SERENDIPITY_LOCAL_PORT;
    process.env.SERENDIPITY_PUBLIC_ORIGIN = "https://travel.example.com";
    process.env.SERENDIPITY_TRUST_PROXY = "1";
    try {
      const headers = { Host: "travel.example.com", Origin: "https://travel.example.com", "X-Forwarded-Proto": "https" };
      expect((await send("GET", "/api/trips", headers)).status).toBe(401);
      const session = security.createSessionToken(60_000);
      expect((await send("GET", "/api/trips", { ...headers, Cookie: `serendipity_session=${session}` })).status).toBe(200);
      expect((await send("GET", "/api/trips", { ...headers, Cookie: "serendipity_session=forged" })).status).toBe(401);
      const created = await send("POST", "/api/trips", { ...headers, Cookie: `serendipity_session=${session}` },
        '{"originalRequest":"authenticated remote same-origin test"}');
      expect(created.status).toBe(201);
      await trips.deleteTrip(JSON.parse(created.body).trip.id);
    } finally {
      process.env.SERENDIPITY_LOCAL_PORT = port;
      delete process.env.SERENDIPITY_PUBLIC_ORIGIN;
      delete process.env.SERENDIPITY_TRUST_PROXY;
    }
  });

  it("disables anonymous local mode behind a configured remote proxy and rejects untrusted TLS headers", async () => {
    process.env.SERENDIPITY_PUBLIC_ORIGIN = "https://travel.example.com";
    try {
      const cookie = `serendipity_session=${security.createSessionToken(60_000)}`;
      expect((await send("GET", "/api/trips", { Host: "travel.example.com", "X-Forwarded-Proto": "https", Cookie: cookie })).status).toBe(401);
      process.env.SERENDIPITY_TRUST_PROXY = "1";
      expect((await send("GET", "/api/trips", { Host: `localhost:${port}`, "X-Forwarded-Proto": "https" })).status).toBe(401);
      expect((await send("POST", "/api/trips", { Host: `localhost:${port}`, Origin: `http://localhost:${port}` })).status).toBe(401);
    } finally {
      delete process.env.SERENDIPITY_PUBLIC_ORIGIN;
      delete process.env.SERENDIPITY_TRUST_PROXY;
    }
  });

  it("rejects missing, cross-site and malformed origins on every trip mutation", async () => {
    for (const [method, pathname] of writes) {
      for (const headers of [
        {}, { Origin: "https://evil.example" }, { Origin: "null" },
        { Origin: `${origin}/path` }, { Origin: origin, "Sec-Fetch-Site": "cross-site" },
        { Origin: "https://evil.example", "X-Forwarded-Host": "evil.example" },
      ]) {
        expect((await send(method, pathname, headers)).status, `${method} ${pathname}`).toBe(403);
      }
    }
    expect(await trips.listTrips()).toHaveLength(0);
  });

  it("rejects cross-site text/plain writes and same-origin simple content types", async () => {
    for (const source of [origin, "https://evil.example"]) {
      expect((await send("POST", "/api/trips", { Origin: source, "Content-Type": "text/plain" },
        '{"originalRequest":"must not be saved"}')).status).toBe(403);
    }
    expect(await trips.listTrips()).toHaveLength(0);
  });

  it("keeps normal anonymous local same-origin creation and reading available", async () => {
    const result = await send("POST", "/api/trips", { Origin: origin, "Sec-Fetch-Site": "same-origin" },
      '{"originalRequest":"杭州两日正常本机旅行"}');
    expect(result.status).toBe(201);
    const trip = JSON.parse(result.body).trip;
    expect((await trips.getTrip(trip.id))?.originalRequest).toBe("杭州两日正常本机旅行");
    expect((await send("GET", "/api/trips")).status).toBe(200);
    await trips.deleteTrip(trip.id);
  });

  it("keeps all settings read/write interfaces behind a valid session", async () => {
    for (const [key] of routes) {
      if (!key.includes("/api/settings") || key.endsWith("/password") || key === "POST /api/settings/session") continue;
      const [method, pathname] = key.split(" ");
      expect((await send(method, pathname, { Origin: origin })).status, key).toBe(401);
    }
  });

  it("rejects absent, empty, malformed, duplicate and mismatched CSRF values", async () => {
    const session = `serendipity_session=${security.createSessionToken(60_000)}`;
    const csrf = security.createCsrfToken();
    for (const headers of [
      { Cookie: session },
      { Cookie: `${session}; serendipity_csrf=`, "X-CSRF-Token": "" },
      { Cookie: `${session}; serendipity_csrf=%`, "X-CSRF-Token": csrf },
      { Cookie: `${session}; serendipity_csrf=${csrf}; serendipity_csrf=${csrf}`, "X-CSRF-Token": csrf },
      { Cookie: `${session}; serendipity_csrf=${csrf}`, "X-CSRF-Token": security.createCsrfToken() },
    ]) expect((await send("DELETE", "/api/settings/session", { Origin: origin, ...headers })).status).toBe(401);
    expect((await send("DELETE", "/api/settings/session", {
      Origin: origin, Cookie: `${session}; serendipity_csrf=${csrf}`, "X-CSRF-Token": csrf,
    })).status).toBe(200);
  });
});
