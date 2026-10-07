/**
 * Terminal chat client for the running API (the web UI arrives in Milestone 5).
 *
 *   npm run dev          # terminal 1: API on :4000
 *   npm run chat         # terminal 2
 *
 * Shows streamed text plus tool calls, cards and citations so you can see what the agent did.
 * Commands: /new (fresh session), /quit.
 */
import { createInterface } from "node:readline/promises";
import { ChatEvent, type Card } from "@stride/shared";

const API = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

function describeCard(card: Card): string {
  switch (card.kind) {
    case "products":
      return card.products.map((p) => `${p.name} $${p.price}`).join(" · ");
    case "stock":
      return `${card.stock.product.name} size ${card.stock.requested.size} ${card.stock.requested.width}: ${card.stock.available ? `in stock (${card.stock.quantity})` : "sold out"}`;
    case "order":
      return `${card.order.orderId} ${card.order.status} → ${card.order.destination}, ${card.order.items.length} item(s), $${card.order.totals.total}`;
    case "return-eligibility":
      return `${card.eligibility.item.name}: ${card.eligibility.eligible ? `eligible (${card.eligibility.daysLeft} days left)` : `not eligible (${card.eligibility.reason})`}`;
    case "return-created":
      return `${card.result.rma} ${card.result.type}${card.result.refundAmount ? ` $${card.result.refundAmount}` : ""}`;
  }
}

async function send(message: string, sessionId: string | undefined): Promise<string | undefined> {
  const res = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, ...(sessionId && { sessionId }) }),
  });
  if (!res.ok || !res.body) {
    console.log(red(`HTTP ${res.status}: ${await res.text()}`));
    return sessionId;
  }

  process.stdout.write(bold("stride › "));
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of res.body) {
    buffer += decoder.decode(bytes, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop()!;
    for (const frame of frames) {
      if (!frame.startsWith("data: ")) continue;
      const event = ChatEvent.parse(JSON.parse(frame.slice(6)));
      switch (event.type) {
        case "session":
          sessionId = event.sessionId;
          break;
        case "text-delta":
          process.stdout.write(event.delta);
          break;
        case "tool-start":
          process.stdout.write(dim(`\n  ⚙ ${event.name}… `));
          break;
        case "tool-end":
          process.stdout.write(dim(event.ok ? "ok\n" : `${event.code}\n`));
          break;
        case "card":
          console.log(dim(`  ▣ ${event.card.kind}: ${describeCard(event.card)}`));
          break;
        case "citation":
          console.log(dim(`\n  📎 ${event.sources.map((s) => s.title).join(" · ")}`));
          break;
        case "chips":
          console.log(dim(`  ➜ ${event.chips.join(" | ")}`));
          break;
        case "error":
          console.log(red(`\n  ✖ ${event.code}: ${event.message}${event.retryable ? " (retryable)" : ""}`));
          break;
        case "done":
          console.log(dim(`\n  run ${event.runId}`));
          break;
      }
    }
  }
  return sessionId;
}

const health = (await fetch(`${API}/api/health`)
  .then((r) => r.json())
  .catch(() => null)) as { status: string } | null;
if (!health) {
  console.error(red(`Can't reach the API at ${API}. Start it with: npm run dev`));
  process.exit(1);
}
console.log(bold("Stride assistant") + dim(` (${health.status}) · /new for a fresh session · /quit to exit\n`));

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: bold("you › ") });
let sessionId: string | undefined;
rl.prompt();
// Line iteration (rather than rl.question) also ends cleanly on Ctrl-D or piped input.
for await (const line of rl) {
  const message = line.trim();
  if (message === "/quit") break;
  if (message === "/new") {
    sessionId = undefined;
    console.log(dim("  new session\n"));
  } else if (message) {
    sessionId = await send(message, sessionId);
    console.log();
  }
  rl.prompt();
}
rl.close();
