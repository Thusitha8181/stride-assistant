import { describe, expect, it } from "vitest";
import { clock, findPii, orderFixture, setup } from "../../test/helpers";
import { loadOrders } from "../data/load";

describe("OrderService.verify", () => {
  const { orders } = setup();

  it("verifies a matching order id and email", () => {
    expect(orders.verify("O-1042", "jane@example.com")).toMatchObject({ kind: "ok" });
  });

  it("rejects a mismatched email without revealing the order @F6", () => {
    expect(orders.verify("O-1042", "bob@example.com")).toEqual({ kind: "unverified" });
  });

  it("suggests a transposed order id that belongs to the same email @F5", () => {
    expect(orders.verify("O-1024", "jane@example.com")).toEqual({ kind: "not_found", suggestions: ["O-1042"] });
  });

  it("never suggests other customers' order ids @F5 @F16", () => {
    // O-1024 is one transposition away from Jane's O-1042, but Bob must not learn that it exists.
    expect(orders.verify("O-1024", "bob@example.com")).toEqual({ kind: "not_found", suggestions: [] });
  });

  it("does not suggest ids more than one edit away @F5", () => {
    expect(orders.verify("O-1099", "jane@example.com")).toEqual({ kind: "not_found", suggestions: [] });
  });
});

describe("OrderService.toView", () => {
  const { orders } = setup();

  it("builds absolute dates from relative fixture data", () => {
    const view = orders.toView(orderFixture("O-1042"));
    expect(view.placedAt).toBe("2026-10-05T12:00:00.000Z");
    expect(view.estimatedDelivery).toBe("2026-10-09T12:00:00.000Z");
    expect(view.timeline.map((t) => t.status)).toEqual(["ordered", "shipped"]);
  });

  it("resolves item names from the catalog and computes totals", () => {
    const view = orders.toView(orderFixture("O-1031"));
    expect(view.items[0]).toMatchObject({ name: "Canvas Low", status: "cancelled" });
    expect(view.totals).toEqual({ subtotal: 55, shipping: 6.95, total: 61.95 });
  });

  it("exposes the destination at city level only", () => {
    expect(orders.toView(orderFixture("O-1042")).destination).toBe("Austin, TX");
  });

  it.each(loadOrders().map((o) => o.orderId))("contains no PII for %s @F16", (orderId) => {
    expect(findPii(orders.toView(orderFixture(orderId)))).toEqual([]);
  });

  it("uses the injected clock", () => {
    expect(clock.now().toISOString()).toBe("2026-10-07T12:00:00.000Z");
  });
});
