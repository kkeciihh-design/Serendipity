import { EventEmitter } from "node:events";
import { fork } from "node:child_process";
import sharp from "sharp";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recognizeTicketImage } from "../lib/ticket-ocr-service";

vi.mock("node:child_process", () => ({ fork: vi.fn() }));
let bytes: Buffer;
let child: EventEmitter & { send: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> };
beforeEach(async () => {
  bytes = await sharp({ create: { width: 30, height: 30, channels: 3, background: "white" } }).png().toBuffer();
  child = Object.assign(new EventEmitter(), { send: vi.fn(), kill: vi.fn() });
  vi.mocked(fork).mockReturnValue(child as unknown as ReturnType<typeof fork>);
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it("kills the isolated OCR process after success and exposes only selected ticket fields", async () => {
  const result = recognizeTicketImage(bytes, "image/png");
  await vi.waitFor(() => expect(child.send).toHaveBeenCalled());
  child.emit("message", { ok: true, text: "G123\n2026-10-29 06:30\n姓名 张某\n110101199001010011" });
  expect(JSON.stringify(await result)).not.toMatch(/张某|110101/);
  expect(child.kill).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fork).mock.calls[0][2]).toMatchObject({ windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
});
it("rejects concurrent work and kills cancelled work without consuming a late result", async () => {
  const controller = new AbortController();
  const result = recognizeTicketImage(bytes, "image/png", controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ status: 499 });
  await vi.waitFor(() => expect(child.send).toHaveBeenCalled());
  await expect(recognizeTicketImage(bytes, "image/png")).rejects.toMatchObject({ status: 429 });
  controller.abort(); await rejected;
  child.emit("message", { ok: true, text: "G999" });
  expect(child.kill).toHaveBeenCalledTimes(1);
});
it("terminates a hung model initialization at 60 seconds", async () => {
  vi.useFakeTimers();
  const result = recognizeTicketImage(bytes, "image/png");
  const rejected = expect(result).rejects.toMatchObject({ status: 504 });
  await vi.waitFor(() => expect(child.send).toHaveBeenCalled());
  await vi.advanceTimersByTimeAsync(60_000); await rejected;
  expect(child.kill).toHaveBeenCalledTimes(1);
});
it("returns a sanitized failure and kills an OCR process that cannot load its model", async () => {
  const result = recognizeTicketImage(bytes, "image/png");
  const rejected = expect(result).rejects.toMatchObject({ status: 503 });
  await vi.waitFor(() => expect(child.send).toHaveBeenCalled());
  child.emit("message", { ok: false, error: "private OCR text" });
  await rejected; expect(child.kill).toHaveBeenCalledTimes(1);
});
