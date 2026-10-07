import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { initChatModel } from "langchain";
import type { Config } from "../config";

export type ModelRole = "primary" | "fallback";

/** API key env var per provider, for a clear startup error instead of a failed first request. */
const KEY_VARS: Record<string, string> = {
  groq: "GROQ_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
  mistralai: "MISTRAL_API_KEY",
};

export function modelSpec(config: Config, role: ModelRole) {
  return role === "primary"
    ? { provider: config.LLM_PROVIDER, model: config.LLM_MODEL }
    : { provider: config.LLM_FALLBACK_PROVIDER, model: config.LLM_FALLBACK_MODEL };
}

export function missingApiKey(provider: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const name = KEY_VARS[provider];
  return name && !env[name] ? name : null;
}

/**
 * Provider-agnostic chat model factory (PRD §6). The agent only sees `BaseChatModel`;
 * switching providers is a config change plus installing that provider's package.
 * Retries are disabled here because resilience is handled by agent middleware (F1, F2).
 */
export async function createChatModel(config: Config, role: ModelRole = "primary"): Promise<BaseChatModel> {
  const { provider, model } = modelSpec(config, role);
  const missing = missingApiKey(provider);
  if (missing) throw new Error(`${missing} is not set (needed for LLM ${role} model ${provider}:${model}). Add it to .env.`);

  return (await initChatModel(model, {
    modelProvider: provider,
    temperature: config.LLM_TEMPERATURE,
    timeout: config.LLM_TIMEOUT_MS,
    maxRetries: 0,
  })) as unknown as BaseChatModel;
}
