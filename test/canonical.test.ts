import { describe, expect, it } from "vitest";
import { canonicalUrl } from "../src/canonical.ts";

const WWW = "www.zavody-aut.cz";
const at = (u: string) => canonicalUrl(new URL(u), WWW);

describe("canonical address", () => {
  it("moves pages from workers.dev and the bare domain to www", () => {
    expect(at("https://zavody-kalendar.j-sankot.workers.dev/zavod/abc?x=1")).toBe("https://www.zavody-aut.cz/zavod/abc?x=1");
    expect(at("https://zavody-aut.cz/")).toBe("https://www.zavody-aut.cz/");
  });
  it("moves plain http on the main address to https", () => {
    expect(at("http://www.zavody-aut.cz/zavod/abc")).toBe("https://www.zavody-aut.cz/zavod/abc");
    expect(at("http://www.zavody-aut.cz/api/events")).toBeNull();
  });
  it("keeps the main address, API, admin and local dev", () => {
    expect(at("https://www.zavody-aut.cz/zavod/abc")).toBeNull();
    expect(at("https://zavody-kalendar.j-sankot.workers.dev/api/events")).toBeNull();
    expect(at("https://zavody-aut.cz/admin/run")).toBeNull();
    expect(at("http://localhost:8787/")).toBeNull();
  });
  it("does nothing until the main address is set", () => {
    expect(canonicalUrl(new URL("https://zavody-kalendar.j-sankot.workers.dev/"), "")).toBeNull();
  });
});
