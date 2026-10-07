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

/**
 * The provider rejected the model's own output (e.g. Groq validates tool calls against the
 * schema and returns 400 "Tool call validation failed"). The model just generated a bad
 * call: sampling again usually works, so this is retryable even though it is a 4xx (F3).
 */
export const isMalformedGeneration = (err: unknown) =>
  errorChain(err).some((e) => /tool call validation failed|tool_use_failed|failed to call a function|output_parse_failed/i.test(e.message ?? ""));

/** 408/429/5xx, timeouts, network errors and malformed generations are transient; other 4xx (bad key) are not. */
export function isTransient(err: unknown): boolean {
  if (isMalformedGeneration(err)) return true;
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

/** Re-sample at most this many times when the provider rejects a malformed generation. */
export const MAX_MALFORMED_RETRIES = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Which = "primary" | "fallback";

/**
 * F1/F2 resilience for model calls (PRD §5: honor retry-after, queue, then fall back).
 *
 * Each model has a cooldown, set from the provider's retry-after hint (or a fixed
 * outage cooldown) when it fails transiently. Every attempt goes to:
 *   - the primary, if it is available within `maxWaitMs` (short waits are worth it), else
 *   - whichever model frees up first (the fallback usually has its own quota).
 * Attempts repeat until one succeeds or the next one would start after `maxQueueMs`.
 * Cooldowns persist across calls and turns, so a rate-limited model isn't hammered.
 * Non-transient errors (e.g. 401 bad key) are never retried; whatever is left surfaces
 * as MODEL_UNAVAILABLE.
 */
export function modelResilienceMiddleware(options: ResilienceOptions) {
  const maxWaitMs = options.maxWaitMs ?? 2000;
  const maxQueueMs = options.maxQueueMs ?? 15_000;
  const outageCooldownMs = options.outageCooldownMs ?? 30_000;
  const now = options.now ?? Date.now;
  const availableAt: Record<Which, number> = { primary: 0, fallback: 0 };

  const choose = (): Which => {
    if (!options.fallback) return "primary";
    const primaryWait = availableAt.primary - now();
    if (primaryWait <= maxWaitMs) return "primary";
    return availableAt.fallback <= availableAt.primary ? "fallback" : "primary";
  };

  return createMiddleware({
    name: "ModelResilience",
    wrapModelCall: async (request, handler) => {
      const call = (which: Which) => (which === "primary" ? handler(request) : handler({ ...request, model: options.fallback! }));
      const deadline = now() + maxQueueMs;
      let lastError: unknown;
      let lastFailed: Which | null = null;
      let malformed = 0;

      for (;;) {
        const which = choose();
        const waitMs = Math.max(0, availableAt[which] - now());
        if (lastError !== undefined && now() + waitMs > deadline) throw lastError;
        if (waitMs > 0) {
          options.log?.(which === "primary" && lastFailed === "primary" ? "model retry" : "model queued", { waitMs, model: which });
          await sleep(waitMs);
        } else if (which === "fallback" && lastFailed === "primary") {
          options.log?.("model fallback", { status: statusOf(lastError) ?? null });
        }

        try {
          return await call(which);
        } catch (err) {
          if (!isTransient(err)) throw err;
          if (isMalformedGeneration(err) && ++malformed > MAX_MALFORMED_RETRIES) throw err;
          lastError = err;
          lastFailed = which;
          // A malformed generation says nothing about availability: retry right away.
          availableAt[which] = isMalformedGeneration(err) ? now() : now() + (retryAfterMs(err) ?? outageCooldownMs);
        }
      }
    },
  });
}
