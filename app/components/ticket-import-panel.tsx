"use client";

import { useEffect, useRef, useState } from "react";
import type { Ticket } from "@/lib/tickets";
import type { RecognitionDraft, RecognizedTicket } from "@/lib/ticket-ocr";
import { ticketDuplicateHints, type ImportResolution, type TicketImportSource } from "@/lib/ticket-import";

const button = "min-h-12 rounded-md border border-sage px-4 py-2 text-sm font-semibold text-sage disabled:opacity-50";
const input = "mt-1 min-h-12 w-full min-w-0 rounded-md border border-sand bg-white px-3 text-base";
type Result = RecognitionDraft & Omit<TicketImportSource, "imageFingerprint">;
export type ImportReview = { fields: RecognizedTicket; source: TicketImportSource; resolution: ImportResolution; targetId?: string };

export function TicketImportPanel({ tickets, disabled, onReview, onRefund, onDiscard }: {
  tickets: Ticket[]; disabled: boolean; onReview: (review: ImportReview) => void; onRefund: (id: string) => void; onDiscard: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [crop, setCrop] = useState({ left: 0, top: 0, right: 100, bottom: 100 });
  const [fingerprint, setFingerprint] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [documentKind, setDocumentKind] = useState<TicketImportSource["documentKind"]>("unknown");
  const [segment, setSegment] = useState(0);
  const [resolution, setResolution] = useState<ImportResolution | "same" | "refund" | "">("");
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const discard = useRef(onDiscard);
  discard.current = onDiscard;
  const selectionStart = useRef<{ x: number; y: number } | null>(null);
  const clear = () => { sequence.current++; controller.current?.abort(); setBusy(false); setBitmap(null); setResult(null); setFingerprint(""); setResolution(""); setTargetId(""); discard.current(); };
  useEffect(() => () => { bitmap?.close(); }, [bitmap]);
  useEffect(() => () => { sequence.current++; controller.current?.abort(); }, []);
  useEffect(() => {
    if (!bitmap) return;
    const expiry = setTimeout(() => { clear(); setMessage("临时票图已在 30 分钟后清除，请重新选择。"); }, 30 * 60_000);
    return () => clearTimeout(expiry);
    // The expiry belongs to this image, not to edits in its review form.
  }, [bitmap]);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context || !bitmap) return;
    element.width = bitmap.width; element.height = bitmap.height;
    context.drawImage(bitmap, 0, 0);
    context.fillStyle = "rgba(0,0,0,0.5)";
    const x = bitmap.width * crop.left / 100, y = bitmap.height * crop.top / 100;
    const width = bitmap.width * (crop.right - crop.left) / 100, height = bitmap.height * (crop.bottom - crop.top) / 100;
    context.fillRect(0, 0, bitmap.width, y); context.fillRect(0, y + height, bitmap.width, bitmap.height - y - height);
    context.fillRect(0, y, x, height); context.fillRect(x + width, y, bitmap.width - x - width, height);
    context.strokeStyle = "#44735e"; context.lineWidth = Math.max(3, bitmap.width / 200); context.strokeRect(x, y, width, height);
  }, [bitmap, crop, open]);

  const choose = async (file?: File) => {
    clear(); setMessage("");
    if (!file) return;
    const run = sequence.current;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024 || !file.size) { setMessage("请选择不超过 10MB 的 PNG、JPEG 或 WebP 静态图片。"); return; }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const signature = file.type === "image/png" ? bytes.slice(0, 8).join() === "137,80,78,71,13,10,26,10" : file.type === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
      if (!signature) throw new Error("文件实际格式与图片类型不符，请选择 PNG、JPEG 或 WebP。");
      const image = await createImageBitmap(file);
      if (image.width * image.height > 20_000_000) { image.close(); throw new Error("图片超过 2000 万像素，请先缩小图片。"); }
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      if (run !== sequence.current) { image.close(); return; }
      setFingerprint([...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, "0")).join(""));
      setBitmap(image); setCrop({ left: 0, top: 0, right: 100, bottom: 100 });
    } catch (error) { if (run === sequence.current) setMessage(error instanceof Error ? error.message : "图片无法读取。"); }
  };
  const rotate = async () => {
    if (!bitmap) return;
    const element = document.createElement("canvas"); element.width = bitmap.height; element.height = bitmap.width;
    const context = element.getContext("2d")!; context.translate(element.width, 0); context.rotate(Math.PI / 2); context.drawImage(bitmap, 0, 0);
    const rotated = await createImageBitmap(element);
    setBitmap(rotated); setCrop({ left: 0, top: 0, right: 100, bottom: 100 }); setResult(null); onDiscard();
  };
  const recognize = async () => {
    if (!bitmap || busy || crop.right <= crop.left || crop.bottom <= crop.top) return;
    const run = ++sequence.current;
    setBusy(true); setMessage(""); setResult(null); onDiscard();
    const element = document.createElement("canvas");
    const width = bitmap.width * (crop.right - crop.left) / 100, height = bitmap.height * (crop.bottom - crop.top) / 100;
    const scale = Math.min(1, 2400 / Math.max(width, height));
    element.width = Math.max(1, Math.round(width * scale)); element.height = Math.max(1, Math.round(height * scale));
    element.getContext("2d")!.drawImage(bitmap, bitmap.width * crop.left / 100, bitmap.height * crop.top / 100, width, height, 0, 0, element.width, element.height);
    controller.current = new AbortController();
    try {
      const response = await fetch("/api/ticket-import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: element.toDataURL("image/png") }), signal: controller.current.signal });
      const payload = await response.json();
      if (run !== sequence.current) return;
      if (!response.ok || !payload.draft) throw new Error(payload.error ?? "识别失败，请重试。");
      setResult(payload.draft); setDocumentKind(payload.draft.documentKind); setSegment(0); setTargetId(""); setResolution("");
    } catch (error) { if (run === sequence.current) setMessage(error instanceof Error && error.name === "AbortError" ? "识别已取消。" : error instanceof Error ? error.message : "识别失败。"); }
    finally { if (run === sequence.current) setBusy(false); element.width = element.height = 0; }
  };
  const selected = result?.segments[segment];
  const source = result ? { engine: result.engine, recognizedAt: result.recognizedAt, documentKind: result.documentKind, confirmedDocumentKind: documentKind, cropFingerprint: result.cropFingerprint, imageFingerprint: fingerprint } : null;
  const duplicates = selected && source ? ticketDuplicateHints(tickets, selected.fields, source) : [];
  const active = tickets.filter((ticket) => ticket.status === "active");
  const positions = { left: "左边界", top: "上边界", right: "右边界", bottom: "下边界" };
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)) }; };
  return <section className="mt-4 min-w-0 rounded-md border border-sand bg-cream p-4" aria-label="截图导入">
    <button className={button} disabled={disabled} onClick={() => { if (open) { clear(); setMessage(""); } setOpen(!open); }}>{open ? "关闭并清除票图" : "导入高铁票截图"}</button>
    {open ? <div className="mt-3 min-w-0 space-y-3">
      <p className="text-sm leading-6 text-graphite">先裁剪票面、移除姓名和证件等无关区域。仅选中区域发送到本机 OCR，不发往第三方。图片只在内存中使用，关闭、提交或 30 分钟后清除；不会进入相册或日志。</p>
      <label className="block text-sm font-semibold">选择票图（PNG / JPEG / WebP，≤10MB）<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || disabled} className={`${input} py-2`} onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = ""; }} /></label>
      {bitmap ? <>
        <p className="text-xs leading-5 text-graphite">拖动画出票面区域，或用下方百分比调整边界。旋转至文字朝上后识别。</p>
        <canvas ref={canvas} role="img" aria-label="本机票图裁剪预览" className="block h-auto max-h-[500px] max-w-full touch-none" onPointerDown={(event) => { if (busy) return; selectionStart.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={(event) => {
          const start = selectionStart.current; if (!start || busy) return; const end = point(event); selectionStart.current = null;
          if (Math.abs(end.x - start.x) > 1 && Math.abs(end.y - start.y) > 1) { setCrop({ left: Math.min(start.x, end.x), right: Math.max(start.x, end.x), top: Math.min(start.y, end.y), bottom: Math.max(start.y, end.y) }); setResult(null); onDiscard(); }
        }} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(Object.keys(positions) as Array<keyof typeof crop>).map((key) => <label key={key} className="text-sm">{positions[key]}（%）<input type="number" min={0} max={100} step={1} value={Math.round(crop[key])} disabled={busy || disabled} className={input} onChange={(event) => { setCrop({ ...crop, [key]: Math.max(0, Math.min(100, Number(event.target.value))) }); setResult(null); onDiscard(); }} /></label>)}</div>
        <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || disabled} onClick={() => void rotate()}>顺时针旋转 90°</button><button className={`${button} bg-sage text-white`} disabled={busy || disabled || crop.right <= crop.left || crop.bottom <= crop.top} onClick={() => void recognize()}>{busy ? "本机识别中…" : "识别选中区域"}</button>{busy ? <button className={button} onClick={() => { sequence.current++; controller.current?.abort(); setBusy(false); setMessage("识别已取消，计划没有改变。"); }}>取消识别</button> : null}</div>
      </> : null}
      {message ? <p role="alert" className="text-sm leading-6 text-clay">{message}</p> : null}
      {selected && source ? <div className="space-y-3 rounded-md border border-sand bg-white p-3" aria-label="识别预览">
        <h5 className="font-semibold">识别完成 · 等待核对</h5>
        <p className="text-sm text-clay">{result!.documentKind === "refund" ? "检测到退票资料，需指定原票并确认已退事实。" : result!.documentKind === "change" ? "检测到改签资料，请裁剪新票，指定原票后确认替换。" : "识别不会自动生效，接下来可修正票面。"}</p>
        <label className="block text-sm font-semibold">核对资料种类<select className={input} value={documentKind} disabled={disabled} onChange={(event) => { setDocumentKind(event.target.value as typeof documentKind); setResolution(""); setTargetId(""); onDiscard(); }}>
          <option value="unknown">暂不确定，继续核对</option><option value="ticket">有效票面（包括退改未成功或仅有规则说明）</option><option value="refund">已办妥退票的资料</option><option value="change">已办妥改签的新票资料</option>
        </select></label>
        <p className="text-xs leading-5 text-graphite">识别种类可能出错，可按实际状态修正。退票、改签仍须核对指定原票并另行确认已办妥；规则、按钮或失败提示不是已退改事实。</p>
        {result!.segments.length > 1 ? <label className="block text-sm">选择导入的行程段<select className={input} value={segment} onChange={(event) => { setSegment(Number(event.target.value)); setResolution(""); onDiscard(); }}>{result!.segments.map((item, index) => <option key={index} value={index}>第 {index + 1} 段 · {item.fields.serviceNumber ?? "车次待补"}</option>)}</select></label> : null}
        <p className="break-words text-sm leading-6">{selected.fields.serviceNumber ?? "车次待补"} · {selected.fields.fromName ?? "站点待补"} → {selected.fields.toName ?? "站点待补"}<br />{selected.fields.date ?? "日期待补"} {selected.fields.departureTime ?? "时刻待补"} → {selected.fields.arrivalDate ?? "日期待补"} {selected.fields.arrivalTime ?? "时刻待补"}<br />{selected.fields.seat ?? "座位待补"} · {selected.fields.fareCents === null ? "票价待补" : `¥${selected.fields.fareCents / 100}`}</p>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-graphite">{selected.notices.map((notice) => <li key={notice}>{notice}</li>)}</ul>
        {duplicates.length ? <div role="status" className="rounded-md bg-clay-soft p-3 text-sm leading-6">{duplicates.map((hint) => <p key={hint.ticketId}>{hint.reason} · {tickets.find((ticket) => ticket.id === hint.ticketId)?.seat ?? "座位未知"}</p>)}<p>同一张票不重复记账；同行票请确认人数与座位。</p></div> : null}
        <label className="block text-sm font-semibold">这张截图用于<select className={input} value={resolution} disabled={disabled} onChange={(event) => { setResolution(event.target.value as typeof resolution); setTargetId(""); onDiscard(); }}>
          <option value="">请选择处理方式</option>
          {documentKind !== "refund" && documentKind !== "change" ? <><option value="new">我的新票</option><option value="companion">同行者的新票（核对费用归属）</option></> : null}
          <option value="same">同一张票（不重复保存）</option>
          {documentKind !== "refund" ? <option value="replacement">替换指定原票</option> : null}
          <option value="refund">记录指定原票已退票</option>
        </select></label>
        {resolution === "replacement" || resolution === "refund" ? <label className="block text-sm">指定原票<select aria-label="指定原票" value={targetId} className={input} onChange={(event) => { setTargetId(event.target.value); onDiscard(); }}><option value="">请选择当前方向的一张有效票</option>{active.map((ticket, index) => <option key={ticket.id} value={ticket.id}>票 {index + 1} · {ticket.serviceNumber} · {ticket.date} · {ticket.seat || "座位未知"} · {ticket.id.slice(-8)}</option>)}</select></label> : null}
        <button className={button} disabled={disabled || !resolution || (resolution === "replacement" || resolution === "refund") && !targetId || resolution === "new" && duplicates.length > 0} onClick={() => {
          if (resolution === "same") { clear(); setMessage("已跳过同一张票，票据与费用没有变化。"); }
          else if (resolution === "refund") onRefund(targetId);
          else if (resolution) onReview({ fields: selected.fields, source, resolution, targetId: targetId || undefined });
        }}>{resolution === "same" ? "跳过重复票" : resolution === "refund" ? "前往退票事实确认" : "修正并核对票面"}</button>
      </div> : null}
    </div> : null}
  </section>;
}
