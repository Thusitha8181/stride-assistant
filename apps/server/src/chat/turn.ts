import { randomUUID } from "node:crypto";
import { AIMessage, AIMessageChunk, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { ChatErrorCode, ChatEvent, CitationSource } from "@stride/shared";
import { RECURSION_LIMIT, type StrideAgent } from "../agent/agent";
import { LIMIT_MESSAGE, TOOL_ROUND_LIMIT_MIDDLEWARE } from "../agent/limits";
import { isTransient, statusOf } from "../agent/resilience";
import { cardFor, citedIds } from "./cards";

export type ChatTurnDeps = {
  agent: StrideAgent;
  /** Every knowledge-base chunk id → title. Citations to unknown ids are dropped. */
  sources: Map<string, string>;
  log?: (msg: string, meta: Record<string, unknown>) => void;
  /** Extra callback handlers (tests, eval trace capture). LangSmith tracing is configured via env. */
  callbacks?: BaseCallbackHandler[];
};

export type ChatTurnInput = { sessionId: string; message: string; signal?: AbortSignal; runId?: string };

const MODEL_NODE = "model_request";

const textOf = (content: BaseMessage["content"]): string =>
  typeof content === "string"
    ? content
    : content.map((block) => (block.type === "text" && "text" in block ? String(block.text) : "")).join("");

const hasToolCalls = (m: BaseMessage) =>
  (AIMessage.isInstance(m) || AIMessageChunk.isInstance(m)) &&
  ((m.tool_calls?.length ?? 0) > 0 || (AIMessageChunk.isInstance(m) && (m.tool_call_chunks?.length ?? 0) > 0));

function toolEvents(m: ToolMessage): ChatEvent[] {
  const name = m.name ?? "unknown";
  let result: { ok?: boolean; code?: string } | null = null;
  try {
    result = JSON.parse(textOf(m.content));
  } catch {
    // Not JSON: LangChain's argument-validation error text (F3).
  }
  const ok = m.status !== "error" && result?.ok === true;
  const code = ok ? null : (result?.code ?? "INVALID_ARGUMENTS");
  const card = cardFor(name, result);
  return [
    { type: "tool-end", toolCallId: m.tool_call_id, name, ok, code },
    ...(card ? [{ type: "card" as const, card }] : []),
  ];
}

function classify(err: unknown): { code: ChatErrorCode; message: string; retryable: boolean } {
  const e = err as { name?: string } | undefined;
  // LangGraph and middleware wrap provider errors; the HTTP status may be several causes deep.
  const status = statusOf(err);
  if (e?.name === "GraphRecursionError")
    return { code: "AGENT_LIMIT", message: LIMIT_MESSAGE, retryable: false };
  // Misconfiguration (bad/revoked key): retrying won't help, and the details belong in server logs.
  if (status === 401 || status === 403)
    return { code: "MODEL_UNAVAILABLE", message: "The assistant is temporarily unavailable. Please contact support@stride.example.", retryable: false };
  if (typeof status === "number" || isTransient(err))
    return { code: "MODEL_UNAVAILABLE", message: "I'm having trouble thinking right now. Please try again in a moment.", retryable: true };
  return { code: "INTERNAL", message: "Something went wrong on our side. Please try again.", retryable: true };
}

/**
 * Runs one chat turn and translates the agent's stream into contract events
 * (PRD §10.1): session → (text-delta | tool-start | tool-end | card)* → citation? → done.
 * Errors become an `error` event; a client disconnect ends the stream silently.
 */
export async function* runChatTurn(deps: ChatTurnDeps, input: ChatTurnInput): AsyncGenerator<ChatEvent> {
  const { sessionId, message, signal } = input;
  const runId = input.runId ?? randomUUID();
  yield { type: "session", sessionId };

  let answer = "";
  try {
    // Full RunnableConfig: the agent's typed stream options omit the tracing fields
    // (runId/runName/metadata/tags) that name the root run and its LangSmith trace.
    const config: RunnableConfig & { streamMode: ["messages", "updates"] } = {
      configurable: { thread_id: sessionId },
      streamMode: ["messages", "updates"],
      recursionLimit: RECURSION_LIMIT,
      signal,
      runId,
      runName: "stride-chat-turn",
      metadata: { session_id: sessionId },
      tags: ["stride", "chat"],
      callbacks: deps.callbacks,
    };
    const stream = await deps.agent.stream(
      { messages: [new HumanMessage(message)] },
      config as Parameters<StrideAgent["stream"]>[1],
    );

    for await (const [mode, chunk] of stream as AsyncIterable<[string, unknown]>) {
      if (mode === "messages") {
        const [msg, meta] = chunk as [BaseMessage, { langgraph_node?: string }];
        if (meta.langgraph_node !== MODEL_NODE || hasToolCalls(msg)) continue;
        if (!AIMessage.isInstance(msg) && !AIMessageChunk.isInstance(msg)) continue;
        const delta = textOf(msg.content);
        if (delta) {
          answer += delta;
          yield { type: "text-delta", delta };
        }
      } else if (mode === "updates") {
        for (const [node, update] of Object.entries(chunk as Record<string, { messages?: BaseMessage[] } | undefined>)) {
          // The middleware node reports an update every round; only one carrying messages means it tripped.
          if (node.startsWith(TOOL_ROUND_LIMIT_MIDDLEWARE) && update?.messages?.length) {
            yield { type: "error", code: "AGENT_LIMIT", message: LIMIT_MESSAGE, retryable: false };
            continue;
          }
          for (const m of update?.messages ?? []) {
            if (AIMessage.isInstance(m))
              for (const call of m.tool_calls ?? []) yield { type: "tool-start", toolCallId: call.id ?? "", name: call.name };
            if (ToolMessage.isInstance(m)) yield* toolEvents(m);
          }
        }
      }
    }

    const sources: CitationSource[] = citedIds(answer).flatMap((id) => {
      const title = deps.sources.get(id);
      return title ? [{ id, title }] : [];
    });
    if (sources.length) yield { type: "citation", sources };
  } catch (err) {
    if (signal?.aborted) return;
    deps.log?.("chat turn failed", { sessionId, runId, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
    yield { type: "error", ...classify(err) };
  }
  yield { type: "done", sessionId, runId };
}
