import { describe, expect, it } from "vitest";
import {
  CheckReturnEligibilityOutput,
  CheckStockOutput,
  CreateReturnOutput,
  GetOrderStatusOutput,
  SearchKnowledgeBaseOutput,
  SearchProductsOutput,
} from "@stride/shared";
import { failingIndex, findPii, setup } from "../../test/helpers";
import { loadOrders } from "../data/load";

const JANE = { orderId: "O-1042", email: "jane@example.com" };

describe("searchKnowledgeBase", () => {
  it("returns ranked chunks with stable ids and scores", async () => {
    const { tools } = setup();
    const r = SearchKnowledgeBaseOutput.parse(await tools.searchKnowledgeBase({ query: "final sale items return" }));
    if (!r.ok) throw new Error("expected ok");
    expect(r.chunks).toHaveLength(4);
    expect(r.chunks[0]!.id).toBe("returns-policy#final-sale-items");
    expect(r.topScore).toBe(r.chunks[0]!.score);
  });

  it("degrades to BACKEND_UNAVAILABLE when the vector store is down @F4", async () => {
    const { tools } = setup({ knowledge: failingIndex });
    expect(await tools.searchKnowledgeBase({ query: "returns" })).toMatchObject({ ok: false, code: "BACKEND_UNAVAILABLE" });
  });

  it("rejects invalid input @F3", async () => {
    const { tools } = setup();
    await expect(tools.searchKnowledgeBase({ query: "   " })).rejects.toThrow();
  });
});

describe("searchProducts", () => {
  it("applies category and price filters", async () => {
    const { tools } = setup();
    const r = SearchProductsOutput.parse(await tools.searchProducts({ query: "waterproof shoe", category: "trail", maxPrice: 130 }));
    if (!r.ok) throw new Error("expected ok");
    expect(r.products.length).toBeGreaterThan(0);
    expect(r.products.every((p) => p.category === "trail" && p.price <= 130)).toBe(true);
    expect(r.products.map((p) => p.name)).toContain("Trail Runner X");
  });

  it("flags in-stock status for a requested size and lists in-stock products first", async () => {
    const { tools } = setup();
    const r = SearchProductsOutput.parse(await tools.searchProducts({ query: "race marathon carbon plate", category: "running", size: 9 }));
    if (!r.ok) throw new Error("expected ok");
    expect(r.products.every((p) => p.inStockInRequestedSize !== undefined)).toBe(true);
    const flags = r.products.map((p) => p.inStockInRequestedSize);
    expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
    expect(r.products.find((p) => p.name === "Tempo Pro")?.inStockInRequestedSize).toBe(false);
  });

  it("returns at most 5 products", async () => {
    const { tools } = setup();
    const r = await tools.searchProducts({ query: "shoe" });
    if (r.ok) expect(r.products.length).toBeLessThanOrEqual(5);
  });

  it("degrades to BACKEND_UNAVAILABLE when the vector store is down @F4", async () => {
    const { tools } = setup({ products: failingIndex });
    expect(await tools.searchProducts({ query: "boots" })).toMatchObject({ ok: false, code: "BACKEND_UNAVAILABLE" });
  });
});

describe("checkStock", () => {
  it("returns a schema-valid result for the F8 demo case @F8", async () => {
    const { tools } = setup();
    const r = CheckStockOutput.parse(await tools.checkStock({ product: "Trail Runner X", size: 10, width: "wide" }));
    expect(r).toMatchObject({ ok: true, available: false });
  });

  it("rejects hallucinated arguments @F3", async () => {
    const { tools } = setup();
    // @ts-expect-error: unknown argument on purpose
    await expect(tools.checkStock({ product: "P-006", size: 10, gender: "men" })).rejects.toThrow();
  });
});

describe("getOrderStatus", () => {
  it("returns a PII-free order view for a verified customer", async () => {
    const { tools } = setup();
    const r = GetOrderStatusOutput.parse(await tools.getOrderStatus({ orderId: " o-1042", email: "JANE@example.com " }));
    expect(r).toMatchObject({ ok: true, order: { orderId: "O-1042", status: "shipped", destination: "Austin, TX" } });
    expect(findPii(r)).toEqual([]);
  });

  it("refuses a wrong email without leaking order details @F6", async () => {
    const { tools } = setup();
    const r = await tools.getOrderStatus({ orderId: "O-1042", email: "bob@example.com" });
    expect(r).toEqual({ ok: false, code: "UNVERIFIED", message: expect.any(String) });
    expect(JSON.stringify(r)).not.toMatch(/Trail Runner|shipped|Austin/);
  });

  it("suggests the customer's own order for a typo @F5", async () => {
    const { tools } = setup();
    expect(await tools.getOrderStatus({ orderId: "O-1024", email: "jane@example.com" })).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
      suggestions: ["O-1042"],
    });
  });

  it("rejects malformed order ids @F3", async () => {
    const { tools } = setup();
    await expect(tools.getOrderStatus({ orderId: "1042", email: "jane@example.com" })).rejects.toThrow();
  });
});

describe("checkReturnEligibility", () => {
  it("approves an item inside the window", async () => {
    const { tools } = setup();
    const r = CheckReturnEligibilityOutput.parse(
      await tools.checkReturnEligibility({ orderId: "O-1046", email: "jane@example.com", itemId: "O-1046-1" }),
    );
    expect(r).toMatchObject({ ok: true, eligible: true, daysLeft: 18, item: { name: "Everyday Knit Sneaker" } });
  });

  it("explains the window for the 45-day-old boots in the demo @F7", async () => {
    const { tools } = setup();
    const r = await tools.checkReturnEligibility({ orderId: "O-1007", email: "sam.lee@example.com", itemId: "O-1007-1" });
    expect(r).toMatchObject({
      ok: true,
      eligible: false,
      reason: "OUTSIDE_WINDOW",
      alternatives: ["warranty_claim", "contact_support"],
      item: { name: "Highland Chelsea Boot" },
    });
  });

  it.each([
    ["O-1035", "noah.brown@example.com", "O-1035-1", { eligible: true, daysLeft: 0 }],
    ["O-1038", "olivia.martin@example.com", "O-1038-1", { eligible: false, reason: "OUTSIDE_WINDOW" }],
    ["O-1011", "maria.garcia@example.com", "O-1011-1", { eligible: false, reason: "FINAL_SALE" }],
    ["O-1003", "priya.shah@example.com", "O-1003-1", { eligible: false, reason: "NOT_DELIVERED" }],
    ["O-1027", "liam.oconnor@example.com", "O-1027-1", { eligible: true }],
    ["O-1027", "liam.oconnor@example.com", "O-1027-2", { eligible: false, reason: "NOT_DELIVERED" }],
    ["O-1031", "emma.wilson@example.com", "O-1031-1", { eligible: false, reason: "ORDER_CANCELLED" }],
    ["O-1050", "david.kim@example.com", "O-1050-1", { eligible: false, reason: "ALREADY_RETURNED" }],
  ])("fixture %s item %s → %o @F7", async (orderId, email, itemId, expected) => {
    const { tools } = setup();
    expect(await tools.checkReturnEligibility({ orderId, email, itemId })).toMatchObject(expected);
  });

  it("lists the order's items when the item id is wrong", async () => {
    const { tools } = setup();
    expect(await tools.checkReturnEligibility({ ...JANE, itemId: "boots" })).toMatchObject({
      ok: false,
      code: "ITEM_NOT_FOUND",
      items: [{ itemId: "O-1042-1", name: "Trail Runner X" }],
    });
  });

  it("requires verification @F6", async () => {
    const { tools } = setup();
    expect(await tools.checkReturnEligibility({ orderId: "O-1046", email: "x@example.com", itemId: "O-1046-1" })).toMatchObject({
      code: "UNVERIFIED",
    });
  });
});

describe("createReturn", () => {
  const ret = { orderId: "O-1046", email: "jane@example.com", itemId: "O-1046-1", reason: "Too small" };

  it("creates a refund with an RMA and next steps", async () => {
    const { tools } = setup();
    const r = CreateReturnOutput.parse(await tools.createReturn({ ...ret, type: "refund" }));
    expect(r).toMatchObject({ ok: true, rma: "RMA-100001", type: "refund", refundAmount: 79, exchangeSize: null });
    if (r.ok) expect(r.nextSteps.join(" ")).toContain("RMA-100001");
  });

  it("blocks a second return for the same item", async () => {
    const { tools } = setup();
    await tools.createReturn({ ...ret, type: "refund" });
    expect(await tools.createReturn({ ...ret, type: "refund" })).toMatchObject({
      ok: false,
      code: "NOT_ELIGIBLE",
      eligibility: { reason: "ALREADY_RETURNED" },
    });
    const { reason: _reason, ...eligibilityInput } = ret;
    expect(await tools.checkReturnEligibility(eligibilityInput)).toMatchObject({ eligible: false, reason: "ALREADY_RETURNED" });
  });

  it("creates an exchange when the new size is in stock", async () => {
    const { tools, catalog } = setup();
    const size = catalog.inStockSizes(catalog.get("P-010")!, "standard").find((s) => s !== 9)!;
    const black = catalog.checkStock({ product: "P-010", size, color: "Black" });
    const r = await tools.createReturn({ ...ret, type: "exchange", exchangeSize: size });
    if (black.ok && black.available) expect(r).toMatchObject({ ok: true, type: "exchange", exchangeSize: size, refundAmount: null });
    else expect(r).toMatchObject({ ok: true, type: "refund" });
  });

  it("turns an out-of-stock exchange into a refund, per policy", async () => {
    const { tools, catalog } = setup();
    const soldOut = catalog
      .get("P-010")!
      .inventory.find((e) => e.color === "Black" && e.width === "standard" && e.qty === 0 && e.size !== 9)!;
    const r = await tools.createReturn({ ...ret, type: "exchange", exchangeSize: soldOut.size });
    expect(r).toMatchObject({ ok: true, type: "refund", exchangeSize: null });
    if (r.ok) expect(r.nextSteps[0]).toContain("out of stock");
  });

  it("rejects an exchange into a size the product isn't made in", async () => {
    const { tools } = setup();
    expect(await tools.createReturn({ ...ret, type: "exchange", exchangeSize: 16 })).toMatchObject({ ok: false, code: "INVALID_VARIANT" });
  });

  it("refuses ineligible returns with the policy reason @F7", async () => {
    const { tools } = setup();
    expect(
      await tools.createReturn({ orderId: "O-1011", email: "maria.garcia@example.com", itemId: "O-1011-1", reason: "x", type: "refund" }),
    ).toMatchObject({ ok: false, code: "NOT_ELIGIBLE", eligibility: { reason: "FINAL_SALE" } });
  });

  it("tells international customers they pay return shipping", async () => {
    const { tools } = setup();
    const r = await tools.createReturn({ orderId: "O-1054", email: "sofia.rossi@example.com", itemId: "O-1054-1", reason: "x", type: "refund" });
    if (r.ok) expect(r.nextSteps.join(" ")).toContain("international return shipping");
    else throw new Error("expected ok");
  });
});

describe("privacy: no tool output ever contains fixture PII @F16", () => {
  it("holds for every order and every item through every order tool", async () => {
    const { tools } = setup();
    for (const order of loadOrders()) {
      const auth = { orderId: order.orderId, email: order.customer.email };
      const outputs: unknown[] = [await tools.getOrderStatus(auth)];
      for (const item of order.items) {
        outputs.push(await tools.checkReturnEligibility({ ...auth, itemId: item.itemId }));
        outputs.push(await tools.createReturn({ ...auth, itemId: item.itemId, reason: "test", type: "refund" }));
      }
      outputs.push(await tools.checkReturnEligibility({ ...auth, itemId: "nope" }));
      expect(findPii(outputs), order.orderId).toEqual([]);
    }
  });
});
