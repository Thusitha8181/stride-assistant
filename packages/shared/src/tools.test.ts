import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CheckReturnEligibilityInput,
  CheckStockInput,
  CreateReturnInput,
  GetOrderStatusInput,
  SearchProductsInput,
} from "./tools";

describe("tool input validation @F3", () => {
  it("normalizes order id and email", () => {
    const parsed = GetOrderStatusInput.parse({ orderId: " o-1042 ", email: " Jane@Example.com " });
    expect(parsed).toEqual({ orderId: "O-1042", email: "jane@example.com" });
  });

  it("rejects malformed order ids and emails", () => {
    expect(GetOrderStatusInput.safeParse({ orderId: "1042", email: "jane@example.com" }).success).toBe(false);
    expect(GetOrderStatusInput.safeParse({ orderId: "O-1042", email: "not-an-email" }).success).toBe(false);
  });

  it("rejects unknown arguments (model hallucinated params)", () => {
    expect(SearchProductsInput.safeParse({ query: "boots", color: "red" }).success).toBe(false);
  });

  it("rejects impossible shoe sizes", () => {
    expect(CheckStockInput.safeParse({ product: "P-001", size: 10.3 }).success).toBe(false);
    expect(CheckStockInput.safeParse({ product: "P-001", size: 40 }).success).toBe(false);
    expect(CheckStockInput.safeParse({ product: "P-001", size: 10.5 }).success).toBe(true);
  });

  it("strips zero-width characters and Unicode hyphens models put in identifiers", () => {
    expect(GetOrderStatusInput.parse({ orderId: "O\u20111042", email: "pri\u200bya@example.com" })).toEqual({
      orderId: "O-1042",
      email: "priya@example.com",
    });
  });

  it("does not mark defaulted/optional fields as required for the model (Groq rejects such calls)", () => {
    const schema = z.toJSONSchema(CheckReturnEligibilityInput, { io: "input" }) as { required?: string[] };
    expect(schema.required).toEqual(["orderId", "email", "itemId"]);
  });

  it("requires an exchange size for exchanges", () => {
    const base = { orderId: "O-1042", email: "jane@example.com", itemId: "O-1042-1", reason: "too small" };
    expect(CreateReturnInput.safeParse({ ...base, type: "exchange" }).success).toBe(false);
    expect(CreateReturnInput.safeParse({ ...base, type: "exchange", exchangeSize: 10.5 }).success).toBe(true);
    expect(CreateReturnInput.safeParse({ ...base, type: "refund" }).success).toBe(true);
  });
});
