"use client";
import { useEffect, useState } from "react";
import type { SafeMapSettings } from "@/lib/map-settings";
import { MapCanvas } from "@/app/components/map-canvas";

const fields = [ ["browserKey", "浏览器 Key（Web 端 JS API）"], ["webServiceKey", "Web 服务 Key"], ["securityCode", "JS API 安全密钥"] ] as const;
const emptyPlaces: [] = [];
export function MapSettings({ csrfToken }: { csrfToken: string }) {
  const [settings, setSettings] = useState<SafeMapSettings | null>(null);
  const [keys, setKeys] = useState({ browserKey: "", webServiceKey: "", securityCode: "" });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [testToken, setTestToken] = useState("");
  const [previewId, setPreviewId] = useState(0);
  const [ready, setReady] = useState(false);
  const [freePreview, setFreePreview] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/settings/map", { signal: controller.signal }).then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "地图设置读取失败。"); setSettings(data);
    }).catch((error) => { if (!controller.signal.aborted) setFeedback(error.message); });
    return () => controller.abort();
  }, []);
  const post = async (url: string, body: object) => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "地图配置操作失败。"); return data;
  };
  const test = async () => {
    setBusy(true); setTestToken(""); setReady(false); setFreePreview(false); setFeedback("正在测试地点搜索与静态图…");
    try { const data = await post("/api/settings/map/test", keys); setTestToken(data.testToken); setPreviewId((value) => value + 1); setFeedback("地点搜索与静态图已返回，请等待下方浏览器地图加载后保存。"); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "测试失败，原配置保留。"); }
    finally { setBusy(false); }
  };
  const save = async (free = false) => {
    setBusy(true);
    try { const data = await post("/api/settings/map", free ? { provider: "osm" } : { testToken, browserMapLoaded: ready }); setSettings(data); setKeys({ browserKey: "", webServiceKey: "", securityCode: "" }); setTestToken(""); setFreePreview(false); setReady(false); setFeedback(free ? "已启用免费地图，无需 Key。" : "高德配置已保存。后续离线导出的账号授权仍需单独核实。"); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "保存失败，原配置保留。"); }
    finally { setBusy(false); }
  };
  const button = "min-h-12 rounded-md border border-sage px-4 py-2 text-sm font-semibold text-sage disabled:opacity-50";
  return <section id="map-settings" className="rounded-lg border border-sand/80 bg-white p-5 sm:p-6" aria-label="地图服务设置">
    <div className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-semibold text-charcoal">地图</h2><span className="rounded bg-sage-soft px-3 py-2 text-sm text-sage">{settings ? settings.provider === "osm" ? "免费方案 · 无需 Key" : "高德地图" : "读取中…"}</span></div>
    <p className="mt-3 text-base leading-7 text-graphite">默认使用 OpenStreetMap 地图与 Nominatim 地点搜索，无需账号或付费 API。适合本机个人旅行规划，地图和搜索需要联网。</p>
    <p className="mt-2 text-sm leading-6 text-graphite">公共搜索限制为手动提交、每秒最多一次，并缓存 24 小时；不自动补全或批量查询。请用公共地标代替私人住址。地图保留署名，不提供批量离线下载。</p>
    <div className="mt-2 flex flex-wrap gap-4 text-sm text-sage"><a className="underline" href="https://operations.osmfoundation.org/policies/nominatim/" target="_blank" rel="noreferrer">搜索使用规则</a><a className="underline" href="https://operations.osmfoundation.org/policies/tiles/" target="_blank" rel="noreferrer">地图使用规则</a><a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">署名与许可</a></div>
    <div className="mt-4 flex flex-wrap gap-3">
      {settings?.provider === "amap" ? <button disabled={busy} onClick={() => void save(true)} className={button}>切回免费地图</button> : <button disabled={busy || !settings} className={button} onClick={() => { setTestToken(""); setReady(false); setFreePreview(true); setPreviewId((value) => value + 1); }}>测试免费地图加载</button>}
    </div>
    {freePreview ? <div className="mt-4"><MapCanvas key={previewId} places={emptyPlaces} onReady={setReady} /><p role="status" className="mt-2 text-sm">{ready ? "免费地图已加载，可拖动、缩放。地点搜索在旅行详情中按需使用。" : "等待地图加载…"}</p></div> : null}
    <details className="mt-5 border-t border-sand pt-4"><summary className="min-h-11 cursor-pointer py-2 text-base font-semibold text-charcoal">可选：以后接入高德地图</summary>
      <p className="mt-2 text-sm leading-6 text-graphite">当前免费方案无需填写。高德需自行取得对应类型的 Key，并核对账号额度、域名和用途权限。已保存项可留空沿用；服务端密钥不会发送给地图页面。</p>
      <a href="https://console.amap.com/dev/key/app" target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-sage underline">高德控制台</a>
      <div className="mt-3 grid gap-3">{fields.map(([name, label]) => <label key={name} className="text-sm font-medium text-charcoal">{label}<input type="password" autoComplete="new-password" value={keys[name]} disabled={busy} maxLength={160} className="mt-1 min-h-12 w-full rounded-md border border-sand bg-cream px-3" onChange={(event) => { setKeys({ ...keys, [name]: event.target.value }); setTestToken(""); setReady(false); }} /></label>)}</div>
      <div className="mt-4 flex flex-wrap gap-3"><button type="button" className={button} disabled={busy} onClick={() => void test()}>{busy ? "处理中…" : "测试高德配置"}</button><button type="button" className={button} disabled={busy || !ready || !testToken} onClick={() => void save()}>保存并使用高德</button></div>
      {testToken ? <div className="mt-4"><MapCanvas key={previewId} places={emptyPlaces} preview onReady={setReady} /><p className="mt-2 text-sm">{ready ? "浏览器地图已加载，可以保存。" : "等待浏览器地图测试；失败时不会覆盖当前配置。"}</p></div> : null}
    </details>
    {feedback ? <p role="status" className="mt-4 rounded bg-shell p-3 text-sm leading-6 text-graphite">{feedback}</p> : null}
  </section>;
}
