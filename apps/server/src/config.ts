import { z } from "zod";

const Config = z.object({
  EMBEDDINGS_PROVIDER: z.enum(["local", "hash"]).default("local"),
  EMBEDDINGS_MODEL: z.string().default("Xenova/all-MiniLM-L6-v2"),
  VECTOR_STORE: z.enum(["qdrant"]).default("qdrant"),
  QDRANT_URL: z.url().default("http://localhost:6333"),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_KB_COLLECTION: z.string().default("stride_kb"),
  QDRANT_PRODUCTS_COLLECTION: z.string().default("stride_products"),
});
export type Config = z.infer<typeof Config>;

/** Fails fast with a readable message when the environment is misconfigured. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Config.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}
