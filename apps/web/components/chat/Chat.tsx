"use client";

import { useEffect, useRef, useState } from "react";
import { Chip } from "@/components/ui";
import { suggestionsFor, STARTER_CHIPS } from "@/lib/suggestions";
import { useChat, type UseChatOptions } from "@/lib/useChat";
import { Composer } from "./Composer";
import { Inspector } from "./Inspector";
import { AssistantBubble, UserBubble } from "./MessageView";

export function Chat(options: UseChatOptions) {
  const { messages, sessionId, busy, send, retry, stop, reset } = useChat(options);
  const [inspector, setInspector] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest content in view while answers stream in.
  const last = messages.at(-1);
  const progress = last?.role === "assistant" ? `${last.text.length}:${last.cards.length}:${last.tools.length}` : messages.length;
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages.length, progress]);

  return (
    <div className="flex h-dvh">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <div aria-hidden className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand font-bold text-white">
              S
            </div>
            <div>
              <h1 className="font-semibold leading-tight text-stone-900">Stride Assistant</h1>
              <p className="hidden text-xs text-stone-500 sm:block">Products, orders &amp; returns</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setInspector((v) => !v)} aria-pressed={inspector} className="whitespace-nowrap rounded-xl px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100">
              Inspector
            </button>
            <button type="button" onClick={reset} disabled={!messages.length} className="whitespace-nowrap rounded-xl border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-40">
              New chat
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div role="log" aria-live="polite" aria-label="Conversation" className="mx-auto max-w-3xl space-y-5 px-4 py-6">
            {messages.length > 0 && <h2 className="sr-only">Conversation</h2>}
            {messages.length === 0 && (
              <section className="py-10 text-center">
                <h2 className="text-2xl font-bold text-brand-ink">Hi! How can I help?</h2>
                <p className="mt-2 text-stone-600">Ask about our shoes, track an order, or start a return.</p>
                <div className="mt-6 flex flex-wrap justify-center gap-2" aria-label="Suggested questions">
                  {STARTER_CHIPS.map((c) => (
                    <Chip key={c} onClick={() => send(c)}>
                      {c}
                    </Chip>
                  ))}
                </div>
                <p className="mt-8 text-xs text-stone-400">Demo with fake data. Try order O-1042 with jane@example.com.</p>
              </section>
            )}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <UserBubble key={m.id} message={m} />
              ) : (
                <AssistantBubble
                  key={m.id}
                  message={m}
                  isLast={i === messages.length - 1}
                  busy={busy}
                  suggestions={suggestionsFor(m)}
                  onAsk={send}
                  onRetry={retry}
                />
              ),
            )}
            <div ref={endRef} />
          </div>
        </main>

        <Composer busy={busy} onSend={send} onStop={stop} />
      </div>

      {inspector && (
        <div className="fixed inset-0 z-10 md:static md:inset-auto">
          <Inspector messages={messages} sessionId={sessionId} onClose={() => setInspector(false)} />
        </div>
      )}
    </div>
  );
}
