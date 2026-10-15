import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { recognizeTicketImage } from "../lib/ticket-ocr-service";
import { verificationEvidenceDirectory } from "./helpers/evidence-directory";

// Opt-in because this exercises the actual CPU OCR models, never a mock.
it.skipIf(process.env.SERENDIPITY_VERIFY_OCR !== "1")("recognizes anonymous normal, rotated, blurry, missing and changed ticket images with real local OCR", async () => {
  const results = [];
  for (const name of ["normal", "missing", "overnight", "refund", "change", "rotated", "blurred"]) {
    let bytes = await fs.readFile(path.resolve("test-data/phase16-samples", `${name}.png`));
    // Same correction offered by the UI before submission.
    if (name === "rotated") bytes = await sharp(bytes).rotate(270).png().toBuffer();
    const draft = await recognizeTicketImage(bytes, "image/png");
    results.push({ sample: name, draft });
  }
  const output = verificationEvidenceDirectory("phase16");
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, "real-ocr.json"), JSON.stringify({ engine: "Tesseract.js 7 / bundled chi_sim", checkedAt: new Date().toISOString(), provenance: "Invented anonymous tickets, real local CPU OCR; this recognition test does not observe network traffic", results }, null, 2));
  console.log(JSON.stringify(results.map(({ sample, draft }) => ({ sample, kind: draft.documentKind, fields: draft.segments[0].fields }))));
  for (const name of ["normal", "rotated"]) {
    const draft = results.find((result) => result.sample === name)!.draft;
    expect(draft.segments[0].fields).toMatchObject({ fromName: "深圳北", toName: "长沙南", serviceNumber: "G6012", date: "2026-10-29", departureTime: "06:30", arrivalTime: "07:30", seat: "05车08A", fareCents: 24300 });
  }
  expect(results.find((r) => r.sample === "missing")!.draft.segments[0].fields).toMatchObject({ date: null, arrivalTime: null, fareCents: null });
  expect(results.find((r) => r.sample === "overnight")!.draft.segments[0].fields.arrivalDate).toBe("2026-10-30");
  expect(results.find((r) => r.sample === "refund")!.draft).toMatchObject({ documentKind: "refund" });
  expect(results.find((r) => r.sample === "refund")!.draft.segments[0].fields.fareCents).toBeNull();
  expect(results.find((r) => r.sample === "change")!.draft.documentKind).toBe("change");
}, 120_000);
