interface Rule {
  type: "allow" | "disallow";
  path: string;
}

// In-memory cache for robots.txt results (keyed by feedUrl + userAgent).
// TTL: 1 hour — prevents 26 robots.txt HTTP fetches on every 5-min ingest tick.
const robotsCache = new Map<string, { allowed: boolean; expiresAt: number }>();
const ROBOTS_CACHE_TTL_MS = 60 * 60 * 1_000;

function parseRules(robots: string, targetAgent: string): Rule[] {
  const lines = robots
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  const rules: Rule[] = [];
  let activeAgents: string[] = [];

  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();

    if (key === "user-agent") {
      activeAgents = [value.toLowerCase()];
      continue;
    }

    const applies = activeAgents.includes("*") || activeAgents.includes(targetAgent.toLowerCase());
    if (!applies) continue;

    if (key === "allow") {
      rules.push({ type: "allow", path: value || "/" });
    }

    if (key === "disallow" && value) {
      rules.push({ type: "disallow", path: value });
    }
  }

  return rules;
}

function patternToRegex(path: string): RegExp {
  const escaped = path
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");

  return new RegExp(`^${escaped}`);
}

export async function isFeedAllowedByRobots(
  feedUrl: string,
  userAgent = "chainshorts-bot",
  strictMode = true
): Promise<boolean> {
  const cacheKey = `${feedUrl}::${userAgent}`;
  const cached = robotsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.allowed;
  }

  try {
    const target = new URL(feedUrl);
    const robotsUrl = `${target.origin}/robots.txt`;
    const response = await fetch(robotsUrl, {
      headers: {
        "User-Agent": userAgent
      },
      signal: AbortSignal.timeout(5_000)
    });

    if (!response.ok) {
      const allowed = !strictMode;
      robotsCache.set(cacheKey, { allowed, expiresAt: Date.now() + ROBOTS_CACHE_TTL_MS });
      return allowed;
    }

    const robots = await response.text();
    const rules = parseRules(robots, userAgent);

    if (rules.length === 0) {
      robotsCache.set(cacheKey, { allowed: true, expiresAt: Date.now() + ROBOTS_CACHE_TTL_MS });
      return true;
    }

    const pathname = target.pathname || "/";
    let matched: Rule | null = null;

    for (const rule of rules) {
      if (!patternToRegex(rule.path).test(pathname)) {
        continue;
      }

      if (!matched || rule.path.length >= matched.path.length) {
        matched = rule;
      }
    }

    const allowed = !matched || matched.type === "allow";
    robotsCache.set(cacheKey, { allowed, expiresAt: Date.now() + ROBOTS_CACHE_TTL_MS });
    return allowed;
  } catch {
    const allowed = !strictMode;
    robotsCache.set(cacheKey, { allowed, expiresAt: Date.now() + ROBOTS_CACHE_TTL_MS });
    return allowed;
  }
}
