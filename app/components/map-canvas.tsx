"use client";
import { useEffect, useRef, useState } from "react";
import type { MapMarker, MapRoute } from "@/lib/map-link";
import { RouteDiagram } from "./route-diagram";

export function MapCanvas({ markers, routes = [], focusEventId, highlightedEventId = null, onEventHover, preview = false, compact = false, title, onReady, onEventSelect }: {
  markers: MapMarker[];
  routes?: MapRoute[];
  focusEventId: string | null;
  highlightedEventId?: string | null;
  onEventHover?: (eventId: string | null) => void;
  preview?: boolean;
  compact?: boolean;
  title?: string;
  onReady?: (ready: boolean) => void;
  onEventSelect?: (eventId: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const frameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // A compact card still renders a geographic basemap. Synthetic positions
  // without geographic meaning must stay in the non-geographic fallback.
  const diagramOnly = markers.some((marker) => marker.geographic === false);
  const parameters = new URLSearchParams();
  if (preview) parameters.set("preview", "1");
  if (compact) parameters.set("compact", "1");
  const frameUrl = `/map/frame${parameters.size ? `?${parameters}` : ""}`;
  const highlighted = useRef(highlightedEventId);
  highlighted.current = highlightedEventId;
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: "serendipity-map-highlight", eventId: highlightedEventId }, window.location.origin);
  }, [highlightedEventId]);
  useEffect(() => {
    if (diagramOnly) return;
    frameTimer.current = setTimeout(() => {
      setError("地图加载超时，文字地点仍可查看。请重试。");
      onReady?.(false);
    }, 20_000);
    return () => { if (frameTimer.current) clearTimeout(frameTimer.current); };
  }, [attempt, diagramOnly, onReady]);
  useEffect(() => {
    if (diagramOnly) return;
    const send = () => frame.current?.contentWindow?.postMessage({
      type: "serendipity-markers",
      markers,
      routes,
      focusEventId,
      highlightedEventId: highlighted.current,
    }, window.location.origin);
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.type !== "serendipity-map") return;
      if (event.data.state === "initialized") send();
      if (event.data.state === "loading") onReady?.(false);
      if (event.data.state === "ready") {
        if (frameTimer.current) clearTimeout(frameTimer.current);
        setError(null); onReady?.(true);
      }
      if (event.data.state === "error") {
        if (frameTimer.current) clearTimeout(frameTimer.current);
        setError(event.data.error ?? "地图加载失败。"); onReady?.(false);
      }
      if (event.data.state === "event-selected" && typeof event.data.eventId === "string") {
        onEventSelect?.(event.data.eventId);
      }
      if (event.data.state === "event-hovered" && (event.data.eventId === null || typeof event.data.eventId === "string")) {
        onEventHover?.(event.data.eventId);
      }
    };
    send();
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [markers, routes, focusEventId, onReady, onEventSelect, onEventHover, attempt, diagramOnly]);
  if (diagramOnly) return <RouteDiagram markers={markers} routes={routes} focusEventId={focusEventId} highlightedEventId={highlightedEventId} onEventHover={onEventHover} onEventSelect={onEventSelect} />;
  return <div className="overflow-hidden rounded-md border border-sand bg-shell">
    <div className="relative"><iframe ref={frame} key={attempt} title={title ?? (preview ? "地图配置测试预览" : "行程地点地图")} src={frameUrl}
      className={compact ? "h-[260px] w-full" : "h-[400px] w-full sm:h-[470px]"} referrerPolicy="strict-origin-when-cross-origin" />
    {error && markers.length > 0 ? <div className="absolute inset-0 grid items-center bg-shell p-3"><RouteDiagram markers={markers} routes={routes} focusEventId={focusEventId} highlightedEventId={highlightedEventId} onEventHover={onEventHover} onEventSelect={onEventSelect} /></div> : null}</div>
    {error ? <div className="flex flex-wrap items-center justify-between gap-2 bg-clay-soft px-3 py-2 text-sm text-clay" role="status">
      <span>{error}</span><button type="button" className="min-h-11 rounded border border-clay px-3" onClick={() => { onReady?.(false); setError(null); setAttempt((value) => value + 1); }}>重试地图</button>
    </div> : null}
  </div>;
}
