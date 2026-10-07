import { describe, expect, it } from "vitest";
import { orderFixture } from "../../test/helpers";
import type { OrderRecord } from "../data/orderRecord";
import { evaluateReturn, RETURN_WINDOW_DAYS } from "./returnRules";

const base = orderFixture("O-1001");

function decide(itemPatch: Partial<OrderRecord["items"][number]>, opts: { condition?: "unworn" | "worn" | "defective"; orderPatch?: Partial<OrderRecord>; alreadyReturned?: boolean } = {}) {
  const item = { ...base.items[0]!, ...itemPatch };
  const order = { ...base, ...opts.orderPatch, items: [item] };
  return evaluateReturn({ order, item, condition: opts.condition ?? "unworn", alreadyReturned: opts.alreadyReturned ?? false });
}

describe("evaluateReturn @F7", () => {
  it.each([0, 1, 29, 30])("is eligible %i days after delivery", (days) => {
    const d = decide({ deliveredDaysAgo: days });
    expect(d).toMatchObject({ eligible: true, daysSinceDelivery: days, daysLeft: RETURN_WINDOW_DAYS - days, options: ["refund", "exchange"] });
  });

  it.each([31, 45, 365])("is outside the window %i days after delivery, with a warranty alternative", (days) => {
    expect(decide({ deliveredDaysAgo: days })).toMatchObject({
      eligible: false,
      reason: "OUTSIDE_WINDOW",
      policySource: "returns-policy#return-window",
      alternatives: ["warranty_claim", "contact_support"],
    });
  });

  it("offers no warranty once the warranty has expired", () => {
    expect(decide({ deliveredDaysAgo: 400 })).toMatchObject({ reason: "OUTSIDE_WINDOW", alternatives: ["contact_support"] });
  });

  it("rejects final-sale items but points to the warranty", () => {
    expect(decide({ deliveredDaysAgo: 3, finalSale: true })).toMatchObject({
      reason: "FINAL_SALE",
      policySource: "returns-policy#final-sale-items",
      alternatives: ["warranty_claim", "contact_support"],
    });
  });

  it("rejects worn items", () => {
    expect(decide({ deliveredDaysAgo: 3 }, { condition: "worn" })).toMatchObject({ reason: "WORN_ITEM" });
  });

  it("accepts defective items inside the window", () => {
    expect(decide({ deliveredDaysAgo: 3 }, { condition: "defective" })).toMatchObject({ eligible: true });
  });

  it("offers cancellation for items still processing", () => {
    expect(decide({ deliveredDaysAgo: null, status: "processing" })).toMatchObject({
      reason: "NOT_DELIVERED",
      alternatives: ["cancel_order", "track_order"],
    });
  });

  it("offers tracking for items in transit", () => {
    expect(decide({ deliveredDaysAgo: null, status: "shipped" })).toMatchObject({ reason: "NOT_DELIVERED", alternatives: ["track_order"] });
  });

  it("rejects cancelled orders", () => {
    expect(decide({ status: "cancelled" }, { orderPatch: { status: "cancelled" } })).toMatchObject({ reason: "ORDER_CANCELLED" });
  });

  it("rejects items already returned (fixture flag or return store)", () => {
    expect(decide({ deliveredDaysAgo: 3, returned: true })).toMatchObject({ reason: "ALREADY_RETURNED" });
    expect(decide({ deliveredDaysAgo: 3 }, { alreadyReturned: true })).toMatchObject({ reason: "ALREADY_RETURNED" });
  });

  it("reports the most fundamental reason first (cancelled beats final sale and window)", () => {
    expect(decide({ status: "cancelled", finalSale: true, deliveredDaysAgo: 90 })).toMatchObject({ reason: "ORDER_CANCELLED" });
    expect(decide({ finalSale: true, deliveredDaysAgo: 90 })).toMatchObject({ reason: "FINAL_SALE" });
  });
});
