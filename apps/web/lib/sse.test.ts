import { describe, expect, it } from "vitest";
import type { ChatEvent } from "@stride/shared";
import { orderTurn, sseResponse } from "@/test/fixtures";
import { parseFrame, readChatEvents } from "./sse";

const collect = async (res: Response, onInvalid?: (f: string) => void) => {
  const out: ChatEvent[] = [];
  for await (const e of readChatEvents(res.body!, onInvalid)) out.push(e);
  return out;
};

describe("readChatEvents", () => {
  it.each([1, 7, 37, 10_000])("reassembles frames split across %i-byte chunks", async (chunk) => {
    expect(await collect(sseResponse(orderTurn(), chunk))).toEqual(orderTurn());
  });

  it("skips malformed JSON and unknown events, reporting them, without breaking the stream", async () => {
    const invalid: string[] = [];
    const res = sseResponse([orderTurn()[0]!, "{not json", '{"type":"debug","x":1}', { type: "text-delta", delta: "ok" }]);
    const events = await collect(res, (f) => invalid.push(f));
    expect(events.map((e) => e.type)).toEqual(["session", "text-delta"]);
    expect(invalid).toHaveLength(2);
  });

  it("handles a final frame without a trailing blank line", async () => {
    const body = new Response(`data: ${JSON.stringify({ type: "text-delta", delta: "end" })}`).body!;
    const events: ChatEvent[] = [];
    for await (const e of readChatEvents(body)) events.push(e);
    expect(events).toEqual([{ type: "text-delta", delta: "end" }]);
  });
});

describe("parseFrame", () => {
  it("ignores comments and non-data lines", () => {
    expect(parseFrame(': keep-alive\nevent: x\ndata: {"type":"text-delta","delta":"a"}')).toEqual({ type: "text-delta", delta: "a" });
    expect(parseFrame(": keep-alive")).toBeNull();
  });
});
