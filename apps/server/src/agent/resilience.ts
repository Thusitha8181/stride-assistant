import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createMiddleware } from "langchain";

type ProviderError = {
  name?: string;
  status?: number;
  message?: string;
  headers?: Headers | Record<string, string | undefined>;
  cause?: unknown;
};

/** The error and its causes, outermost first. LangGraph and middleware wrap provider errors. */
export function errorChain(err: unknown): ProviderError[] {
  const chain: ProviderError[] = [];
  for (let e = err as ProviderError | undefined; e && typeof e === "object" && chain.length < 10; e = e.cause as ProviderError)
    chain.push(e);
  return chain;
}

export const statusOf = (err: unknown) => errorChain(err).find((e) => typeof e.status === "number")?.status;

/** 408/429/5xx, timeouts and network errors are transient; other 4xx (bad key, bad request) are not. */
export function isTransient(err: unknown): boolean {
  const status = statusOf(err);
  if (typeof status === "number") return status === 408 || status === 429 || status >= 500;
  return errorChain(err).some((e) => /timeout|timed out|ECONNRESET|ECONNREFUSED|fetch failed|socket hang up/i.test(e.message ?? ""));
}

/** How long the provider asked us to wait, from `retry-after` or Groq's "try again in 8.39s" text. */
export function retryAfterMs(err: unknown): number | null {
  for (const e of errorChain(err)) {
    const header = e.headers instanceof Headers ? e.headers.get("retry-after") : e.headers?.["retry-after"];
    if (header && !Number.isNaN(Number(header))) return Number(header) * 1000;
    const match = /try again in ([\d.]+)\s*(ms|s)\b/i.exec(e.message ?? "");
    if (match) return Number(match[1]) * (match[2]!.toLowerCase() === "ms" ? 1 : 1000);
  }
  return null;
}

export type ResilienceOptions = {
  /** Used while the primary is down or rate-limited (it usually has its own quota). */
  fallback?: BaseChatModel;
  /** Only wait for the primary if the provider asks for at most this long; otherwise use the fallback. */
  maxWaitMs?: number;
  /** When every model is rate-limited, queue the call for at most this long before giving up. */
  maxQueueMs?: number;
  /** How long to avoid the primary after an outage that gave no retry hint. */
  outageCooldownMs?: number;
  now?: () => number;
  log?: (msg: string, meta: Record<string, unknown>) => void;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * F1/F2 resilience for model calls (PRD §5: honor retry-after, queue, then fall back). Per call:
 *
 *   primary ── transient error ──┬─ short wait requested → wait, retry primary once
 *                                └─ otherwise → fallback; avoid the primary until its
 *                                   cooldown ends (no wasted calls on a rate-limited model)
 *   fallback ── transient error ──→ queue: wait for whichever model frees up first
 *                                   (≤ maxQueueMs), then try it once
 *
 * Non-transient errors (e.g. 401 bad key) are never retried. Anything left surfaces as
 * MODEL_UNAVAILABLE.
 */
export function modelResilienceMiddleware(options: ResilienceOptions) {
  const maxWaitMs = options.maxWaitMs ?? 2000;
  const maxQueueMs = options.maxQueueMs ?? 15_000;
  const outageCooldownMs = options.outageCooldownMs ?? 30_000;
  const now = options.now ?? Date.now;
  let primaryCooldownUntil = 0;

  return createMiddleware({
    name: "ModelResilience",
    wrapModelCall: async (request, handler) => {
      const { fallback } = options;
      const primary = () => handler(request);
      const secondary = () => handler({ ...request, model: fallback! });

      /** Both models are rate-limited: wait for the first one to free up, then try it once. */
      const queue = async (fallbackError: unknown) => {
        const fallbackWait = retryAfterMs(fallbackError) ?? outageCooldownMs;
        const primaryWait = Math.max(0, primaryCooldownUntil - now());
        const waitMs = Math.min(fallbackWait, primaryWait);
        if (waitMs > maxQueueMs) throw fallbackError;
        const useFallback = fallbackWait <= primaryWait;
        options.log?.("model queued", { waitMs, model: useFallback ? "fallback" : "primary" });
        await sleep(waitMs);
        return useFallback ? secondary() : primary();
      };

      const viaFallback = async () => {
        try {
          return await secondary();
        } catch (err) {
          if (!isTransient(err)) throw err;
          return queue(err);
        }
      };

      if (fallback && now() < primaryCooldownUntil) return viaFallback();

      let lastError: unknown;
      try {
        return await primary();
      } catch (err) {
        if (!isTransient(err)) throw err;
        lastError = err;
      }

      const wait = retryAfterMs(lastError);
      if (wait !== null && (wait <= maxWaitMs || (!fallback && wait <= maxQueueMs))) {
        options.log?.("model retry", { waitMs: wait });
        await sleep(wait);
        try {
          return await primary();
        } catch (err) {
          if (!isTransient(err)) throw err;
          lastError = err;
        }
      }

      if (!fallback) throw lastError;
      const cooldown = retryAfterMs(lastError) ?? outageCooldownMs;
      primaryCooldownUntil = now() + cooldown;
      options.log?.("model fallback", { cooldownMs: cooldown, status: statusOf(lastError) ?? null });
      return viaFallback();
    },
  });
}
