"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { placeSchema, toGcj02, toWgs84, type Place } from "@/lib/places";
import { z } from "zod";

type AMapInstance = {
  on: (name: string, handler: () => void) => void;
  add: (markers: unknown[]) => void; remove: (markers: unknown[]) => void;
  setFitView: (markers: unknown[], immediately: boolean, padding: number[], maxZoom: number) => void;
  destroy: () => void;
};
type AMapApi = { Map: new (element: HTMLElement, options: object) => AMapInstance; Marker: new (options: object) => unknown };
declare global { interface Window { AMap?: AMapApi; _AMapSecurityConfig?: { serviceHost: string } } }

export function MapFrame() {
  const container = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("正在加载地图…");
  useEffect(() => {
    const controller = new AbortController();
    let disposeMap: (() => void) | undefined;
    let updatePlaces: ((places: Place[]) => void) | undefined;
    let pending: Place[] = [];
    let script: HTMLScriptElement | undefined;
    const preview = new URLSearchParams(window.location.search).get("preview") === "1";
    const send = (state: "ready" | "error" | "loading", error?: string) => {
      if (controller.signal.aborted) return;
      setMessage(error ?? "");
      window.parent.postMessage({ type: "serendipity-map", state, preview, error }, window.location.origin);
    };
    let timer = window.setTimeout(() => send("error", "地图加载超时，文字地点仍可查看。请重试。"), 18000);
    const ready = () => { window.clearTimeout(timer); send("ready"); };
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.type !== "serendipity-places") return;
      const result = z.array(placeSchema).max(64).safeParse(event.data.places);
      if (!result.success) return;
      pending = result.data;
      updatePlaces?.(pending);
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
        const markers = L.layerGroup().addTo(map);
        updatePlaces = (places) => {
          markers.clearLayers();
          const coordinates: [number, number][] = [];
          for (const place of places) {
            const position = toWgs84(place, place.coordinateSystem);
            const point: [number, number] = [position.latitude, position.longitude];
            coordinates.push(point);
            const popup = document.createElement("div");
            popup.textContent = `${place.name}${place.precision === "area_reference" ? " · 区域参考点" : ""}｜${place.city}｜${place.address}`;
            const marker = L.marker(point, { title: place.name, keyboard: true,
              icon: L.divIcon({ className: "serendipity-map-pin", html: place.precision === "area_reference" ? "◎" : "●", iconSize: [30, 30], iconAnchor: [15, 15] }),
            }).bindPopup(popup).addTo(markers);
            if (place.precision === "area_reference") marker.setOpacity(0.7);
          }
          if (coordinates.length) map.fitBounds(coordinates, { padding: [35, 35], maxZoom: 15, animate: false });
        };
        updatePlaces(pending);
        // Orientation/viewport changes must keep the selected day's points in view.
        map.on("resize", () => updatePlaces?.(pending));
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
        updatePlaces = (places) => {
          map.remove(markers);
          markers = places.map((place) => {
            const coordinate = toGcj02(place, place.coordinateSystem);
            const pin = document.createElement("div");
            pin.className = "serendipity-map-pin";
            pin.textContent = place.precision === "area_reference" ? "◎" : "●";
            return new sdk.Marker({ position: [coordinate.longitude, coordinate.latitude], title: `${place.name} · ${place.city}`, content: pin });
          });
          map.add(markers);
          if (markers.length) map.setFitView(markers, true, [35, 35, 35, 35], 15);
        };
        updatePlaces(pending);
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
