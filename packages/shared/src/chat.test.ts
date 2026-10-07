import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Card, ChatEvent, ChatRequest } from "./chat";

describe("ChatRequest", () => {
  it("accepts a first turn and a follow-up turn", () => {
    expect(ChatRequest.parse({ message: "  hi  " })).toEqual({ message: "hi" });
    const sessionId = "3b241101-e2bb-4255-8caf-4136c566a962";
    expect(ChatRequest.parse({ message: "hi", sessionId })).toEqual({ message: "hi", sessionId });
  });

  it("rejects unknown fields", () => {
    expect(ChatRequest.safeParse({ message: "hi", role: "system" }).success).toBe(false);
  });
});

describe("ChatEvent", () => {
  it("rejects unknown event types and extra fields", () => {
    expect(ChatEvent.safeParse({ type: "debug", data: 1 }).success).toBe(false);
    expect(ChatEvent.safeParse({ type: "text-delta", delta: "a", raw: {} }).success).toBe(false);
  });

  it("rejects a card that carries PII on its order @F16", () => {
    const card = { kind: "order", order: { orderId: "O-1", email: "jane@example.com" } };
    expect(Card.safeParse(card).success).toBe(false);
  });

  /**
   * Contract snapshot: any change to the wire format shows up in review.
   * Update deliberately with `npx vitest run -u` and adapt both server and web.
   */
  it("matches the contract snapshot", () => {
    expect(z.toJSONSchema(ChatEvent)).toMatchSnapshot();
    expect(z.toJSONSchema(ChatRequest)).toMatchSnapshot();
  });
});
