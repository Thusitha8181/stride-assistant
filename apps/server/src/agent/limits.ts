import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

export const TOOL_ROUND_LIMIT_MIDDLEWARE = "ToolRoundLimit";
export const LIMIT_MESSAGE = "I couldn't finish working that out. Could you rephrase or break it into smaller questions?";

/**
 * Caps tool-calling rounds per turn (PRD §6: max 5 iterations). Runs after each model
 * call and BEFORE tools execute, so a 6th round's tools never run (createReturn included).
 *
 * Instead of throwing, it replaces the runaway message (same id, no tool calls) and ends
 * the turn. Throwing would leave an AI tool call without a tool result in the session's
 * memory, which providers reject on the next turn.
 */
export function toolRoundLimitMiddleware(maxRounds: number) {
  return createMiddleware({
    name: TOOL_ROUND_LIMIT_MIDDLEWARE,
    afterModel: {
      canJumpTo: ["end"],
      hook: (state) => {
        const messages = state.messages;
        const last = messages.at(-1);
        if (!last || !AIMessage.isInstance(last) || !last.tool_calls?.length) return;

        const turnStart = messages.findLastIndex((m) => HumanMessage.isInstance(m));
        const modelCallsThisTurn = messages.slice(turnStart + 1).filter((m) => AIMessage.isInstance(m)).length;
        if (modelCallsThisTurn <= maxRounds) return;

        return { messages: [new AIMessage({ id: last.id, content: LIMIT_MESSAGE })], jumpTo: "end" };
      },
    },
  });
}
