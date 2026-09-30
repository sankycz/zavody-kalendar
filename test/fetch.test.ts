import { describe, expect, it } from "vitest";
import { htmlToText } from "../src/pipeline/htmlToText.ts";
import { PoliteClient, RobotsDisallowedError, sha256Hex } from "../src/pipeline/http.ts";
import { isAllowed } from "../src/pipeline/robots.ts";

const UA = "zavody-kalendar/0.1 (+https://github.com/sankycz/zavody-kalendar; test@example.com)";

describe("robots.txt", () => {
  const txt = `
User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php
Disallow: /*?s=

User-agent: BadBot
Disallow: /
`;
  it.each([
    ["/205368-kalendar-automobiloveho-sportu-acr-2026/", true],
    ["/wp-content/uploads/2026/01/cal.pdf", true],
    ["/wp-admin/options.php", false],
    ["/wp-admin/admin-ajax.php", true],
    ["/?s=rally", false],
  ])("%s allowed=%s", (path, allowed) => {
    expect(isAllowed(txt, UA, path)).toBe(allowed);
  });

  it("specific group applies to its agent", () => {
    expect(isAllowed(txt, "BadBot/1.0", "/anything")).toBe(false);
  });

  it("empty robots allows everything", () => {
    expect(isAllowed("", UA, "/x")).toBe(true);
  });
});

describe("PoliteClient", () => {
  function fakeFetch(robots: string | number) {
    const calls: { url: string; ua: string | null; at: number }[] = [];
    let clock = 0;
    const client = new PoliteClient({
      userAgent: UA,
      minIntervalMs: 3000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      fetcher: async (url, init) => {
        calls.push({ url, ua: new Headers(init?.headers).get("User-Agent"), at: clock });
        if (url.endsWith("/robots.txt")) {
          return typeof robots === "number" ? new Response("", { status: robots }) : new Response(robots);
        }
        return new Response("ok");
      },
    });
    return { client, calls };
  }

  it("sends own User-Agent and spaces requests per host", async () => {
    const { client, calls } = fakeFetch("User-agent: *\nDisallow:");
    await client.get("https://a.example/1");
    await client.get("https://a.example/2");
    expect(calls.map((c) => c.url)).toEqual(["https://a.example/robots.txt", "https://a.example/1", "https://a.example/2"]);
    expect(calls.every((c) => c.ua === UA)).toBe(true);
    expect(calls.map((c) => c.at)).toEqual([0, 3000, 6000]);
  });

  it("refuses URLs disallowed by robots.txt", async () => {
    const { client } = fakeFetch("User-agent: *\nDisallow: /private");
    await expect(client.get("https://a.example/private/x")).rejects.toBeInstanceOf(RobotsDisallowedError);
  });

  it("404 robots = allowed, 5xx robots = disallowed", async () => {
    await expect(fakeFetch(404).client.get("https://a.example/x")).resolves.toBeInstanceOf(Response);
    await expect(fakeFetch(503).client.get("https://a.example/x")).rejects.toBeInstanceOf(RobotsDisallowedError);
  });
});

describe("htmlToText", () => {
  const html = `<html><head><style>.x{}</style><script>var a=1</script></head><body>
<header><nav><a href="/">Domů</a> <a href="/o-nas">O nás</a></nav></header>
<main><h1>Kalendář 2026</h1>
<table><tr><td>22.&nbsp;5.</td><td>Rallye Test</td><td><a href="https://rallye.example">web</a></td></tr>
<tr><td>6. 6.</td><td>Vrch &amp; Co</td><td></td></tr></table>
<p>Poznámka: <a href="/doc.pdf">PDF</a> <a href="mailto:x@y.cz">mail</a></p></main>
<footer>© Autoklub</footer></body></html>`;

  it("keeps main content, rows on one line, links as text (url)", () => {
    expect(htmlToText(html, "https://www.autoklub.example/kalendar/")).toBe(
      [
        "Kalendář 2026",
        "22. 5. | Rallye Test | web (https://rallye.example/)",
        "6. 6. | Vrch & Co",
        "Poznámka: PDF (https://www.autoklub.example/doc.pdf) mail",
      ].join("\n"),
    );
  });
});

describe("sha256Hex", () => {
  it("hashes bytes", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
