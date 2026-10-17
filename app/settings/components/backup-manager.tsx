"use client";
import { useEffect, useState } from "react";
import { Download, FileJson, RotateCcw, ShieldCheck } from "lucide-react";
import { businessFetch } from "@/lib/business-fetch";
import type { previewRestore, readInstanceState } from "@/scripts/restore-core.mjs";

type Preview = ReturnType<typeof previewRestore> & { previewToken: string };
type State = ReturnType<typeof readInstanceState>;
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium disabled:opacity-50";
export function BackupManager({ csrfToken }: { csrfToken: string }) {
  const [backup, setBackup] = useState<unknown>(null), [filename, setFilename] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null), [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<State | null>(null), [busy, setBusy] = useState("");
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const refresh = async () => {
    const r = await fetch("/api/data-management/status", { cache: "no-store" });
    if (r.ok) setState(await r.json());
  };
  useEffect(() => { const timer = setInterval(() => { void refresh(); }, 2000); void refresh(); return () => clearInterval(timer); }, []);
  async function post(body: unknown) {
    const response = await businessFetch("/api/settings/backup", { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "恢复处理失败。");
    return result;
  }
  async function select(file?: File) {
    setPreview(null); setConfirmed(false); setBackup(null); setError(""); setMessage(""); setFilename(file?.name ?? "");
    if (!file) return;
    setBusy("正在校验备份");
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error("备份超过64 MiB上限。");
      let content; try { content = JSON.parse(await file.text()); } catch { throw new Error("文件不是有效的JSON旅行备份。"); }
      const result = await post({ action: "preview", backup: content });
      setBackup(content); setPreview(result);
    } catch (e) { setError(e instanceof Error ? e.message : "校验失败。"); }
    finally { setBusy(""); }
  }
  async function download() {
    setBusy("正在生成备份"); setError("");
    try {
      const r = await fetch("/api/settings/backup", { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json()).error ?? "下载失败。");
      const url = URL.createObjectURL(await r.blob()), a = document.createElement("a");
      a.href = url; a.download = `Serendipity-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage("旅行备份已生成，请保留下载的JSON文件。");
    } catch (e) { setError(e instanceof Error ? e.message : "下载失败。"); }
    finally { setBusy(""); }
  }
  async function restore(resume = false) {
    if (!resume && (!confirmed || !preview || !backup)) return;
    setBusy(resume ? "正在接续恢复处理" : "恢复中，业务写入已暂停"); setError(""); setMessage("");
    try {
      await post(resume ? { action: "resume" } : { action: "restore", backup, previewToken: preview!.previewToken, confirmed: true });
      setPreview(null); setBackup(null); setConfirmed(false);
      setMessage("恢复处理完成。请重新载入页面，读取恢复后的旅行数据。");
    } catch (e) { setError(e instanceof Error ? e.message : "恢复失败，请查看恢复记录。"); }
    finally { setBusy(""); await refresh(); }
  }
  return <section id="data-management" aria-labelledby="backup-heading" className="mt-8 rounded-3xl border border-sage/20 bg-white p-5 shadow-sm sm:p-8">
    <div className="flex items-start gap-3"><ShieldCheck aria-hidden="true" className="mt-1 size-6 shrink-0 text-sage" /><div>
      <p className="text-sm font-medium text-sage">数据管理</p><h2 id="backup-heading" className="mt-1 text-2xl font-bold text-charcoal">留一份旅行备份</h2>
      <p className="mt-3 text-sm leading-6 text-graphite">保存旅行需求、计划历史、票据必要信息、费用、来源、清单和执行进度。升级或换电脑后，可用同一份文件恢复。</p>
    </div></div>
    <p className="mt-4 rounded-xl bg-cream p-4 text-sm leading-6 text-graphite">备份含私人旅行资料，请妥善保管。文件不含服务密钥、登录会话或票据原图。恢复保留当前管理员与服务设置；原导出缓存和待应用候选会清除，旅行资料恢复后可重新导出。</p>
    <div className="mt-5 flex flex-wrap gap-3">
      <button type="button" className={`${button} bg-sage text-white`} disabled={!!busy || !!state?.activeRestoreId} onClick={download}><Download className="size-4" aria-hidden="true" />下载旅行备份</button>
      <label className={`${button} cursor-pointer border border-sage/30 text-charcoal`}><FileJson className="size-4" aria-hidden="true" />从备份恢复
        <input aria-label="选择旅行备份" type="file" accept=".json,application/json" className="sr-only" disabled={!!busy || !!state?.activeRestoreId} onChange={(e) => { void select(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
    </div>
    {filename && <p className="mt-3 break-all text-xs text-graphite">已选择：{filename}</p>}
    {preview && <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-5">
      <h3 className="font-bold text-charcoal">恢复摘要与影响范围</h3>
      <p className="mt-3 text-sm leading-6">备份包含 <strong>{preview.incoming.trips} 趟旅行</strong>、{preview.incoming.plans} 个计划版本、{preview.incoming.events} 条历史事件。创建于 {new Date(preview.incoming.createdAt).toLocaleString("zh-CN")}。</p>
      {!!preview.incoming.titles.length && <p className="mt-2 break-words text-sm text-graphite">{preview.incoming.titles.join("、")}{preview.incoming.trips > 20 ? "等" : ""}</p>}
      <p className="mt-3 text-sm font-medium">当前 {preview.current.trips} 趟旅行及其全部历史将被备份中的内容替换，不会合并。{preview.incoming.trips === 0 ? "这是一份空备份，恢复后旅行列表将为空。" : ""}</p>
      <p className="mt-2 text-sm leading-6">确认后暂停写入，先在本机制作并验证安全副本。失败时保护原数据或回退；完成处理后，所有旧页面须重新载入。</p>
      <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-6"><input className="mt-1 size-5 shrink-0" type="checkbox" checked={confirmed} disabled={!!busy} onChange={(e) => setConfirmed(e.target.checked)} />我已核对，确认用此备份替换当前全部旅行数据。</label>
      <button type="button" disabled={!confirmed || !!busy} onClick={() => restore()} className={`${button} mt-3 bg-charcoal text-white`}><RotateCcw className="size-4" aria-hidden="true" />确认恢复旅行</button>
    </div>}
    {busy && <p role="status" className="mt-4 text-sm text-sage">{busy}…</p>}
    {state?.activeRestoreId && <div role="status" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm"><p>恢复处理中，业务写入暂停。处理未完成时可接续，安全副本保留在本机。</p><button disabled={!!busy} className={`${button} mt-2 border border-sage/30`} onClick={() => restore(true)}>接续未完成的恢复</button></div>}
    {error && <p role="alert" className="mt-4 text-sm leading-6 text-red-800">{error}</p>}
    {message && <p role="status" className="mt-4 text-sm leading-6 text-sage">{message}</p>}
    {state?.history.length ? <div className="mt-6 border-t border-sage/15 pt-5"><h3 className="font-semibold text-charcoal">恢复记录</h3><ul className="mt-3 space-y-3">{state.history.map((item) => <li key={item.id} className="text-sm leading-6"><span className="text-graphite">{new Date(item.startedAt).toLocaleString("zh-CN")} · {item.source === "technical" ? "技术恢复" : "网页恢复"}</span><p>{item.message}</p></li>)}</ul></div> : null}
  </section>;
}
