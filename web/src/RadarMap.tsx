import { useEffect, useRef, useState } from "react";
import { RAINVIEWER_MAPS, radarTileUrl, type RadarFrame } from "./live.ts";
import { createMap, maplibregl } from "./maplibre.ts";

interface Maps {
  host: string;
  radar: { past: RadarFrame[]; nowcast?: RadarFrame[] };
}

const time = new Intl.DateTimeFormat("cs-CZ", { hour: "numeric", minute: "2-digit", timeZone: "Europe/Prague" });
const FRAME_MS = 700;
const OPACITY = 0.75;
const layerId = (f: RadarFrame) => `radar-${f.time}`;

/**
 * Rain radar around the race: the vector base map, RainViewer's last two hours
 * on top. Shows the latest picture; "play" loads the other frames only then
 * (the free API allows 100 requests a minute per visitor).
 */
export default function RadarMap({ lat, lng }: { lat: number; lng: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  /** Frames already added as layers (re-added after a light/dark style switch). */
  const added = useRef(new Map<number, RadarFrame>());
  const host = useRef("");
  const shown = useRef<number | null>(null);
  const [maps, setMaps] = useState<Maps | null>(null);
  const [error, setError] = useState(false);
  const [frame, setFrame] = useState(-1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!el.current) return;
    const addFrames = (m: maplibregl.Map) => {
      for (const f of added.current.values()) addLayer(m, host.current, f, f.time === shown.current);
    };
    const created = createMap(el.current, { center: [lng, lat], zoom: 7.5, dragRotate: false, touchPitch: false, scrollZoom: false, maxZoom: 11 }, addFrames);
    if (!created) {
      setError(true);
      return;
    }
    const m = created.map;
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    m.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: '<a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>' }), "bottom-right");
    const dot = document.createElement("div");
    dot.className = "map-marker marker-mcr";
    dot.style.setProperty("--size", "16px");
    new maplibregl.Marker({ element: dot }).setLngLat([lng, lat]).addTo(m);
    map.current = m;
    const ctrl = new AbortController();
    fetch(RAINVIEWER_MAPS, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Maps>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!d.radar.past.length) throw new Error("no frames");
        host.current = d.host;
        setMaps(d);
        setFrame(d.radar.past.length - 1);
      })
      .catch(() => !ctrl.signal.aborted && setError(true));
    return () => {
      ctrl.abort();
      created.dispose();
      map.current = null;
      added.current.clear();
    };
  }, [lat, lng]);

  // Show the current frame (its layer added on first use), hide the others.
  useEffect(() => {
    const m = map.current;
    const f = maps?.radar.past[frame];
    if (!m || !maps || !f) return;
    shown.current = f.time;
    const apply = () => {
      if (!added.current.has(f.time)) {
        added.current.set(f.time, f);
        addLayer(m, maps.host, f, true);
      }
      for (const a of added.current.values()) {
        if (m.getLayer(layerId(a))) m.setPaintProperty(layerId(a), "raster-opacity", a.time === f.time ? OPACITY : 0);
      }
    };
    if (m.isStyleLoaded()) apply();
    else m.once("style.load", apply);
  }, [frame, maps]);

  useEffect(() => {
    if (!playing || !maps) return;
    const n = maps.radar.past.length;
    const t = setInterval(() => setFrame((i) => (i + 1) % n), FRAME_MS);
    return () => clearInterval(t);
  }, [playing, maps]);

  const f = maps?.radar.past[frame];
  return (
    <div>
      <div ref={el} className="z-0 h-72 w-full overflow-hidden rounded-2xl sm:h-80" />
      <div className="mt-2 flex items-center gap-2">
        {maps && f ? (
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="press flex min-h-10 items-center gap-2 rounded-full bg-surface-2 px-3.5 text-sm font-semibold ring-1 ring-glass-border ring-inset"
            aria-label={playing ? "Zastavit animaci radaru" : "Přehrát poslední dvě hodiny radaru"}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
              {playing ? <path d="M7 5h3v14H7zM14 5h3v14h-3z" /> : <path d="M8 5v14l11-7z" />}
            </svg>
            <span className="tabular-nums">{time.format(f.time * 1000)}</span>
            {frame === maps.radar.past.length - 1 && <span className="text-xs font-medium text-muted">poslední snímek</span>}
          </button>
        ) : (
          <span className="py-2 text-sm text-muted">{error ? "Radar se nepodařilo načíst." : "Načítám radar…"}</span>
        )}
      </div>
    </div>
  );
}

function addLayer(m: maplibregl.Map, host: string, f: RadarFrame, visible: boolean) {
  const id = layerId(f);
  if (m.getLayer(id)) return;
  if (!m.getSource(id)) {
    // RainViewer's free tiles go up to zoom 7; MapLibre stretches them when closer.
    m.addSource(id, { type: "raster", tiles: [radarTileUrl(host, f)], tileSize: 256, maxzoom: 7 });
  }
  m.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": visible ? OPACITY : 0, "raster-fade-duration": 0 } });
}
