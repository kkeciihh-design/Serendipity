"use client";
import { businessFetch } from "@/lib/business-fetch";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExportFileSummary } from "@/lib/export-snapshot";
import { formatRedlineTime } from "@/lib/redlines";

type Panel = { plan: { versionNumber: number; requestRevision: number; dates: string[] } | null; files: ExportFileSummary[] };
const button = "inline-flex min-h-12 items-center justify-center rounded-lg border px-4 py-3 font-semibold disabled:opacity-50";
export function PdfPanel({ tripId }: { tripId: string }) {
  const endpoint = `/api/trips/${tripId}/exports`;
  const [data, setData] = useState<Panel | null>(null), [file, setFile] = useState<ExportFileSummary | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [date, setDate] = useState("all"), [mode, setMode] = useState("complete"), [photos, setPhotos] = useState(true);
  const [address, setAddress] = useState(false), [seats, setSeats] = useState(false), [landmark, setLandmark] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(""), [previewError, setPreviewError] = useState(""), [retry, setRetry] = useState(0);
  const active = useRef<AbortController | null>(null);
  const read = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError("");
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const r = await businessFetch(`${endpoint}?kind=pdf`, { cache: "no-store", signal: controller.signal });
      const body = await r.json(); if (!r.ok) throw new Error(body.error);
      if (!controller.signal.aborted) { setData(body); setFile(body.files[0] ?? null); }
    } catch (e) { if (active.current === controller) setError(controller.signal.aborted ? "读取超时，请重试。" : e instanceof Error ? e.message : "读取失败，请重试。"); }
    finally { clearTimeout(timer); if (active.current === controller) { active.current = null; setBusy(false); } }
  }, [endpoint]);
  useEffect(() => { void read(); return () => { active.current?.abort(); active.current = null; }; }, [read]);
  useEffect(() => {
    setPreviewUrl(""); setPreviewError(""); if (!file) return;
    const controller = new AbortController(); let url = "", disposed = false;
    const timer = setTimeout(() => controller.abort(), 20_000);
    void (async () => {
      try {
        const r = await businessFetch(`${endpoint}/${file.id}`, { cache: "no-store", signal: controller.signal });
        if (!r.ok || r.headers.get("content-type") !== "application/pdf") throw new Error("PDF预览加载失败，请重试或下载文件。");
        const blob = await r.blob(); if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob); setPreviewUrl(url);
      } catch { if (!disposed) setPreviewError(controller.signal.aborted ? "PDF预览读取超时，请重试。" : "PDF预览加载失败，请重试或下载文件。"); }
      finally { clearTimeout(timer); }
    })();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [endpoint, file, retry]);
  async function generate() {
    if (!data?.plan || active.current || !confirmed) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError("");
    const timer = setTimeout(() => controller.abort(), 75_000);
    try {
      const r = await businessFetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ expectedPlanVersion: data.plan.versionNumber, format: "pdf", options: { dates: date === "all" ? null : [date], includePrivateAddress: address, includeSeats: seats, publicLandmark: landmark }, pdfContent: { mode, includePhotos: photos } }) });
      const body = await r.json(); if (!r.ok) throw new Error(body.error);
      if (!controller.signal.aborted) { setFile(body.file); setData((old) => old ? { ...old, files: [body.file, ...old.files].slice(0, 20) } : old); }
    } catch (e) { if (active.current === controller) setError(controller.signal.aborted ? "生成超时。请重新读取记录确认是否已保存，再重试。" : e instanceof Error ? e.message : "生成失败，请重试。"); }
    finally { clearTimeout(timer); if (active.current === controller) { active.current = null; setBusy(false); } }
  }
  const changed = file && ((file.options.dates?.join(",") ?? "all") !== date || file.options.includePrivateAddress !== address || file.options.includeSeats !== seats || file.options.publicLandmark !== landmark.trim() || file.pdfContent?.mode !== mode || file.pdfContent?.includePhotos !== photos);
  return <div className="mt-7 grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
    <div className="contents lg:block lg:space-y-5">
      <section aria-label="PDF导出选项" className="rounded-2xl border border-sand bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">准备旅行手册</h2><button onClick={read} disabled={busy} className="min-h-11 text-sm text-sage underline">重新读取</button></div>
        <p className="mt-2 text-sm text-graphite">{data?.plan ? `当前计划 V${data.plan.versionNumber} · 需求 R${data.plan.requestRevision}` : data ? "请先保存旅行计划。" : "正在读取旅行资料…"}</p>
        <fieldset disabled={busy || !data?.plan} className="mt-4 space-y-4 disabled:opacity-60">
          <label className="block font-semibold">资料内容<select value={mode} onChange={(e) => { setMode(e.target.value); setConfirmed(false); }} className="mt-2 min-h-12 w-full rounded-lg border border-sand bg-cream px-3"><option value="complete">完整手册 · 含每日地图</option><option value="simplified">简化资料 · 无地图</option></select></label>
        <p className="text-sm leading-6 text-graphite">完整手册包含每日动线、行程、天气、预算和清单。建议地点按当日顺序绘制，出发前请核对入口。</p>
          <label className="block font-semibold">导出日期<select value={date} onChange={(e) => { setDate(e.target.value); setConfirmed(false); }} className="mt-2 min-h-12 w-full rounded-lg border border-sand bg-cream px-3"><option value="all">全部日期</option>{data?.plan?.dates.map((d, i) => <option key={d} value={d}>第 {i + 1} 天 · {d}</option>)}</select></label>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-sage" checked={photos} onChange={(e) => setPhotos(e.target.checked)} />包含许可照片</label>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-sage" checked={address} onChange={(e) => { setAddress(e.target.checked); setConfirmed(false); }} />包含私人起终点地址</label>
          {!address && <label className="block text-sm">附近公共地标（选填）<input value={landmark} maxLength={100} onChange={(e) => { setLandmark(e.target.value); setConfirmed(false); }} placeholder="例如：市民中心南门" className="mt-2 min-h-12 w-full rounded-lg border border-sand px-3 text-base" /></label>}
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-sage" checked={seats} onChange={(e) => { setSeats(e.target.checked); setConfirmed(false); }} />包含票面座位</label>
          <p className="text-sm leading-6 text-graphite">私人地图标点始终隐藏；红线沿用原起点计算。地图为公开地点位置示意，无道路底图。下载后资料不自动更新。</p>
          <label className="flex min-h-11 items-center gap-3 font-semibold"><input type="checkbox" className="size-5 shrink-0 accent-sage" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />已确认以上隐私选项</label>
          <button disabled={!confirmed} onClick={generate} className={`${button} w-full border-sage bg-sage text-white`}>生成PDF预览</button>
        </fieldset>
        <p role="status" aria-live="polite" className="mt-3 text-sm text-sage">{busy ? "正在准备旅行资料，请稍候…" : file ? `已生成，共 ${file.pdf?.pages} 页` : ""}</p>
        {error && <p role="alert" className="mt-3 rounded-lg bg-clay-soft p-3 text-clay">{error}</p>}
      </section>
      {!!data?.files.length && <section aria-label="PDF导出记录" className="order-3 rounded-2xl border border-sand bg-white p-5"><h2 className="font-semibold">最近PDF导出</h2><p className="mt-2 text-sm text-graphite">最近20份，保存各自生成时的资料。</p><ul className="mt-3 space-y-3">{data.files.map((f) => <li key={f.id}><button disabled={busy} aria-pressed={f.id === file?.id} onClick={() => setFile(f)} className={`${button} w-full flex-col items-start border-sand text-left text-sm`}><span>{f.pdfContent?.mode === "complete" ? "完整手册" : "简化资料"} · {f.pdf?.pages} 页</span><span>V{f.planVersion} / R{f.requestRevision} · {formatRedlineTime(f.generatedAt)}</span></button></li>)}</ul></section>}
    </div>
    <section aria-label="PDF手册预览" className="order-1 min-w-0 rounded-2xl border border-sand bg-white p-4 sm:p-5 lg:order-none">
      <h2 className="text-xl font-semibold">PDF手册预览</h2>
      {file ? <><p className="mt-3 text-sm leading-7 text-graphite">{file.pdfContent?.mode === "complete" ? "完整手册" : "简化资料 · 无地图"} · 共 {file.pdf?.pages} 页 · {((file.pdf?.bytes ?? 0) / 1024 / 1024).toFixed(2)} MB<br />V{file.planVersion} / R{file.requestRevision} · 清单 {file.checklistRevision} / 执行 {file.executionRevision}<br />{formatRedlineTime(file.generatedAt)} · 静态快照，不自动更新</p>
        <p className="mt-2 text-sm text-graphite">{file.options.dates?.join("、") ?? "全部日期"} · {file.options.includePrivateAddress ? "含私人地址" : "地址隐藏"} · {file.options.includeSeats ? "含座位" : "座位隐藏"}</p>
        {changed && <p className="mt-3 rounded-lg bg-clay-soft p-3 text-sm text-clay">选项已改变，请生成新预览；当前下载仍是下面展示的旧文件。</p>}
        {(!file.requirementUpToDate || data?.plan?.versionNumber !== file.planVersion) && <p className="mt-3 text-sm text-clay">这份文件沿用生成时的计划资料；请核对是否需要重新生成。</p>}
        <div className="my-4 flex flex-wrap gap-3"><a href={`${endpoint}/${file.id}`} target="_blank" rel="noreferrer" className={`${button} border-sand text-sage`}>打开PDF</a><a href={`${endpoint}/${file.id}?download=1`} download={file.filename} className={`${button} border-sage bg-sage text-white`}>下载PDF</a></div>
        <p className="mb-4 text-sm leading-6 text-graphite">A4纵向，可保存后离线阅读或打印。若浏览器不支持内嵌预览，请打开或下载至文件查看器。</p>
        {previewError ? <div role="alert" className="rounded-lg bg-clay-soft p-4 text-clay">{previewError}<button onClick={() => setRetry((v) => v + 1)} className={`${button} mt-3 border-clay`}>重试PDF预览</button></div> : previewUrl ? <iframe title="PDF旅行手册全部页面" src={previewUrl} className="h-[75vh] min-h-96 w-full rounded-lg border border-sand" /> : <p className="py-16 text-center text-graphite">正在加载PDF预览…</p>}
      </> : <p className="my-20 text-center leading-8 text-graphite">选择内容并确认隐私选项，<br />生成可以保存和打印的旅行手册。</p>}
    </section>
  </div>;
}
