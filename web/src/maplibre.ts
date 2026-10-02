import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAP_STYLES } from "./basemap.ts";

// MapLibre set-up shared by the maps (EventMap, RadarMap): the style follows the
// app's light / dark theme, natively – no CSS filter over the tiles.

export { maplibregl };

function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

export function styleUrl(): string {
  return isDark() ? MAP_STYLES.dark : MAP_STYLES.light;
}

/**
 * A map in `container`, or null where WebGL is missing. Switches style when the
 * theme changes (HTML markers stay; layers added by the caller are re-added in
 * `onStyle`, called after every style load).
 */
export function createMap(
  container: HTMLElement,
  options: Omit<maplibregl.MapOptions, "container" | "style">,
  onStyle?: (m: maplibregl.Map) => void,
): { map: maplibregl.Map; dispose: () => void } | null {
  let map: maplibregl.Map;
  try {
    map = new maplibregl.Map({ container, style: styleUrl(), attributionControl: false, ...options });
  } catch {
    return null;
  }
  if (onStyle) map.on("style.load", () => onStyle(map));
  let dark = isDark();
  const observer = new MutationObserver(() => {
    if (isDark() === dark) return;
    dark = isDark();
    map.setStyle(styleUrl());
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return {
    map,
    dispose: () => {
      observer.disconnect();
      map.remove();
    },
  };
}
