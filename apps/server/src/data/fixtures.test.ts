import { describe, expect, it } from "vitest";
import { loadCompanyDocs, loadOrders, loadProducts } from "./load";

/** Guards the fake data the demo script, tests and evals depend on. */
describe("fixture integrity", () => {
  const products = loadProducts();
  const orders = loadOrders();
  const byId = new Map(products.map((p) => [p.id, p]));

  it("has the expected catalog and order volume", () => {
    expect(products).toHaveLength(25);
    expect(orders.length).toBeGreaterThanOrEqual(15);
    expect(loadCompanyDocs().length).toBeGreaterThanOrEqual(10);
  });

  it("has unique ids", () => {
    expect(new Set(products.map((p) => p.id)).size).toBe(products.length);
    expect(new Set(orders.map((o) => o.orderId)).size).toBe(orders.length);
  });

  it("every product has an inventory row per color × width × size", () => {
    for (const p of products) expect(p.inventory.length, p.name).toBe(p.colors.length * p.widths.length * p.sizes.length);
  });

  it("every order item references a real product variant", () => {
    for (const o of orders)
      for (const item of o.items) {
        const p = byId.get(item.productId);
        expect(p, item.itemId).toBeDefined();
        expect(item.itemId.startsWith(`${o.orderId}-`)).toBe(true);
        expect(p!.sizes).toContain(item.size);
        expect(p!.widths).toContain(item.width);
        expect(p!.colors).toContain(item.color);
      }
  });

  it("covers every order status", () => {
    const statuses = new Set(orders.map((o) => o.status));
    for (const s of ["processing", "shipped", "out_for_delivery", "delivered", "delayed", "partially_shipped", "cancelled"])
      expect(statuses, s).toContain(s);
  });

  it("keeps the demo script's preconditions (PRD §11)", () => {
    expect(orders.find((o) => o.orderId === "O-1042")?.customer.email).toBe("jane@example.com");
    expect(orders.find((o) => o.orderId === "O-1007")?.items[0]?.deliveredDaysAgo).toBe(45);
    expect(orders.some((o) => o.orderId === "O-1024")).toBe(false);
  });
});
