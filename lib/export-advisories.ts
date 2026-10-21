import { advisorySeverityLabels, advisoryValidityLabels } from "./advisories";
import type { ExportSnapshot } from "./export-snapshot";
import { formatRedlineTime } from "./redlines";
import { effectiveWeatherStatus, weatherSummary } from "./weather";

export const EXPORT_ADVISORY_NOTICE = "提醒与状态截至本文件生成时；离线不更新天气、开放、排队或交通条件。标记已知不表示风险解除。";
export const EMPTY_EXPORT_ADVISORIES = "尚未保存所选日期的专项提醒，请结合时间红线、待确认事项与清单核对出发条件。";

export function projectExportWeather(snapshot: ExportSnapshot, dates: readonly string[]) {
  const seen = new Set<string>();
  return (snapshot.weather ?? []).filter((record) => dates.includes(record.date)).flatMap((record) => {
    const effective = { ...record, status: effectiveWeatherStatus(record, new Date(snapshot.generatedAt)) };
    const label = `${record.date} · ${record.locationName}：${weatherSummary(effective)}`;
    if (seen.has(label)) return [];
    seen.add(label);
    return [`${label}；来源 Open-Meteo${record.retrievedAt ? `，获取于 ${formatRedlineTime(record.retrievedAt)}` : ""}。离线不更新。`];
  });
}

/** All formats render the same saved, date-scoped facts through their privacy filter. */
export function projectExportAdvisories(snapshot: ExportSnapshot, dates: readonly string[]) {
  const seen = new Set<string>();
  return (snapshot.advisories?.items ?? []).filter((item) => dates.includes(item.date)).flatMap((item) => {
    const key = `${item.date}:${item.targetName.trim().toLowerCase()}:${item.category}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      title: `${item.date} · ${item.title}`,
      paragraphs: [
        `${item.acknowledged ? "已知" : "待关注"} · ${advisorySeverityLabels[item.severity]} · ${item.targetName}；${item.reason}`,
        item.recommendation,
        ...(item.aiExplanation ? [`参考解释：${item.aiExplanation}`] : []),
        ...(item.retrievedAt ? [`来源：${item.sourceLabel}；获取 ${formatRedlineTime(item.retrievedAt)}；适用 ${formatRedlineTime(item.applicableFrom)} 至 ${formatRedlineTime(item.applicableUntil)}；状态 ${item.validity === "valid" ? "导出时适用" : `${advisoryValidityLabels[item.validity]}，待复核`}`] : []),
        ...(item.acknowledged && item.acknowledgedAt ? [`用户标记已知于 ${formatRedlineTime(item.acknowledgedAt)}`] : []),
      ],
    }];
  });
}
