"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { mapMarkerSchema, mapRouteSchema, markerLabel, routeArrowRotation, type MapMarker, type MapRoute } from "@/lib/map-link";
import { toGcj02, toWgs84 } from "@/lib/places";
import { z } from "zod";

type AMapInstance = {
  on: (name: string, handler: () => void) => void;
  add: (markers: unknown[]) => void; remove: (markers: unknown[]) => void;
  setFitView: (markers: unknown[], immediately: boolean, padding: number[], maxZoom: number) => void;
  destroy: () => void;
};
type AMapApi = {
  Map: new (element: HTMLElement, options: object) => AMapInstance;
  Marker: new (options: object) => unknown;
  Polyline: new (options: object) => unknown;
};
declare global { interface Window { AMap?: AMapApi; _AMapSecurityConfig?: { serviceHost: string } } }

function createPopup(marker: MapMarker, selectEvent: (eventId: string) => void) {
  const popup = document.createElement("div");
  popup.className = "serendipity-map-popup";
  const title = document.createElement("strong");
  title.textContent = `${marker.name}${marker.precision === "area_reference" ? " · 区域参考点" : ""}`;
  popup.append(title);
  for (const event of marker.events) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "serendipity-map-popup-event";
    button.textContent = `${event.visitLabel ?? event.visitNumber}. ${event.timeRange}｜${event.title}`;
    button.addEventListener("click", () => selectEvent(event.id));
    popup.append(button);
  }
  return popup;
}

function routeColor(route: MapRoute) {
  if (route.mode === "walking") return "#3f6212";
  if (route.mode === "public_transit") return "#1d4ed8";
  return "#9a3412";
}

export function MapFrame() {
  const container = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("正在加载地图…");
  useEffect(() => {
    const controller = new AbortController();
    let disposeMap: (() => void) | undefined;
    let updateMarkers: ((markers: MapMarker[], routes: MapRoute[], focusEventId: string | null) => void) | undefined;
    let pending: { markers: MapMarker[]; routes: MapRoute[]; focusEventId: string | null } = { markers: [], routes: [], focusEventId: null };
    let script: HTMLScriptElement | undefined;
    const preview = new URLSearchParams(window.location.search).get("preview") === "1";
    const send = (state: "ready" | "error" | "loading", error?: string) => {
      if (controller.signal.aborted) return;
      setMessage(error ?? "");
      window.parent.postMessage({ type: "serendipity-map", state, preview, error }, window.location.origin);
    };
    const selectEvent = (eventId: string) => {
      if (controller.signal.aborted) return;
      window.parent.postMessage({ type: "serendipity-map", state: "event-selected", preview, eventId }, window.location.origin);
    };
    let timer = window.setTimeout(() => send("error", "地图加载超时，文字地点仍可查看。请重试。"), 18000);
    const ready = () => { window.clearTimeout(timer); send("ready"); };
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.type !== "serendipity-markers") return;
      const result = z.object({
        markers: z.array(mapMarkerSchema).max(64),
        routes: z.array(mapRouteSchema).max(64),
        focusEventId: z.string().nullable(),
      }).safeParse(event.data);
      if (!result.success) return;
      pending = { markers: result.data.markers, routes: result.data.routes, focusEventId: result.data.focusEventId };
      updateMarkers?.(pending.markers, pending.routes, pending.focusEventId);
    };
    window.addEventListener("message", receive);
    const start = async () => {
      const response = await fetch(`/api/map/config${preview ? "?preview=1" : ""}`, { signal: controller.signal });
      const config = await response.json();
      if (!response.ok) throw new Error(config.error ?? "地图配置无法读取。");
      if (controller.signal.aborted || !container.current) return;
      if (config.provider === "osm") {
        const L = await import("leaflet");
        if (controller.signal.aborted || !container.current) return;
        const map = L.map(container.current, { zoomControl: true, scrollWheelZoom: false }).setView([35, 105], 4);
        disposeMap = () => map.remove();
        let loaded = 0;
        let failed = 0;
        const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19, keepBuffer: 1, updateWhenIdle: true, crossOrigin: true,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
        });
        tiles.on("loading", () => {
          loaded = 0; failed = 0;
          send("loading", "正在加载地图…");
          window.clearTimeout(timer);
          timer = window.setTimeout(() => send("error", "地图加载超时，文字地点仍可查看。请重试。"), 18000);
        });
        tiles.on("tileload", () => { loaded++; });
        tiles.on("tileerror", () => { failed++; send("error", "部分地图未加载，请检查网络后重试。地点文字仍可查看。"); });
        tiles.on("load", () => { if (loaded > 0 && failed === 0) ready(); });
        tiles.addTo(map);
        const markerLayer = L.layerGroup().addTo(map);
        const routeLayer = L.layerGroup().addTo(map);
        updateMarkers = (mapMarkers, mapRoutes, focusEventId) => {
          markerLayer.clearLayers();
          routeLayer.clearLayers();
          for (const route of mapRoutes) {
            const points = route.polyline
              .map((point) => toWgs84(point, route.coordinateSystem))
              .map((point) => [point.latitude, point.longitude] as [number, number]);
            if (points.length < 2) continue;
            L.polyline(points, {
              color: routeColor(route),
              weight: 5,
              opacity: route.status === "verified" ? 0.9 : 0.65,
              dashArray: route.status === "verified" ? undefined : "8 7",
            }).addTo(routeLayer);
            L.marker(points[Math.floor(points.length / 2)], {
              interactive: false,
              keyboard: false,
              icon: L.divIcon({
                className: "serendipity-map-route-arrow",
                html: `<span style="transform: rotate(${routeArrowRotation(route.polyline)}deg)">➤</span>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10],
              }),
            }).addTo(routeLayer);
          }
          const coordinates: [number, number][] = [];
          const createdMarkers: L.Marker[] = [];
          for (const markerData of mapMarkers) {
            const position = toWgs84(markerData, markerData.coordinateSystem);
            const point: [number, number] = [position.latitude, position.longitude];
            coordinates.push(point);
            const marker = L.marker(point, {
              title: markerData.name,
              keyboard: true,
              icon: L.divIcon({
                className: `serendipity-map-pin${markerData.precision === "area_reference" ? " serendipity-map-pin-area" : ""}`,
                html: markerData.precision === "area_reference" ? "◎" : markerLabel(markerData),
                iconSize: markerData.events.length > 1 ? [42, 30] : [30, 30],
                iconAnchor: [markerData.events.length > 1 ? 21 : 15, 15],
              }),
            }).bindPopup(createPopup(markerData, selectEvent)).addTo(markerLayer);
            createdMarkers.push(marker);
            if (markerData.precision === "area_reference") marker.setOpacity(0.7);
          }
          if (coordinates.length) {
            if (focusEventId) {
              const focusIndex = mapMarkers.findIndex((item) => item.events.some((event) => event.id === focusEventId));
              if (focusIndex >= 0) {
                const focus = createdMarkers[focusIndex];
                if (focus) {
                  map.setView(coordinates[focusIndex], Math.max(map.getZoom(), 15), { animate: true });
                  focus.openPopup();
                }
              }
            } else {
              const bounds = L.latLngBounds(createdMarkers.map((marker) => marker.getLatLng()));
              if (createdMarkers.length === 1) {
                map.setView(bounds.getCenter(), 15, { animate: false });
              } else {
                map.fitBounds(bounds, { padding: [35, 35], maxZoom: 15, animate: false });
              }
            }
          }
        };
        updateMarkers(pending.markers, pending.routes, pending.focusEventId);
        // Orientation/viewport changes must keep the selected day's points in view.
        map.on("resize", () => updateMarkers?.(pending.markers, pending.routes, pending.focusEventId));
        // Tiles may already be loaded before the parent receives the frame event.
        window.parent.postMessage({ type: "serendipity-map", state: "initialized", preview }, window.location.origin);
      } else {
        window._AMapSecurityConfig = { serviceHost: `${window.location.origin}${config.serviceHost}` };
        script = document.createElement("script");
        script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.browserKey)}`;
        const sdkScript = script;
        await new Promise<void>((resolve, reject) => { sdkScript.onload = () => resolve(); sdkScript.onerror = () => reject(new Error("高德地图脚本加载失败，请检查网络。")); document.head.appendChild(sdkScript); });
        if (controller.signal.aborted || !container.current) return;
        if (!window.AMap) throw new Error("高德地图未授权，请检查浏览器 Key 与域名权限。");
        const sdk = window.AMap;
        const map = new sdk.Map(container.current, { zoom: 4, center: [105, 35], viewMode: "2D" });
        disposeMap = () => map.destroy();
        map.on("complete", ready);
        let markers: unknown[] = [];
        updateMarkers = (mapMarkers, mapRoutes, focusEventId) => {
          map.remove(markers);
          markers = [];
          for (const route of mapRoutes) {
            const points = route.polyline
              .map((point) => toGcj02(point, route.coordinateSystem))
              .map((point) => [point.longitude, point.latitude]);
            if (points.length < 2) continue;
            markers.push(new sdk.Polyline({
              path: points,
              strokeColor: routeColor(route),
              strokeWeight: 5,
              strokeOpacity: route.status === "verified" ? 0.9 : 0.65,
              strokeStyle: route.status === "verified" ? "solid" : "dashed",
            }));
            const arrow = toGcj02(route.polyline[Math.floor(route.polyline.length / 2)], route.coordinateSystem);
            const pin = document.createElement("div");
            pin.className = "serendipity-map-route-arrow";
            pin.innerHTML = `<span style="transform: rotate(${routeArrowRotation(route.polyline)}deg)">➤</span>`;
            markers.push(new sdk.Marker({ position: [arrow.longitude, arrow.latitude], content: pin }));
          }
          markers = [...markers, ...mapMarkers.map((markerData) => {
            const coordinate = toGcj02(markerData, markerData.coordinateSystem);
            const pin = document.createElement("div");
            pin.className = `serendipity-map-pin${markerData.precision === "area_reference" ? " serendipity-map-pin-area" : ""}`;
            pin.textContent = markerData.precision === "area_reference" ? "◎" : markerLabel(markerData);
            for (const event of markerData.events) {
              const button = document.createElement("button");
              button.type = "button";
              button.className = "serendipity-map-popup-event serendipity-map-popup-event-inline";
              button.textContent = `${event.visitLabel ?? event.visitNumber}. ${event.title}`;
              button.addEventListener("click", () => selectEvent(event.id));
              pin.append(button);
            }
            return new sdk.Marker({ position: [coordinate.longitude, coordinate.latitude], title: markerData.name, content: pin });
          })];
          map.add(markers);
          if (markers.length && !focusEventId) map.setFitView(markers, true, [35, 35, 35, 35], 15);
        };
        updateMarkers(pending.markers, pending.routes, pending.focusEventId);
        window.parent.postMessage({ type: "serendipity-map", state: "initialized", preview }, window.location.origin);
      }
    };
    start().catch((error) => { window.clearTimeout(timer); if (!controller.signal.aborted) send("error", error instanceof Error ? error.message : "地图加载失败。"); });
    return () => { controller.abort(); window.clearTimeout(timer); window.removeEventListener("message", receive); disposeMap?.(); script?.remove(); };
  }, []);
  return <main className="map-frame-root">
    <div ref={container} className="map-frame-canvas" aria-label="可缩放和拖动的行程地图" />
    {message ? <p className="map-frame-message" role="status">{message}</p> : null}
  </main>;
}
