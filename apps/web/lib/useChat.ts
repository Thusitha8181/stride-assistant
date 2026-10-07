"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@stride/shared";
import { applyEvent, finish, newAssistantMessage, type AssistantMessage, type Message } from "./messages";
import { readChatEvents } from "./sse";
import { clearChat, loadChat, saveChat } from "./storage";

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()));

export type UseChatOptions = { endpoint?: string; fetchImpl?: typeof fetch; persist?: boolean };

/**
 * Chat state + transport. Sends a turn to POST /api/chat, folds the streamed events into
 * the assistant message, keeps the server session id, and persists finished history.
 */
export function useChat({ endpoint = "/api/chat", fetchImpl, persist = true }: UseChatOptions = {}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(!persist);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string | null>(null);

  // Restore after mount (localStorage isn't available during server rendering).
  useEffect(() => {
    if (!persist) return;
    const stored = loadChat();
    if (stored) {
      setMessages(stored.messages);
      setSessionId(stored.sessionId);
      sessionRef.current = stored.sessionId;
    }
    setRestored(true);
  }, [persist]);

  useEffect(() => {
    if (!persist || !restored) return;
    if (messages.length || sessionId) saveChat({ sessionId, messages });
    else clearChat();
  }, [persist, restored, sessionId, messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const updateAssistant = (id: string, fn: (m: AssistantMessage) => AssistantMessage) =>
    setMessages((ms) => ms.map((m) => (m.id === id && m.role === "assistant" ? fn(m) : m)));

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || abortRef.current) return;

      const assistantId = newId();
      setMessages((ms) => [...ms, { id: newId(), role: "user", text }, newAssistantMessage(assistantId, text)]);
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;

      const fail = (code: "NETWORK" | "INVALID_REQUEST", message: string, retryable: boolean) =>
        updateAssistant(assistantId, (m) => finish({ ...m, error: { code, message, retryable } }));

      try {
        const res = await (fetchImpl ?? fetch)(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, ...(sessionRef.current && { sessionId: sessionRef.current }) }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const body = ApiError.safeParse(await res.json().catch(() => null));
          if (res.status >= 400 && res.status < 500 && body.success) fail("INVALID_REQUEST", body.data.error.message, false);
          else fail("NETWORK", "The assistant is unavailable right now. Please try again.", true);
          return;
        }

        for await (const event of readChatEvents(res.body)) {
          if (event.type === "session") {
            sessionRef.current = event.sessionId;
            setSessionId(event.sessionId);
          }
          updateAssistant(assistantId, (m) => applyEvent(m, event));
        }
        updateAssistant(assistantId, (m) => finish(m));
      } catch {
        if (controller.signal.aborted) updateAssistant(assistantId, (m) => finish(m));
        else fail("NETWORK", "Can't reach the assistant. Check your connection and try again.", true);
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [endpoint, fetchImpl],
  );

  /** Re-sends the question behind the last failed answer. */
  const retry = useCallback(() => {
    const last = messages.at(-1);
    if (busy || !last || last.role !== "assistant" || !last.error) return;
    setMessages((ms) => ms.slice(0, -2));
    void send(last.replyTo);
  }, [busy, messages, send]);

  /** Stops the answer being streamed (also stops the agent server-side). */
  const stop = useCallback(() => abortRef.current?.abort(), []);

  /** Starts a fresh conversation (new server session, no memory). */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setSessionId(null);
    sessionRef.current = null;
    if (persist) clearChat();
  }, [persist]);

  return { messages, sessionId, busy, send, retry, stop, reset };
}
