import http from "node:http";
import { type AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";

test("real Next HTTP rejects all trip mutations without an Origin", async ({ request }) => {
  const writes = [
    ["POST", "/api/trips"], ["PATCH", "/api/trips/missing"], ["DELETE", "/api/trips/missing"],
    ["PATCH", "/api/trips/missing/request"], ["POST", "/api/trips/missing/request/confirm"],
    ["POST", "/api/trips/missing/request/extract"], ["POST", "/api/trips/missing/plans/generate"],
    ["PATCH", "/api/trips/missing/plans/1"], ["POST", "/api/trips/missing/plans/1/evidence"],
  ];
  for (const [method, url] of writes) {
    expect((await request.fetch(url, { method, data: {} })).status(), `${method} ${url}`).toBe(403);
  }
});

test("normal local home and optimized public artwork remain accessible", async ({ request }) => {
  expect((await request.get("/")).status()).toBe(200);
  const image = await request.get("/_next/image?url=%2Fimages%2Fjiuzhaigou-home.jpg&w=1920&q=75");
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toMatch(/^image\//);
});

test("forged Host, forwarding headers and fake sessions do not open the app", async ({ request }) => {
  for (const cookie of ["", "serendipity_session=fake"]) {
    const response = await request.get("/api/trips", { headers: {
      Host: "untrusted.example", "X-Forwarded-Host": "localhost:3100",
      "X-Forwarded-For": "127.0.0.1", Cookie: cookie,
    } });
    expect(response.status()).toBe(401);
  }
});

test("a cross-site browser text/plain fetch cannot create a trip", async ({ page, request, baseURL }) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<!doctype html><title>Controlled cross-site test</title>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const marker = `blocked-browser-${Date.now()}`;
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    const responsePromise = page.waitForResponse(`${baseURL}/api/trips`);
    await page.evaluate(async ({ url, marker }) => {
      await fetch(url, {
        method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ originalRequest: marker }),
      });
    }, { url: `${baseURL}/api/trips`, marker });
    expect((await responsePromise).status()).toBe(403);
    expect(await (await request.get("/api/trips")).text()).not.toContain(marker);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
