import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orderTurn, SESSION, sseResponse } from "@/test/fixtures";
import { useChat } from "./useChat";

const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, call: number) => JSON.parse((fetchMock.mock.calls[call]![1] as RequestInit).body as string);

describe("useChat", () => {
  beforeEach(() => localStorage.clear());

  it("streams a turn into messages and keeps the session id for the next turn", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(sseResponse(orderTurn())).mockResolvedValueOnce(sseResponse(orderTurn("Second.")));
    const { result } = renderHook(() => useChat({ fetchImpl: fetchMock }));

    await act(() => result.current.send("Where is O-1042? jane@example.com"));
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({ role: "assistant", status: "done", cards: [{ kind: "order" }] });
    expect(result.current.sessionId).toBe(SESSION);
    expect(bodyOf(fetchMock, 0)).toEqual({ message: "Where is O-1042? jane@example.com" });

    await act(() => result.current.send("thanks"));
    expect(bodyOf(fetchMock, 1)).toEqual({ message: "thanks", sessionId: SESSION });
  });

  it("ignores empty input and sends while busy", async () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useChat({ fetchImpl: fetchMock, persist: false }));
    await act(async () => void result.current.send("   "));
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => void result.current.send("one"));
    act(() => void result.current.send("two"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable error when the network fails, and retry re-sends the question", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(sseResponse(orderTurn("Back online.")));
    const { result } = renderHook(() => useChat({ fetchImpl: fetchMock, persist: false }));

    await act(() => result.current.send("hello"));
    expect(result.current.messages[1]).toMatchObject({ error: { code: "NETWORK", retryable: true }, status: "done" });

    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({ error: null, text: "Back online." });
    expect(bodyOf(fetchMock, 1).message).toBe("hello");
  });

  it("surfaces API validation errors without offering a retry", async () => {
    const error = { error: { code: "INVALID_REQUEST", message: "Message too long." } };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(error), { status: 400 }));
    const { result } = renderHook(() => useChat({ fetchImpl: fetchMock, persist: false }));
    await act(() => result.current.send("x"));
    expect(result.current.messages[1]).toMatchObject({ error: { code: "INVALID_REQUEST", message: "Message too long.", retryable: false } });
  });

  it("stop() aborts the stream and closes the message", async () => {
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal!;
      return new Promise<Response>((_, reject) => signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    });
    const { result } = renderHook(() => useChat({ fetchImpl: fetchMock as never, persist: false }));
    act(() => void result.current.send("long question"));
    await waitFor(() => expect(result.current.busy).toBe(true));
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(signal!.aborted).toBe(true);
    expect(result.current.messages[1]).toMatchObject({ status: "done", error: null });
  });

  it("restores finished history after a reload, and reset() clears it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(orderTurn()));
    const first = renderHook(() => useChat({ fetchImpl: fetchMock }));
    await act(() => first.result.current.send("Where is O-1042?"));
    first.unmount();

    const second = renderHook(() => useChat({ fetchImpl: fetchMock }));
    await waitFor(() => expect(second.result.current.messages).toHaveLength(2));
    expect(second.result.current.sessionId).toBe(SESSION);

    act(() => second.result.current.reset());
    expect(second.result.current.messages).toEqual([]);
    expect(localStorage.getItem("stride-chat-v1")).toBeNull();
  });

  it("survives storage being unavailable (private browsing)", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const { result } = renderHook(() => useChat({ fetchImpl: vi.fn().mockResolvedValue(sseResponse(orderTurn())) }));
    await act(() => result.current.send("hi"));
    expect(result.current.messages).toHaveLength(2);
    spy.mockRestore();
  });
});
