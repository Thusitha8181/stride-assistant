import type { Card, ChatErrorCode, ChatEvent, CitationSource } from "@stride/shared";

export type ToolActivity = { id: string; name: string; status: "running" | "ok" | "failed"; code: string | null };

/** Server error codes plus the ones the client itself can produce. */
export type ErrorCode = ChatErrorCode | "NETWORK" | "INVALID_REQUEST";

export type UserMessage = { id: string; role: "user"; text: string };

export type AssistantMessage = {
  id: string;
  role: "assistant";
  /** The user message this answers, for retries. */
  replyTo: string;
  text: string;
  cards: Card[];
  tools: ToolActivity[];
  citations: CitationSource[];
  error: { code: ErrorCode; message: string; retryable: boolean } | null;
  status: "streaming" | "done";
  runId: string | null;
  startedAt: number;
  finishedAt: number | null;
};

export type Message = UserMessage | AssistantMessage;

export const newAssistantMessage = (id: string, replyTo: string, now = Date.now()): AssistantMessage => ({
  id,
  role: "assistant",
  replyTo,
  text: "",
  cards: [],
  tools: [],
  citations: [],
  error: null,
  status: "streaming",
  runId: null,
  startedAt: now,
  finishedAt: null,
});

/** Pure reducer: folds one stream event into the assistant message it belongs to. */
export function applyEvent(msg: AssistantMessage, event: ChatEvent, now = Date.now()): AssistantMessage {
  switch (event.type) {
    case "text-delta":
      return { ...msg, text: msg.text + event.delta };
    case "tool-start":
      return { ...msg, tools: [...msg.tools, { id: event.toolCallId, name: event.name, status: "running", code: null }] };
    case "tool-end": {
      const status = event.ok ? ("ok" as const) : ("failed" as const);
      const known = msg.tools.some((t) => t.id === event.toolCallId);
      return {
        ...msg,
        tools: known
          ? msg.tools.map((t) => (t.id === event.toolCallId ? { ...t, status, code: event.code } : t))
          : [...msg.tools, { id: event.toolCallId, name: event.name, status, code: event.code }],
      };
    }
    case "card":
      return { ...msg, cards: [...msg.cards, event.card] };
    case "citation":
      return { ...msg, citations: event.sources };
    case "error":
      return { ...msg, error: { code: event.code, message: event.message, retryable: event.retryable } };
    case "done":
      return { ...msg, status: "done", runId: event.runId, finishedAt: now };
    case "session":
    case "chips":
      return msg;
  }
}

/** Closes a message that ended without a `done` event (network drop, abort). */
export const finish = (msg: AssistantMessage, now = Date.now()): AssistantMessage =>
  msg.status === "done" ? msg : { ...msg, status: "done", finishedAt: now, tools: msg.tools.map((t) => (t.status === "running" ? { ...t, status: "failed" } : t)) };

/** Friendly progress labels for tools that are still running. */
export const TOOL_LABELS: Record<string, string> = {
  searchKnowledgeBase: "Checking our help center",
  searchProducts: "Searching products",
  checkStock: "Checking stock",
  getOrderStatus: "Looking up your order",
  checkReturnEligibility: "Checking return eligibility",
  createReturn: "Creating your return",
};
