import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it } from "vitest";
import { clock, collect, setup } from "../../test/helpers";
import { runChatTurn } from "../chat/turn";
import { createStrideAgent } from "./agent";
import { isTransient, MAX_MALFORMED_RETRIES, retryAfterMs } from "./resilience";

const rateLimit = (after: string) =>
  Object.assign(new Error(`429 Rate limit reached for model on tokens per minute. Please try again in ${after}.`), { status: 429 });

function run(primary: ReturnType<typeof fakeModel>, fallback?: ReturnType<typeof fakeModel>) {
  const logs: string[] = [];
  const { tools } = setup();
  const agent = createStrideAgent({
    model: primary,
    fallbackModel: fallback,
    handlers: tools,
    clock,
    log: (m) => logs.push(m),
  });
  return { agent, logs };
}

describe("retryAfterMs / isTransient", () => {
  it.each([
    ["Please try again in 667.5ms.", 667.5],
    ["Please try again in 8.3925s.", 8392.5],
    ["no hint", null],
  ])("parses %s", (msg, ms) => {
    expect(retryAfterMs(new Error(msg))).toBe(ms);
  });

  it("finds hints and statuses deep in a wrapped error", () => {
    const wrapped = { message: "outer", cause: { message: "middle", cause: { status: 429, message: "try again in 3s" } } };
    expect(retryAfterMs(wrapped)).toBe(3000);
    expect(isTransient(wrapped)).toBe(true);
  });

  it("prefers the retry-after header", () => {
    expect(retryAfterMs({ message: "try again in 9s", headers: new Headers({ "retry-after": "2" }) })).toBe(2000);
  });

  it.each([
    [429, true],
    [503, true],
    [408, true],
    [401, false],
    [400, false],
  ])("status %i transient: %s", (status, expected) => {
    expect(isTransient({ status })).toBe(expected);
    expect(isTransient({ cause: { status } })).toBe(expected);
  });

  it("treats timeouts and network errors as transient", () => {
    expect(isTransient(new Error("Request timed out."))).toBe(true);
    expect(isTransient(new Error("fetch failed"))).toBe(true);
    expect(isTransient(new Error("Invalid tool schema"))).toBe(false);
  });
});

describe("model resilience in the agent", () => {
  const turn = async (agent: ReturnType<typeof createStrideAgent>) =>
    collect(runChatTurn({ agent, sources: new Map() }, { sessionId: randomUUID(), message: "hi" }));
  const text = (events: Awaited<ReturnType<typeof turn>>) =>
    events.flatMap((e) => (e.type === "text-delta" ? [e.delta] : [])).join("");

  it("waits the requested time and retries the primary when the wait is short @F2", async () => {
    const primary = fakeModel().respond(rateLimit("50ms")).respond(new AIMessage("from primary"));
    const fallback = fakeModel().respond(new AIMessage("from fallback"));
    const { agent, logs } = run(primary, fallback);
    const started = Date.now();
    const events = await turn(agent);
    expect(text(events)).toBe("from primary");
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
    expect(fallback.callCount).toBe(0);
    expect(logs).toEqual(["model retry"]);
  });

  it("goes straight to the fallback when the provider asks for a long wait @F2", async () => {
    const primary = fakeModel().respond(rateLimit("10.7s"));
    const fallback = fakeModel().respond(new AIMessage("from fallback"));
    const { agent, logs } = run(primary, fallback);
    const started = Date.now();
    const events = await turn(agent);
    expect(text(events)).toBe("from fallback");
    expect(Date.now() - started).toBeLessThan(2000);
    expect(primary.callCount).toBe(1);
    expect(logs).toEqual(["model fallback"]);
  });

  it("falls back when the primary is down @F1", async () => {
    const outage = Object.assign(new Error("Service Unavailable"), { status: 503 });
    const primary = fakeModel().alwaysThrow(outage);
    const fallback = fakeModel().respond(new AIMessage("from fallback"));
    const { agent } = run(primary, fallback);
    expect(text(await turn(agent))).toBe("from fallback");
  });

  it("reports MODEL_UNAVAILABLE when the fallback fails too @F1", async () => {
    const outage = Object.assign(new Error("Service Unavailable"), { status: 503 });
    const { agent } = run(fakeModel().alwaysThrow(outage), fakeModel().alwaysThrow(outage));
    const events = await turn(agent);
    expect(events.map((e) => e.type)).toEqual(["session", "error", "done"]);
    expect(events[1]).toMatchObject({ code: "MODEL_UNAVAILABLE", retryable: true });
  });

  it("does not retry or fall back on a bad API key", async () => {
    const unauthorized = Object.assign(new Error("Invalid API Key"), { status: 401 });
    const primary = fakeModel().alwaysThrow(unauthorized);
    const fallback = fakeModel().respond(new AIMessage("should not be used"));
    const { agent } = run(primary, fallback);
    const events = await turn(agent);
    expect(events[1]).toMatchObject({ code: "MODEL_UNAVAILABLE", retryable: false });
    expect(fallback.callCount).toBe(0);
  });

  it("keeps using the fallback while the primary cools down, across turns @F2", async () => {
    const primary = fakeModel().respond(rateLimit("30s")).respond(new AIMessage("primary again"));
    const fallback = fakeModel().respond(new AIMessage("fallback 1")).respond(new AIMessage("fallback 2"));
    const { agent } = run(primary, fallback);
    expect(text(await turn(agent))).toBe("fallback 1");
    expect(text(await turn(agent))).toBe("fallback 2");
    expect(primary.callCount).toBe(1); // not hammered while rate-limited
  });

  it("queues when both models are rate-limited, then uses whichever frees up first @F2", async () => {
    const primary = fakeModel().respond(rateLimit("20s"));
    const fallback = fakeModel().respond(rateLimit("100ms")).respond(new AIMessage("after a short queue"));
    const { agent, logs } = run(primary, fallback);
    const started = Date.now();
    expect(text(await turn(agent))).toBe("after a short queue");
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
    expect(logs).toEqual(["model fallback", "model queued"]);
  });

  it("gives up with MODEL_UNAVAILABLE when every model needs a long wait @F2", async () => {
    const { agent } = run(fakeModel().respond(rateLimit("40s")), fakeModel().respond(rateLimit("30s")));
    const started = Date.now();
    const events = await turn(agent);
    expect(events[1]).toMatchObject({ type: "error", code: "MODEL_UNAVAILABLE", retryable: true });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("keeps queueing until a model succeeds within the budget @F2", async () => {
    const primary = fakeModel().respond(rateLimit("20s"));
    const fallback = fakeModel().respond(rateLimit("50ms")).respond(rateLimit("50ms")).respond(new AIMessage("third time lucky"));
    const { agent, logs } = run(primary, fallback);
    expect(text(await turn(agent))).toBe("third time lucky");
    expect(logs).toEqual(["model fallback", "model queued", "model queued"]);
  });

  it("keeps tool calling working on the fallback model", async () => {
    const primary = fakeModel().respond(rateLimit("30s"));
    const fallback = fakeModel()
      .respondWithTools([{ name: "getOrderStatus", args: { orderId: "O-1042", email: "jane@example.com" } }])
      .respond(new AIMessage("It has shipped."));
    const { agent } = run(primary, fallback);
    const events = await turn(agent);
    expect(events.some((e) => e.type === "card" && e.card.kind === "order")).toBe(true);
    expect(text(events)).toBe("It has shipped.");
  });
});

describe("malformed generations @F3", () => {
  const malformed = () =>
    Object.assign(new Error("Tool call validation failed: parameters for tool checkReturnEligibility did not match schema"), { status: 400 });

  it("treats a provider-rejected tool call as retryable despite the 400", () => {
    expect(isTransient(malformed())).toBe(true);
    expect(isTransient({ message: "wrapped", cause: malformed() })).toBe(true);
  });

  it("re-samples immediately and recovers", async () => {
    const primary = fakeModel().respond(malformed()).respond(new AIMessage("second try worked"));
    const { tools } = setup();
    const agent = createStrideAgent({ model: primary, handlers: tools, clock });
    const events = await collect(runChatTurn({ agent, sources: new Map() }, { sessionId: randomUUID(), message: "hi" }));
    expect(events.flatMap((e) => (e.type === "text-delta" ? [e.delta] : [])).join("")).toBe("second try worked");
  });

  it(`gives up after ${MAX_MALFORMED_RETRIES} re-samples`, async () => {
    const { tools } = setup();
    const agent = createStrideAgent({ model: fakeModel().alwaysThrow(malformed()), handlers: tools, clock });
    const events = await collect(runChatTurn({ agent, sources: new Map() }, { sessionId: randomUUID(), message: "hi" }));
    expect(events.map((e) => e.type)).toEqual(["session", "error", "done"]);
  });
});
