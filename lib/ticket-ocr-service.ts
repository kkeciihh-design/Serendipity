import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import path from "node:path";
import sharp from "sharp";
import { parseTicketRecognition } from "./ticket-ocr";

export const MAX_TICKET_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TICKET_IMAGE_PIXELS = 20_000_000;
export class TicketImageError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const state = globalThis as typeof globalThis & { ticketOcrBusy?: boolean };

function runOcr(image: Buffer, signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) { reject(new TicketImageError("识别已取消。", 499)); return; }
    const child = fork(path.join(process.cwd(), "scripts/ticket-ocr-worker.mjs"), [], {
      // Library diagnostics can include OCR data; none are copied into logs.
      stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "advanced", windowsHide: true,
    });
    let done = false;
    const finish = (error?: TicketImageError, text?: string) => {
      if (done) return;
      done = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      child.kill();
      if (error) reject(error); else resolve(text!);
    };
    const abort = () => finish(new TicketImageError("识别已取消。", 499));
    const timer = setTimeout(() => finish(new TicketImageError("识别超时，请缩小票面区域后重试。", 504)), 60_000);
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", () => finish(new TicketImageError("本机识别进程无法启动，请重试。", 503)));
    child.on("exit", () => { if (!done) finish(new TicketImageError("本机识别未完成，请重新裁剪后重试。", 503)); });
    child.on("message", (message: unknown) => {
      const result = message as { ok?: boolean; text?: unknown };
      if (result?.ok && typeof result.text === "string" && result.text.length <= 30_000) finish(undefined, result.text);
      else finish(new TicketImageError("本机识别失败，请检查模型文件是否完整，或重新裁剪后重试。", 503));
    });
    child.send(image, (error) => { if (error) finish(new TicketImageError("图片无法送入本机识别，请重试。", 503)); });
  });
}

export async function prepareTicketImage(bytes: Buffer, mime: string) {
  if (!bytes.length || bytes.length > MAX_TICKET_IMAGE_BYTES) throw new TicketImageError("请选择不超过 10MB 的图片。", 413);
  const actual = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png" :
    bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg" :
    bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" ? "image/webp" : null;
  if (!actual || actual !== mime) throw new TicketImageError("图片实际格式不符；仅支持 PNG、JPEG、WebP 静态图片。");
  try {
    const input = sharp(bytes, { limitInputPixels: MAX_TICKET_IMAGE_PIXELS, failOn: "warning" });
    const meta = await input.metadata();
    if (!meta.width || !meta.height || (meta.pages ?? 1) > 1) throw new Error("invalid dimensions/pages");
    // Re-encode without EXIF, comments or filenames; limit OCR workload.
    return await input.rotate().flatten({ background: "#ffffff" }).resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).greyscale().normalize().png().toBuffer();
  } catch { throw new TicketImageError("无法读取静态图片，或像素超过 2000 万；请重新裁剪或另存后再试。"); }
}

/** All image/text buffers live only for this request. No temp image or OCR log. */
export async function recognizeTicketImage(bytes: Buffer, mime: string, signal?: AbortSignal) {
  if (state.ticketOcrBusy) throw new TicketImageError("另一张票图正在识别，请稍后重试。", 429);
  state.ticketOcrBusy = true;
  try {
    const image = await prepareTicketImage(bytes, mime);
    const text = await runOcr(image, signal);
    const draft = parseTicketRecognition(text);
    return { ...draft, cropFingerprint: createHash("sha256").update(image).digest("hex"), recognizedAt: new Date().toISOString(), engine: "tesseract-local" as const };
  } catch (error) {
    if (error instanceof TicketImageError) throw error;
    throw new TicketImageError("本机识别失败，请重新裁剪后重试；当前计划没有改变。", 503);
  } finally {
    state.ticketOcrBusy = false;
  }
}
