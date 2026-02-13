import { describe, expect, it } from "vitest";
import { darkPalette, lightPalette, palette } from "./palette";

describe("palette", () => {
  it("exposes core brand colors", () => {
    expect(palette.coal).toBe("#0A1018");
    expect(palette.ember).toBe("#14F195");
    expect(lightPalette.white).toBe("#FFFFFF");
    expect(darkPalette.white).toBe("#FFFFFF");
  });
});
