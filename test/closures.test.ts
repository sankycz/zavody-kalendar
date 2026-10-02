import { describe, expect, it } from "vitest";
import type { EventLink } from "../src/shared/types.ts";
import { closesRoads, closureDoc } from "../web/src/closures.ts";

const race = { discipline: "rally" as const, status: "planned" as const, organizer_flag: null };

describe("road closures warning", () => {
  it("for upcoming races on closed public roads", () => {
    expect(closesRoads(race)).toBe(true);
    expect(closesRoads({ ...race, discipline: "rallysprint" })).toBe(true);
    expect(closesRoads({ ...race, discipline: "vrch" })).toBe(true);
    expect(closesRoads({ ...race, discipline: "okruh" })).toBe(false);
    expect(closesRoads({ ...race, discipline: "autocross" })).toBe(false);
  });

  it("not for finished, cancelled or postponed races", () => {
    expect(closesRoads({ ...race, status: "finished" })).toBe(false);
    expect(closesRoads({ ...race, status: "cancelled" })).toBe(false);
    expect(closesRoads({ ...race, organizer_flag: "postponed" })).toBe(false);
  });

  it("points to the spectator info first, then the stage map", () => {
    const link = (kind: EventLink["kind"]): EventLink => ({ kind, label: kind, url: `https://x.cz/${kind}` });
    expect(closureDoc([link("plakat"), link("harmonogram"), link("mapa")])?.kind).toBe("mapa");
    expect(closureDoc([link("mapa"), link("divaci")])?.kind).toBe("divaci");
    expect(closureDoc([link("plakat"), link("video")])).toBeNull();
  });
});
