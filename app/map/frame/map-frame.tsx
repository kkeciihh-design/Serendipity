"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { mapMarkerSchema, mapRouteSchema, markerLabel, routeArrowRotation, type MapMarker, type MapRoute } from "@/lib/map-link";
import { FOCUSED_MAX_ZOOM, focusedMaxZoom, markerSpreadOffsets, remoteOriginLabel, splitDailyFocus } from "@/lib/daily-focus";
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

function createPopup(marker: MapMarker, selectEvent: (eventId: string) => void, hoverEvent: (eventId: string | null) => void) {
  const popup = document.createElement("div");
  popup.className = "serendipity-map-popup";
  const title = document.createElement("strong");
  title.textContent = `${marker.name}${marker.illustrative ? " · 建议位置（动线示意）" : marker.precision === "area_reference" ? " · 区域参考点" : ""}`;
  popup.append(title);
  for (const event of marker.events) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "serendipity-map-popup-event";
    button.textContent = `${event.visitLabel ?? event.visitNumber}. ${event.timeRange}｜${event.title}`;
    button.addEventListener("click", () => selectEvent(event.id));
    button.addEventListener("mouseenter", () => hoverEvent(event.id));
    button.addEventListener("mouseleave", () => hoverEvent(null));
    button.addEventListener("focus", () => hoverEvent(event.id));
    button.addEventListener("blur", () => hoverEvent(null));
    popup.append(button);
  }
  return popup;
}

function routeColor(route: MapRoute) {
  if (route.illustrative) return "#7b8867";
  if (route.mode === "walking") return "#3f6212";
  if (route.mode === "public_transit") return "#1d4ed8";
  return "#9a3412";
}

export function MapFrame() {
  const container = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("正在加载地图…");
  const [arrivalNote, setArrivalNote] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let disposeMap: (() => void) | undefined;
    let updateMarkers: ((markers: MapMarker[], routes: MapRoute[], focusEventId: string | null) => void) | undefined;
    let pending: { markers: MapMarker[]; routes: MapRoute[]; focusEventId: string | null } = { markers: [], routes: [], focusEventId: null };
    let highlightedEventId: string | null = null;
    let updateHighlight: (() => void) | undefined;
    let script: HTMLScriptElement | undefined;
    const parameters = new URLSearchParams(window.location.search);
    const preview = parameters.get("preview") === "1";
    const compact = parameters.get("compact") === "1";
    const send = (state: "ready" | "error" | "loading", error?: string) => {
      if (controller.signal.aborted) return;
      setMessage(error ?? "");
      window.parent.postMessage({ type: "serendipity-map", state, preview, error }, window.location.origin);
    };
    const selectEvent = (eventId: string) => {
      if (controller.signal.aborted) return;
      window.parent.postMessage({ type: "serendipity-map", state: "event-selected", preview, eventId }, window.location.origin);
    };
    const hoverEvent = (eventId: string | null) => {
      if (controller.signal.aborted) return;
      window.parent.postMessage({ type: "serendipity-map", state: "event-hovered", preview, eventId }, window.location.origin);
    };
    let timer = window.setTimeout(() => send("error", "地图加载超时，文字地点仍可查看。请重试。"), 18000);
    const ready = () => { window.clearTimeout(timer); send("ready"); };
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (event.data?.type === "serendipity-map-highlight") {
        const result = z.string().max(80).nullable().safeParse(event.data.eventId);
        if (result.success) { highlightedEventId = result.data; updateHighlight?.(); }
        return;
      }
      if (event.data?.type !== "serendipity-markers") return;
      const result = z.object({
        markers: z.array(mapMarkerSchema).max(64),
        routes: z.array(mapRouteSchema).max(64),
        focusEventId: z.string().nullable(),
        highlightedEventId: z.string().max(80).nullable().optional(),
      }).safeParse(event.data);
      if (!result.success) return;
      pending = { markers: result.data.markers, routes: result.data.routes, focusEventId: result.data.focusEventId };
      highlightedEventId = result.data.highlightedEventId ?? null;
      // The excluded origin is still worth naming above the focused city view.
      const { remote } = splitDailyFocus(result.data.markers);
      setArrivalNote(remote.length ? remoteOriginLabel(remote) : null);
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
        tiles.on("tileerror", () => { failed++; });
        tiles.on("load", () => {
          // A failed peripheral tile must not replace a usable basemap with a
          // diagram. Evaluate the completed batch, including successful tiles.
          if (loaded > 0) {
            ready();
            if (failed > 0) setMessage("部分底图暂未加载，可拖动地图或稍后重试。");
          } else if (failed > 0) {
            window.clearTimeout(timer);
            send("error", "地图底图未加载，请检查网络后重试。地点文字仍可查看。");
          }
        });
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
                html: markerLabel(markerData),
                iconSize: markerData.events.length > 1 ? [42, 30] : [30, 30],
                iconAnchor: [markerData.events.length > 1 ? 21 : 15, 15],
              }),
            }).bindPopup(createPopup(markerData, selectEvent, hoverEvent)).addTo(markerLayer);
            marker.on("mouseover", () => hoverEvent(markerData.events[0].id));
            marker.on("mouseout", () => hoverEvent(null));
            marker.getElement()?.addEventListener("focus", () => hoverEvent(markerData.events[0].id));
            marker.getElement()?.addEventListener("blur", () => hoverEvent(null));
            if (compact && markerData.events.length === 1) {
              marker.on("click", () => selectEvent(markerData.events[0].id));
            }
            createdMarkers.push(marker);
            if (markerData.precision === "area_reference") marker.setOpacity(markerData.illustrative ? 0.95 : 0.7);
          }
          // Hover changes styling only. Recreating pins or fitting bounds here
          // would interrupt pointer events, popup state and the user's viewport.
          updateHighlight = () => createdMarkers.forEach((marker, index) => {
            const pin = marker.getElement();
            if (!pin) return;
            const events = mapMarkers[index].events;
            const selected = events.some((event) => event.id === focusEventId);
            const highlighted = events.some((event) => event.id === highlightedEventId);
            pin.dataset.selected = String(selected);
            pin.dataset.highlighted = String(highlighted);
            marker.setZIndexOffset(selected || highlighted ? 1000 : 0);
          });
          updateHighlight();
          if (coordinates.length) {
            if (compact || !focusEventId) {
              // The far cross-city origin keeps its pin but not the camera.
              const { focus: focusMarkers } = splitDailyFocus(mapMarkers);
              const focusIndexes = focusMarkers.map((marker) => mapMarkers.indexOf(marker));
              const focusPoints = focusIndexes.map((index) => createdMarkers[index]);
              const bounds = L.latLngBounds(focusPoints.map((marker) => marker.getLatLng()));
              if (focusPoints.length === 1) {
                map.setView(bounds.getCenter(), 15, { animate: false });
              } else {
                map.fitBounds(bounds, { padding: [35, 35], maxZoom: focusedMaxZoom(bounds), animate: false });
              }
              // Overlapping numbers hide each other. Fan out only the collisions so
              // every numbered stop stays readable; geography is never changed.
              const offsets = markerSpreadOffsets(focusPoints.map((marker) => map.project(marker.getLatLng(), map.getZoom())));
              focusPoints.forEach((marker, index) => {
                const pin = marker.getElement();
                if (pin) pin.style.translate = offsets[index].x || offsets[index].y ? `${offsets[index].x}px ${offsets[index].y}px` : "";
              });
            }
            if (focusEventId) {
              const focusIndex = mapMarkers.findIndex((item) => item.events.some((event) => event.id === focusEventId));
              if (focusIndex >= 0) {
                const focus = createdMarkers[focusIndex];
                if (focus) {
                  if (!compact) map.setView(coordinates[focusIndex], Math.max(map.getZoom(), 15), { animate: true });
                  focus.openPopup();
                }
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
          const pins: { element: HTMLElement; marker: MapMarker; instance: unknown }[] = [];
          const markerInstances = mapMarkers.map((markerData) => {
            const coordinate = toGcj02(markerData, markerData.coordinateSystem);
            const pin = document.createElement("div");
            pin.className = `serendipity-map-pin${markerData.precision === "area_reference" ? " serendipity-map-pin-area" : ""}`;
            pin.textContent = markerLabel(markerData);
            pin.addEventListener("mouseenter", () => hoverEvent(markerData.events[0].id));
            pin.addEventListener("mouseleave", () => hoverEvent(null));
            pin.addEventListener("focus", () => hoverEvent(markerData.events[0].id));
            pin.addEventListener("blur", () => hoverEvent(null));
            if (compact && markerData.events.length === 1) {
              pin.tabIndex = 0;
              pin.setAttribute("role", "button");
              pin.setAttribute("aria-label", `${markerLabel(markerData)} ${markerData.name}`);
              pin.addEventListener("click", (event) => { if (event.target === pin) selectEvent(markerData.events[0].id); });
              pin.addEventListener("keydown", (event) => {
                if (event.target === pin && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault(); selectEvent(markerData.events[0].id);
                }
              });
            }
            for (const event of markerData.events) {
              const button = document.createElement("button");
              button.type = "button";
              button.className = "serendipity-map-popup-event serendipity-map-popup-event-inline";
              button.textContent = `${event.visitLabel ?? event.visitNumber}. ${event.title}`;
              button.addEventListener("click", () => selectEvent(event.id));
              button.addEventListener("mouseenter", () => hoverEvent(event.id));
              button.addEventListener("mouseleave", () => hoverEvent(null));
              pin.append(button);
            }
            const instance = new sdk.Marker({ position: [coordinate.longitude, coordinate.latitude], title: markerData.name, content: pin });
            pins.push({ element: pin, marker: markerData, instance });
            return instance;
          });
          markers = [...markers, ...markerInstances];
          map.add(markers);
          updateHighlight = () => pins.forEach(({ element, marker }) => {
            element.dataset.selected = String(marker.events.some((event) => event.id === focusEventId));
            element.dataset.highlighted = String(marker.events.some((event) => event.id === highlightedEventId));
          });
          updateHighlight();
          if (markers.length && !focusEventId) {
            // Same camera rule as the OSM branch: the far origin is drawn but
            // never lengthens the fitted bounds.
            const { focus: focusMarkers } = splitDailyFocus(mapMarkers);
            const focusPins = pins.filter((pin) => focusMarkers.includes(pin.marker));
            const camera = focusPins.map((pin) => pin.instance);
            const lats = focusMarkers.map((marker) => marker.latitude);
            const lons = focusMarkers.map((marker) => marker.longitude);
            const span = focusMarkers.length > 1
              ? Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons))
              : 0;
            const maxZoom = span > 0 && span < 0.12 ? FOCUSED_MAX_ZOOM : 15;
            map.setFitView(camera.length ? camera : markers, true, [35, 35, 35, 35], maxZoom);
          }
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
    {arrivalNote ? <p className="map-frame-arrival" data-testid="map-arrival-note"><span aria-hidden="true">🚄</span>{arrivalNote}</p> : null}
    {message ? <p className="map-frame-message" role="status">{message}</p> : null}
  </main>;
}
