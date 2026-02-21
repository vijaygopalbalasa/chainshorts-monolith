import { describe, expect, it } from "vitest";
import { classifyCategory } from "./category.js";

describe("classifyCategory", () => {
  it("detects regulation stories", () => {
    const category = classifyCategory({
      sourceName: "CoinDesk",
      headline: "SEC opens new crypto enforcement review",
      body: "Regulators are evaluating ETF disclosures and compliance controls."
    });

    expect(category).toBe("regulation");
  });

  it("detects security stories", () => {
    const category = classifyCategory({
      sourceName: "Decrypt",
      headline: "Exchange hacked as exploit drains hot wallet",
      body: "Teams patched a vulnerability and paused withdrawals."
    });

    expect(category).toBe("security");
  });

  it("detects solana ecosystem stories", () => {
    const category = classifyCategory({
      sourceName: "Web3 Wire",
      headline: "Jupiter launches new Solana liquidity route",
      body: "The rollout improves swap performance on Solana."
    });

    expect(category).toBe("solana");
  });

  it("falls back to web3", () => {
    const category = classifyCategory({
      sourceName: "The Block",
      headline: "Macro uncertainty reshapes crypto investor sentiment",
      body: "Market participants discuss risk appetite across major assets."
    });

    expect(category).toBe("web3");
  });
});

