import { randomUUID } from "node:crypto";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it } from "vitest";
import { agentSetup, collect } from "../../test/helpers";
import { runChatTurn } from "../chat/turn";
import { repairCredentials, repairToTyped, typedCredentials } from "./credentials";

describe("typedCredentials", () => {
  it("extracts emails and order numbers from customer messages only", () => {
    const messages = [
      new HumanMessage("Return from order o-1003 please, priya.shah@example.com."),
      new AIMessage("Is your email bob@example.com? Order O-9999?"),
      new HumanMessage("also O 1046 and O‑1042"),
    ];
    expect(typedCredentials(messages)).toEqual({ emails: ["priya.shah@example.com"], orderIds: ["O-1003", "O-1046", "O-1042"] });
  });
});

describe("repairToTyped", () => {
  const typed = ["priya.shah@example.com", "jane@example.com"];

  it("restores a value the model mis-copied (live finding)", () => {
    expect(repairToTyped("priyaa.shah@example.com", typed, 2)).toBe("priya.shah@example.com");
  });

  it("keeps exact and unrelated values unchanged", () => {
    expect(repairToTyped("jane@example.com", typed, 2)).toBe("jane@example.com");
    expect(repairToTyped("someone.else@example.com", typed, 2)).toBe("someone.else@example.com");
  });

  it("never picks between two equally close typed values", () => {
    expect(repairToTyped("O-1045", ["O-1044", "O-1046"], 1)).toBe("O-1045");
  });

  it("only ever returns the model's value or a typed one", () => {
    expect(repairCredentials({ orderId: "O-1030", email: "x@example.com" }, [new HumanMessage("O-1003")])).toEqual({
      orderId: "O-1003",
      email: "x@example.com",
    });
  });
});

describe("credential repair in the agent", () => {
  it("verifies the customer even when the model corrupts their email", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "getOrderStatus", args: { orderId: "O-1003", email: "priyaa.shah@example.com" }, id: "c1" }])
      .respond(new AIMessage("It's being processed."));
    const { agent, sources } = agentSetup(model);
    const events = await collect(
      runChatTurn({ agent, sources }, { sessionId: randomUUID(), message: "Where is O-1003? priya.shah@example.com" }),
    );
    expect(events).toContainEqual({ type: "tool-end", toolCallId: "c1", name: "getOrderStatus", ok: true, code: null });
  });

  it("never swaps in an email the customer didn't type @F6", async () => {
    // Customer typed bob@; the model "helpfully" uses Priya's real email. Repair must not
    // touch it (it's not a near-copy of anything typed), so it goes to the tool unchanged.
    expect(repairToTyped("priya.shah@example.com", ["bob@example.com"], 2)).toBe("priya.shah@example.com");
  });
});
