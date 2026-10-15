import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { parseTicketRecognition } from "../lib/ticket-ocr";
import { prepareTicketImage } from "../lib/ticket-ocr-service";
import { ticketDuplicateHints, type TicketImportSource } from "../lib/ticket-import";
import { activateTicket } from "../lib/tickets";
import { ticketFixture } from "./helpers/ticket-fixtures";

const source: TicketImportSource = { engine: "tesseract-local", imageFingerprint: "a".repeat(64), cropFingerprint: "b".repeat(64), recognizedAt: "2026-10-15T08:00:00.000Z", documentKind: "ticket" };
const normal = "深圳北 G6012 长沙南\n出发：2026年10月29日 06:30\n到达：2026年10月29日 07:30\n05车08A 二等座\n票价：243.00元";
describe("ticket image parsing and privacy", () => {
  it("reads ticket fields without extracting identities or changing exact station suffixes", () => {
    const fields = parseTicketRecognition(normal + "\n姓名 王某\n证件号 110101199001010011").segments[0].fields;
    expect(fields).toEqual({ fromName: "深圳北", toName: "长沙南", serviceNumber: "G6012", date: "2026-10-29", departureTime: "06:30", arrivalDate: "2026-10-29", arrivalTime: "07:30", seat: "05车08A", fareCents: 24300 });
    expect(JSON.stringify(fields)).not.toMatch(/王某|110101/);
    expect(parseTicketRecognition(normal.replace("深圳北", "深圳")).segments[0].fields.fromName).toBe("深圳");
  });
  it("does not invent years, fares or missing arrivals; next-day inference is explicit", () => {
    const missing = parseTicketRecognition("深圳北 G6012 长沙南\n10月29日 23:30").segments[0];
    expect(missing.fields).toMatchObject({ date: null, arrivalDate: null, arrivalTime: null, fareCents: null, seat: null });
    const overnight = parseTicketRecognition("深圳北 G6012 长沙南\n2026年12月31日 23:30\n次日 01:20").segments[0];
    expect(overnight.fields.arrivalDate).toBe("2027-01-01"); expect(overnight.notices.join()).toContain("次日");
    expect(parseTicketRecognition("G123 2026-10-29 23:30 01:20").segments[0].fields.arrivalDate).toBeNull();
    expect(parseTicketRecognition("G123 2026-02-30 06:30").segments[0].fields.date).toBeNull();
  });
  it("recognizes refund/change context, multiple segments and ambiguous old/new tickets", () => {
    expect(parseTicketRecognition("退票成功\n" + normal.replace("票价", "退款金额")).segments[0].fields.fareCents).toBeNull();
    expect(parseTicketRecognition("退票成功\n" + normal).documentKind).toBe("refund");
    expect(parseTicketRecognition("改签成功\n" + normal).documentKind).toBe("change");
    expect(parseTicketRecognition("第一段\n" + normal + "\n第二段\n" + normal.replace("G6012", "G6013")).segments).toHaveLength(2);
    expect(parseTicketRecognition(normal + "\n新票 G6013 10:30").segments[0].fields.serviceNumber).toBeNull();
  });
  it("flags same image and same journey while preserving separate seat hints", () => {
    const core = ticketFixture("2026-10-29", { seat: "05车08A" });
    const ticket = { ...activateTicket(core), importSource: source };
    expect(ticketDuplicateHints([ticket], core, source)[0].reason).toBe("相同图片");
    const differentImage = { ...source, imageFingerprint: "c".repeat(64), cropFingerprint: "d".repeat(64) };
    expect(ticketDuplicateHints([ticket], { ...core, seat: "05车08B" }, differentImage)[0].differentSeat).toBe(true);
    expect(ticketDuplicateHints([ticket], { ...core, fromName: "其他站" }, differentImage)).toEqual([]);
  });
  it("checks actual format, size, pixels and removes metadata for PNG/JPEG/WebP", async () => {
    for (const format of ["png", "jpeg", "webp"] as const) {
      const bytes = await sharp({ create: { width: 50, height: 50, channels: 3, background: "white" } }).withMetadata().toFormat(format).toBuffer();
      const image = await prepareTicketImage(bytes, `image/${format}`);
      expect((await sharp(image).metadata()).exif).toBeUndefined();
      await expect(prepareTicketImage(bytes, "image/gif")).rejects.toThrow("格式");
    }
    await expect(prepareTicketImage(Buffer.from("<svg/>"), "image/png")).rejects.toThrow("格式");
    await expect(prepareTicketImage(Buffer.alloc(10 * 1024 * 1024 + 1), "image/png")).rejects.toThrow("10MB");
    const enormous = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "white" } }).png().toBuffer();
    await expect(prepareTicketImage(enormous, "image/png")).rejects.toThrow("2000 万");
  });
});
