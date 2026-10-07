import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent, dynamicSystemPromptMiddleware, type AgentMiddleware } from "langchain";
import type { Clock } from "../clock";
import type { ToolHandlers } from "../tools/handlers";
import { toolRoundLimitMiddleware } from "./limits";
import { systemPrompt } from "./prompt";
import { modelResilienceMiddleware, type ResilienceOptions } from "./resilience";
import { createAgentTools } from "./tools";

/** PRD §6: max 5 tool-calling iterations per turn, enforced by toolRoundLimitMiddleware. */
export const MAX_TOOL_ROUNDS = 5;

/** Backstop only (graph steps, including middleware nodes); the round limit trips first. */
export const RECURSION_LIMIT = 25;

export type StrideAgentDeps = {
  model: BaseChatModel;
  handlers: ToolHandlers;
  clock: Clock;
  /** Conversation memory keyed by session id (thread_id). In-memory for the POC. */
  checkpointer?: MemorySaver;
  /** Backup model for outages and rate limits (F1/F2). */
  fallbackModel?: BaseChatModel;
  /** Tuning for retries/queueing (e.g. evals queue longer than interactive chat). */
  resilience?: Omit<ResilienceOptions, "fallback" | "log">;
  log?: (msg: string, meta: Record<string, unknown>) => void;
  /** Extra middleware (guards) added in later milestones. */
  middleware?: AgentMiddleware[];
};

export function createStrideAgent(deps: StrideAgentDeps) {
  return createAgent({
    model: deps.model,
    tools: createAgentTools(deps.handlers),
    checkpointer: deps.checkpointer ?? new MemorySaver(),
    middleware: [
      dynamicSystemPromptMiddleware(() => systemPrompt(deps.clock.now())),
      toolRoundLimitMiddleware(MAX_TOOL_ROUNDS),
      modelResilienceMiddleware({ ...deps.resilience, fallback: deps.fallbackModel, log: deps.log }),
      ...(deps.middleware ?? []),
    ],
  });
}

export type StrideAgent = ReturnType<typeof createStrideAgent>;
