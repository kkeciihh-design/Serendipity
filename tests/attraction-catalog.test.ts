import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  attractionCatalog,
  findAttractionCatalogEntry,
  getAttractionCatalog,
  getAttractionCatalogEntry,
  getAttractionImages,
} from "../lib/attraction-catalog";

describe("reviewed attraction directory and image boundaries (local deterministic checks)", () => {
  it("matches an explicit same-city name or alias without borrowing another city's image", () => {
    expect(getAttractionCatalog("长沙市")).toHaveLength(3);
    expect(findAttractionCatalogEntry("湖南省博物馆", "长沙")?.id).toBe("hunan-museum");
    expect(findAttractionCatalogEntry(" 岳麓书院 ", "长沙市")?.id).toBe("yuelu-academy");
    expect(findAttractionCatalogEntry("湖南博物院", "武汉")).toBeNull();
    expect(findAttractionCatalogEntry("湖南博物院附近咖啡馆", "长沙")).toBeNull();
    expect(getAttractionCatalog("长沙或武汉")).toEqual([]);
    expect(getAttractionCatalogEntry("not-in-directory")).toBeNull();
  });

  it("rejects swapped entities, swapped files, unknown permissions and external image URLs", () => {
    const entry = getAttractionCatalogEntry("hunan-museum")!;
    const [photo] = entry.images;
    const changes = [
      { entryId: "yuelu-academy" }, { entityName: "湖北省博物馆" }, { city: "武汉" },
      { url: "/attractions/yuelu-academy.webp" }, { displayAllowed: false },
      { url: "https://example.com/image.webp" }, { url: "/attractions/../../secret.webp" },
      { width: 4000 }, { height: 0 }, { width: 500.5 },
      { license: "unknown" }, { licenseUrl: "javascript:alert(1)" },
      { sourceUrl: "https://commons.wikimedia.org.evil.example/wiki/File:photo" },
    ];
    for (const change of changes) {
      expect(getAttractionImages({ ...entry, images: [{ ...photo, ...change }] }), JSON.stringify(change)).toEqual([]);
    }
    expect(getAttractionImages({ ...entry, images: [] })).toEqual([]);
    expect(getAttractionImages(entry)).toHaveLength(1);
  });

  it("keeps prices, bookings and date applicability independent from verified images and POIs", () => {
    for (const entry of attractionCatalog) {
      const ids = new Set(entry.sources.map((source) => source.id));
      for (const fact of [entry.opening, entry.ticket, entry.reservation]) {
        expect(fact.status).toBe("pending");
        expect(fact.notes.length).toBeGreaterThan(0);
        expect(fact.sourceIds.every((id) => ids.has(id))).toBe(true);
      }
      expect(entry.opening.applicableFrom).toBeNull();
      expect(entry.opening.applicableUntil).toBeNull();
      expect(entry.visitMinutes.status).toBe("estimated");
      expect(entry.location?.city).toBe("长沙市");
    }
    const orange = getAttractionCatalogEntry("orange-isle")!;
    expect(orange.ticket.minCents).toBeNull();
    expect(orange.ticket.maxCents).toBeNull();
    expect(orange.reservation.required).toBeNull();
    expect(orange.location?.category).toBe("place:island");
    expect(getAttractionCatalogEntry("hunan-museum")!.reservation.required).toBe(true);
    expect(getAttractionCatalogEntry("yuelu-academy")!.ticket.minCents).toBe(4000);
  });

  it("retains exact official closure dates separately from unconfirmed general opening rules", () => {
    const museum = getAttractionCatalogEntry("hunan-museum")!;
    expect(museum.opening.status).toBe("pending");
    expect(museum.opening.applicableUntil).toBeNull();
    expect(museum.opening.confirmedClosedDates?.map((item) => item.date)).toEqual([
      "2026-02-16", "2026-02-17", "2026-02-24", "2026-04-07", "2026-05-06", "2026-10-08",
    ]);
    for (const closure of museum.opening.confirmedClosedDates ?? []) {
      const source = museum.sources.find((item) => item.id === closure.sourceId);
      expect(source?.kind).toBe("official");
      expect(source?.retrievedAt).toBe(closure.retrievedAt);
      expect(source?.quote).toContain("2026年法定节假日");
    }
    // A generic Monday rule has public-holiday exceptions; it is not expanded
    // into confirmed closures for every Monday of the year.
    expect(museum.opening.confirmedClosedDates?.some((item) => item.date === "2026-10-19")).toBe(false);
  });

  it("ships decodable bounded local images with real-source attribution and no embedded EXIF", async () => {
    for (const entry of attractionCatalog) {
      const images = getAttractionImages(entry);
      expect(images.length).toBeGreaterThanOrEqual(1);
      expect(images.length).toBeLessThanOrEqual(2);
      for (const photo of images) {
        const file = path.join(process.cwd(), "public", photo.url);
        const bytes = await fs.readFile(file);
        expect(bytes.byteLength).toBeLessThanOrEqual(400_000);
        const metadata = await sharp(bytes).metadata();
        expect(metadata.format).toBe("webp");
        expect(metadata.width).toBe(photo.width);
        expect(metadata.height).toBe(photo.height);
        expect(metadata.exif).toBeUndefined();
        expect(metadata.xmp).toBeUndefined();
        expect(photo.retrievedAt).toMatch(/^2026-10-15T/);
        expect(photo.exportAllowed).toBe(true);
        expect(photo.modification).toContain("衍生图沿用原许可");
      }
    }
  });
});
