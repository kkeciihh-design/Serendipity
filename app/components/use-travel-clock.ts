"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { calibrateTravelClock, readTravelClock, type ClockAnchor } from "@/lib/travel-clock";

export function useTravelClock() {
  const anchor = useRef<ClockAnchor | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [reliable, setReliable] = useState(false);
  const [message, setMessage] = useState("正在与本机服务器校时…");
  const calibrate = useCallback((serverNow: string, sent: number) => {
    anchor.current = calibrateTravelClock(serverNow, sent, Date.now(), performance.now());
    setNow(anchor.current.server); setReliable(!anchor.current.skewed);
    setMessage(anchor.current.skewed ? "设备与服务器时钟相差较大，时间不可靠；暂按服务器时间显示，请核对系统时间。" : "北京时间 · 使用本机服务器校准的时间");
  }, []);
  const invalidate = useCallback((failed = false) => {
    setReliable(false);
    setMessage(failed ? "无法校时，时间仅供参考；联网后请重新读取，路线可行性待确认。" : "正在恢复前台校时，时间与路线待确认…");
  }, []);
  useEffect(() => {
    const tick = () => {
      if (!anchor.current) { setNow(Date.now()); return; }
      const value = readTravelClock(anchor.current, Date.now(), performance.now());
      setNow(value.now);
      if (value.jumped) { setReliable(false); setMessage("设备时间发生变化或刚从后台返回，时间不可靠；请重新读取校时。"); }
    };
    tick(); const timer = window.setInterval(tick, 1000); return () => clearInterval(timer);
  }, []);
  return { now, reliable, message, calibrate, invalidate };
}
export function useForegroundRefresh(refresh: () => Promise<void>, invalidate: (failed?: boolean) => void) {
  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30_000);
    const resume = () => { if (document.visibilityState === "visible") { invalidate(); void refresh(); } };
    const offline = () => invalidate(true);
    window.addEventListener("focus", resume); window.addEventListener("online", resume); window.addEventListener("offline", offline); document.addEventListener("visibilitychange", resume);
    return () => { clearInterval(poll); window.removeEventListener("focus", resume); window.removeEventListener("online", resume); window.removeEventListener("offline", offline); document.removeEventListener("visibilitychange", resume); };
  }, [refresh, invalidate]);
}
