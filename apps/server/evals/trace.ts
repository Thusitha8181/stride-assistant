import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatGeneration, LLMResult } from "@langchain/core/outputs";
import type { Serialized } from "@langchain/core/load/serializable";

export type RecordedResponse = { content: string; tool_calls: Array<{ id?: string; name: string; args: Record<string, unknown> }> };

export type ModelCall = {
  model: string | null;
  /** Everything the model was sent, serialized (privacy evaluator scans this). */
  input: string;
  output: RecordedResponse | null;
  tokens: number;
};

export type ToolCall = { name: string; args: unknown; output: unknown };

export type TurnTrace = { modelCalls: ModelCall[]; tools: ToolCall[] };

const parse = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

const textOf = (content: BaseMessage["content"]) =>
  typeof content === "string" ? content : content.map((b) => ("text" in b ? String(b.text) : "")).join("");

/**
 * Token usage lives in different places depending on the provider and on streaming:
 * `usage_metadata` (LangChain standard), Groq's streamed `response_metadata.usage`,
 * or `llmOutput.tokenUsage` (non-streaming).
 */
export function tokensUsed(
  message: { usage_metadata?: { total_tokens?: number }; response_metadata?: { usage?: { prompt_tokens?: number; completion_tokens?: number } } },
  output?: { llmOutput?: { tokenUsage?: { totalTokens?: number } } },
): number {
  const streamed = message.response_metadata?.usage;
  return (
    message.usage_metadata?.total_tokens ??
    (streamed?.prompt_tokens !== undefined ? streamed.prompt_tokens + (streamed.completion_tokens ?? 0) : undefined) ??
    output?.llmOutput?.tokenUsage?.totalTokens ??
    0
  );
}

/**
 * Callback handler that records what happened inside a turn: every model call (input,
 * output, model name, tokens) and every tool call (args, output). Evaluators score this
 * trace; the recorded model outputs become replay cassettes.
 */
export class TraceRecorder extends BaseCallbackHandler {
  name = "eval-trace";
  // Run synchronously so the trace is complete when the turn's stream ends.
  override awaitHandlers = true;

  private models = new Map<string, ModelCall>();
  private toolRuns = new Map<string, { name: string; args: unknown }>();
  private trace: TurnTrace = { modelCalls: [], tools: [] };

  override handleChatModelStart(
    _llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    _parentRunId?: string,
    extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
  ) {
    const invocation = extraParams?.invocation_params as { model?: string } | undefined;
    const call: ModelCall = {
      model: (metadata?.ls_model_name as string) ?? invocation?.model ?? null,
      input: JSON.stringify(messages.flat().map((m) => ({ role: m.type, content: m.content }))),
      output: null,
      tokens: 0,
    };
    this.models.set(runId, call);
    this.trace.modelCalls.push(call);
  }

  override handleLLMEnd(output: LLMResult, runId: string) {
    const call = this.models.get(runId);
    const generation = output.generations[0]?.[0] as ChatGeneration | undefined;
    if (!call || !generation?.message) return;
    const message = generation.message as BaseMessage & {
      tool_calls?: RecordedResponse["tool_calls"];
      usage_metadata?: { total_tokens?: number };
      response_metadata?: { usage?: { prompt_tokens?: number; completion_tokens?: number } };
    };
    call.output = {
      content: textOf(message.content),
      tool_calls: (message.tool_calls ?? []).map(({ id, name, args }) => ({ id, name, args })),
    };
    call.tokens = tokensUsed(message, output);
  }

  override handleToolStart(
    tool: Serialized,
    input: string,
    runId: string,
    _parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    runName?: string,
  ) {
    this.toolRuns.set(runId, { name: runName ?? tool.id.at(-1) ?? "unknown", args: parse(input) });
  }

  override handleToolEnd(output: unknown, runId: string) {
    const run = this.toolRuns.get(runId);
    if (!run) return;
    const raw = ToolMessage.isInstance(output) ? textOf(output.content) : String(output);
    this.trace.tools.push({ ...run, output: parse(raw) });
  }

  override handleToolError(error: Error, runId: string) {
    const run = this.toolRuns.get(runId);
    if (run) this.trace.tools.push({ ...run, output: { ok: false, code: "INVALID_ARGUMENTS", message: error.message } });
  }

  /** Returns the trace collected since the last call and starts a new one. */
  take(): TurnTrace {
    const trace = this.trace;
    this.trace = { modelCalls: [], tools: [] };
    this.models.clear();
    this.toolRuns.clear();
    return trace;
  }
}
