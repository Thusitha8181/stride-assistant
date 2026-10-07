import { describe, expect, it } from "vitest";
import { OrderView } from "./order";

const validOrder = {
  orderId: "O-1042",
  status: "shipped",
  placedAt: "2026-10-01T10:00:00.000Z",
  items: [
    {
      itemId: "O-1042-1",
      productId: "P-001",
      name: "Trail Runner X",
      size: 10,
      width: "standard",
      color: "Black",
      quantity: 1,
      unitPrice: 129,
      finalSale: false,
      status: "shipped",
    },
  ],
  timeline: [{ status: "ordered", at: "2026-10-01T10:00:00.000Z" }],
  estimatedDelivery: "2026-10-09T18:00:00.000Z",
  carrier: "UPS",
  trackingNumber: "1Z999AA10123456784",
  destination: "Austin, TX",
  totals: { subtotal: 129, shipping: 0, total: 129 },
};

describe("OrderView privacy contract @F16", () => {
  it("accepts a PII-free order", () => {
    expect(OrderView.safeParse(validOrder).success).toBe(true);
  });

  it.each([
    ["customerName", "Jane Doe"],
    ["email", "jane@example.com"],
    ["phone", "+1 512 555 0100"],
    ["shippingAddress", { line1: "12 Main St" }],
    ["payment", { last4: "4242" }],
  ])("rejects an order that carries %s", (field, value) => {
    expect(OrderView.safeParse({ ...validOrder, [field]: value }).success).toBe(false);
  });

  it("rejects PII smuggled into an item", () => {
    const items = [{ ...validOrder.items[0], buyerEmail: "jane@example.com" }];
    expect(OrderView.safeParse({ ...validOrder, items }).success).toBe(false);
  });
});
