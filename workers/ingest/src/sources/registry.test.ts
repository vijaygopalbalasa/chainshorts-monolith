import { describe, expect, it } from "vitest";
import { sourceRegistry } from "./registry.js";

describe("source registry", () => {
  it("contains active compliant sources", () => {
    expect(sourceRegistry.length).toBeGreaterThan(0);
    for (const item of sourceRegistry) {
      expect(item.policy.active).toBe(true);
      expect(item.policy.requiresLinkBack).toBe(true);
    }
  });
});
