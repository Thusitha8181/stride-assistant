import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { Product } from "@stride/shared";
import type { Chunk } from "./chunk";
import type { KnowledgeIndex, ProductIndex } from "./indexes";
import { productText } from "./qdrant";

const cosine = (a: number[], b: number[]) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/** Embeds lazily on first search, so construction is cheap and failures surface where they're handled. */
function lazy<T>(fn: () => Promise<T>) {
  let value: Promise<T> | undefined;
  return () => (value ??= fn());
}

/**
 * In-process KnowledgeIndex with the same document text and cosine ranking as the Qdrant
 * collection. Used by tests and evals (no Docker; recordings and replays see identical results).
 */
export function memoryKnowledgeIndex(embeddings: EmbeddingsInterface, chunks: Chunk[]): KnowledgeIndex {
  const vectors = lazy(() => embeddings.embedDocuments(chunks.map((c) => `${c.title}\n${c.text}`)));
  return {
    async search(query, k) {
      const [docs, q] = await Promise.all([vectors(), embeddings.embedQuery(query)]);
      return chunks
        .map((chunk, i) => ({ chunk, score: cosine(q, docs[i]!) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },
  };
}

/** In-process ProductIndex with the same filter semantics as the Qdrant adapter. */
export function memoryProductIndex(embeddings: EmbeddingsInterface, products: Product[]): ProductIndex {
  const vectors = lazy(() => embeddings.embedDocuments(products.map(productText)));
  return {
    async search(query, filter, k) {
      const [docs, q] = await Promise.all([vectors(), embeddings.embedQuery(query)]);
      return products
        .map((p, i) => ({ p, score: cosine(q, docs[i]!) }))
        .filter(({ p }) => !filter.category || p.category === filter.category)
        .filter(({ p }) => filter.maxPrice === undefined || p.price <= filter.maxPrice)
        .filter(({ p }) => filter.size === undefined || p.sizes.includes(filter.size))
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map(({ p, score }) => ({ productId: p.id, score }));
    },
  };
}
