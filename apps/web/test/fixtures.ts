import type { Card, ChatEvent, OrderView, ProductHit, StockResult } from "@stride/shared";

export const SESSION = "3b241101-e2bb-4255-8caf-4136c566a962";
export const RUN = "6ed79d82-8d36-44ee-b594-b1cbcf0fdbd1";

export const order: OrderView = {
  orderId: "O-1042",
  status: "shipped",
  placedAt: "2026-10-05T12:00:00.000Z",
  items: [
    { itemId: "O-1042-1", productId: "P-006", name: "Trail Runner X", size: 10, width: "standard", color: "Black", quantity: 1, unitPrice: 129, finalSale: false, status: "shipped" },
  ],
  timeline: [
    { status: "ordered", at: "2026-10-05T12:00:00.000Z" },
    { status: "shipped", at: "2026-10-06T12:00:00.000Z" },
  ],
  estimatedDelivery: "2026-10-09T12:00:00.000Z",
  carrier: "UPS",
  trackingNumber: "1Z999AA10000000142",
  destination: "Austin, TX",
  totals: { subtotal: 129, shipping: 0, total: 129 },
};

export const soldOut: StockResult = {
  ok: true,
  product: { id: "P-006", name: "Trail Runner X", price: 129 },
  requested: { size: 10, width: "wide", color: null },
  available: false,
  quantity: 0,
  alternatives: {
    nearbySizes: [{ size: 10.5, width: "wide", color: "Black", qty: 4 }],
    otherWidths: [{ size: 10, width: "standard", color: "Black", qty: 6 }],
    otherColors: [],
    similarProducts: [{ id: "P-007", name: "Trail Runner Y", price: 115 }],
  },
};

export const product = (over: Partial<ProductHit> = {}): ProductHit => ({
  id: "P-004",
  name: "Daily Jog",
  category: "running",
  price: 85,
  description: "Affordable, durable running shoe.",
  colors: ["Navy"],
  widths: ["standard", "wide"],
  sizes: [6, 13],
  inStockSizes: [6, 13],
  score: 0.8,
  ...over,
});

export const orderCard: Card = { kind: "order", order };

/** A complete, contract-valid turn: tool call, card, streamed text with a citation, done. */
export const orderTurn = (text = "Your order has **shipped** [[shipping#tracking-your-order]]."): ChatEvent[] => [
  { type: "session", sessionId: SESSION },
  { type: "tool-start", toolCallId: "c1", name: "getOrderStatus" },
  { type: "tool-end", toolCallId: "c1", name: "getOrderStatus", ok: true, code: null },
  { type: "card", card: orderCard },
  ...text.match(/.{1,8}/gs)!.map((delta) => ({ type: "text-delta" as const, delta })),
  { type: "citation", sources: [{ id: "shipping#tracking-your-order", title: "Shipping: Tracking your order" }] },
  { type: "done", sessionId: SESSION, runId: RUN },
];

/**
 * A streaming SSE Response. `chunk` splits the byte stream at arbitrary points so frames
 * arrive across chunk boundaries, like on a real network.
 */
export function sseResponse(events: Array<ChatEvent | string>, chunk = 37): Response {
  const body = events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(bytes.slice(i, i + chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
