"use client";
import { useEffect, useRef, useState } from "react";
import type { MapMarker, MapRoute } from "@/lib/map-link";

export function MapCanvas({ markers, routes = [], focusEventId, preview = false, onReady, onEventSelect }: {
  markers: MapMarker[];
  routes?: MapRoute[];
  focusEventId: string | null;
  preview?: boolean;
  onReady?: (ready: boolean) => void;
  onEventSelect?: (eventId: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const send = () => frame.current?.contentWindow?.postMessage({
      type: "serendipity-markers",
      markers,
      routes,
      focusEventId,
    }, window.location.origin);
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.type !== "serendipity-map") return;
      if (event.data.state === "initialized") send();
      if (event.data.state === "loading") onReady?.(false);
      if (event.data.state === "ready") { setError(null); onReady?.(true); }
      if (event.data.state === "error") { setError(event.data.error ?? "地图加载失败。"); onReady?.(false); }
      if (event.data.state === "event-selected" && typeof event.data.eventId === "string") {
        onEventSelect?.(event.data.eventId);
      }
    };
    send();
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [markers, routes, focusEventId, onReady, onEventSelect, attempt]);
  return <div className="overflow-hidden rounded-md border border-sand bg-shell">
    <iframe ref={frame} key={attempt} title={preview ? "地图配置测试预览" : "行程地点地图"} src={`/map/frame${preview ? "?preview=1" : ""}`}
      className="h-[400px] w-full sm:h-[470px]" referrerPolicy="strict-origin-when-cross-origin" />
    {error ? <div className="flex flex-wrap items-center justify-between gap-2 bg-clay-soft px-3 py-2 text-sm text-clay" role="status">
      <span>{error}</span><button type="button" className="min-h-11 rounded border border-clay px-3" onClick={() => { onReady?.(false); setError(null); setAttempt((value) => value + 1); }}>重试地图</button>
    </div> : null}
  </div>;
}
