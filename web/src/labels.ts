import type { Discipline, Level, OrganizerFlag } from "../../src/shared/types.ts";

export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  rally: "Rally",
  rallysprint: "Rallysprint",
  vrch: "Závod do vrchu",
  autocross: "Autokros",
  slalom: "Autoslalom",
  okruh: "Okruh",
  drift: "Drift",
  regularity: "Regularity",
  historic: "Historická vozidla",
  jiny: "Jiné",
};

export const LEVEL_LABEL: Record<Level, string> = {
  mcr: "MČR",
  pohar: "Pohár / seriál",
  regionalni: "Regionální",
  volny: "Volný závod",
};

const COUNTRY_LABEL: Record<string, string> = {
  AT: "Rakousko",
  SK: "Slovensko",
  DE: "Německo",
  PL: "Polsko",
  HU: "Maďarsko",
  IT: "Itálie",
  SI: "Slovinsko",
  HR: "Chorvatsko",
};

export function countryLabel(code: string): string {
  return COUNTRY_LABEL[code] ?? code;
}

/** Short badge for what the organizer's website reports. */
export const ORGANIZER_FLAG_LABEL: Record<OrganizerFlag, string> = {
  cancelled: "Zrušeno pořadatelem",
  postponed: "Odloženo",
  date_changed: "Změna termínu?",
};
