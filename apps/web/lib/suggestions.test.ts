import { describe, expect, it } from "vitest";
import { orderCard, soldOut } from "@/test/fixtures";
import { newAssistantMessage, type AssistantMessage } from "./messages";
import { suggestionsFor } from "./suggestions";

const done = (patch: Partial<AssistantMessage>): AssistantMessage => ({ ...newAssistantMessage("a", "q"), status: "done", ...patch });

describe("suggestionsFor", () => {
  it("suggests the in-stock alternative and a similar shoe for a sold-out size @F8", () => {
    expect(suggestionsFor(done({ cards: [{ kind: "stock", stock: soldOut }] }))).toEqual([
      "Is the Trail Runner X available in 10.5 wide in black?",
      "Tell me about the Trail Runner Y",
    ]);
  });

  it("suggests next steps after an order lookup", () => {
    expect(suggestionsFor(done({ cards: [orderCard] }))).toEqual(["When will it arrive?", "Track another order"]);
  });

  it("offers refund/exchange for an eligible return", () => {
    const eligibility = { ok: true as const, eligible: true as const, item: { itemId: "i", name: "x" }, daysSinceDelivery: 3, daysLeft: 27, options: ["refund" as const, "exchange" as const], policySource: "p" };
    expect(suggestionsFor(done({ cards: [{ kind: "return-eligibility", eligibility }] }))).toEqual(["I'd like a refund", "I'd like to exchange for a different size"]);
  });

  it("shows nothing while streaming or after an error", () => {
    expect(suggestionsFor(newAssistantMessage("a", "q"))).toEqual([]);
    expect(suggestionsFor(done({ cards: [orderCard], error: { code: "INTERNAL", message: "x", retryable: true } }))).toEqual([]);
  });
});
