import { randomUUID } from "node:crypto";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ChatEvent } from "@stride/shared";
import { createStrideAgent } from "../src/agent/agent";
import { runChatTurn } from "../src/chat/turn";
import { fixedClock } from "../src/clock";
import { loadCompanyDocs, loadOrders, loadProducts } from "../src/data/load";
import { Catalog } from "../src/domain/catalog";
import { OrderService } from "../src/domain/orders";
import { ReturnStore } from "../src/domain/returnStore";
import { chunkMarkdown } from "../src/rag/chunk";
import type { KnowledgeIndex, ProductIndex } from "../src/rag/indexes";
import { memoryKnowledgeIndex, memoryProductIndex } from "../src/rag/memory";
import { createToolHandlers } from "../src/tools/handlers";
import { evaluateConversation, evaluateRetrieval, piiValues, type EvalEnv, type EvalResult, type TurnRun } from "./evaluators";
import type { Cassette } from "./replay";
import { ReplayChatModel } from "./replay";
import type { ChatCase, RetrievalCase } from "./schema";
import { TraceRecorder } from "./trace";

/** Evals run on a fixed date so recordings and replays see identical tool results. */
export const EVAL_CLOCK = fixedClock("2026-10-07T12:00:00.000Z");

export type CaseResult = {
  id: string;
  dataset: string;
  kind: "chat" | "retrieval";
  repeat: number;
  pass: boolean;
  results: EvalResult[];
  turns?: Array<{ user: string; text: string; tools: string[]; models: string[]; tokens: number; latencyMs: number }>;
  ranked?: string[];
  /** Infrastructure problem (rate limit exhausted, missing cassette), not agent behavior. */
  infraError?: string;
};

export type EvalWorld = {
  catalog: Catalog;
  orders: OrderService;
  knowledge: KnowledgeIndex;
  products: ProductIndex;
  sources: Map<string, string>;
  env: EvalEnv;
};

/** Shared, read-only world for a run: data, in-memory retrieval (same ranking as Qdrant), PII list. */
export function createWorld(embeddings: EmbeddingsInterface): EvalWorld {
  const chunks = loadCompanyDocs().flatMap(chunkMarkdown);
  const orderRecords = loadOrders();
  const catalog = new Catalog(loadProducts());
  return {
    catalog,
    orders: new OrderService(orderRecords, catalog, EVAL_CLOCK),
    knowledge: memoryKnowledgeIndex(embeddings, chunks),
    products: memoryProductIndex(embeddings, catalog.products),
    sources: new Map(chunks.map((c) => [c.id, c.title])),
    env: { kbIds: new Set(chunks.map((c) => c.id)), pii: piiValues(orderRecords) },
  };
}

export type CaseModels = { model: BaseChatModel; fallbackModel?: BaseChatModel };

export async function runChatCase(
  world: EvalWorld,
  dataset: string,
  c: ChatCase,
  models: CaseModels,
  repeat = 1,
): Promise<{ result: CaseResult; cassette: Cassette }> {
  // Fresh tools state (returns) and memory per case; the world is shared.
  const handlers = createToolHandlers({ ...world, returns: new ReturnStore(), clock: EVAL_CLOCK });
  const agent = createStrideAgent({
    model: models.model,
    fallbackModel: models.fallbackModel,
    handlers,
    clock: EVAL_CLOCK,
    // Evals run unattended: wait out rate limits rather than fail.
    resilience: { maxQueueMs: 60_000 },
  });

  const recorder = new TraceRecorder();
  const sessionId = randomUUID();
  const runs: TurnRun[] = [];
  for (const turn of c.turns) {
    const started = Date.now();
    const events: ChatEvent[] = [];
    for await (const e of runChatTurn({ agent, sources: world.sources, callbacks: [recorder] }, { sessionId, message: turn.user }))
      events.push(e);
    const text = events.flatMap((e) => (e.type === "text-delta" ? [e.delta] : [])).join("");
    runs.push({ user: turn.user, expect: turn.expect, events, trace: recorder.take(), text, latencyMs: Date.now() - started });
  }

  const results = evaluateConversation(runs, world.env);
  if (models.model instanceof ReplayChatModel && models.model.remaining > 0)
    results.push({
      key: "cassette",
      pass: false,
      score: 0,
      comment: `agent made ${models.model.remaining} fewer model call(s) than recorded; behavior changed, re-record`,
    });

  const modelUnavailable = runs.some((r) => r.events.some((e) => e.type === "error" && e.code === "MODEL_UNAVAILABLE"));
  const calls = runs.flatMap((r) => r.trace.modelCalls);
  return {
    result: {
      id: c.id,
      dataset,
      kind: "chat",
      repeat,
      pass: results.every((r) => r.pass),
      results,
      turns: runs.map((r) => ({
        user: r.user,
        text: r.text,
        tools: r.events.flatMap((e) => (e.type === "tool-start" ? [e.name] : [])),
        models: [...new Set(r.trace.modelCalls.flatMap((m) => (m.model ? [m.model] : [])))],
        tokens: r.trace.modelCalls.reduce((s, m) => s + m.tokens, 0),
        latencyMs: r.latencyMs,
      })),
      ...(modelUnavailable && { infraError: "model unavailable (rate limit or outage)" }),
    },
    cassette: {
      caseId: c.id,
      recordedAt: new Date().toISOString(),
      models: [...new Set(calls.flatMap((m) => (m.model ? [m.model] : [])))],
      responses: calls.flatMap((m) => (m.output ? [m.output] : [])),
    },
  };
}

export async function runRetrievalCase(world: EvalWorld, dataset: string, c: RetrievalCase): Promise<CaseResult> {
  const { results, ranked } = await evaluateRetrieval(c, world.knowledge);
  return { id: c.id, dataset, kind: "retrieval", repeat: 1, pass: results.every((r) => r.pass), results, ranked };
}
