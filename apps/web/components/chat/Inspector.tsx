import type { Message } from "@/lib/messages";

/**
 * Demo panel (PRD §4.2): what the agent did on each turn: tools and their results,
 * cards, citations, errors, latency and the LangSmith run id.
 */
export function Inspector({ messages, sessionId, onClose }: { messages: Message[]; sessionId: string | null; onClose: () => void }) {
  const turns = messages.flatMap((m) => (m.role === "assistant" ? [m] : []));
  return (
    <aside aria-label="Inspector" className="flex h-full w-full flex-col border-l border-stone-200 bg-stone-50 md:w-96">
      <header className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
        <div>
          <h2 className="font-semibold text-stone-900">Inspector</h2>
          <p className="text-xs text-stone-500">What the agent did, per turn</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-stone-600 hover:bg-stone-200">
          Close
        </button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        <p className="break-all text-xs text-stone-500">Session: {sessionId ?? "none yet"}</p>
        {turns.length === 0 && <p className="text-stone-500">Send a message to see tool calls, failure codes and timings.</p>}
        {turns.map((t, i) => (
          <section key={t.id} className="rounded-xl bg-white p-3 ring-1 ring-stone-200">
            <p className="mb-2 font-medium text-stone-800">
              {i + 1}. “{t.replyTo.length > 60 ? `${t.replyTo.slice(0, 60)}…` : t.replyTo}”
            </p>
            <ul className="space-y-1">
              {t.tools.map((tool) => (
                <li key={tool.id} className="flex justify-between gap-2 font-mono text-xs">
                  <span>{tool.name}</span>
                  <span className={tool.status === "ok" ? "text-emerald-700" : tool.status === "running" ? "text-stone-500" : "text-rose-700"}>
                    {tool.status === "ok" ? "ok" : tool.status === "running" ? "…" : (tool.code ?? "failed")}
                  </span>
                </li>
              ))}
              {t.tools.length === 0 && <li className="text-xs text-stone-500">No tools</li>}
            </ul>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-stone-600">
              {t.cards.length > 0 && (
                <>
                  <dt>Cards</dt>
                  <dd>{t.cards.map((c) => c.kind).join(", ")}</dd>
                </>
              )}
              {t.citations.length > 0 && (
                <>
                  <dt>Cited</dt>
                  <dd className="break-all">{t.citations.map((c) => c.id).join(", ")}</dd>
                </>
              )}
              {t.error && (
                <>
                  <dt>Error</dt>
                  <dd className="text-rose-700">{t.error.code}</dd>
                </>
              )}
              {t.finishedAt && (
                <>
                  <dt>Time</dt>
                  <dd>{((t.finishedAt - t.startedAt) / 1000).toFixed(1)}s</dd>
                </>
              )}
              {t.runId && (
                <>
                  <dt>Run</dt>
                  <dd className="break-all font-mono">{t.runId}</dd>
                </>
              )}
            </dl>
          </section>
        ))}
      </div>
    </aside>
  );
}
