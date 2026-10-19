import { isValidRequestDate, requestSnapshotSchema, type RequestSnapshot } from "./trip-request";

export function readTripSummarySnapshot(value: string | null | undefined): RequestSnapshot | null {
  if (!value) return null;
  try {
    const parsed = requestSnapshotSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function tripSummaryDays(snapshot: RequestSnapshot | null) {
  if (!snapshot?.startDate || !snapshot.endDate ||
      !isValidRequestDate(snapshot.startDate) || !isValidRequestDate(snapshot.endDate)) return null;
  const days = Math.round((Date.parse(`${snapshot.endDate}T00:00:00Z`) - Date.parse(`${snapshot.startDate}T00:00:00Z`)) / 86_400_000) + 1;
  return days > 0 ? days : null;
}

export function tripSummaryDates(snapshot: RequestSnapshot | null) {
  if (!snapshot?.startDate) return "日期待安排";
  const start = snapshot.startDate.replaceAll("-", ".");
  if (!snapshot.endDate) return `${start} 出发`;
  const end = (snapshot.startDate.slice(0, 4) === snapshot.endDate.slice(0, 4)
    ? snapshot.endDate.slice(5) : snapshot.endDate).replaceAll("-", ".");
  return `${start} — ${end}`;
}

export function tripSummaryTravelers(snapshot: RequestSnapshot | null, originalRequest?: string) {
  if (!snapshot?.travelerCount) return null;
  // Only use explicit companion wording from this snapshot's source request;
  // two travelers alone are never enough to infer a relationship.
  const source = [originalRequest ?? "", ...snapshot.constraints].join("、");
  const relationshipPatterns: [string, RegExp][] = [
    ["与父母", /(?:带(?:着|上)?|陪(?:着)?|和|与|跟)(?:我的|我)?(?:父母|爸妈|爸爸妈妈)/g],
    ["亲子", /亲子(?:游|旅行|出游|同行)|(?:带(?:着|上)?|和|与|跟)(?:我的|我)?(?:孩子|小孩|宝宝|儿子|女儿)/g],
    ["伴侣同行", /(?:和|与|跟)(?:我的|我)?(?:伴侣|爱人|另一半|女朋友|男朋友|女友|男友|老公|老婆)/g],
    ["情侣", /情侣(?=游|旅行|出游|同行|两人|去|到|[，。、；,;\s]|$)|(?:我们|两人|二人)是情侣/g],
    ["夫妻", /夫妻(?=俩|游|旅行|出游|同行|去|到|[，。、；,;\s]|$)|(?:我们|两人|二人)是夫妻/g],
    ["朋友同行", /(?:和|与|跟)(?:我的|我|几位|几个|一位)?(?:朋友|好友|闺蜜)|(?:朋友|好友|闺蜜)(?:一起|同行|结伴)/g],
    ["家庭同行", /(?:和|与|跟)(?:我的|我)?家人|(?:全家|一家人)(?:一起|同行|出游|旅行)/g],
    ["同事同行", /(?:和|与|跟)(?:我的|我)?同事|同事(?:一起|同行|结伴)/g],
  ];
  const relationship = relationshipPatterns.find(([, pattern]) =>
    [...source.matchAll(pattern)].some((match) => !/(?:不|不要|不想|不是|并非|没有|避免|无需)$/.test(source.slice(Math.max(0, match.index - 6), match.index))),
  )?.[0];
  return `${snapshot.travelerCount} 人${relationship ? ` · ${relationship}` : ""}`;
}

export function tripSummaryBudget(snapshot: RequestSnapshot | null) {
  if (snapshot?.budgetAmountCents === null || snapshot?.budgetAmountCents === undefined) return null;
  const amount = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(snapshot.budgetAmountCents / 100);
  const scope = snapshot.budgetScope === "per_person" ? "人均" : snapshot.budgetScope === "total" ? "总预算" : "预算";
  return `${scope} ¥${amount}`;
}
