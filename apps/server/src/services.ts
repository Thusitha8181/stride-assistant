import { systemClock, type Clock } from "./clock";
import type { Config } from "./config";
import { loadOrders, loadProducts } from "./data/load";
import { Catalog } from "./domain/catalog";
import { OrderService } from "./domain/orders";
import { ReturnStore } from "./domain/returnStore";
import { createEmbeddings } from "./rag/embeddings";
import { createQdrantClient, QdrantKnowledgeIndex, QdrantProductIndex } from "./rag/qdrant";
import { createToolHandlers } from "./tools/handlers";

/** Composition root: wires data, domain services, retrieval and tools from config. */
export function createServices(config: Config, clock: Clock = systemClock) {
  const catalog = new Catalog(loadProducts());
  const orders = new OrderService(loadOrders(), catalog, clock);
  const returns = new ReturnStore();
  const embeddings = createEmbeddings(config);
  const client = createQdrantClient(config);
  const knowledge = new QdrantKnowledgeIndex(client, embeddings, config.QDRANT_KB_COLLECTION);
  const products = new QdrantProductIndex(client, embeddings, config.QDRANT_PRODUCTS_COLLECTION);
  const tools = createToolHandlers({ catalog, orders, returns, knowledge, products, clock });
  return { catalog, orders, returns, embeddings, client, knowledge, products, tools };
}
