"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { MAX_MESSAGE_CHARS } from "@stride/shared";

type Props = { busy: boolean; onSend: (text: string) => void; onStop: () => void };

export function Composer({ busy, onSend, onStop }: Props) {
  const [text, setText] = useState("");
  const remaining = MAX_MESSAGE_CHARS - text.length;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    onSend(text);
    setText("");
  };

  // Enter sends; Shift+Enter adds a new line.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  };

  return (
    <form onSubmit={submit} className="border-t border-stone-200 bg-white/90 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <label htmlFor="composer" className="sr-only">
          Message the Stride assistant
        </label>
        <textarea
          id="composer"
          rows={1}
          value={text}
          maxLength={MAX_MESSAGE_CHARS}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type your question…"
          className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-stone-900 placeholder:text-stone-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        {busy ? (
          <button type="button" onClick={onStop} className="h-11 rounded-2xl border border-stone-300 px-4 font-medium text-stone-700 hover:bg-stone-50">
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!text.trim()} className="h-11 rounded-2xl bg-brand px-5 font-medium text-white hover:bg-brand-ink disabled:cursor-not-allowed disabled:opacity-40">
            Send
          </button>
        )}
      </div>
      {remaining < 200 && (
        <p className="mx-auto mt-1 max-w-3xl text-right text-xs text-stone-500" aria-live="polite">
          {remaining} characters left
        </p>
      )}
    </form>
  );
}
