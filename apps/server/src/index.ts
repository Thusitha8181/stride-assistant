import "./env";
import { createStrideAgent } from "./agent/agent";
import { createApp, type Health } from "./api/app";
import { runChatTurn } from "./chat/turn";
import { loadConfig } from "./config";
import { loadCompanyDocs } from "./data/load";
import { createChatModel, missingApiKey, modelSpec } from "./llm/models";
import { chunkMarkdown } from "./rag/chunk";
import { createServices } from "./services";
import { systemClock } from "./clock";

const config = loadConfig();
const services = createServices(config);
const fail = (err: Error): never => {
  console.error(`\n✖ ${err.message}\n`);
  process.exit(1);
};
const model = await createChatModel(config, "primary").catch(fail);
const fallbackModel = await createChatModel(config, "fallback").catch(fail);
const log = (msg: string, meta: Record<string, unknown>) => console.error(msg, meta);

const agent = createStrideAgent({ model, fallbackModel, handlers: services.tools, clock: systemClock, log });
const sources = new Map(loadCompanyDocs().flatMap(chunkMarkdown).map((c) => [c.id, c.title]));

async function health(): Promise<Health> {
  const qdrant = await services.client
    .getCollections()
    .then((r) => {
      const names = r.collections.map((c) => c.name);
      const missing = [config.QDRANT_KB_COLLECTION, config.QDRANT_PRODUCTS_COLLECTION].filter((n) => !names.includes(n));
      return missing.length ? { ok: false, detail: `missing collections: ${missing.join(", ")} (run npm run ingest)` } : { ok: true };
    })
    .catch(() => ({ ok: false, detail: `unreachable at ${config.QDRANT_URL}` }));
  const spec = (role: "primary" | "fallback") => {
    const { provider, model: name } = modelSpec(config, role);
    const key = missingApiKey(provider);
    return key ? { ok: false, detail: `${key} not set` } : { ok: true, detail: `${provider}:${name}` };
  };
  const checks = {
    qdrant,
    model: spec("primary"),
    fallbackModel: spec("fallback"),
    tracing: { ok: true, detail: config.LANGSMITH_TRACING ? `LangSmith project ${config.LANGSMITH_PROJECT}` : "off" },
  };
  return { status: Object.values(checks).every((c) => c.ok) ? "ok" : "degraded", checks };
}

const app = createApp({
  chat: ({ sessionId, message, signal }) =>
    runChatTurn({ agent, sources, log }, { sessionId, message, signal }),
  health,
});

const server = app.listen(config.PORT, async () => {
  const h = await health();
  console.log(`Stride API on http://localhost:${config.PORT} (${h.status})`);
  for (const [name, c] of Object.entries(h.checks)) console.log(`  ${c.ok ? "✓" : "✖"} ${name}${c.detail ? `: ${c.detail}` : ""}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
