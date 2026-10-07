import { CardView } from "@/components/cards/CardView";
import { Chip } from "@/components/ui";
import { linkCitations } from "@/lib/citations";
import { TOOL_LABELS, type AssistantMessage, type UserMessage } from "@/lib/messages";
import { Markdown } from "./Markdown";

export function UserBubble({ message }: { message: UserMessage }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-white">{message.text}</p>
    </div>
  );
}

function TypingDots() {
  return (
    <span role="status" className="inline-flex items-center gap-1 py-2" aria-label="Assistant is typing">
      {[0, 150, 300].map((d) => (
        <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-stone-400" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

type Props = {
  message: AssistantMessage;
  isLast: boolean;
  busy: boolean;
  suggestions: string[];
  onAsk: (text: string) => void;
  onRetry: () => void;
};

export function AssistantBubble({ message, isLast, busy, suggestions, onAsk, onRetry }: Props) {
  const streaming = message.status === "streaming";
  // Activity only shows while the turn is live, so a dropped tool-end can't leave a stale spinner.
  const running = streaming ? message.tools.filter((t) => t.status === "running") : [];
  const text = linkCitations(message.text, message.status === "done" ? message.citations : []);

  return (
    <div className="flex gap-3">
      <div aria-hidden className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
        S
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {running.length > 0 && (
          <p role="status" className="flex items-center gap-2 text-sm text-stone-500">
            <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            {TOOL_LABELS[running[0]!.name] ?? "Working on it"}…
          </p>
        )}

        {message.cards.map((card, i) => (
          <CardView key={i} card={card} onAsk={onAsk} disabled={busy} />
        ))}

        {text ? (
          <div className="rounded-2xl rounded-tl-md bg-white px-4 py-3 text-stone-800 shadow-sm ring-1 ring-stone-200">
            <Markdown text={text} />
          </div>
        ) : (
          streaming && running.length === 0 && <TypingDots />
        )}

        {message.error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900 ring-1 ring-rose-200">
            <span>{message.error.message}</span>
            {message.error.retryable && isLast && (
              <button type="button" onClick={onRetry} disabled={busy} className="rounded-full bg-rose-700 px-3 py-1 font-medium text-white hover:bg-rose-800 disabled:opacity-50">
                Try again
              </button>
            )}
          </div>
        )}

        {isLast && !busy && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Suggested replies">
            {suggestions.map((s) => (
              <Chip key={s} onClick={() => onAsk(s)}>
                {s}
              </Chip>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
