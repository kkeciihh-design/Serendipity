"use client";
import { businessFetch } from "@/lib/business-fetch";
import { useCallback, useEffect, useRef, useState } from "react";
import { exportFormatLabels, type ExportFileSummary, type TextExportFormat } from "@/lib/export-snapshot";
import { formatRedlineTime } from "@/lib/redlines";

type PanelData = { plan: { versionNumber: number; requestRevision: number; dates: string[] } | null; files: ExportFileSummary[] };
const button = "inline-flex min-h-12 items-center justify-center rounded-lg border px-4 py-3 text-base font-semibold disabled:opacity-50";
export function TextExportPanel({ tripId }: { tripId: string }) {
  const [data, setData] = useState<PanelData | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [format, setFormat] = useState<TextExportFormat>("plain-text"), [date, setDate] = useState("all");
  const [includePrivateAddress, setPrivate] = useState(false), [includeSeats, setSeats] = useState(false), [publicLandmark, setLandmark] = useState("");
  const [preview, setPreview] = useState<{ file: ExportFileSummary; text: string } | null>(null);
  const [copyStatus, setCopyStatus] = useState(""), [copying, setCopying] = useState(false);
  const active = useRef<AbortController | null>(null), textarea = useRef<HTMLTextAreaElement | null>(null), previewRegion = useRef<HTMLElement | null>(null);
  const endpoint = `/api/trips/${tripId}/exports`;

  const loadFile = useCallback(async (file: ExportFileSummary, signal: AbortSignal) => {
    const response = await businessFetch(`${endpoint}/${file.id}`, { cache: "no-store", signal });
    if (!response.ok) throw new Error((await response.json()).error ?? "文件读取失败，请重试。");
    const text = await response.text();
    if (signal.aborted) return;
    setPreview({ file, text }); setCopyStatus("");
  }, [endpoint]);
  const read = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError("");
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await businessFetch(`${endpoint}?kind=text`, { cache: "no-store", signal: controller.signal });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      if (controller.signal.aborted) return;
      setData(body);
      if (body.files[0]) await loadFile(body.files[0], controller.signal); else setPreview(null);
    } catch (e) { if (active.current === controller) setError(controller.signal.aborted ? "读取超时，请重试。" : e instanceof Error ? e.message : "读取失败，请重试。"); }
    finally { clearTimeout(timeout); if (active.current === controller) { active.current = null; setBusy(false); } }
  }, [endpoint, loadFile]);
  useEffect(() => { void read(); return () => { active.current?.abort(); active.current = null; }; }, [read]);

  async function selectFile(file: ExportFileSummary) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError("");
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      await loadFile(file, controller.signal);
      if (!controller.signal.aborted) previewRegion.current?.scrollIntoView({ block: "start" });
    } catch (e) { if (active.current === controller) setError(controller.signal.aborted ? "文件读取超时，请重试。" : e instanceof Error ? e.message : "文件读取失败，请重试。"); }
    finally { clearTimeout(timeout); if (active.current === controller) { active.current = null; setBusy(false); } }
  }
  async function generate() {
    if (!data?.plan || active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError("");
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await businessFetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ expectedPlanVersion: data.plan.versionNumber, format, options: { dates: date === "all" ? null : [date], includePrivateAddress, includeSeats, publicLandmark } }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      if (controller.signal.aborted) return;
      setData((old) => old ? { ...old, files: [body.file, ...old.files].slice(0, 20) } : old);
      await loadFile(body.file, controller.signal);
      if (!controller.signal.aborted && window.innerWidth < 1024) previewRegion.current?.scrollIntoView({ block: "start" });
    } catch (e) { if (active.current === controller) setError(controller.signal.aborted ? "生成超时。请重新读取记录确认是否已保存，再决定重试。" : e instanceof Error ? e.message : "生成失败，请重新读取记录。"); }
    finally { clearTimeout(timeout); if (active.current === controller) { active.current = null; setBusy(false); } }
  }
  function selectAll() {
    textarea.current?.focus(); textarea.current?.select();
    setCopyStatus("已全选完整文字。请按 Ctrl+C（Mac 为 ⌘C），或使用系统的复制菜单；也可以直接下载文件。");
  }
  async function copy() {
    if (!preview || copying) return;
    setCopying(true); setCopyStatus("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("unavailable");
      await navigator.clipboard.writeText(preview.text);
      setCopyStatus(`已复制完整${exportFormatLabels[preview.file.format]}，可粘贴到备忘录或聊天输入框。`);
    } catch {
      textarea.current?.focus(); textarea.current?.select();
      setCopyStatus("自动复制不可用或权限被拒绝。已全选完整文字，请手动复制，或下载文件。");
    } finally { setCopying(false); }
  }
  const file = preview?.file;
  const changed = file && (file.format !== format || (file.options.dates?.join(",") ?? "all") !== date || file.options.includePrivateAddress !== includePrivateAddress || file.options.includeSeats !== includeSeats || file.options.publicLandmark !== publicLandmark.trim());
  return <div className="mt-7 grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
    <div className="contents lg:block lg:space-y-5">
      <section aria-label="文字导出选项" className="rounded-2xl border border-sand bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">准备文字资料</h2><button onClick={read} disabled={busy || copying} className="min-h-11 text-sm text-sage underline disabled:opacity-50">重新读取</button></div>
        <p className="mt-2 text-sm text-graphite">{data?.plan ? `当前计划 V${data.plan.versionNumber} · 需求 R${data.plan.requestRevision}` : data ? "还没有已保存的计划，请返回旅行先生成。" : "正在读取旅行资料…"}</p>
        <fieldset disabled={busy || copying || !data?.plan} className="mt-4 space-y-4 disabled:opacity-60">
          <label className="block text-sm font-semibold">文字格式<select value={format} onChange={(e) => setFormat(e.target.value as TextExportFormat)} className="mt-2 min-h-12 w-full rounded-lg border border-sand bg-cream px-3 text-base"><option value="plain-text">纯文字（.txt）</option><option value="markdown">Markdown（.md）</option></select></label>
          <label className="block text-sm font-semibold">导出日期<select value={date} onChange={(e) => setDate(e.target.value)} className="mt-2 min-h-12 w-full rounded-lg border border-sand bg-cream px-3 text-base"><option value="all">全部日期</option>{data?.plan?.dates.map((d, i) => <option key={d} value={d}>第 {i + 1} 天 · {d}</option>)}</select></label>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-sage" checked={includePrivateAddress} onChange={(e) => setPrivate(e.target.checked)} />包含私人起终点地址</label>
          {!includePrivateAddress && <label className="block text-sm">附近公共地标（选填）<input maxLength={100} value={publicLandmark} onChange={(e) => setLandmark(e.target.value)} placeholder="例如：市民中心南门" className="mt-2 min-h-12 w-full rounded-lg border border-sand px-3 text-base" /><span className="mt-2 block leading-6 text-graphite">仅供辨认，红线沿用原起点计算。</span></label>}
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-sage" checked={includeSeats} onChange={(e) => setSeats(e.target.checked)} />包含票面座位</label>
          <p className="text-sm leading-6 text-graphite">默认隐藏地址和座位，保留来源名称与待确认提示。文件使用 UTF-8 编码。</p>
          <button onClick={generate} className={`${button} w-full border-sage bg-sage text-white`}>{busy ? "正在处理…" : "生成文字预览"}</button>
        </fieldset>
        {error && <p role="alert" className="mt-4 rounded-lg bg-clay-soft p-3 text-clay">{error}</p>}
      </section>
      <section className="order-2 rounded-2xl border border-sand p-5"><h2 className="font-semibold">复制后随身带走</h2><p className="mt-3 text-sm leading-7 text-graphite">纯文字适合备忘录和聊天；Markdown 保留标题与清单标记。复制后可自行粘贴，或下载文件保存。文字不会自动同步旅行的后续修改。</p></section>
      {!!data?.files.length && <section aria-label="文字导出记录" className="order-3 rounded-2xl border border-sand bg-white p-5"><h2 className="font-semibold">最近文字导出</h2><p className="mt-2 text-sm text-graphite">展示最近20份，各自保留生成时的选项。</p><ul className="mt-3 space-y-3">{data.files.map((f) => <li key={f.id}><button disabled={busy || copying} onClick={() => selectFile(f)} aria-pressed={file?.id === f.id} className={`min-h-12 w-full rounded-lg border p-3 text-left text-sm disabled:opacity-50 ${file?.id === f.id ? "border-sage bg-sage/10" : "border-sand"}`}><span>{exportFormatLabels[f.format]} · V{f.planVersion} / R{f.requestRevision}</span><span className="mt-1 block text-graphite">{formatRedlineTime(f.generatedAt)}</span><span className="mt-1 block text-graphite">{f.options.dates?.join("、") ?? "全部日期"} · {f.options.includePrivateAddress ? "含私人地址" : "地址隐藏"} · {f.options.includeSeats ? "含座位" : "座位隐藏"}</span></button></li>)}</ul></section>}
    </div>
    <section ref={previewRegion} aria-label="文字预览" className="order-1 min-w-0 scroll-mt-6 rounded-2xl border border-sand bg-white p-4 sm:p-5 lg:order-none">
      <h2 className="text-xl font-semibold">文字预览</h2>
      {preview && file ? <>
        <p className="mt-3 text-sm leading-6 text-graphite">{exportFormatLabels[file.format]} · V{file.planVersion} / R{file.requestRevision} · 清单 {file.checklistRevision} / 执行 {file.executionRevision} · {formatRedlineTime(file.generatedAt)}</p>
        <p className="mt-1 text-sm text-graphite">{file.options.dates?.join("、") ?? "全部日期"} · {file.options.includePrivateAddress ? "含私人地址" : "地址已隐藏"} · {file.options.includeSeats ? "含座位" : "座位已隐藏"}。当前复制与下载均对应这份快照。</p>
        {changed && <p className="mt-3 rounded-lg bg-clay-soft p-3 text-sm leading-6 text-clay">选项与当前文件不同，请生成新预览；复制和下载仍对应当前展示的旧文件。</p>}
        {!file.requirementUpToDate && <p className="mt-3 text-sm text-clay">计划待更新：文件沿用该计划自己的需求依据。</p>}
        <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy || copying} onClick={copy} className={`${button} border-sage bg-sage text-white`}>{copying ? "正在复制…" : "复制全文"}</button><button onClick={selectAll} className={`${button} border-sand text-sage`}>全选文字</button><a href={`${endpoint}/${file.id}?download=1`} download={file.filename} className={`${button} border-sand text-sage`}>下载 {file.format === "markdown" ? ".md" : ".txt"}</a></div>
        <p role="status" aria-live="polite" className="mt-3 min-h-6 text-sm leading-6 text-sage">{copyStatus}</p>
        <textarea ref={textarea} aria-label="导出文字" readOnly spellCheck={false} value={preview.text} className="mt-3 h-[70dvh] min-h-[480px] w-full resize-y rounded-xl border border-sand bg-cream p-4 text-base leading-8 text-charcoal focus:outline-2 focus:outline-sage" />
      </> : <p className="my-20 text-center leading-8 text-graphite">选择格式与隐私选项，<br />生成一份可以独立阅读的行程。</p>}
    </section>
  </div>;
}
