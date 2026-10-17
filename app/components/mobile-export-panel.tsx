"use client";
import { businessFetch } from "@/lib/business-fetch";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExportFileSummary } from "@/lib/export-snapshot";
import { formatRedlineTime } from "@/lib/redlines";
type PanelData = { plan: { versionNumber: number; requestRevision: number; dates: string[] } | null; files: ExportFileSummary[] };
const button = "inline-flex min-h-12 items-center justify-center rounded-lg px-4 py-3 text-base font-semibold disabled:opacity-50";
export function MobileExportPanel({ tripId }: { tripId: string }) {
  const [data, setData] = useState<PanelData | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [date, setDate] = useState("all"), [includePrivateAddress, setPrivate] = useState(false), [includeSeats, setSeats] = useState(false), [publicLandmark, setLandmark] = useState("");
  const [selected, setSelected] = useState<ExportFileSummary | null>(null), [changed, setChanged] = useState(false);
  const active = useRef<AbortController | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);
  const read = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError("");
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const r = await businessFetch(`/api/trips/${tripId}/exports`, { cache: "no-store", signal: controller.signal });
      const body = await r.json(); if (!r.ok) throw new Error(body.error);
      setData(body); setSelected((old) => old ?? body.files[0] ?? null); setDate("all");
    } catch (e) { if (active.current === controller) setError(controller.signal.aborted ? "读取超时，请重试。" : e instanceof Error ? e.message : "读取失败，请重试。"); }
    finally { clearTimeout(timeout); if (active.current === controller) { active.current = null; setBusy(false); } }
  }, [tripId]);
  useEffect(() => { void read(); return () => { active.current?.abort(); active.current = null; }; }, [read]);
  async function generate() {
    if (!data?.plan || active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError("");
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const r = await businessFetch(`/api/trips/${tripId}/exports`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ expectedPlanVersion: data.plan.versionNumber, options: { dates: date === "all" ? null : [date], includePrivateAddress, includeSeats, publicLandmark } }) });
      const body = await r.json(); if (!r.ok) throw new Error(body.error);
      setSelected(body.file); setChanged(false); setData((old) => old ? { ...old, files: [body.file, ...old.files].slice(0, 20) } : old);
      if (window.innerWidth < 1024) previewRef.current?.scrollIntoView({ block: "start" });
    } catch (e) { setError(controller.signal.aborted ? "生成超时。请重新读取记录确认是否已保存，再决定重试。" : e instanceof Error ? e.message : "生成失败，请重新读取记录。"); }
    finally { clearTimeout(timeout); active.current = null; setBusy(false); }
  }
  const url = selected ? `/api/trips/${tripId}/exports/${selected.id}` : "";
  const edit = () => setChanged(true);
  return <div className="mt-7 grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
    <div className="contents lg:block lg:min-w-0 lg:space-y-5"><section className="rounded-2xl border border-sand bg-white p-5" aria-label="导出选项">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">准备随身资料</h2><button onClick={read} disabled={busy} className="min-h-11 text-sm text-sage underline">重新读取</button></div>
      {data?.plan ? <p className="mt-2 text-sm text-graphite">当前计划 V{data.plan.versionNumber} · 需求 R{data.plan.requestRevision}</p> : <p className="mt-3">{data ? "还没有已保存的计划，请返回旅行先生成。" : "正在读取旅行资料…"}</p>}
      <fieldset disabled={busy || !data?.plan} className="mt-4 space-y-4 disabled:opacity-60">
        <label className="block text-sm font-semibold">导出日期<select aria-label="导出日期" value={date} onChange={(e) => { setDate(e.target.value); edit(); }} className="mt-2 min-h-12 w-full rounded-lg border border-sand bg-cream px-3 text-base"><option value="all">全部日期</option>{data?.plan?.dates.map((d, i) => <option key={d} value={d}>第 {i + 1} 天 · {d}</option>)}</select></label>
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-sage" checked={includePrivateAddress} onChange={(e) => { setPrivate(e.target.checked); edit(); }} />包含私人起终点地址</label>
        {!includePrivateAddress && <label className="block text-sm">附近公共地标（选填）<input maxLength={100} value={publicLandmark} onChange={(e) => { setLandmark(e.target.value); edit(); }} placeholder="例如：市民中心南门" className="mt-2 min-h-12 w-full rounded-lg border border-sand px-3 text-base" /><span className="mt-2 block leading-6 text-graphite">仅供辨认。红线沿用原起点计算，不会按地标重算。</span></label>}
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-sage" checked={includeSeats} onChange={(e) => { setSeats(e.target.checked); edit(); }} />包含票面座位</label>
        <p className="text-sm leading-6 text-graphite">默认隐藏地址和座位；文件不包含定位坐标、图片或导航链接。</p>
        <button onClick={generate} className={`${button} w-full bg-sage text-white`}>{busy ? "正在生成…" : "生成预览"}</button>
      </fieldset>
      {error && <p role="alert" className="mt-4 rounded-lg bg-clay-soft p-3 text-clay">{error}</p>}
    </section>
    <section className="order-2 rounded-2xl border border-sand p-5 lg:order-none"><h2 className="font-semibold">保存与打开</h2><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-graphite"><li>生成后核对预览，再下载 .html 文件。</li><li>已验证 Windows Edge：在下载列表中打开文件，断网仍可阅读。</li><li>手机文件应用支持有差异。Android / iOS 真机打开方式尚待验证，暂不能承诺在所有手机上直接打开。</li></ol><p className="mt-3 text-sm leading-6 text-graphite">保存的文件不会自动同步旅行变化；应用里的预览需要本机服务，下载文件可独立阅读。</p></section>
    {Boolean(data?.files.length) && <section aria-label="导出记录" className="order-3 rounded-2xl border border-sand bg-white p-5 lg:order-none"><h2 className="font-semibold">最近导出</h2><p className="mt-2 text-sm text-graphite">保留原版本与选项，最多展示最近20份。</p><ul className="mt-3 space-y-3">{data!.files.map((f) => <li key={f.id}><button onClick={() => { setSelected(f); setChanged(false); if (window.innerWidth < 1024) previewRef.current?.scrollIntoView({ block: "start" }); }} aria-pressed={selected?.id === f.id} className={`min-h-12 w-full rounded-lg border p-3 text-left text-sm ${selected?.id === f.id ? "border-sage bg-sage/10" : "border-sand"}`}>V{f.planVersion} · {formatRedlineTime(f.generatedAt)}<span className="mt-1 block text-graphite">{f.options.dates?.join("、") ?? "全部日期"} · {f.options.includePrivateAddress ? "含私人地址" : "地址隐藏"} · {f.options.includeSeats ? "含座位" : "座位隐藏"}</span></button></li>)}</ul></section>}
    </div>
    <section ref={previewRef} className="order-1 min-w-0 rounded-2xl border border-sand bg-white p-3 sm:p-5 lg:order-none" aria-label="手机一页预览">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">随身预览</h2>{selected && <a className={`${button} bg-sage text-white`} href={`${url}?download=1`} download={selected.filename}>下载此 HTML</a>}</div>
      {selected ? <><p className="mt-3 text-sm leading-6 text-graphite">预览文件 V{selected.planVersion} / R{selected.requestRevision} · {formatRedlineTime(selected.generatedAt)} · {selected.options.dates?.join("、") ?? "全部日期"} · {selected.options.includePrivateAddress ? "含私人地址" : "地址已隐藏"} · {selected.options.includeSeats ? "含座位" : "座位已隐藏"}</p><p className="mt-2 text-sm text-graphite">这是生成时的快照，最新修改需重新生成。</p>{changed && <p role="status" className="mt-3 rounded-lg bg-clay-soft p-3 text-clay">选项已修改，请生成新预览；下载按钮仍对应当前展示的旧文件。</p>}<iframe key={selected.id} title="独立手机 HTML 预览" src={url} sandbox="" className="mt-4 h-[76dvh] min-h-[520px] w-full rounded-xl border border-sand" /></> : <div className="my-16 px-5 text-center leading-8 text-graphite">选择日期与隐私选项，<br />生成可以随身保存的行动资料。</div>}
    </section>
  </div>;
}
