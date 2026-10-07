import { describe, expect, it } from "vitest";
import { orderTurn, RUN } from "@/test/fixtures";
import { applyEvent, finish, newAssistantMessage } from "./messages";

describe("applyEvent", () => {
  it("folds a whole turn into one assistant message", () => {
    const msg = orderTurn().reduce((m, e) => applyEvent(m, e, 2000), newAssistantMessage("a", "where is my order", 1000));
    expect(msg).toMatchObject({
      text: "Your order has **shipped** [[shipping#tracking-your-order]].",
      tools: [{ id: "c1", name: "getOrderStatus", status: "ok", code: null }],
      citations: [{ id: "shipping#tracking-your-order" }],
      status: "done",
      runId: RUN,
      startedAt: 1000,
      finishedAt: 2000,
    });
    expect(msg.cards.map((c) => c.kind)).toEqual(["order"]);
  });

  it("records tool failures and errors", () => {
    let msg = newAssistantMessage("a", "q");
    msg = applyEvent(msg, { type: "tool-start", toolCallId: "t", name: "getOrderStatus" });
    msg = applyEvent(msg, { type: "tool-end", toolCallId: "t", name: "getOrderStatus", ok: false, code: "UNVERIFIED" });
    msg = applyEvent(msg, { type: "error", code: "MODEL_UNAVAILABLE", message: "busy", retryable: true });
    expect(msg.tools[0]).toMatchObject({ status: "failed", code: "UNVERIFIED" });
    expect(msg.error).toEqual({ code: "MODEL_UNAVAILABLE", message: "busy", retryable: true });
  });

  it("finish() closes a message cut off mid-stream", () => {
    const msg = applyEvent(newAssistantMessage("a", "q"), { type: "tool-start", toolCallId: "t", name: "checkStock" });
    expect(finish(msg, 5)).toMatchObject({ status: "done", finishedAt: 5, tools: [{ status: "failed" }] });
  });
});
