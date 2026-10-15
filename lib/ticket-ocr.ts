import { nextPlanDate } from "./plan";

export type RecognizedTicket = {
  serviceNumber: string | null; date: string | null; departureTime: string | null;
  arrivalDate: string | null; arrivalTime: string | null; fromName: string | null;
  toName: string | null; seat: string | null; fareCents: number | null;
};
export type RecognitionDraft = {
  documentKind: "ticket" | "refund" | "change" | "unknown";
  segments: Array<{ fields: RecognizedTicket; notices: string[] }>;
};

function validDate(year: string, month: string, day: string) {
  const value = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function parseSegment(raw: string) {
  // Never retain OCR text: it may contain names, IDs or order numbers.
  const text = raw.normalize("NFKC").replace(/([\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/g, "$1").replace(/[ \t]*:[ \t]*/g, ":");
  const notices = ["全部字段均为识别草稿，请逐项核对日期、完整站名、车次、时刻和当前有效状态；不代表官方核验。"];
  const serviceNumber = text.match(/\b([GDCZTK]\s?\d{1,5})\b/i)?.[1]?.replace(/\s/g, "").toUpperCase() ?? null;
  const dates = [...text.matchAll(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})日?/g)].map((m) => validDate(m[1], m[2], m[3]));
  const times = [...text.matchAll(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g)].map((m) => `${m[1].padStart(2, "0")}:${m[2]}`);
  const date = dates[0] ?? null;
  const departureTime = times[0] ?? null;
  const arrivalTime = times[1] ?? null;
  const station = (pattern: RegExp) => text.match(pattern)?.[1]?.replace(/站$/, "") ?? null;
  let fromName = station(/(?:出发站|发站|始发站)[:：]?\s*([\u4e00-\u9fff]{2,12}?)(?=\s|→|到达站|车次|\d|$)/);
  let toName = station(/(?:到达站|到站|终到站)[:：]?\s*([\u4e00-\u9fff]{2,12}?)(?=\s|出发站|车次|\d|$)/);
  // A common ticket layout has only station names around the service number.
  if (!fromName || !toName) {
    const pair = text.match(/([\u4e00-\u9fff]{2,10})\s*(?:→|—+|[GDCZTK]\s?\d{1,5})\s*([\u4e00-\u9fff]{2,10})/i);
    if (pair) { fromName ??= pair[1].replace(/站$/, ""); toName ??= pair[2].replace(/站$/, ""); }
  }
  let arrivalDate = dates[1] ?? null;
  if (arrivalTime && !arrivalDate && date) {
    if (/次日|翌日|\+1天/.test(text)) { arrivalDate = nextPlanDate(date); notices.push("到达日期根据“次日”换算，请确认完整年月日。"); }
    else if (/当日|同日/.test(text) || departureTime && arrivalTime > departureTime) {
      arrivalDate = date; notices.push("到达日期按同日暂填，请确认是否跨日。");
    } else notices.push("到达时刻早于出发时刻，跨日日期待补，未自行增加一天。");
  }
  const seat = text.match(/(?:\d{1,2}\s*车(?:厢)?\s*\d{1,3}\s*[A-Fa-f号]?|无座)/)?.[0]?.replace(/\s/g, "").toUpperCase() ?? null;
  // Only a marked ticket price is accepted; refund totals are not ticket fares.
  const amount = text.match(/(?:票价|票面金额)[:：]?\s*[¥￥]?\s*(\d{1,7}(?:\.\d{1,2})?)/)?.[1] ??
    (!/退款|退票|改签/.test(text) ? text.match(/[¥￥]\s*(\d{1,7}(?:\.\d{1,2})?)/)?.[1] : undefined);
  const fareCents = amount === undefined ? null : Math.round(Number(amount) * 100);
  const fields: RecognizedTicket = { serviceNumber, date, departureTime, arrivalDate, arrivalTime, fromName, toName, seat, fareCents };
  const labels: Record<keyof RecognizedTicket, string> = { serviceNumber: "车次", date: "完整出发日期（含年份）", departureTime: "出发时刻", arrivalDate: "到达日期", arrivalTime: "到达时刻", fromName: "出发站", toName: "到达站", seat: "座位", fareCents: "票价" };
  for (const [key, value] of Object.entries(fields)) if (value === null) notices.push(`${labels[key as keyof RecognizedTicket]}未可靠识别，保持空白。`);
  return { fields, notices };
}

export function parseTicketRecognition(text: string): RecognitionDraft {
  const compact = text.replace(/\s/g, "");
  const documentKind = /退票|退款|已退/.test(compact) ? "refund" : /改签|换票|变更/.test(compact) ? "change" : /[GDCZTK]\s?\d{1,5}/i.test(text) ? "ticket" : "unknown";
  // Split only at explicit segment boundaries. Ambiguous multi-ticket images
  // must be cropped separately rather than combining old/new ticket fields.
  const chunks = text.split(/(?:第[一二三四五六七八九\d]+[段程]|行程\s*\d+)[:：]?/).filter((part) => /[GDCZTK]\s?\d{1,5}/i.test(part));
  const parts = chunks.length > 1 ? chunks : [text];
  const segments = parts.slice(0, 8).map((part) => {
    const services = new Set((part.match(/\b[GDCZTK]\s?\d{1,5}\b/gi) ?? []).map((s) => s.replace(/\s/g, "")));
    if (services.size > 1) {
      const empty = parseSegment("");
      empty.notices.unshift("发现多段或新旧票混排，无法可靠对应字段；请返回裁剪，每次只保留一段票面。");
      return empty;
    }
    return parseSegment(part);
  });
  return { documentKind, segments };
}
