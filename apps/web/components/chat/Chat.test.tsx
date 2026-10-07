import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "@stride/shared";
import { expectAccessible } from "@/test/a11y";
import { orderTurn, RUN, SESSION, soldOut, sseResponse } from "@/test/fixtures";
import { Chat } from "./Chat";

const turn = (...events: ChatEvent[]): ChatEvent[] => [{ type: "session", sessionId: SESSION }, ...events, { type: "done", sessionId: SESSION, runId: RUN }];

function setup(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const r of responses) fetchMock.mockResolvedValueOnce(r);
  const view = render(<Chat fetchImpl={fetchMock} persist={false} />);
  return { fetchMock, ...view, user: userEvent.setup() };
}

describe("Chat", () => {
  beforeEach(() => localStorage.clear());

  it("greets with starter chips and is accessible", async () => {
    const { container } = setup();
    expect(screen.getByRole("heading", { name: "Hi! How can I help?" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Suggested questions")).getAllByRole("button")).toHaveLength(5);
    await expectAccessible(container);
  });

  it("sends a starter chip, streams the answer with a card, citation pill and follow-up chips", async () => {
    const { user, fetchMock, container } = setup(sseResponse(orderTurn()));
    await user.click(screen.getByRole("button", { name: "Track my order" }));

    expect(await screen.findByRole("region", { name: "Order O-1042" })).toBeInTheDocument();
    expect(await screen.findByText("Tracking your order")).toBeInTheDocument(); // citation pill
    expect(screen.queryByText(/\[\[/)).not.toBeInTheDocument(); // no raw markers
    expect(screen.getByText("shipped", { selector: "strong" })).toBeInTheDocument(); // markdown bold
    expect(within(screen.getByLabelText("Suggested replies")).getByRole("button", { name: "Track another order" })).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).message).toBe("Track my order");
    await expectAccessible(container);
  });

  it("sends typed messages with Enter, and keeps Shift+Enter for new lines", async () => {
    const { user, fetchMock } = setup(sseResponse(turn({ type: "text-delta", delta: "Hello!" })));
    const box = screen.getByLabelText("Message the Stride assistant");
    await user.type(box, "first line{Shift>}{Enter}{/Shift}second line");
    expect(fetchMock).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).message).toBe("first line\nsecond line");
    expect(await screen.findByText("Hello!")).toBeInTheDocument();
    expect(box).toHaveValue("");
  });

  it("lets the customer tap a sold-out alternative to ask about it @F8", async () => {
    const { user, fetchMock } = setup(
      sseResponse(turn({ type: "card", card: { kind: "stock", stock: soldOut } }, { type: "text-delta", delta: "Sold out in 10 wide." })),
      sseResponse(turn({ type: "text-delta", delta: "Yes, 4 in stock." })),
    );
    await user.type(screen.getByLabelText("Message the Stride assistant"), "Trail Runner X in 10 wide?{Enter}");
    await user.click(await screen.findByRole("button", { name: "10.5 wide · Black" }));
    expect(await screen.findByText("Yes, 4 in stock.")).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ message: "Is the Trail Runner X available in 10.5 wide in Black?", sessionId: SESSION });
  });

  it("shows a friendly error with Try again, and retrying recovers @F1", async () => {
    const { user } = setup(
      sseResponse(turn({ type: "error", code: "MODEL_UNAVAILABLE", message: "I'm having trouble thinking right now.", retryable: true })),
      sseResponse(turn({ type: "text-delta", delta: "Here you go." })),
    );
    await user.type(screen.getByLabelText("Message the Stride assistant"), "hi{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("I'm having trouble thinking right now.");
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Here you go.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByText("hi")).toHaveLength(1);
  });

  it("does not offer a retry for non-retryable errors", async () => {
    const { user } = setup(sseResponse(turn({ type: "error", code: "AGENT_LIMIT", message: "Could you rephrase?", retryable: false })));
    await user.type(screen.getByLabelText("Message the Stride assistant"), "x{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could you rephrase?");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("shows tool activity while the agent works", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(c) {
        c.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "session", sessionId: SESSION })}\n\ndata: ${JSON.stringify({ type: "tool-start", toolCallId: "t", name: "checkStock" })}\n\n`));
        await gate;
        c.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", sessionId: SESSION, runId: RUN })}\n\n`));
        c.close();
      },
    });
    const { user } = setup(new Response(stream));
    await user.type(screen.getByLabelText("Message the Stride assistant"), "stock?{Enter}");
    expect(await screen.findByText(/Checking stock/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    release();
    await waitFor(() => expect(screen.queryByText(/Checking stock/)).not.toBeInTheDocument());
  });

  it("opens the inspector with tool calls, failure codes and the run id", async () => {
    const { user } = setup(
      sseResponse(
        turn(
          { type: "tool-start", toolCallId: "t", name: "getOrderStatus" },
          { type: "tool-end", toolCallId: "t", name: "getOrderStatus", ok: false, code: "UNVERIFIED" },
          { type: "text-delta", delta: "Those details don't match." },
        ),
      ),
    );
    await user.type(screen.getByLabelText("Message the Stride assistant"), "O-1042 bob@example.com{Enter}");
    await screen.findByText("Those details don't match.");
    await user.click(screen.getByRole("button", { name: "Inspector" }));
    const panel = screen.getByRole("complementary", { name: "Inspector" });
    expect(within(panel).getByText("UNVERIFIED")).toBeInTheDocument();
    expect(within(panel).getByText(RUN)).toBeInTheDocument();
    await expectAccessible(panel);
  });

  it("New chat clears the conversation", async () => {
    const { user } = setup(sseResponse(orderTurn()));
    await user.click(screen.getByRole("button", { name: "Track my order" }));
    await screen.findByRole("region", { name: "Order O-1042" });
    await user.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.getByRole("heading", { name: "Hi! How can I help?" })).toBeInTheDocument();
  });
});
