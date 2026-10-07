import { describe, expect, it } from "vitest";
import type { ChatEvent } from "@stride/shared";
import { evaluateConversation, normalize, type EvalEnv, type TurnRun } from "./evaluators";
import { TurnExpect } from "./schema";

const env: EvalEnv = { kbIds: new Set(["returns-policy#return-window", "shipping#shipping-costs"]), pii: ["Jane Doe", "jane@example.com", "+1 512-555-0142", "4111"] };

function turn(partial: { user?: string; text?: string; events?: ChatEvent[]; expect?: Partial<TurnExpect>; tools?: TurnRun["trace"]["tools"]; modelInput?: string }): TurnRun {
  const text = partial.text ?? "";
  return {
    user: partial.user ?? "hi",
    expect: TurnExpect.parse(partial.expect ?? {}),
    text,
    events: partial.events ?? [{ type: "text-delta", delta: text }],
    trace: { tools: partial.tools ?? [], modelCalls: [{ model: "m", input: partial.modelInput ?? "", output: null, tokens: 0 }] },
    latencyMs: 1,
  };
}
const byKey = (rs: ReturnType<typeof evaluateConversation>) => Object.fromEntries(rs.map((r) => [r.key, r]));

describe("normalize", () => {
  it("maps Unicode hyphens and quotes to ASCII (models write O‑1042 with U+2011)", () => {
    expect(normalize("O‑1042 isn’t")).toBe("O-1042 isn't");
  });
});

describe("tools evaluator", () => {
  const events: ChatEvent[] = [
    { type: "tool-start", toolCallId: "1", name: "checkStock" },
    { type: "tool-end", toolCallId: "1", name: "checkStock", ok: true, code: null },
  ];
  const tools = [{ name: "checkStock", args: { product: "Trail Runner X", size: 10, color: "Black" }, output: { ok: true } }];

  it("passes when expected tools and args match (strings case-insensitive)", () => {
    const r = byKey(evaluateConversation([turn({ events, tools, expect: { toolsCalled: ["checkStock"], toolArgs: { checkStock: { size: 10, color: "black" } } } })], env));
    expect(r.tools).toMatchObject({ pass: true, score: 1 });
  });

  it("fails with a useful comment and partial score", () => {
    const r = byKey(evaluateConversation([turn({ events, tools, expect: { toolsCalled: ["checkStock", "searchProducts"], toolsNotCalled: ["checkStock"] } })], env));
    expect(r.tools!.pass).toBe(false);
    expect(r.tools!.score).toBeCloseTo(1 / 3);
    expect(r.tools!.comment).toMatch(/expected searchProducts to be called .*checkStock must not be called/);
  });

  it("checks tool failure codes", () => {
    const unverified: ChatEvent[] = [
      { type: "tool-start", toolCallId: "1", name: "getOrderStatus" },
      { type: "tool-end", toolCallId: "1", name: "getOrderStatus", ok: false, code: "UNVERIFIED" },
    ];
    expect(byKey(evaluateConversation([turn({ events: unverified, expect: { toolCodes: ["UNVERIFIED"] } })], env)).tools!.pass).toBe(true);
    expect(byKey(evaluateConversation([turn({ events, expect: { toolCodes: ["UNVERIFIED"] } })], env)).tools!.pass).toBe(false);
  });
});

describe("grounding evaluator (hallucination)", () => {
  const tools = [{ name: "searchProducts", args: {}, output: { ok: true, products: [{ name: "Daily Jog", price: 85 }] } }];

  it("accepts prices and ids that come from tool results or the customer", () => {
    const r = byKey(evaluateConversation([turn({ user: "order O-1042?", text: "Daily Jog is $85. Your order O‑1042…", tools })], env));
    expect(r.grounding!.pass).toBe(true);
  });

  it("flags invented prices and identifiers", () => {
    const r = byKey(evaluateConversation([turn({ text: "Daily Jog is $79, see RMA-123456.", tools })], env));
    expect(r.grounding).toMatchObject({ pass: false });
    expect(r.grounding!.comment).toMatch(/\$79.*RMA-123456/);
  });

  it("uses earlier turns' tool results as sources", () => {
    const rs = evaluateConversation([turn({ tools }), turn({ text: "It's still $85." })], env);
    expect(byKey(rs).grounding!.pass).toBe(true);
  });

  it("is not applicable when the answer makes no checkable claims", () => {
    expect(byKey(evaluateConversation([turn({ text: "Happy to help!" })], env)).grounding).toBeUndefined();
  });
});

describe("privacy evaluator @F16", () => {
  it("fails when PII the customer didn't type appears in the answer", () => {
    const r = byKey(evaluateConversation([turn({ text: "It ships to Jane Doe" })], env));
    expect(r.privacy).toMatchObject({ pass: false, comment: expect.stringMatching(/PII in answer: Jane Doe/) });
  });

  it("fails when PII reaches the model, even if the answer is clean", () => {
    const r = byKey(evaluateConversation([turn({ text: "ok", modelInput: '{"phone":"+1 512-555-0142"}' })], env));
    expect(r.privacy!.comment).toMatch(/sent to the model: \+1 512-555-0142/);
  });

  it("allows values the customer typed themselves", () => {
    const r = byKey(evaluateConversation([turn({ user: "my email is jane@example.com", text: "Thanks, jane@example.com", modelInput: "jane@example.com" })], env));
    expect(r.privacy!.pass).toBe(true);
  });

  it("matches whole values only (a card's last-4 inside a tracking number is fine)", () => {
    expect(byKey(evaluateConversation([turn({ text: "Tracking 1Z999AA10000004111x" })], env)).privacy!.pass).toBe(true);
  });
});

describe("citations", () => {
  it("checks expected citations and flags invented [[markers]]", () => {
    const events: ChatEvent[] = [
      { type: "text-delta", delta: "x" },
      { type: "citation", sources: [{ id: "returns-policy#return-window", title: "t" }] },
    ];
    const r = byKey(
      evaluateConversation(
        [turn({ events, text: "30 days [[returns-policy#return-window]] [[searchProducts]]", expect: { citations: ["returns-policy#return-window"] } })],
        env,
      ),
    );
    expect(r.citations!.pass).toBe(true);
    expect(r["citation-validity"]).toMatchObject({ pass: false, score: 0.5, comment: "invalid citation [[searchProducts]]" });
  });
});

describe("content, retrieval and errors", () => {
  it("applies case-insensitive regexes to normalized text", () => {
    const r = byKey(evaluateConversation([turn({ text: "Order O‑1042 has SHIPPED", expect: { mustContain: ["O-1042", "shipped"], mustNotContain: ["delayed"] } })], env));
    expect(r.content!.pass).toBe(true);
  });

  it("checks which chunks searchKnowledgeBase returned", () => {
    const tools = [{ name: "searchKnowledgeBase", args: {}, output: { ok: true, chunks: [{ id: "shipping#shipping-costs" }] } }];
    const r = byKey(evaluateConversation([turn({ tools, expect: { retrieved: ["returns-policy#return-window"] } })], env));
    expect(r.retrieval!.comment).toMatch(/got: shipping#shipping-costs/);
  });

  it("fails on unexpected error events and accepts expected ones", () => {
    const events: ChatEvent[] = [{ type: "error", code: "AGENT_LIMIT", message: "x", retryable: false }];
    expect(byKey(evaluateConversation([turn({ events })], env)).errors!.pass).toBe(false);
    expect(byKey(evaluateConversation([turn({ events, expect: { errorCode: "AGENT_LIMIT" } })], env)).errors!.pass).toBe(true);
  });

  it("labels failures by turn in multi-turn conversations", () => {
    const rs = evaluateConversation([turn({ text: "a" }), turn({ text: "b", expect: { mustContain: ["zzz"] } })], env);
    expect(byKey(rs).content!.comment).toBe("turn 2: missing /zzz/");
  });
});
