import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { RAINVIEWER_MAPS, radarTileUrl, type RadarFrame } from "./live.ts";

interface Maps {
  host: string;
  radar: { past: RadarFrame[]; nowcast?: RadarFrame[] };
}

const time = new Intl.DateTimeFormat("cs-CZ", { hour: "numeric", minute: "2-digit", timeZone: "Europe/Prague" });
const FRAME_MS = 700;

/**
 * Rain radar around the race: OSM map, RainViewer's last two hours on top.
 * Shows the latest picture; "play" loads the other frames only then (the free
 * API allows 100 requests a minute per visitor).
 */
export default function RadarMap({ lat, lng }: { lat: number; lng: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef(new Map<number, L.TileLayer>());
  const [maps, setMaps] = useState<Maps | null>(null);
  const [error, setError] = useState(false);
  const [frame, setFrame] = useState(-1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([lat, lng], 8);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 12,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(m);
    L.circleMarker([lat, lng], { radius: 8, weight: 3, fillOpacity: 1, className: "marker-mcr", interactive: false }).addTo(m);
    map.current = m;
    const ctrl = new AbortController();
    fetch(RAINVIEWER_MAPS, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Maps>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!d.radar.past.length) throw new Error("no frames");
        setMaps(d);
        setFrame(d.radar.past.length - 1);
      })
      .catch(() => !ctrl.signal.aborted && setError(true));
    return () => {
      ctrl.abort();
      m.remove();
      map.current = null;
      layers.current.clear();
    };
  }, [lat, lng]);

  // Show the current frame (its layer created on first use), hide the others.
  useEffect(() => {
    const m = map.current;
    const f = maps?.radar.past[frame];
    if (!m || !maps || !f) return;
    let layer = layers.current.get(f.time);
    if (!layer) {
      layer = L.tileLayer(radarTileUrl(maps.host, f), {
        maxNativeZoom: 7,
        maxZoom: 12,
        opacity: 0,
        zIndex: 10,
        className: "radar-layer",
        attribution: '<a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>',
      }).addTo(m);
      layers.current.set(f.time, layer);
    }
    for (const [t, l] of layers.current) l.setOpacity(t === f.time ? 0.75 : 0);
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
