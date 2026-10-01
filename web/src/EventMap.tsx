import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { EventListItem } from "../../src/shared/types.ts";
import { dateRange } from "./format.ts";
import type { Position } from "./distance.ts";
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
export default function EventMap({
  events,
  single = false,
  me = null,
  selectedId = null,
  follow = true,
  onSelect,
  fullscreen = false,
  interactive = true,
  padding = { top: 24, bottom: 24 },
  className = "",
}: {
  events: MapEvent[];
  single?: boolean;
  /** The visitor's position ("near me"): shown and kept in view. */
  me?: Position | null;
  /** Highlighted race; the map flies to it. */
  selectedId?: string | null;
  /** Fly to the selected race (false: only highlight it). */
  follow?: boolean;
  /** Marker click selects a race (instead of a popup). */
  onSelect?: (id: string) => void;
  /** Edge to edge, no frame (map view); controls clear of the floating UI. */
  fullscreen?: boolean;
  /** false: a still picture (detail header) – no dragging, zooming or controls. */
  interactive?: boolean;
  /** Room taken by floating UI over the map, px. */
  padding?: { top: number; bottom: number };
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, L.CircleMarker>());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, {
      scrollWheelZoom: interactive && !single,
      zoomControl: interactive,
      dragging: interactive,
      touchZoom: interactive,
      doubleClickZoom: interactive,
      boxZoom: interactive,
      keyboard: interactive,
      attributionControl: true,
    }).setView(CZ_CENTER, 7);
    if (interactive && fullscreen) m.zoomControl.setPosition("topright");
    // Detail header: the race's card covers the map's bottom edge; keep the OSM credit visible.
    if (single) m.attributionControl.setPosition("topright");
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
  }, [single, interactive, fullscreen]);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    markers.current.clear();

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
      const marker = L.circleMarker(pt, {
        radius: single ? 10 : group.length > 1 ? 9 : 7,
        weight: 2,
        fillOpacity: 0.85,
        interactive,
        className: `marker-${first.level}${
          group.every((e) => e.status === "cancelled") ? " marker-cancelled" : group.every((e) => e.status === "finished") ? " marker-finished" : ""
        }`,
      });
      if (onSelectRef.current) marker.on("click", () => onSelectRef.current?.(first.id));
      else if (interactive) marker.bindPopup(popupHtml(group, !single), { maxWidth: 280 });
      marker.addTo(g);
      for (const e of group) markers.current.set(e.id, marker);
    }

    const pad = { paddingTopLeft: [32, padding.top] as L.PointTuple, paddingBottomRight: [32, padding.bottom] as L.PointTuple };
    if (me) {
      L.circleMarker([me.lat, me.lng], { radius: 8, weight: 3, fillOpacity: 1, className: "marker-me" })
        .bindTooltip("Vy", { direction: "top", offset: [0, -8] })
        .addTo(g);
      // Around the visitor: the nearest races rather than the whole country.
      const nearest = [...points].sort((a, b) => Math.hypot(a[0] - me.lat, a[1] - me.lng) - Math.hypot(b[0] - me.lat, b[1] - me.lng));
      m.fitBounds([[me.lat, me.lng], ...nearest.slice(0, 5)], { ...pad, maxZoom: 10 });
    } else if (points.length === 1) m.setView(points[0]!, single ? 11 : 10);
    else if (points.length > 1) m.fitBounds(points, { ...pad, maxZoom: 11 });
  }, [events, single, me, interactive, padding.top, padding.bottom]);

  // Selected race: bigger, ringed marker, map flies there (centered in the area left free by the floating UI).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const mk of markers.current.values()) mk.getElement()?.classList.remove("marker-selected");
    const mk = selectedId ? markers.current.get(selectedId) : undefined;
    if (!mk) return;
    mk.getElement()?.classList.add("marker-selected");
    mk.bringToFront();
    if (!follow) return;
    const zoom = Math.max(m.getZoom(), 9);
    const target = m.unproject(m.project(mk.getLatLng(), zoom).add([0, (padding.bottom - padding.top) / 2]), zoom);
    m.flyTo(target, zoom, { duration: 0.6 });
  }, [selectedId, follow, padding.top, padding.bottom]);

  return (
    <div
      ref={el}
      className={`z-0 ${fullscreen ? "map-fullscreen" : "glass overflow-hidden rounded-2xl"} ${className}`}
      style={fullscreen ? ({ "--map-top": `${padding.top}px`, "--map-bottom": `${padding.bottom}px` } as React.CSSProperties) : undefined}
    />
  );
}
