// Types shared between the Worker API and the web frontend.
import type { Discipline, Level, Status } from "../pipeline/schema.ts";

export type { Discipline, Level, Status };

export interface EventListItem {
  id: string;
  name: string;
  date_from: string;
  date_to: string | null;
  discipline: Discipline;
  series: string | null;
  level: Level;
  location_name: string | null;
  region: string | null;
  country: string;
  status: Status;
  lat: number | null;
  lng: number | null;
  source_count: number;
}

export interface EventsResponse {
  events: EventListItem[];
  /** Latest successful fetch of any source (ISO), null before the first run. */
  last_ingest_at: string | null;
}
