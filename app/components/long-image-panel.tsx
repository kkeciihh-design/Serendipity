"use client";
import { businessFetch } from "@/lib/business-fetch";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExportFileSummary } from "@/lib/export-snapshot";
import { formatRedlineTime } from "@/lib/redlines";

type Panel = { plan: { versionNumber: number; requestRevision: number; dates: string[] } | null; files: ExportFileSummary[] };
const button = "inline-flex min-h-12 items-center justify-center rounded-lg border px-4 py-3 font-semibold disabled:opacity-50";
export function LongImagePanel({ tripId }: { tripId: string }) {
  const endpoint = `/api/trips/${tripId}/exports`;
  const [data, setData] = useState<Panel | null>(null), [file, setFile] = useState<ExportFileSummary | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [date, setDate] = useState("all"), [includePrivateAddress, setPrivate] = useState(false), [includeSeats, setSeats] = useState(false), [publicLandmark, setLandmark] = useState("");
  const [includeMap, setMap] = useState(true), [includePhotos, setPhotos] = useState(true), [failedImages, setFailedImages] = useState<number[]>([]), [retry, setRetry] = useState(0);
  const active = useRef<AbortController | null>(null), preview = useRef<HTMLElement | null>(null);
  const read = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError("");
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await businessFetch(`${endpoint}?kind=long-image`, { cache: "no-store", signal: controller.signal });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      if (!controller.signal.aborted) { setData(body); setFile(body.files[0] ?? null); setFailedImages([]); }
    } catch (e) { if (active.current === controller) setError(controller.signal.aborted ? "读取超时，请重试。" : e instanceof Error ? e.message : "读取失败，请重试。"); }
    finally { clearTimeout(timer); if (active.current === controller) { active.current = null; setBusy(false); } }
  }, [endpoint]);
  useEffect(() => { void read(); return () => { active.current?.abort(); active.current = null; }; }, [read]);
  async function generate() {
    if (!data?.plan || active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError("");
    const timer = setTimeout(() => controller.abort(), 75_000);
    try {
      const response = await businessFetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ expectedPlanVersion: data.plan.versionNumber, format: "long-image", options: { dates: date === "all" ? null : [date], includePrivateAddress, includeSeats, publicLandmark }, imageContent: { includeMap, includePhotos } }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      if (controller.signal.aborted) return;
      setFile(body.file); setFailedImages([]); setData((old) => old ? { ...old, files: [body.file, ...old.files].slice(0, 20) } : old);
      preview.current?.scrollIntoView({ block: "start" });
    } catch (e) { if (active.current === controller) setError(controller.signal.aborted ? "生成超时。请重新读取记录确认是否已保存，再重试。" : e instanceof Error ? e.message : "生成失败，请重试。"); }
    finally { clearTimeout(timer); if (active.current === controller) { active.current = null; setBusy(false); } }
  }
  const changed = file && ((file.options.dates?.join(",") ?? "all") !== date || file.options.includePrivateAddress !== includePrivateAddress || file.options.includeSeats !== includeSeats || file.options.publicLandmark !== publicLandmark.trim() || file.imageContent?.includeMap !== includeMap || file.imageContent?.includePhotos !== includePhotos);
  return <div className="mt-7 grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
    <div className="contents lg:block lg:space-y-5">
      <section aria-label="长图导出选项" className="rounded-2xl border border-sand bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">准备旅行长图</h2><button disabled={busy} onClick={read} className="min-h-11 text-sm text-sage underline disabled:opacity-50">重新读取</button></div>
        <p className="mt-2 text-sm text-graphite">{data?.plan ? `当前计划 V${data.plan.versionNumber} · 需求 R${data.plan.requestRevision}` : data ? "请先保存旅行计划。" : "正在读取旅行资料…"}</p>
        <fieldset disabled={busy || !data?.plan} className="mt-4 space-y-4 disabled:opacity-60">
          <label className="block font-semibold">导出日期<select value={date} onChange={(e) => setDate(e.target.value)} className="mt-2 min-h-12 w-full rounded-lg border border-sand bg-cream px-3"><option value="all">全部日期</option>{data?.plan?.dates.map((d, i) => <option key={d} value={d}>第 {i + 1} 天 · {d}</option>)}</select></label>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-sage" checked={includeMap} onChange={(e) => setMap(e.target.checked)} />包含位置示意图</label>
          <p className="text-sm leading-6 text-graphite">显示已确认公开地点和行程编号，无道路底图。私人标点不带出；无已确认地点时会注明。</p>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-sage" checked={includePhotos} onChange={(e) => setPhotos(e.target.checked)} />包含许可照片</label>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-sage" checked={includePrivateAddress} onChange={(e) => setPrivate(e.target.checked)} />包含私人起终点地址</label>
          {!includePrivateAddress && <label className="block text-sm">附近公共地标（选填）<input value={publicLandmark} maxLength={100} onChange={(e) => setLandmark(e.target.value)} placeholder="例如：市民中心南门" className="mt-2 min-h-12 w-full rounded-lg border border-sand px-3 text-base" /><span className="mt-2 block leading-6 text-graphite">仅供辨认，红线沿用原起点计算。</span></label>}
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-sage" checked={includeSeats} onChange={(e) => setSeats(e.target.checked)} />包含票面座位</label>
          <p className="text-sm leading-6 text-graphite">保留时间轴、红线、预算、来源和清单。内容较长时自动分图，保存时请收齐全部图片。</p>
          <button onClick={generate} className={`${button} w-full border-sage bg-sage text-white`}>{busy ? "正在生成…" : "生成长图预览"}</button>
        </fieldset>
        <p role="status" aria-live="polite" className="mt-3 text-sm text-sage">{busy ? "正在准备资料并生成图片，请稍候…" : file ? `已生成，共 ${file.parts?.length ?? 0} 张` : ""}</p>
        {error && <p role="alert" className="mt-3 rounded-lg bg-clay-soft p-3 text-clay">{error}</p>}
      </section>
      {!!data?.files.length && <section aria-label="长图导出记录" className="order-3 rounded-2xl border border-sand bg-white p-5"><h2 className="font-semibold">最近长图导出</h2><p className="mt-2 text-sm text-graphite">最近20份，保存各自生成时的资料。</p><ul className="mt-3 space-y-3">{data.files.map((f) => <li key={f.id}><button disabled={busy} aria-pressed={f.id === file?.id} onClick={() => { setFile(f); setFailedImages([]); }} className={`${button} w-full flex-col items-start border-sand text-left text-sm`}><span>V{f.planVersion} / R{f.requestRevision} · 共 {f.parts?.length} 张</span><span className="mt-1 text-graphite">{formatRedlineTime(f.generatedAt)}</span></button></li>)}</ul></section>}
    </div>
    <section ref={preview} aria-label="完整长图预览" className="order-1 min-w-0 scroll-mt-6 rounded-2xl border border-sand bg-white p-4 sm:p-5 lg:order-none">
      <h2 className="text-xl font-semibold">完整长图预览</h2>
      {file ? <><p className="mt-3 text-sm leading-7 text-graphite">共 {file.parts?.length} 张 · V{file.planVersion} / R{file.requestRevision} · 清单 {file.checklistRevision} / 执行 {file.executionRevision}<br />{formatRedlineTime(file.generatedAt)} · 静态快照，不自动更新</p>
        <p className="mt-2 text-sm text-graphite">{file.options.dates?.join("、") ?? "全部日期"} · {file.options.includePrivateAddress ? "含私人地址" : "地址隐藏"} · {file.options.includeSeats ? "含座位" : "座位隐藏"}</p>
        {changed && <p className="mt-3 rounded-lg bg-clay-soft p-3 text-sm text-clay">选项已改变，请生成新预览；当前下载仍是下面展示的旧文件。</p>}
        {(!file.requirementUpToDate || data?.plan?.versionNumber !== file.planVersion) && <p className="mt-3 text-sm text-clay">这份文件沿用生成时的计划资料；请核对是否需要重新生成。</p>}
        <p className="mt-3 text-sm leading-7 text-graphite">点“下载”保存 PNG，也可打开原图放大查看。传到手机后可保存至相册；请按编号收齐全部图片。</p>
        <div className="mt-5 space-y-8">{file.parts?.map((part) => <figure key={`${file.id}-${part.index}-${retry}`} className="min-w-0">
          <figcaption className="mb-3 flex flex-wrap items-center gap-2"><span className="mr-auto font-semibold">第 {part.index} / {file.parts!.length} 张</span><a className={`${button} border-sand text-sage`} href={`${endpoint}/${file.id}?part=${part.index}`} target="_blank" rel="noreferrer">打开原图 {part.index}</a><a className={`${button} border-sage bg-sage text-white`} href={`${endpoint}/${file.id}?part=${part.index}&download=1`} download={part.filename}>下载第 {part.index} 张</a></figcaption>
          <p className="mb-3 text-sm text-graphite">{part.width} × {part.height} 像素 · {(part.bytes / 1024 / 1024).toFixed(2)} MB</p>
          {failedImages.includes(part.index) ? <div role="alert" className="rounded-lg bg-clay-soft p-4 text-clay">第 {part.index} 张预览加载失败。<button className={`${button} ml-3 border-clay`} onClick={() => { setFailedImages([]); setRetry((n) => n + 1); }}>重试图片加载</button></div> : <img src={`${endpoint}/${file.id}?part=${part.index}`} alt={`旅行长图第 ${part.index} 张，共 ${file.parts!.length} 张`} width={part.width} height={part.height} onError={() => setFailedImages((old) => [...old, part.index])} className="block h-auto w-full rounded-lg border border-sand" />}
        </figure>)}</div>
      </> : <p className="my-20 text-center leading-8 text-graphite">选择日期和内容，<br />生成可以随身保存的旅行长图。</p>}
    </section>
  </div>;
}
