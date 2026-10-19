import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures";

// Exercise the real Leaflet image-loading lifecycle without depending on the
// public tile server in CI. Human-facing captures use real tiles separately.
const tile = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");

export async function controlledBasemap(page: Page, initiallyAvailable = true) {
  let available = initiallyAvailable;
  await page.route("**/api/map/config", (route) => route.fulfill({ json: { provider: "osm" } }));
  await page.route("https://tile.openstreetmap.org/**", (route) => available
    ? route.fulfill({ contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: tile })
    : route.abort("internetdisconnected"));
  return { restore: () => { available = true; } };
}

export async function expectCompanionBasemap(companion: Locator) {
  const iframe = companion.locator('iframe[title="当日路线地图预览"]');
  await expect(iframe).toBeVisible();
  const map = iframe.contentFrame();
  await expect(map.locator("img.leaflet-tile-loaded").first()).toBeVisible();
  await expect.poll(() => map.locator("img.leaflet-tile-loaded").evaluateAll((tiles) =>
    tiles.some((tile) => tile instanceof HTMLImageElement && tile.complete && tile.naturalWidth > 0))).toBe(true);
  await expect(map.locator(".serendipity-map-pin").first()).toBeVisible();
  await expect(map.locator("path.leaflet-interactive[stroke-dasharray]").first()).toBeAttached();
  await expect(companion.getByTestId("daily-route-diagram")).toHaveCount(0);
  await expect(companion.getByRole("button", { name: "重试地图", exact: true })).toHaveCount(0);
  return map;
}
