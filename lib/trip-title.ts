import type { RequestSnapshot } from "./trip-request";
import { tripSummaryDays } from "./trip-summary";

export function deriveTripTitle(originalRequest: string) {
  const firstLine =
    originalRequest
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "未命名旅行";
  const characters = Array.from(firstLine);

  return characters.length <= 30
    ? firstLine
    : `${characters.slice(0, 30).join("")}…`;
}

function requestDuration(originalRequest: string) {
  // A stated duration is useful before extraction has produced calendar dates.
  // Do not interpret a calendar date such as “十一日” as an eleven-day trip.
  const statedDays = originalRequest.match(/([1-9]\d?|[一二两三四五六七八九十]{1,3})\s*(?:天|日\s*(?:游|之旅|旅行))/)?.[1];
  if (!statedDays) return null;
  if (/^\d+$/.test(statedDays)) return Number(statedDays);
  const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (statedDays === "十") return 10;
  if (statedDays.includes("十")) {
    const [tens, units] = statedDays.split("十");
    return (digits[tens] ?? 1) * 10 + (digits[units] ?? 0);
  }
  return digits[statedDays] ?? null;
}

function editorialTheme(snapshot: RequestSnapshot | null) {
  if (snapshot?.pace === "relaxed") return "轻松漫游";
  const interests = snapshot?.interests.join("、") ?? "";
  if (/人文|历史|文化|博物馆|古迹/.test(interests)) return "人文漫游";
  if (/美食|小吃|餐饮|寻味/.test(interests)) return "风味之旅";
  if (/自然|山水|公园|徒步|户外/.test(interests)) return "山水漫游";
  if (/摄影|拍照|建筑/.test(interests)) return "光影漫游";
  if (/亲子|儿童/.test(interests)) return "亲子漫游";
  return "自在漫游";
}

export function tripDisplayTitle({
  title,
  originalRequest,
  snapshot,
}: {
  title: string;
  originalRequest: string;
  snapshot: RequestSnapshot | null;
}) {
  const original = originalRequest.trim();
  const firstLine = original.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  const isOriginalTitle = title === deriveTripTitle(original) || title.trim() === original;
  const isRequestSentence = Array.from(firstLine).length > 24 ||
    /[，。；！？,;!?]|^(?:我|请|希望|帮我|计划|想|打算)|^(?:去|到).+(?:玩|游|住|逛)|(?:出发|预算|人均)/.test(firstLine);
  // A deliberately named trip (including a short original heading) stays intact.
  if (!isOriginalTitle || !isRequestSentence) return title;

  const days = tripSummaryDays(snapshot) ?? requestDuration(original);
  const dayLabels = ["", "一", "两", "三", "四", "五", "六", "七", "八", "九", "十"];
  const duration = days ? `${dayLabels[days] ?? days}日` : "";
  const destination = snapshot?.destination?.trim() || "下一站";
  return `${destination} · ${duration}${editorialTheme(snapshot)}`;
}
