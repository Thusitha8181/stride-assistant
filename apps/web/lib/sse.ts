import { ChatEvent } from "@stride/shared";

/** Parses one SSE frame ("data: {...}" lines) into a contract-valid ChatEvent, or null. */
export function parseFrame(frame: string): ChatEvent | null {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    const parsed = ChatEvent.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Reads a text/event-stream body and yields contract-valid events as they arrive.
 * Frames can be split across network chunks; malformed or unknown events are reported
 * through `onInvalid` and skipped, so one bad frame never breaks the conversation.
 */
export async function* readChatEvents(
  body: ReadableStream<Uint8Array>,
  onInvalid?: (frame: string) => void,
): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const drain = function* (final: boolean): Generator<ChatEvent> {
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = final ? "" : frames.pop()!;
    for (const frame of frames) {
      if (!frame.trim()) continue;
      const event = parseFrame(frame);
      if (event) yield event;
      else onInvalid?.(frame);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      yield* drain(false);
    }
    buffer += decoder.decode();
    yield* drain(true);
  } finally {
    reader.releaseLock();
  }
}
