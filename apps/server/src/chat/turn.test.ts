import { randomUUID } from "node:crypto";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { fakeModel } from "@langchain/core/testing";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { describe, expect, it } from "vitest";
import { ChatEvent } from "@stride/shared";
import { agentSetup, collect, fixturePiiPatterns } from "../../test/helpers";
import { MAX_TOOL_ROUNDS } from "../agent/agent";
import { runChatTurn } from "./turn";

/** Minimal streaming provider double: emits its answer token by token. */
class StreamingFake extends BaseChatModel {
  constructor(private readonly chunks: string[]) {
    super({});
  }
  _llmType() {
    return "streaming-fake";
  }
  override bindTools() {
    return this as never;
  }
  async _generate() {
    const text = this.chunks.join("");
    return { generations: [{ text, message: new AIMessage(text) }] };
  }
  override async *_streamResponseChunks(_m: unknown, _o: unknown, runManager?: CallbackManagerForLLMRun) {
    for (const c of this.chunks) {
      const chunk = new ChatGenerationChunk({ text: c, message: new AIMessageChunk(c) });
      yield chunk;
      // Real providers report each token; LangGraph's "messages" stream listens for this.
      await runManager?.handleLLMNewToken(c, undefined, undefined, undefined, undefined, { chunk });
    }
  }
}

const JANE = { orderId: "O-1042", email: "jane@example.com" };

async function turn(model: ReturnType<typeof fakeModel>, message: string, sessionId = randomUUID(), extra = {}) {
  const { agent, sources } = agentSetup(model);
  const events = await collect(runChatTurn({ agent, sources, ...extra }, { sessionId, message }));
  return { events, sessionId, agent, sources };
}

const types = (events: ChatEvent[]) => events.map((e) => e.type);
const text = (events: ChatEvent[]) => events.flatMap((e) => (e.type === "text-delta" ? [e.delta] : [])).join("");

describe("runChatTurn", () => {
  it("streams a plain answer: session → text → done", async () => {
    const { events, sessionId } = await turn(fakeModel().respond(new AIMessage("Hi! How can I help?")), "hello");
    expect(types(events)).toEqual(["session", "text-delta", "done"]);
    expect(events[0]).toEqual({ type: "session", sessionId });
    expect(text(events)).toBe("Hi! How can I help?");
    expect(events.at(-1)).toMatchObject({ type: "done", sessionId });
  });

  it("emits tool events and an order card for an order lookup", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "getOrderStatus", args: JANE, id: "call_1" }])
      .respond(new AIMessage("Your Trail Runner X has shipped and should arrive in 2 days."));
    const { events } = await turn(model, "Where is O-1042? jane@example.com");

    expect(types(events)).toEqual(["session", "tool-start", "tool-end", "card", "text-delta", "done"]);
    expect(events[1]).toEqual({ type: "tool-start", toolCallId: "call_1", name: "getOrderStatus" });
    expect(events[2]).toEqual({ type: "tool-end", toolCallId: "call_1", name: "getOrderStatus", ok: true, code: null });
    expect(events[3]).toMatchObject({ type: "card", card: { kind: "order", order: { orderId: "O-1042", destination: "Austin, TX" } } });
    // The model's tool-calling message content is never streamed as answer text.
    expect(text(events)).toBe("Your Trail Runner X has shipped and should arrive in 2 days.");
  });

  it("every event satisfies the shared contract (PRD §10.2 contract test)", async () => {
    const model = fakeModel()
      .respondWithTools([
        { name: "searchProducts", args: { query: "waterproof trail", category: "trail", size: 10 } },
        { name: "checkStock", args: { product: "Trail Runner X", size: 10, width: "wide" } },
        { name: "searchKnowledgeBase", args: { query: "return window" } },
      ])
      .respondWithTools([{ name: "checkReturnEligibility", args: { orderId: "O-1046", email: "jane@example.com", itemId: "O-1046-1" } }])
      .respondWithTools([
        { name: "createReturn", args: { orderId: "O-1046", email: "jane@example.com", itemId: "O-1046-1", reason: "small", type: "refund" } },
      ])
      .respond(new AIMessage("Done [[returns-policy#return-window]]."));
    const { events } = await turn(model, "do everything");
    for (const e of events) expect(ChatEvent.safeParse(e).success, JSON.stringify(e).slice(0, 120)).toBe(true);
    // Tools in one round run in parallel, so compare as a set.
    const cards = events.flatMap((e) => (e.type === "card" ? [e.card.kind] : []));
    expect(cards.sort()).toEqual(["products", "return-created", "return-eligibility", "stock"]);
  });

  it("reports tool failures as tool-end codes without a card @F6", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "getOrderStatus", args: { orderId: "O-1042", email: "bob@example.com" }, id: "c1" }])
      .respond(new AIMessage("Those details don't match our records."));
    const { events } = await turn(model, "Where is O-1042? bob@example.com");
    expect(events).toContainEqual({ type: "tool-end", toolCallId: "c1", name: "getOrderStatus", ok: false, code: "UNVERIFIED" });
    expect(types(events)).not.toContain("card");
  });

  it("returns invalid tool arguments to the model, which can recover @F3", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "getOrderStatus", args: { orderId: "1042" }, id: "bad" }])
      .respondWithTools([{ name: "getOrderStatus", args: JANE, id: "good" }])
      .respond(new AIMessage("Found it: it has shipped."));
    const { events } = await turn(model, "order 1042 jane@example.com");
    expect(events).toContainEqual({ type: "tool-end", toolCallId: "bad", name: "getOrderStatus", ok: false, code: "INVALID_ARGUMENTS" });
    expect(events).toContainEqual({ type: "tool-end", toolCallId: "good", name: "getOrderStatus", ok: true, code: null });
    // The model saw the validation error and retried.
    const toolMsgs = model.calls[1]!.messages.filter((m) => m.getType() === "tool");
    expect(String(toolMsgs[0]!.content)).toMatch(/orderId/);
  });

  it("emits citations only for real knowledge-base chunk ids", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "searchKnowledgeBase", args: { query: "return policy" } }])
      .respond(
        new AIMessage(
          "You have 30 days [[returns-policy#return-window]]. Final sale is excluded [[returns-policy#final-sale-items]]. Made up [[returns-policy#lifetime-returns]]. Again [[returns-policy#return-window]].",
        ),
      );
    const { events } = await turn(model, "What's your return policy?");
    const citations = events.filter((e) => e.type === "citation");
    expect(citations).toEqual([
      {
        type: "citation",
        sources: [
          { id: "returns-policy#return-window", title: "Return Policy: Return window" },
          { id: "returns-policy#final-sale-items", title: "Return Policy: Final sale items" },
        ],
      },
    ]);
    expect(types(events).slice(-2)).toEqual(["citation", "done"]);
  });

  it("remembers the conversation within a session", async () => {
    const model = fakeModel().respond(new AIMessage("What size do you wear?")).respond(new AIMessage("Got it, size 10."));
    const { agent, sources } = agentSetup(model);
    const sessionId = randomUUID();
    await collect(runChatTurn({ agent, sources }, { sessionId, message: "I need running shoes" }));
    await collect(runChatTurn({ agent, sources }, { sessionId, message: "size 10" }));
    const secondCall = model.calls[1]!.messages.map((m) => `${m.getType()}:${m.content}`);
    expect(secondCall).toEqual(
      expect.arrayContaining(["human:I need running shoes", "ai:What size do you wear?", "human:size 10"]),
    );
  });

  it("keeps sessions isolated", async () => {
    const model = fakeModel().respond(new AIMessage("a")).respond(new AIMessage("b"));
    const { agent, sources } = agentSetup(model);
    await collect(runChatTurn({ agent, sources }, { sessionId: randomUUID(), message: "secret from session one" }));
    await collect(runChatTurn({ agent, sources }, { sessionId: randomUUID(), message: "hi" }));
    expect(JSON.stringify(model.calls[1]!.messages)).not.toContain("secret from session one");
  });

  it("sends the system prompt with today's date and the privacy rules", async () => {
    const model = fakeModel().respond(new AIMessage("ok"));
    await turn(model, "hi");
    const system = model.calls[0]!.messages[0]!;
    expect(system.getType()).toBe("system");
    expect(String(system.content)).toContain("Today is 2026-10-07");
    expect(String(system.content)).toMatch(/Never reveal or discuss personal information/);
  });

  it("turns a model outage into a retryable error event, then done @F1", async () => {
    const outage = Object.assign(new Error("Service Unavailable"), { status: 503 });
    const logs: string[] = [];
    const { events } = await turn(fakeModel().alwaysThrow(outage), "hi", undefined, { log: (m: string) => logs.push(m) });
    expect(types(events)).toEqual(["session", "error", "done"]);
    expect(events[1]).toMatchObject({ type: "error", code: "MODEL_UNAVAILABLE", retryable: true });
    expect(JSON.stringify(events)).not.toContain("Service Unavailable"); // no internals leak to the client
    expect(logs).toEqual(["chat turn failed"]);
  });

  const toolRounds = (rounds: number) => {
    let model = fakeModel();
    for (let i = 0; i < rounds; i++) model = model.respondWithTools([{ name: "searchKnowledgeBase", args: { query: `q${i}` } }]);
    return model;
  };
  const looping = (rounds: number) => toolRounds(rounds).respond(new AIMessage("final answer"));

  it(`allows up to ${MAX_TOOL_ROUNDS} tool rounds`, async () => {
    const { events } = await turn(looping(MAX_TOOL_ROUNDS), "research a lot");
    expect(types(events)).not.toContain("error");
    expect(text(events)).toBe("final answer");
  });

  it.each([
    [429, true],
    [500, true],
    [401, false],
  ])("classifies a provider %i as MODEL_UNAVAILABLE (retryable: %s)", async (status, retryable) => {
    const { events } = await turn(fakeModel().alwaysThrow(Object.assign(new Error("x"), { status })), "hi");
    expect(events[1]).toMatchObject({ type: "error", code: "MODEL_UNAVAILABLE", retryable });
  });

  it("classifies unknown failures as INTERNAL", async () => {
    const { events } = await turn(fakeModel().alwaysThrow(new TypeError("cannot read x of undefined")), "hi");
    expect(events[1]).toMatchObject({ type: "error", code: "INTERNAL", retryable: true });
  });

  it("stops a model stuck in a tool loop before a 6th round of tools runs @F3", async () => {
    const { events } = await turn(looping(MAX_TOOL_ROUNDS + 1), "loop forever");
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "AGENT_LIMIT", retryable: false });
    expect(events.filter((e) => e.type === "tool-end")).toHaveLength(MAX_TOOL_ROUNDS);
    expect(types(events).at(-1)).toBe("done");
  });

  it("leaves the session usable after hitting the limit (no orphaned tool calls)", async () => {
    const model = toolRounds(MAX_TOOL_ROUNDS + 1).respond(new AIMessage("Sure, ask me anything."));
    const { agent, sources } = agentSetup(model);
    const sessionId = randomUUID();
    await collect(runChatTurn({ agent, sources }, { sessionId, message: "loop forever" }));
    const events = await collect(runChatTurn({ agent, sources }, { sessionId, message: "ok, simpler question" }));
    expect(text(events)).toBe("Sure, ask me anything.");

    const history = model.calls.at(-1)!.messages;
    const answered = new Set(history.filter((m) => m.getType() === "tool").map((m) => (m as unknown as { tool_call_id: string }).tool_call_id));
    for (const m of history)
      for (const call of (m as AIMessage).tool_calls ?? []) expect(answered, `orphaned ${call.id}`).toContain(call.id);
  });

  it("ends silently when the client aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const { agent, sources } = agentSetup(fakeModel().respond(new AIMessage("never sent")));
    const events = await collect(runChatTurn({ agent, sources }, { sessionId: randomUUID(), message: "hi", signal: controller.signal }));
    expect(types(events)).toEqual(["session"]);
  });

  it("names the root run with the runId reported in `done` (LangSmith trace link)", async () => {
    const roots: Array<{ runId: string; name?: string }> = [];
    class Capture extends BaseCallbackHandler {
      name = "capture";
      override handleChainStart(_c: unknown, _i: unknown, runId: string, parentRunId?: string, _t?: string[], _m?: unknown, _rt?: string, name?: string) {
        if (!parentRunId) roots.push({ runId, name });
      }
    }
    const runId = randomUUID();
    const { agent, sources } = agentSetup(fakeModel().respond(new AIMessage("hi")));
    const events = await collect(runChatTurn({ agent, sources, callbacks: [new Capture()] }, { sessionId: randomUUID(), message: "hi", runId }));
    expect(events.at(-1)).toMatchObject({ type: "done", runId });
    expect(roots).toEqual([{ runId, name: "stride-chat-turn" }]);
  });

  it("streams token chunks from streaming models", async () => {
    const chunks = ["Size ", "10 is ", "in stock."];
    const { agent, sources } = agentSetup(new StreamingFake(chunks));
    const events = await collect(runChatTurn({ agent, sources }, { sessionId: randomUUID(), message: "stock?" }));
    expect(events.filter((e) => e.type === "text-delta").map((e) => (e as { delta: string }).delta)).toEqual(chunks);
  });
});

describe("privacy: what the model sees @F16", () => {
  it("never includes fixture PII beyond what the customer typed, across order and return flows", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "getOrderStatus", args: { orderId: "O-1046", email: "jane@example.com" } }])
      .respondWithTools([{ name: "checkReturnEligibility", args: { orderId: "O-1046", email: "jane@example.com", itemId: "O-1046-1" } }])
      .respondWithTools([
        { name: "createReturn", args: { orderId: "O-1046", email: "jane@example.com", itemId: "O-1046-1", reason: "small", type: "refund" } },
      ])
      .respond(new AIMessage("Your return is set up."));
    await turn(model, "Return the sneakers from O-1046, my email is jane@example.com");

    const typedByCustomer = /jane@example\.com/i.source;
    const patterns = fixturePiiPatterns().filter((re) => re.source.replace(/\\b/g, "") !== typedByCustomer);
    const seen = JSON.stringify(model.calls.map((c) => c.messages));
    expect(patterns.filter((re) => re.test(seen)).map((re) => re.source)).toEqual([]);
  });
});
