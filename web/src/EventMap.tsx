import { useEffect, useRef, useState } from "react";
import type { EventListItem } from "../../src/shared/types.ts";
import { dateRange } from "./format.ts";
import type { Position } from "./distance.ts";
import { DISCIPLINE_LABEL, LEVEL_LABEL, ORGANIZER_FLAG_LABEL } from "./labels.ts";
import { createMap, maplibregl } from "./maplibre.ts";

type MapEvent = Pick<
  EventListItem,
  "id" | "name" | "date_from" | "date_to" | "discipline" | "level" | "status" | "lat" | "lng" | "organizer_flag"
>;

const CZ_CENTER: [number, number] = [15.5, 49.8];

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

/** Round marker (HTML, so it survives a style switch light ↔ dark); colour by level. */
function markerEl(className: string, size: number, label: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `map-marker ${className}`;
  el.style.setProperty("--size", `${size}px`);
  el.setAttribute("aria-label", label);
  return el;
}

/**
 * Vector map of events (MapLibre GL, OpenFreeMap). Events at the same point
 * share one marker with a popup listing all of them. `single` = detail page
 * (one event, no links).
 */
export default function EventMap({
  events,
  single = false,
  me = null,
  selectedId = null,
  follow = true,
  onSelect,
  fullscreen = false,
  framed = true,
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
  /** Own glass frame and rounded corners (false: part of a card that frames it). */
  framed?: boolean;
  /** false: a still picture (detail header) – no dragging, zooming or controls. */
  interactive?: boolean;
  /** Room taken by floating UI over the map, px. */
  padding?: { top: number; bottom: number };
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const all = useRef<maplibregl.Marker[]>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!el.current) return;
    const created = createMap(el.current, {
      center: CZ_CENTER,
      zoom: 6,
      interactive,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      cooperativeGestures: false,
      scrollZoom: interactive && !single,
    });
    if (!created) return setFailed(true);
    const m = created.map;
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.AttributionControl({ compact: true }), single || fullscreen ? "top-right" : "bottom-right");
    if (interactive) m.addControl(new maplibregl.NavigationControl({ showCompass: false }), fullscreen ? "top-right" : "top-left");
    map.current = m;
    return () => {
      created.dispose();
      map.current = null;
    };
  }, [single, interactive, fullscreen]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const mk of all.current) mk.remove();
    all.current = [];
    markers.current.clear();

    const byPoint = new Map<string, MapEvent[]>();
    for (const e of events) {
      if (e.lat == null || e.lng == null) continue;
      const k = `${e.lat.toFixed(4)},${e.lng.toFixed(4)}`;
      byPoint.set(k, [...(byPoint.get(k) ?? []), e]);
    }

    const points: [number, number][] = [];
    for (const group of byPoint.values()) {
      const first = group[0]!;
      const pt: [number, number] = [first.lng!, first.lat!];
      points.push(pt);
      const state = group.every((e) => e.status === "cancelled") ? " marker-cancelled" : group.every((e) => e.status === "finished") ? " marker-finished" : "";
      const size = single ? 20 : group.length > 1 ? 18 : 14;
      const node = markerEl(`marker-${first.level}${state}${interactive ? " is-interactive" : ""}`, size, group.map((e) => e.name).join(", "));
      const marker = new maplibregl.Marker({ element: node }).setLngLat(pt).addTo(m);
      if (onSelectRef.current) {
        node.addEventListener("click", (ev) => {
          ev.stopPropagation();
          onSelectRef.current?.(first.id);
        });
      } else if (interactive) {
        marker.setPopup(new maplibregl.Popup({ offset: size / 2 + 4, maxWidth: "280px", closeButton: true }).setHTML(popupHtml(group, !single)));
      }
      all.current.push(marker);
      for (const e of group) markers.current.set(e.id, marker);
    }

    const pad = { top: padding.top, bottom: padding.bottom, left: 32, right: 32 };
    if (me) {
      const node = markerEl("marker-me", 16, "Vaše poloha");
      all.current.push(new maplibregl.Marker({ element: node }).setLngLat([me.lng, me.lat]).addTo(m));
      // Around the visitor: the nearest races rather than the whole country.
      const nearest = [...points].sort((a, b) => Math.hypot(a[1] - me.lat, a[0] - me.lng) - Math.hypot(b[1] - me.lat, b[0] - me.lng));
      fit(m, [[me.lng, me.lat], ...nearest.slice(0, 5)], pad, 10);
    } else if (points.length === 1) m.jumpTo({ center: points[0]!, zoom: single ? 11 : 10 });
    else if (points.length > 1) fit(m, points, pad, 11);
  }, [events, single, me, interactive, padding.top, padding.bottom]);

  // Selected race: bigger, ringed marker; the map flies there, centred in the area left free by the floating UI.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const mk of markers.current.values()) mk.getElement().classList.remove("marker-selected");
    const mk = selectedId ? markers.current.get(selectedId) : undefined;
    if (!mk) return;
    mk.getElement().classList.add("marker-selected");
    if (!follow) return;
    m.flyTo({
      center: mk.getLngLat(),
      zoom: Math.max(m.getZoom(), 9),
      padding: { top: padding.top, bottom: padding.bottom, left: 0, right: 0 },
      duration: 600,
    });
  }, [selectedId, follow, padding.top, padding.bottom]);

  if (failed) {
    return (
      <div className={`grid place-items-center bg-surface-2 p-4 text-center text-sm text-muted ${framed && !fullscreen ? "rounded-2xl" : ""} ${className}`}>
        Mapu tento prohlížeč neumí zobrazit (chybí WebGL).
      </div>
    );
  }
  return (
    <div
      ref={el}
      className={`z-0 ${fullscreen ? "map-fullscreen" : framed ? "glass overflow-hidden rounded-2xl" : ""} ${className}`}
      style={fullscreen ? ({ "--map-top": `${padding.top}px`, "--map-bottom": `${padding.bottom}px` } as React.CSSProperties) : undefined}
    />
  );
}

function fit(m: maplibregl.Map, points: [number, number][], padding: maplibregl.PaddingOptions, maxZoom: number) {
  const b = new maplibregl.LngLatBounds(points[0], points[0]);
  for (const p of points) b.extend(p);
  m.fitBounds(b, { padding, maxZoom, duration: 0 });
}
