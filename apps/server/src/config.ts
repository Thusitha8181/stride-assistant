import { z } from "zod";

const flag = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const Config = z.object({
  PORT: z.coerce.number().int().positive().default(4000),

  /** Any provider supported by LangChain's initChatModel (groq, openai, anthropic, …) whose package is installed. */
  LLM_PROVIDER: z.string().min(1).default("groq"),
  LLM_MODEL: z.string().min(1).default("openai/gpt-oss-120b"),
  LLM_FALLBACK_PROVIDER: z.string().min(1).default("groq"),
  LLM_FALLBACK_MODEL: z.string().min(1).default("openai/gpt-oss-20b"),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

  EMBEDDINGS_PROVIDER: z.enum(["local", "hash"]).default("local"),
  EMBEDDINGS_MODEL: z.string().default("Xenova/all-MiniLM-L6-v2"),
  VECTOR_STORE: z.enum(["qdrant"]).default("qdrant"),
  QDRANT_URL: z.url().default("http://localhost:6333"),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_KB_COLLECTION: z.string().default("stride_kb"),
  QDRANT_PRODUCTS_COLLECTION: z.string().default("stride_products"),

  /** Read directly by LangChain/LangSmith from the environment; validated here for /api/health. */
  LANGSMITH_TRACING: flag,
  LANGSMITH_PROJECT: z.string().default("stride-poc"),
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
