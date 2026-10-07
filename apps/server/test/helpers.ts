import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createStrideAgent } from "../src/agent/agent";
import { fixedClock } from "../src/clock";
import { loadCompanyDocs, loadOrders, loadProducts } from "../src/data/load";
import type { OrderRecord } from "../src/data/orderRecord";
import { Catalog } from "../src/domain/catalog";
import { OrderService } from "../src/domain/orders";
import { ReturnStore } from "../src/domain/returnStore";
import { chunkMarkdown } from "../src/rag/chunk";
import { HashEmbeddings } from "../src/rag/embeddings";
import type { KnowledgeIndex, ProductIndex } from "../src/rag/indexes";
import { memoryKnowledgeIndex as memoryKB, memoryProductIndex as memoryProducts } from "../src/rag/memory";
import { createToolHandlers } from "../src/tools/handlers";

export const clock = fixedClock("2026-10-07T12:00:00.000Z");

/** In-memory KnowledgeIndex over the real KB, using the deterministic hash embeddings. */
export const memoryKnowledgeIndex = (): KnowledgeIndex =>
  memoryKB(new HashEmbeddings(), loadCompanyDocs().flatMap(chunkMarkdown));

/** In-memory ProductIndex with the same filter semantics as the Qdrant adapter. */
export const memoryProductIndex = (catalog: Catalog): ProductIndex => memoryProducts(new HashEmbeddings(), catalog.products);

export const failingIndex = {
  async search(): Promise<never> {
    throw new Error("connect ECONNREFUSED 127.0.0.1:6333");
  },
};

export function setup(overrides: { knowledge?: KnowledgeIndex; products?: ProductIndex } = {}) {
  const catalog = new Catalog(loadProducts());
  const orders = new OrderService(loadOrders(), catalog, clock);
  const returns = new ReturnStore();
  const tools = createToolHandlers({
    catalog,
    orders,
    returns,
    clock,
    knowledge: overrides.knowledge ?? memoryKnowledgeIndex(),
    products: overrides.products ?? memoryProductIndex(catalog),
  });
  return { catalog, orders, returns, tools };
}

export const orderFixture = (orderId: string): OrderRecord => {
  const order = loadOrders().find((o) => o.orderId === orderId);
  if (!order) throw new Error(`fixture ${orderId} missing`);
  return order;
};

/**
 * Every PII value in the order fixtures, as regexes (word-bounded so card last-4s
 * don't match inside tracking numbers). Used to assert nothing leaks (PRD §4.4).
 */
export function fixturePiiPatterns(): RegExp[] {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const values = loadOrders().flatMap((o) => [
    o.customer.name,
    o.customer.email,
    o.customer.phone,
    o.shippingAddress.line1,
    ...(o.shippingAddress.line2 ? [o.shippingAddress.line2] : []),
    o.shippingAddress.postalCode,
    o.payment.last4,
  ]);
  // Lookarounds, not \b: \b never matches before "+", so phone numbers would slip through.
  return [...new Set(values)].map((v) => new RegExp(`(?<![\\w])${escape(v)}(?![\\w])`, "i"));
}

export function findPii(value: unknown): string[] {
  const text = JSON.stringify(value);
  return fixturePiiPatterns()
    .filter((re) => re.test(text))
    .map((re) => re.source);
}

// ---------------------------------------------------------------- agent helpers (Milestone 2)

export function agentSetup(model: BaseChatModel) {
  const base = setup();
  const agent = createStrideAgent({ model, handlers: base.tools, clock });
  const sources = new Map(loadCompanyDocs().flatMap(chunkMarkdown).map((c) => [c.id, c.title]));
  return { ...base, agent, sources };
}

/** Collects every event of one chat turn. */
export async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of events) out.push(e);
  return out;
}

/** Parses a text/event-stream body into its JSON `data:` payloads. */
export const parseSse = (body: string): unknown[] =>
  body
    .split("\n\n")
    .map((frame) => frame.trim())
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice("data: ".length)));
