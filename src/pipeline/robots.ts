interface Group {
  agents: string[];
  rules: { allow: boolean; path: string }[];
}

function parse(robotsTxt: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const line of robotsTxt.split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(clean);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      if (value) current.rules.push({ allow: key === "allow", path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function matches(rulePath: string, path: string): boolean {
  const anchored = rulePath.endsWith("$");
  const body = anchored ? rulePath.slice(0, -1) : rulePath;
  const re = new RegExp(
    "^" + body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""),
  );
  return re.test(path);
}

/**
 * robots.txt check (RFC 9309): pick the most specific matching user-agent group
 * (falls back to '*'), then the longest matching rule wins; Allow wins ties.
 */
export function isAllowed(robotsTxt: string, userAgent: string, pathWithQuery: string): boolean {
  const groups = parse(robotsTxt);
  const ua = userAgent.toLowerCase();
  const product = ua.split("/")[0]!;
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && (product.includes(a) || a.includes(product))));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of chosen) {
    for (const r of g.rules) {
      if (!matches(r.path, pathWithQuery)) continue;
      const len = r.path.length;
      if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
    }
  }
  return best ? best.allow : true;
}
