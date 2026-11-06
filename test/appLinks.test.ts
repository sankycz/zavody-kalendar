import { describe, expect, it } from "vitest";
import { APP_SITE_ASSOCIATION_PATH, IOS_APP_ID, appSiteAssociation } from "../src/appLinks.ts";
import { canonicalUrl } from "../src/canonical.ts";

describe("apple-app-site-association", () => {
  it("links race pages to the iOS app", async () => {
    const res = appSiteAssociation();
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const body = (await res.json()) as { applinks: { details: { appIDs: string[]; components: { "/": string }[] }[] } };
    expect(body.applinks.details[0]!.appIDs).toEqual([IOS_APP_ID]);
    expect(body.applinks.details[0]!.components.map((c) => c["/"])).toEqual(["/zavod/*"]);
  });

  it("is a path the canonical redirect would move on the bare domain, so it is answered before it", () => {
    expect(canonicalUrl(new URL(`https://zavody-aut.cz${APP_SITE_ASSOCIATION_PATH}`), "www.zavody-aut.cz")).not.toBeNull();
  });
});
