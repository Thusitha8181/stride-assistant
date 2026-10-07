import { QdrantContainer, type StartedQdrantContainer } from "@testcontainers/qdrant";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type Config } from "../../src/config";
import { loadCompanyDocs, loadOrders, loadProducts } from "../../src/data/load";
import { Catalog } from "../../src/domain/catalog";
import { OrderService } from "../../src/domain/orders";
import { ReturnStore } from "../../src/domain/returnStore";
import { chunkMarkdown } from "../../src/rag/chunk";
import { createEmbeddings, HashEmbeddings } from "../../src/rag/embeddings";
import { createQdrantClient, ingest, QdrantKnowledgeIndex, QdrantProductIndex } from "../../src/rag/qdrant";
import { createToolHandlers } from "../../src/tools/handlers";
import { clock } from "../helpers";

/** Keep in sync with docker-compose.yml. */
const QDRANT_IMAGE = "qdrant/qdrant:v1.19.2";

const chunks = loadCompanyDocs().flatMap(chunkMarkdown);
const products = loadProducts();
const catalog = new Catalog(products);

let container: StartedQdrantContainer;
let config: Config;
let client: ReturnType<typeof createQdrantClient>;
const embeddings = new HashEmbeddings();

beforeAll(async () => {
  container = await new QdrantContainer(QDRANT_IMAGE).start();
  config = loadConfig({ QDRANT_URL: `http://${container.getRestHostAddress()}`, EMBEDDINGS_PROVIDER: "hash" });
  client = createQdrantClient(config);
  await ingest({ client, embeddings, config, chunks, products });
});

afterAll(async () => {
  await container?.stop();
});

describe("ingest", () => {
  it("indexes every KB chunk and product", async () => {
    expect((await client.count(config.QDRANT_KB_COLLECTION, { exact: true })).count).toBe(chunks.length);
    expect((await client.count(config.QDRANT_PRODUCTS_COLLECTION, { exact: true })).count).toBe(25);
  });

  it("is idempotent", async () => {
    const again = await ingest({ client, embeddings, config, chunks, products });
    expect(again).toEqual({ kb: chunks.length, products: 25 });
  });
});

describe("QdrantKnowledgeIndex", () => {
  it("retrieves the right policy chunk", async () => {
    const index = new QdrantKnowledgeIndex(client, embeddings, config.QDRANT_KB_COLLECTION);
    const [top] = await index.search("can I return final sale items", 3);
    expect(top?.chunk.id).toBe("returns-policy#final-sale-items");
    expect(top?.score).toBeGreaterThan(0);
  });
});

describe("QdrantProductIndex filters", () => {
  const index = () => new QdrantProductIndex(client, embeddings, config.QDRANT_PRODUCTS_COLLECTION);

  it("filters by category and max price", async () => {
    const hits = await index().search("waterproof", { category: "trail", maxPrice: 120 }, 10);
    const found = hits.map((h) => catalog.get(h.productId)!);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((p) => p.category === "trail" && p.price <= 120)).toBe(true);
    expect(found.map((p) => p.name)).toContain("Trail Runner Y");
  });

  it("filters by half sizes (float payload values)", async () => {
    const hits = await index().search("shoe", { size: 10.5 }, 25);
    const expected = products.filter((p) => p.sizes.includes(10.5)).map((p) => p.id).sort();
    expect(hits.map((h) => h.productId).sort()).toEqual(expected);
  });

  it("returns nothing when no product matches the filter", async () => {
    expect(await index().search("shoe", { category: "kids", maxPrice: 10 }, 5)).toEqual([]);
  });
});

describe("tools against Qdrant", () => {
  const tools = () =>
    createToolHandlers({
      catalog,
      orders: new OrderService(loadOrders(), catalog, clock),
      returns: new ReturnStore(),
      clock,
      knowledge: new QdrantKnowledgeIndex(client, embeddings, config.QDRANT_KB_COLLECTION),
      products: new QdrantProductIndex(client, embeddings, config.QDRANT_PRODUCTS_COLLECTION),
    });

  it("searchProducts returns filtered, in-stock-annotated results", async () => {
    const r = await tools().searchProducts({ query: "waterproof trail running", category: "trail", size: 10 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.products.length).toBeGreaterThan(0);
    expect(r.products.every((p) => p.category === "trail" && p.inStockInRequestedSize !== undefined)).toBe(true);
  });

  it("searchKnowledgeBase cites the shipping policy", async () => {
    const r = await tools().searchKnowledgeBase({ query: "how much is international shipping to Canada" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.chunks.map((c) => c.id)).toContain("shipping#international-shipping");
  });

  it("degrades to BACKEND_UNAVAILABLE when Qdrant is unreachable @F4", async () => {
    const down = createQdrantClient({ ...config, QDRANT_URL: "http://127.0.0.1:1" });
    const t = createToolHandlers({
      catalog,
      orders: new OrderService(loadOrders(), catalog, clock),
      returns: new ReturnStore(),
      clock,
      knowledge: new QdrantKnowledgeIndex(down, embeddings, config.QDRANT_KB_COLLECTION),
      products: new QdrantProductIndex(down, embeddings, config.QDRANT_PRODUCTS_COLLECTION),
    });
    expect(await t.searchKnowledgeBase({ query: "returns" })).toMatchObject({ ok: false, code: "BACKEND_UNAVAILABLE" });
    expect(await t.searchProducts({ query: "boots" })).toMatchObject({ ok: false, code: "BACKEND_UNAVAILABLE" });
  });
});

/** Opt-in: downloads the ~25 MB sentence-transformer. `TEST_LOCAL_EMBEDDINGS=1 npm run test:integration` */
describe.skipIf(!process.env.TEST_LOCAL_EMBEDDINGS)("semantic retrieval with local embeddings", () => {
  it("answers paraphrased questions", { timeout: 300_000 }, async () => {
    const local = createEmbeddings({ EMBEDDINGS_PROVIDER: "local", EMBEDDINGS_MODEL: "Xenova/all-MiniLM-L6-v2" });
    const cfg = { ...config, QDRANT_KB_COLLECTION: "kb_local", QDRANT_PRODUCTS_COLLECTION: "products_local" };
    await ingest({ client, embeddings: local, config: cfg, chunks, products });

    const kb = new QdrantKnowledgeIndex(client, local, cfg.QDRANT_KB_COLLECTION);
    const [top] = await kb.search("my sneakers fell apart after two months, what can I do?", 3);
    expect(top?.chunk.source).toBe("warranty");

    const shoes = new QdrantProductIndex(client, local, cfg.QDRANT_PRODUCTS_COLLECTION);
    const [best] = await shoes.search("something warm for snowy winters", {}, 3);
    expect(catalog.get(best!.productId)?.name).toBe("Summit Winter Boot");
  });
});
