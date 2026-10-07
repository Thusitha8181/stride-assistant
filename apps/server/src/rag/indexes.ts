import type { Category } from "@stride/shared";
import type { Chunk } from "./chunk";

/**
 * Retrieval ports. Tools depend on these, not on Qdrant, so the vector store can be
 * swapped (or replaced by the keyword fallback for F4) without touching tool code.
 */
export interface KnowledgeIndex {
  search(query: string, k: number): Promise<Array<{ chunk: Chunk; score: number }>>;
}

export type ProductFilter = { category?: Category; maxPrice?: number; size?: number };

export interface ProductIndex {
  search(query: string, filter: ProductFilter, k: number): Promise<Array<{ productId: string; score: number }>>;
}
