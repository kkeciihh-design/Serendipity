"use client";
import { useRef, useState } from "react";
import type { SafeWeatherSettings } from "@/lib/weather-settings";
export function WeatherSettings({ csrfToken, initial }: { csrfToken: string; initial: SafeWeatherSettings }) {
  const [settings, setSettings] = useState(initial), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const lock = useRef(false);
  async function test() {
    if (lock.current) return; lock.current = true; setBusy(true); setMessage("正在查询当日天气预报…");
    try {
      const post = async (url: string, body: object) => {
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
        const data = await r.json(); if (!r.ok) throw new Error(data.error || "天气服务不可用。"); return data;
      };
      const tested = await post("/api/settings/weather/test", {});
      setSettings(await post("/api/settings/weather", { testToken: tested.testToken }));
      setMessage(`真实查询成功：${tested.record.date} · ${tested.record.locationName} · ${tested.summary}。连接状态已保存。`);
    } catch (e) { setMessage(e instanceof Error && e.name !== "TimeoutError" ? e.message : "天气测试超时，请重试；原配置保持不变。"); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section id="weather-settings" aria-label="天气服务设置" className="rounded-lg border border-sand bg-white p-5 sm:p-6">
    <div className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-semibold text-charcoal">天气</h2><span className="rounded bg-sage-soft px-3 py-2 text-sm text-sage">免费预报 · 无需 Key</span></div>
    <div className="source-capsules"><span>Open-Meteo</span><span>最长未来 16 天</span><span>北京时间</span></div>
    <details className="source-details"><summary>预报范围与时效</summary><p>适用于本机个人非商业使用。按已定位活动地区查询，历史和超范围日期显示无有效预报；超过 1 小时标为过期。出行当天请留意实际天气，不提供灾害预警或后台推送。</p><a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer" className="text-sage underline">服务说明与预报范围</a></details>
    <p className="mt-2 text-sm text-sage">{settings.status === "connected" ? "最近连接测试通过" : "尚未通过连接测试"}{settings.checkedAt ? ` · ${new Date(settings.checkedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（北京时间）` : ""}</p>
    <div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={() => void test()} className="min-h-12 rounded-md border border-sage px-4 py-2 font-semibold text-sage disabled:opacity-50">{busy ? "正在测试…" : "测试并保存天气连接"}</button></div>
    {message && <p role="status" className="mt-3 rounded bg-shell p-3 text-sm leading-6 text-graphite">{message}</p>}
  </section>;
}
