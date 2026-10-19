"use client";

import { useId, useMemo } from "react";
import { formatVisitNumber, markerLabel, type MapMarker, type MapRoute } from "@/lib/map-link";
import { toWgs84 } from "@/lib/places";
import styles from "./route-diagram.module.css";

function diagramPoints(markers: MapMarker[]) {
  const points = markers.map((marker) => toWgs84(marker, marker.coordinateSystem));
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const west = Math.min(...longitudes); const east = Math.max(...longitudes);
  const south = Math.min(...latitudes); const north = Math.max(...latitudes);
  const width = Math.max(east - west, .003); const height = Math.max(north - south, .003);
  const positions = points.map((point) => ({
    x: west === east ? 180 : 40 + (point.longitude - west) / width * 280,
    y: south === north ? 130 : 47 + (north - point.latitude) / height * 163,
  }));
  // Keep adjacent numbered pins readable at a small card size. This is a route
  // illustration rather than a scale map, so modest collision offsets are OK.
  for (let pass = 0; pass < 40; pass++) {
    for (let a = 0; a < positions.length; a++) {
      for (let b = a + 1; b < positions.length; b++) {
        let dx = positions[b].x - positions[a].x; let dy = positions[b].y - positions[a].y;
        const distance = Math.hypot(dx, dy);
        if (distance >= 40) continue;
        if (distance < .001) { dx = Math.cos(b * 2.4); dy = Math.sin(b * 2.4); }
        const magnitude = Math.hypot(dx, dy);
        const move = (40 - distance) / 2;
        positions[a].x -= dx / magnitude * move; positions[a].y -= dy / magnitude * move;
        positions[b].x += dx / magnitude * move; positions[b].y += dy / magnitude * move;
      }
    }
    for (const position of positions) {
      position.x = Math.max(28, Math.min(332, position.x));
      position.y = Math.max(43, Math.min(221, position.y));
    }
  }
  return positions;
}

export function RouteDiagram({ markers, routes, focusEventId, highlightedEventId, onEventHover, onEventSelect }: {
  markers: MapMarker[];
  routes: MapRoute[];
  focusEventId: string | null;
  highlightedEventId?: string | null;
  onEventHover?: (eventId: string | null) => void;
  onEventSelect?: (eventId: string) => void;
}) {
  const arrowId = useId().replaceAll(":", "");
  const positions = useMemo(() => diagramPoints(markers), [markers]);
  const pointByEvent = new Map(markers.flatMap((marker, index) => marker.events.map((event) => [event.id, positions[index]] as const)));
  const city = [...new Set(markers.map((marker) => marker.city))].join(" · ");
  return <div className={styles.diagram} data-testid="daily-route-diagram" aria-label="每日动线示意图">
    <div className={styles.label}><span>{city || "每日行程"}</span><span>动线示意</span></div>
    <svg viewBox="0 0 360 260" preserveAspectRatio="none" aria-hidden="true" className={styles.lines}>
      <defs><marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#78865b" /></marker></defs>
      {routes.map((route) => {
        const from = pointByEvent.get(route.fromEventId); const to = pointByEvent.get(route.toEventId);
        if (!from || !to || from === to) return null;
        const dx = to.x - from.x; const dy = to.y - from.y; const distance = Math.hypot(dx, dy);
        if (distance < 1) return null;
        const padding = Math.min(17, distance / 3);
        return <line key={route.id} data-testid="daily-route-line" x1={from.x + dx / distance * padding} y1={from.y + dy / distance * padding} x2={to.x - dx / distance * padding} y2={to.y - dy / distance * padding} stroke="#78865b" strokeWidth="2" strokeDasharray="5 4" markerEnd={`url(#${arrowId})`} />;
      })}
    </svg>
    {markers.map((marker, index) => {
      const selected = marker.events.some((event) => event.id === focusEventId || event.id === highlightedEventId);
      const point = positions[index];
      if (marker.events.length > 1) return <div key={marker.placeId} className={styles.pinGroup} style={{ left: `${point.x / 3.6}%`, top: `${point.y / 2.6}%` }}>
        {marker.events.map((event) => <button key={event.id} type="button" data-testid="daily-route-marker" className={`${styles.pin} ${styles.groupedPin}`} data-selected={event.id === focusEventId || event.id === highlightedEventId} onMouseEnter={() => onEventHover?.(event.id)} onMouseLeave={() => onEventHover?.(null)} onFocus={() => onEventHover?.(event.id)} onBlur={() => onEventHover?.(null)} onClick={() => onEventSelect?.(event.id)} aria-label={`${event.visitLabel ?? formatVisitNumber(event.visitNumber)} ${event.title}`} title={event.title}>{event.visitLabel ?? formatVisitNumber(event.visitNumber)}</button>)}
      </div>;
      return <button key={marker.placeId} type="button" data-testid="daily-route-marker" className={styles.pin} data-selected={selected} style={{ left: `${point.x / 3.6}%`, top: `${point.y / 2.6}%` }} onMouseEnter={() => onEventHover?.(marker.events[0].id)} onMouseLeave={() => onEventHover?.(null)} onFocus={() => onEventHover?.(marker.events[0].id)} onBlur={() => onEventHover?.(null)} onClick={() => onEventSelect?.(marker.events[0].id)} aria-label={`${markerLabel(marker)} ${marker.name}`} title={`${markerLabel(marker)} ${marker.name} · ${marker.address}`}>
        <span>{markerLabel(marker)}</span>
      </button>;
    })}
    <span className={styles.legend}>按日程顺序连线 · 点击编号查看安排</span>
  </div>;
}
