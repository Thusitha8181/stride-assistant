import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChatEvent } from "@stride/shared";
import "../../src/env";
import { loadConfig } from "../../src/config";
import { createChatModel } from "../../src/llm/models";
import { runChatTurn } from "../../src/chat/turn";
import { agentSetup, collect } from "../helpers";

/**
 * Opt-in smoke tests against the real model provider (costs tokens, non-deterministic).
 * Runs only when GROQ_API_KEY is set. Uses in-memory retrieval, so no Qdrant needed.
 * Behavior quality is measured properly by the eval suite (Milestone 3); these only
 * prove the wiring works end to end.
 */
describe.skipIf(!process.env.GROQ_API_KEY)("live agent (Groq)", { timeout: 60_000 }, () => {
  const run = async (...messages: string[]) => {
    const { agent, sources } = agentSetup(await createChatModel(loadConfig(), "primary"));
    const sessionId = randomUUID();
    let events: ChatEvent[] = [];
    for (const message of messages) events = await collect(runChatTurn({ agent, sources }, { sessionId, message }));
    const text = events.flatMap((e) => (e.type === "text-delta" ? [e.delta] : [])).join("");
    return { events, text };
  };

  it("looks up an order with the tool and shows an order card", async () => {
    const { events, text } = await run("Where is my order O-1042? My email is jane@example.com");
    expect(events).toContainEqual(expect.objectContaining({ type: "tool-start", name: "getOrderStatus" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "card", card: expect.objectContaining({ kind: "order" }) }));
    expect(text.length).toBeGreaterThan(10);
  });

  it("answers a policy question from the knowledge base", async () => {
    const { events } = await run("How long do I have to return shoes?");
    expect(events).toContainEqual(expect.objectContaining({ type: "tool-start", name: "searchKnowledgeBase" }));
    expect(events.at(-1)?.type).toBe("done");
  });

  it("asks for the email instead of guessing it", async () => {
    const { events } = await run("Where is order O-1042?");
    expect(events.some((e) => e.type === "tool-start" && e.name === "getOrderStatus")).toBe(false);
  });
});
