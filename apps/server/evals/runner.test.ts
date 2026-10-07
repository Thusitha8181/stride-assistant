import { describe, expect, it } from "vitest";
import { HashEmbeddings } from "../src/rag/embeddings";
import { checkGates, computeMetrics } from "./metrics";
import { ReplayChatModel } from "./replay";
import { createWorld, runChatCase, runRetrievalCase } from "./runner";
import { ChatCase, RetrievalCase } from "./schema";

const world = createWorld(new HashEmbeddings());

const orderCase = ChatCase.parse({
  id: "order-status",
  turns: [
    {
      user: "Where is O-1042? jane@example.com",
      expect: { toolsCalled: ["getOrderStatus"], cards: ["order"], mustContain: ["shipped"] },
    },
  ],
});
const recorded = [
  { content: "", tool_calls: [{ id: "c1", name: "getOrderStatus", args: { orderId: "O-1042", email: "jane@example.com" } }] },
  { content: "Your order O-1042 has shipped and costs $129.", tool_calls: [] },
];

describe("replay runner", () => {
  it("replays a cassette through the real agent, tools and evaluators", async () => {
    const { result, cassette } = await runChatCase(world, "happy-path", orderCase, { model: new ReplayChatModel(recorded) });
    expect(result.pass).toBe(true);
    expect(result.results.map((r) => r.key).sort()).toEqual(["cards", "content", "errors", "grounding", "privacy", "tools"]);
    expect(result.turns![0]).toMatchObject({ tools: [`getOrderStatus({"orderId":"O-1042","email":"jane@example.com"})`], text: "Your order O-1042 has shipped and costs $129." });
    // What the model produced is captured for re-recording.
    expect(cassette.responses).toEqual(recorded);
  });

  it("flags a cassette the agent no longer consumes (behavior drift)", async () => {
    const extra = [...recorded, { content: "unused", tool_calls: [] }];
    const { result } = await runChatCase(world, "happy-path", orderCase, { model: new ReplayChatModel(extra) });
    expect(result.results.find((r) => r.key === "cassette")).toMatchObject({ pass: false });
  });

  it("fails clearly when the cassette runs out", async () => {
    const { result } = await runChatCase(world, "happy-path", orderCase, { model: new ReplayChatModel(recorded.slice(0, 1)) });
    expect(result.pass).toBe(false);
    expect(result.results.find((r) => r.key === "errors")).toMatchObject({ pass: false });
  });

  it("catches a hallucinated price in a recorded answer", async () => {
    const lying = [recorded[0]!, { content: "Your order O-1042 has shipped; it cost $99.", tool_calls: [] }];
    const { result } = await runChatCase(world, "happy-path", orderCase, { model: new ReplayChatModel(lying) });
    expect(result.results.find((r) => r.key === "grounding")).toMatchObject({ pass: false, comment: "ungrounded price $99" });
  });
});

describe("retrieval cases and metrics", () => {
  it("scores hit@k and MRR", async () => {
    const r = await runRetrievalCase(world, "retrieval", RetrievalCase.parse({ id: "x", query: "final sale clearance items return", expected: ["returns-policy#final-sale-items"] }));
    expect(r.results[0]).toMatchObject({ key: "hit@3", pass: true });
    expect(r.results[1]!.score).toBeGreaterThan(0);
  });

  it("computes metrics and gates", async () => {
    const { result } = await runChatCase(world, "happy-path", orderCase, { model: new ReplayChatModel(recorded) });
    const metrics = computeMetrics([result, { ...result, repeat: 2, pass: false }]);
    expect(metrics).toMatchObject({ chatRuns: 2, taskSuccess: 0.5, passAllRepeats: 0, privacyViolations: 0, hallucinationRate: 0 });
    const gates = checkGates(metrics, "replay");
    expect(gates.find((g) => g.metric === "taskSuccess")).toMatchObject({ pass: false });
    expect(gates.find((g) => g.metric === "privacyViolations")).toMatchObject({ pass: true });
  });
});
