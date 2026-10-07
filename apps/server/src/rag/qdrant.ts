import { createHash } from "node:crypto";
import { Document } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { QdrantVectorStore } from "@langchain/qdrant";
import { QdrantClient, type Schemas } from "@qdrant/js-client-rest";
import type { Product } from "@stride/shared";
import type { Config } from "../config";
import type { Chunk } from "./chunk";
import type { KnowledgeIndex, ProductFilter, ProductIndex } from "./indexes";

type QdrantConfig = Pick<Config, "QDRANT_URL" | "QDRANT_API_KEY" | "QDRANT_KB_COLLECTION" | "QDRANT_PRODUCTS_COLLECTION">;

export const createQdrantClient = (config: QdrantConfig) =>
  new QdrantClient({ url: config.QDRANT_URL, apiKey: config.QDRANT_API_KEY, checkCompatibility: false });

/** Deterministic UUID (v5-style, SHA-1) so re-ingesting the same document reuses its point id. */
export function stableId(name: string): string {
  const h = createHash("sha1").update(`stride:${name}`).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const store = (client: QdrantClient, embeddings: EmbeddingsInterface, collectionName: string) =>
  new QdrantVectorStore(embeddings, { client, collectionName });

export class QdrantKnowledgeIndex implements KnowledgeIndex {
  private readonly vs: QdrantVectorStore;

  constructor(client: QdrantClient, embeddings: EmbeddingsInterface, collection: string) {
    this.vs = store(client, embeddings, collection);
  }

  async search(query: string, k: number) {
    const hits = await this.vs.similaritySearchWithScore(query, k);
    return hits.map(([doc, score]) => ({ chunk: doc.metadata.chunk as Chunk, score }));
  }
}

export class QdrantProductIndex implements ProductIndex {
  private readonly vs: QdrantVectorStore;

  constructor(client: QdrantClient, embeddings: EmbeddingsInterface, collection: string) {
    this.vs = store(client, embeddings, collection);
  }

  async search(query: string, filter: ProductFilter, k: number) {
    const must: Schemas["FieldCondition"][] = [];
    if (filter.category) must.push({ key: "metadata.category", match: { value: filter.category } });
    if (filter.maxPrice !== undefined) must.push({ key: "metadata.price", range: { lte: filter.maxPrice } });
    // `range` (not `match`) because half sizes are floats; on an array it matches if any element is in range.
    if (filter.size !== undefined) must.push({ key: "metadata.sizes", range: { gte: filter.size, lte: filter.size } });

    const hits = await this.vs.similaritySearchWithScore(query, k, must.length ? { must } : undefined);
    return hits.map(([doc, score]) => ({ productId: doc.metadata.productId as string, score }));
  }
}

export const productText = (p: Product) =>
  `${p.name}. ${p.category} shoe. ${p.description} Features: ${p.tags.join(", ")}.`;

/**
 * Rebuilds both collections from the source data. Recreating the collection (with
 * deterministic point ids) makes ingest idempotent and drops stale documents.
 */
export async function ingest(args: {
  client: QdrantClient;
  embeddings: EmbeddingsInterface;
  config: QdrantConfig;
  chunks: Chunk[];
  products: Product[];
}): Promise<{ kb: number; products: number }> {
  const { client, embeddings, config } = args;

  // Keys are our own ids ("P-006", "returns-policy#eligibility"); Qdrant needs UUIDs. Document.id must stay
  // unset because QdrantVectorStore prefers it over the `ids` option.
  const rebuild = async (collection: string, entries: Array<[key: string, doc: Document]>) => {
    if ((await client.collectionExists(collection)).exists) await client.deleteCollection(collection);
    const docs = entries.map(([, doc]) => doc);
    await store(client, embeddings, collection).addDocuments(docs, {
      ids: entries.map(([key]) => stableId(`${collection}:${key}`)),
    });
    const { count } = await client.count(collection, { exact: true });
    return count;
  };

  const kb = await rebuild(
    config.QDRANT_KB_COLLECTION,
    args.chunks.map((c) => [c.id, new Document({ pageContent: `${c.title}\n${c.text}`, metadata: { chunk: c } })]),
  );
  const products = await rebuild(
    config.QDRANT_PRODUCTS_COLLECTION,
    args.products.map((p) => [
      p.id,
      new Document({
        pageContent: productText(p),
        metadata: { productId: p.id, category: p.category, price: p.price, sizes: p.sizes },
      }),
    ]),
  );
  return { kb, products };
}
