/**
 * Chunks the company docs and catalog, embeds them, and (re)builds the Qdrant collections.
 * Idempotent: safe to run any time the data changes.
 *
 *   docker compose up -d && npm run ingest
 */
import "../src/env";
import { loadConfig } from "../src/config";
import { loadCompanyDocs, loadProducts } from "../src/data/load";
import { chunkMarkdown } from "../src/rag/chunk";
import { createEmbeddings } from "../src/rag/embeddings";
import { createQdrantClient, ingest } from "../src/rag/qdrant";

const config = loadConfig();
const started = Date.now();
console.log(`Ingesting into ${config.QDRANT_URL} using ${config.EMBEDDINGS_PROVIDER} embeddings…`);

try {
  const counts = await ingest({
    client: createQdrantClient(config),
    embeddings: createEmbeddings(config),
    config,
    chunks: loadCompanyDocs().flatMap(chunkMarkdown),
    products: loadProducts(),
  });
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${counts.kb} KB chunks, ${counts.products} products.`);
} catch (err) {
  console.error(`Ingest failed: ${err instanceof Error ? err.message : err}`);
  console.error("Is Qdrant running? Try: docker compose up -d");
  process.exit(1);
}
