import { z } from "zod";
import type { Ticket, TicketCore } from "./tickets";

export const ticketImportSourceSchema = z.object({
  engine: z.literal("tesseract-local"),
  imageFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  cropFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  recognizedAt: z.iso.datetime(),
  documentKind: z.enum(["ticket", "refund", "change", "unknown"]),
  // Keep the OCR classification even when the user corrects its meaning.
  confirmedDocumentKind: z.enum(["ticket", "refund", "change", "unknown"]).optional(),
});
export type TicketImportSource = z.infer<typeof ticketImportSourceSchema>;
export const importResolutionSchema = z.enum(["new", "companion", "replacement"]);
export type ImportResolution = z.infer<typeof importResolutionSchema>;

/** Hints only: a journey match must never merge different passengers. */
export function ticketDuplicateHints(tickets: Ticket[], core: Partial<TicketCore>, source: TicketImportSource, excludedTicketId?: string) {
  const normalized = (value: string | null | undefined) => value?.replace(/\s|站$/g, "").toUpperCase();
  return tickets.flatMap((ticket) => {
    if (ticket.id === excludedTicketId) return [];
    const imageMatch = ticket.importSource?.imageFingerprint === source.imageFingerprint || ticket.importSource?.cropFingerprint === source.cropFingerprint;
    const journeyMatch = ticket.mode === "train" && Boolean(core.date && core.serviceNumber && core.fromName && core.toName) &&
      ["date", "serviceNumber", "fromName", "toName"].every((key) => normalized(ticket[key as keyof TicketCore] as string) === normalized(core[key as keyof TicketCore] as string));
    if (!imageMatch && !journeyMatch) return [];
    const differentSeat = Boolean(ticket.seat && core.seat && normalized(ticket.seat) !== normalized(core.seat));
    return [{ ticketId: ticket.id, reason: imageMatch ? "相同图片" : differentSeat ? "同班次、不同座位：可能是同行票" : "同日期、班次与站点：疑似同票", differentSeat }];
  });
}
