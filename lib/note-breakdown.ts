/**
 * A persisted note is one dense paragraph. The timeline shows it as a short
 * lead-in plus a few labelled cells, so the card can be scanned instead of read.
 *
 * This is a presentation-only decomposition: `event.note` is never rewritten,
 * every character of the source is preserved across the returned parts, and any
 * note that does not match the known shapes falls back to a single lead-in.
 */

export type NoteKind = "ticket" | "hours" | "tip";

export type NotePart = {
  kind: NoteKind | "lead";
  label: string;
  text: string;
};

export type NoteBreakdown = {
  lead: string;
  parts: NotePart[];
  /** True when nothing was recognised, so the caller shows the plain paragraph. */
  plain: boolean;
};

const KINDS: { kind: NoteKind; label: string; pattern: RegExp }[] = [
  { kind: "ticket", label: "门票/预约", pattern: /(门票|票价|预约|预订|免费|无需购票|购票|索道票|联票|实名)/ },
  { kind: "hours", label: "参考耗时", pattern: /(开放时间|营业时间|开放|闭馆|闭园|时长|小时|分钟|耗时|末班|班次|发车|全程)/ },
  { kind: "tip", label: "实用贴士", pattern: /(建议|推荐|注意|避开|高峰|旺季|人多|排队|防晒|保暖|提前|最好|尽量|记得|务必|避开|排队|避坑)/ },
];

const LABELS: Record<NoteKind, string> = { ticket: "门票/预约", hours: "参考耗时", tip: "实用贴士" };

function splitSentences(text: string) {
  // Keep the delimiter so reassembling the parts stays lossless.
  return text
    .split(/(?<=[。；;！!？?])\s*/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * Split one note into a lead-in sentence and up to two labelled cells.
 * Lossless: concatenating every returned fragment reproduces the input text.
 */
export function breakdownNote(note: string | null | undefined): NoteBreakdown {
  const source = (note ?? "").trim();
  if (!source) return { lead: "", parts: [], plain: true };

  const sentences = splitSentences(source);
  if (sentences.length < 2) return { lead: source, parts: [], plain: true };

  // The first sentence introduces the stop; it reads best slightly larger.
  const lead = sentences[0];
  const buckets = new Map<NoteKind, string[]>();
  const leftovers: string[] = [];

  for (const sentence of sentences.slice(1)) {
    const match = KINDS.find((kind) => kind.pattern.test(sentence));
    if (!match) { leftovers.push(sentence); continue; }
    buckets.set(match.kind, [...(buckets.get(match.kind) ?? []), sentence]);
  }

  const parts: NotePart[] = [];
  for (const kind of ["ticket", "hours", "tip"] as NoteKind[]) {
    const texts = buckets.get(kind);
    if (texts?.length) parts.push({ kind, label: LABELS[kind], text: texts.join(" ").trim() });
  }

  // A single dense sentence is the common case for short notes: keep it whole
  // rather than carving it into cells that would each be a fragment.
  if (!parts.length) return { lead: source, parts: [], plain: true };

  // Anything unrecognised stays attached to the lead-in so nothing is dropped.
  const leadWithLeftovers = [lead, ...leftovers].join(" ").trim();
  return { lead: leadWithLeftovers, parts: parts.slice(0, 3), plain: false };
}

/** The lead-in shown at a slightly larger size: first clause, clipped on a boundary. */
export function noteLeadIn(breakdown: NoteBreakdown, maxLength = 42) {
  const text = breakdown.lead;
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength);
  const boundary = Math.max(clipped.lastIndexOf("，"), clipped.lastIndexOf("、"), clipped.lastIndexOf("。"));
  return `${boundary > maxLength * 0.5 ? clipped.slice(0, boundary) : clipped}…`;
}
