// Types shared between the Worker API and the web frontend.
import type { Discipline, Level, LinkKind, Status } from "../pipeline/schema.ts";

export type { Discipline, Level, LinkKind, Status };

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
  /** What the organizer's own website reports, when it differs from the calendar. */
  organizer_flag: OrganizerFlag | null;
}

export type OrganizerFlag = "cancelled" | "postponed" | "date_changed";

export interface OrganizerCheckInfo {
  url: string;
  checked_at: string;
  outcome: "confirmed" | "changed" | "not_mentioned" | "error";
  status: "planned" | "cancelled" | "postponed" | null;
  /** Dates the organizer reports, only when they differ from the calendar. */
  date_from: string | null;
  date_to: string | null;
  notice: string | null;
  /** Last check failed (earlier findings above still apply). */
  error: string | null;
  changed_at: string | null;
}

export interface EventsResponse {
  events: EventListItem[];
  /** Latest successful fetch of any source (ISO), null before the first run. */
  last_ingest_at: string | null;
  /** Seasons (years) that have races in the calendar, ascending – for the season switch (absent from older API versions). */
  seasons?: number[];
}

export interface EventSourceLink {
  /** Human-readable source name, e.g. 'Autoklub ČR – kalendář (PDF)'. */
  name: string;
  url: string;
  last_seen_at: string;
}

/** A document for spectators (schedule, map, regulations…) linked by a source. */
export interface EventLink {
  label: string;
  url: string;
  kind: LinkKind;
}

export interface EventDetail extends EventListItem {
  organizer: string | null;
  website_url: string | null;
  description: string | null;
  updated_at: string;
  sources: EventSourceLink[];
  /** Absent from older API versions. */
  links?: EventLink[];
  organizer_check: OrganizerCheckInfo | null;
  /** Race-day view: where to follow the race (absent from older API versions). */
  live?: LiveLinks;
  /** Stages and road closures from the organizer's documents; null when no document gives them (absent from older API versions). */
  stages?: StagesInfo | null;
}

/** One run of a stage (RZ). Times HH:MM local; closure only when the document states it. */
export interface StageInfo {
  name: string;
  date: string | null;
  first_car: string | null;
  closed_from: string | null;
  closed_to: string | null;
  length_km: number | null;
}

export interface StagesInfo {
  /** The organizer's document the stages were read from. */
  doc_url: string;
  checked_at: string;
  items: StageInfo[];
}

/** A link for following a race live. We only point there, results stay on that site. */
export interface LiveLink {
  label: string;
  url: string;
  /** organizer = found on the organizer's website for this race; service = results service for the discipline / series; source = a video link from a calendar source. */
  from: "organizer" | "service" | "source";
}

export interface LiveLinks {
  results: LiveLink[];
  streams: LiveLink[];
}

export interface RegionsResponse {
  /** Regions (kraje) of upcoming events, alphabetical. */
  regions: string[];
}
