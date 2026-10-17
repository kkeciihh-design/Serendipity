"use client";
import { useEffect, useState } from "react";
import { documentGeneration } from "@/lib/business-fetch";

export function DataGenerationBanner() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    const generation = documentGeneration();
    const changed = (event: Event) => setMessage((event as CustomEvent<string>).detail);
    window.addEventListener("serendipity-data-changed", changed);
    const controller = new AbortController();
    const check = async () => {
      try {
        const response = await fetch("/api/data-management/status", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const state = await response.json();
        if (state.activeRestoreId) setMessage("正在恢复旅行数据，写入已暂停。请等待处理完成。");
        else if (state.dataGeneration !== generation) setMessage("旅行数据已恢复，当前页面及候选已过期。请重新载入并核对最新数据。");
      } catch { /* A temporary connection failure is handled by the active form. */ }
    };
    void check();
    const timer = window.setInterval(check, 3000);
    window.addEventListener("focus", check);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus", check); window.removeEventListener("serendipity-data-changed", changed); };
  }, []);
  return message ? <aside role="alert" className="sticky top-0 z-[1000] flex flex-wrap items-center justify-center gap-3 border-b border-amber-300 bg-amber-50 px-5 py-3 text-sm text-charcoal">
    <span>{message}</span><button className="min-h-11 rounded-lg bg-charcoal px-4 text-white" onClick={() => window.location.reload()}>重新载入页面</button>
  </aside> : null;
}
