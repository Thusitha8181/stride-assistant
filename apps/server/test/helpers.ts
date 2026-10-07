import { fixedClock } from "../src/clock";
import { loadCompanyDocs, loadOrders, loadProducts } from "../src/data/load";
import type { OrderRecord } from "../src/data/orderRecord";
import { Catalog } from "../src/domain/catalog";
import { OrderService } from "../src/domain/orders";
import { ReturnStore } from "../src/domain/returnStore";
import { chunkMarkdown } from "../src/rag/chunk";
import { HashEmbeddings } from "../src/rag/embeddings";
import type { KnowledgeIndex, ProductIndex } from "../src/rag/indexes";
import { productText } from "../src/rag/qdrant";
import { createToolHandlers } from "../src/tools/handlers";

export const clock = fixedClock("2026-10-07T12:00:00.000Z");

const cosine = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);

/** In-memory KnowledgeIndex over the real KB, using the deterministic hash embeddings. */
export function memoryKnowledgeIndex(): KnowledgeIndex {
  const embeddings = new HashEmbeddings();
  const chunks = loadCompanyDocs().flatMap(chunkMarkdown);
  const vectors = chunks.map((c) => embeddings.embed(`${c.title}\n${c.text}`));
  return {
    async search(query, k) {
      const q = embeddings.embed(query);
      return chunks
        .map((chunk, i) => ({ chunk, score: cosine(q, vectors[i]!) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },
  };
}

/** In-memory ProductIndex with the same filter semantics as the Qdrant adapter. */
export function memoryProductIndex(catalog: Catalog): ProductIndex {
  const embeddings = new HashEmbeddings();
  const vectors = new Map(catalog.products.map((p) => [p.id, embeddings.embed(productText(p))]));
  return {
    async search(query, filter, k) {
      const q = embeddings.embed(query);
      return catalog.products
        .filter((p) => !filter.category || p.category === filter.category)
        .filter((p) => filter.maxPrice === undefined || p.price <= filter.maxPrice)
        .filter((p) => filter.size === undefined || p.sizes.includes(filter.size))
        .map((p) => ({ productId: p.id, score: cosine(q, vectors.get(p.id)!) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },
  };
}

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
  return [...new Set(values)].map((v) => new RegExp(`\\b${escape(v)}\\b`, "i"));
}

export function findPii(value: unknown): string[] {
  const text = JSON.stringify(value);
  return fixturePiiPatterns()
    .filter((re) => re.test(text))
    .map((re) => re.source);
}
