import { afterEach, describe, expect, it, vi } from "vitest";
import { isFeedAllowedByRobots } from "./robots.js";

describe("robots parser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when robots disallows path", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(`User-agent: *\nDisallow: /feed`, { status: 200 })
    );

    const allowed = await isFeedAllowedByRobots("https://example.com/feed");
    expect(allowed).toBe(false);
  });

  it("returns true when no rule matches path", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(`User-agent: *\nDisallow: /private`, { status: 200 })
    );

    const allowed = await isFeedAllowedByRobots("https://example.com/feed");
    expect(allowed).toBe(true);
  });
});
