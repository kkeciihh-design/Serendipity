import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { recognizeTicketImage } from "../lib/ticket-ocr-service";
import { assertTestDataPath } from "../scripts/test-data-safety.mjs";

type NetworkRecord = { pid: number; threadId: number; isMainThread: boolean; event: string; checkedApis?: number; entrypoint?: string };

// Run only through verify-ticket-ocr-offline.mjs. This checks Node networking
// APIs across the actual service, fork and Tesseract worker; it is not a packet
// capture or proof about native code outside those APIs.
it.skipIf(process.env.SERENDIPITY_VERIFY_OCR_OFFLINE !== "1")("recognizes a real image with outbound Node networking denied in the service, fork and OCR worker", async () => {
  const bytes = await fs.readFile(assertTestDataPath(path.resolve("test-data/phase16-samples/normal.png")));
  const result = await recognizeTicketImage(bytes, "image/png");
  expect(result.segments[0].fields).toMatchObject({ serviceNumber: "G6012", fromName: "深圳北", toName: "长沙南", fareCents: 24300 });
  const records: NetworkRecord[] = (await fs.readFile(assertTestDataPath(process.env.SERENDIPITY_OCR_NETWORK_LOG ?? ""), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  const ready = records.filter((entry) => entry.event === "ready");
  expect(ready.some((entry) => entry.pid === process.pid)).toBe(true);
  const child = ready.find((entry) => entry.pid !== process.pid && entry.isMainThread && entry.entrypoint === "ticket-ocr-worker.mjs" &&
    ready.some((worker) => worker.pid === entry.pid && !worker.isMainThread));
  expect(child, "actual OCR child and its worker both loaded the guard").toBeDefined();
  expect(ready.every((entry) => (entry.checkedApis ?? 0) >= 20)).toBe(true);
  expect(records.filter((entry) => entry.event === "blocked")).toEqual([]);
}, 90_000);
