import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_APP_ENV = process.env.APP_ENV;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  if (ORIGINAL_APP_ENV === undefined) {
    Reflect.deleteProperty(process.env, "APP_ENV");
  } else {
    process.env.APP_ENV = ORIGINAL_APP_ENV;
  }

  if (ORIGINAL_NODE_ENV === undefined) {
    Reflect.deleteProperty(process.env, "NODE_ENV");
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }

  vi.resetModules();
});

describe("parseHttpUrl", () => {
  it("rejects unsafe schemes and embedded credentials", async () => {
    const { parseHttpUrl } = await import("./url");
    expect(parseHttpUrl("javascript:alert(1)")).toBeNull();
    expect(parseHttpUrl("https://user:pass@example.com")).toBeNull();
    expect(parseHttpUrl("https://example.com")).not.toBeNull();
  });

  it("enforces production-safe URL rules", async () => {
    process.env.APP_ENV = "production";
    vi.resetModules();
    const { parseHttpUrl } = await import("./url");

    expect(parseHttpUrl("http://example.com")).toBeNull();
    expect(parseHttpUrl("https://localhost/news")).toBeNull();
    expect(parseHttpUrl("https://10.0.0.1/feed")).toBeNull();
    expect(parseHttpUrl("https://example.com/news")?.toString()).toBe("https://example.com/news");
  });
});
