import { describe, expect, it } from "vitest";
import { liveLinks } from "../src/api.ts";
import { embeddedVideoUrl } from "../src/pipeline/htmlToText.ts";
import { pageLink } from "../src/pipeline/organizer.ts";
import { forecastHours, forecastUrl, liveParts, liveWindow, weatherLabel, type Forecast } from "../web/src/live.ts";
import { createTestDb } from "./d1shim.ts";

const race = { date_from: "2026-10-03", date_to: "2026-10-04", status: "planned" as const, organizer_flag: null };

describe("race-day window", () => {
  it("opens the day before and stays while the race runs", () => {
    expect(liveWindow(race, "2026-10-01")).toBeNull();
    expect(liveWindow(race, "2026-10-02")).toBe("eve");
    expect(liveWindow(race, "2026-10-03")).toBe("live");
    expect(liveWindow(race, "2026-10-04")).toBe("live");
    expect(liveWindow(race, "2026-10-05")).toBeNull();
    expect(liveWindow({ ...race, date_to: null }, "2026-10-04")).toBeNull();
  });

  it("not for cancelled or postponed races", () => {
    expect(liveWindow({ ...race, status: "cancelled" }, "2026-10-03")).toBeNull();
    expect(liveWindow({ ...race, organizer_flag: "postponed" }, "2026-10-03")).toBeNull();
  });
});

describe("links out", () => {
  it("the race-day button names only what there is", () => {
    const link = { label: "x", url: "https://x.cz", from: "organizer" as const };
    expect(liveParts({ lat: 49.4, lng: 13.3, live: { results: [], streams: [] } })).toEqual(["počasí a radar"]);
    expect(liveParts({ lat: null, lng: null, live: { results: [link], streams: [link] } })).toEqual(["výsledky", "přenos"]);
    expect(liveParts({ lat: null, lng: null, live: { results: [], streams: [] } })).toEqual([]);
  });

  it("embedded players become watch links", () => {
    expect(embeddedVideoUrl("https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(embeddedVideoUrl("https://www.youtube-nocookie.com/embed/live_stream?channel=UC_x5XG1OV2P6uZZ5FSM9Ttw")).toBe(
      "https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw/live",
    );
    expect(embeddedVideoUrl("https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fakklatovy%2Fvideos%2F123%2F&amp;show_text=0")).toBe(
      "https://www.facebook.com/akklatovy/videos/123/",
    );
    expect(embeddedVideoUrl("https://maps.google.com/maps?q=Klatovy")).toBeNull();
  });

  it("keeps only links the model really found on the page", () => {
    const text = "Výsledky (https://org.cz/vysledky) a přenos (https://youtu.be/abc)";
    expect(pageLink("https://org.cz/vysledky", text)).toBe("https://org.cz/vysledky");
    expect(pageLink("https://org.cz/live", text)).toBeNull();
    expect(pageLink("javascript:alert(1)", "javascript:alert(1)")).toBeNull();
    expect(pageLink(null, text)).toBeNull();
  });
});

describe("results services by discipline and series", () => {
  const { d1 } = createTestDb();
  const urls = async (discipline: string, series: string | null, name = "Rallye X") =>
    (await liveLinks(d1, { name, date_from: "2026-10-03", discipline: discipline as never, series }, null, [])).results.map((l) => l.url);

  it("rally: championship services, the cup's own results first", async () => {
    expect(await urls("rally", null)).toEqual(["https://rally-vysledky.com/", "https://www.ewrc-results.com/"]);
    expect(await urls("rally", "Českomoravský pohár rallye")).toEqual([
      "https://cmpr.cz/vysledky/",
      "https://rally-vysledky.com/",
      "https://www.ewrc-results.com/",
    ]);
    expect((await urls("rally", null, "55. Barum Czech Rally Zlín"))[0]).toBe("https://www.czechrally.com/en/rally-results");
  });

  it("autocross and hill climbs", async () => {
    expect(await urls("autocross", "MČR")).toEqual(["https://www.rallycross.cz/"]);
    expect(await urls("vrch", "MČR")).toEqual([]);
  });

  it("video links from sources count as streams only on video sites", async () => {
    const live = await liveLinks(d1, { name: "X", date_from: "2026-10-03", discipline: "vrch", series: null }, null, [
      { label: "Přenos", url: "https://www.youtube.com/watch?v=abc", kind: "video" },
      { label: "Pozvánka", url: "https://org.cz/video.mp4", kind: "video" },
      { label: "Harmonogram", url: "https://youtube.com/x", kind: "harmonogram" },
    ]);
    expect(live.streams).toEqual([{ label: "Přenos", url: "https://www.youtube.com/watch?v=abc", from: "source" }]);
  });
});

describe("weather", () => {
  const times = ["2026-10-02T13:00", "2026-10-02T14:00", "2026-10-03T06:00", "2026-10-03T07:00", "2026-10-03T19:00", "2026-10-03T20:00"];
  const f: Forecast = {
    current: { time: "2026-10-02T14:15", temperature_2m: 12, precipitation: 0, weather_code: 3, wind_speed_10m: 10, wind_gusts_10m: 20 },
    hourly: { time: times, temperature_2m: times.map(() => 10), precipitation_probability: times.map(() => 40), precipitation: times.map(() => 0), weather_code: times.map(() => 61) },
  };
  it("the race day's daytime the day before, the next hours on race day", () => {
    expect(forecastHours(f, "eve", "2026-10-03", "2026-10-02T14:00").map((h) => h.time)).toEqual(["2026-10-03T07:00", "2026-10-03T19:00"]);
    expect(forecastHours(f, "live", "2026-10-02", "2026-10-02T14:00")[0]!.time).toBe("2026-10-02T14:00");
  });
  it("labels weather codes in Czech", () => {
    expect(weatherLabel(61).text).toBe("Déšť");
    expect(weatherLabel(95).text).toBe("Bouřky");
    expect(forecastUrl(49.39, 13.29)).toContain("latitude=49.390&longitude=13.290");
  });
});
