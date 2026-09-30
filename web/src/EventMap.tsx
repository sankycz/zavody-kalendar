import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { EventListItem } from "../../src/shared/types.ts";
import { dateRange } from "./format.ts";
import { DISCIPLINE_LABEL, LEVEL_LABEL, ORGANIZER_FLAG_LABEL } from "./labels.ts";

type MapEvent = Pick<
  EventListItem,
  "id" | "name" | "date_from" | "date_to" | "discipline" | "level" | "status" | "lat" | "lng" | "organizer_flag"
>;

const CZ_CENTER: L.LatLngTuple = [49.8, 15.5];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function popupHtml(events: MapEvent[], linkToDetail: boolean): string {
  return events
    .map((e) => {
      const title = esc(e.name);
      const name = linkToDetail ? `<a href="/zavod/${e.id}" class="map-popup-link">${title}</a>` : `<strong>${title}</strong>`;
      const cancelled = e.organizer_flag
        ? ` · <b>${esc(ORGANIZER_FLAG_LABEL[e.organizer_flag].toLowerCase())}</b>`
        : e.status === "cancelled"
          ? " · <b>zrušeno</b>"
          : "";
      return `<div class="map-popup-item">${name}<div>${esc(dateRange(e.date_from, e.date_to))} · ${esc(
        DISCIPLINE_LABEL[e.discipline],
      )} · ${esc(LEVEL_LABEL[e.level])}${cancelled}</div></div>`;
    })
    .join("");
}

/**
 * Leaflet + OSM map of events. Events at the same point share one marker with
 * a popup listing all of them. `single` = detail page (one event, no links).
 */
export default function EventMap({ events, single = false, className = "" }: { events: MapEvent[]; single?: boolean; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { scrollWheelZoom: !single, zoomControl: true }).setView(CZ_CENTER, 7);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(m);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    return () => {
      m.remove();
      map.current = null;
    };
  }, [single]);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();

    const byPoint = new Map<string, MapEvent[]>();
    for (const e of events) {
      if (e.lat == null || e.lng == null) continue;
      const k = `${e.lat.toFixed(4)},${e.lng.toFixed(4)}`;
      byPoint.set(k, [...(byPoint.get(k) ?? []), e]);
    }

    const points: L.LatLngTuple[] = [];
    for (const group of byPoint.values()) {
      const first = group[0]!;
      const pt: L.LatLngTuple = [first.lat!, first.lng!];
      points.push(pt);
      L.circleMarker(pt, {
        radius: single ? 10 : group.length > 1 ? 9 : 7,
        weight: 2,
        fillOpacity: 0.85,
        className: `marker-${first.level}${
          group.every((e) => e.status === "cancelled") ? " marker-cancelled" : group.every((e) => e.status === "finished") ? " marker-finished" : ""
        }`,
      })
        .bindPopup(popupHtml(group, !single), { maxWidth: 280 })
        .addTo(g);
    }

    if (points.length === 1) m.setView(points[0]!, single ? 12 : 10);
    else if (points.length > 1) m.fitBounds(points, { padding: [24, 24], maxZoom: 11 });
  }, [events, single]);

  return <div ref={el} className={`glass z-0 overflow-hidden rounded-2xl ${className}`} />;
}
