// Race-day view ("Živě ze závodu"): when it shows, and the outside services it points to.
import type { EventDetail, EventListItem } from "../../src/shared/types.ts";

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "eve" the day before, "live" while the race runs, else null (also for cancelled races). */
export function liveWindow(
  e: Pick<EventListItem, "date_from" | "date_to" | "status" | "organizer_flag">,
  today: string,
): "eve" | "live" | null {
  if (e.status !== "planned" || e.organizer_flag === "cancelled" || e.organizer_flag === "postponed") return null;
  if (today >= e.date_from && today <= (e.date_to ?? e.date_from)) return "live";
  if (today === addDays(e.date_from, -1)) return "eve";
  return null;
}

/** What the race-day view can show for a race; empty = no button. */
export function liveParts(e: Pick<EventDetail, "lat" | "lng" | "live">): string[] {
  const parts: string[] = [];
  if (e.lat != null && e.lng != null) parts.push("počasí a radar");
  if (e.live?.results.length) parts.push("výsledky");
  if (e.live?.streams.length) parts.push("přenos");
  return parts;
}

// Weather: Open-Meteo forecast (free for non-commercial use, CC BY 4.0), called from the browser.

/** Forecast at the race's place; the same URL is stored for offline use (web/sw/sw.ts). */
export function forecastUrl(lat: number, lng: number): string {
  const p = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lng.toFixed(3),
    current: "temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m",
    hourly: "temperature_2m,precipitation_probability,precipitation,weather_code",
    timezone: "Europe/Prague",
    forecast_days: "3",
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

export interface Forecast {
  current: { time: string; temperature_2m: number; precipitation: number; weather_code: number; wind_speed_10m: number; wind_gusts_10m: number };
  hourly: {
    time: string[];
    temperature_2m: number[];
    precipitation_probability: (number | null)[];
    precipitation: number[];
    weather_code: number[];
  };
}

export interface Hour {
  time: string;
  temp: number;
  /** Chance of rain, %. */
  chance: number | null;
  /** mm in that hour. */
  rain: number;
  code: number;
}

/** Hours to show: from now on today ("live"), the race day's daytime the day before ("eve"). */
export function forecastHours(f: Forecast, mode: "eve" | "live", raceDay: string, nowHour: string): Hour[] {
  const hours: Hour[] = f.hourly.time.map((time, i) => ({
    time,
    temp: f.hourly.temperature_2m[i]!,
    chance: f.hourly.precipitation_probability[i] ?? null,
    rain: f.hourly.precipitation[i]!,
    code: f.hourly.weather_code[i]!,
  }));
  if (mode === "eve") return hours.filter((h) => h.time.startsWith(raceDay) && h.time.slice(11, 13) >= "07" && h.time.slice(11, 13) <= "19");
  const from = hours.findIndex((h) => h.time >= nowHour);
  return from < 0 ? [] : hours.slice(from, from + 12);
}

/** WMO weather code → Czech label and emoji. */
export function weatherLabel(code: number): { text: string; icon: string } {
  if (code === 0) return { text: "Jasno", icon: "☀️" };
  if (code <= 2) return { text: "Polojasno", icon: "🌤️" };
  if (code === 3) return { text: "Zataženo", icon: "☁️" };
  if (code === 45 || code === 48) return { text: "Mlha", icon: "🌫️" };
  if (code >= 51 && code <= 57) return { text: "Mrholení", icon: "🌦️" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { text: code >= 80 ? "Přeháňky" : "Déšť", icon: "🌧️" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { text: "Sněžení", icon: "🌨️" };
  if (code >= 95) return { text: "Bouřky", icon: "⛈️" };
  return { text: "—", icon: "🌡️" };
}

// Rain radar: RainViewer (free, no key; past two hours in 10-minute frames, tiles up to zoom 7).
export const RAINVIEWER_MAPS = "https://api.rainviewer.com/public/weather-maps.json";

export interface RadarFrame {
  time: number;
  path: string;
}

export function radarTileUrl(host: string, frame: RadarFrame): string {
  // 256 px tiles, colour scheme 2 (the only one on the free API), smoothed, with snow.
  return `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
}
