import { z } from "zod";
import { OrderView } from "./order";
import { Category, ProductRef, ProductSummary, ShoeSize, Width } from "./product";

/**
 * Tool input/output contracts. Inputs are what the model must send (validated, F3);
 * outputs are what the model and the UI receive. Every output is a union tagged by
 * `ok` (plus `code` on failures) so failures are data, not exceptions.
 */

const OrderId = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^O-\d{4}$/, "Order IDs look like O-1234"));

const Email = z.string().trim().toLowerCase().pipe(z.email());

export const ToolErrorCode = z.enum([
  "NOT_FOUND",
  "UNVERIFIED",
  "ITEM_NOT_FOUND",
  "INVALID_VARIANT",
  "NOT_ELIGIBLE",
  "BACKEND_UNAVAILABLE",
]);
export type ToolErrorCode = z.infer<typeof ToolErrorCode>;

const toolError = <C extends ToolErrorCode>(code: C) =>
  z.strictObject({
    ok: z.literal(false),
    code: z.literal(code),
    message: z.string(),
  });

// ---------------------------------------------------------------- searchKnowledgeBase

export const SearchKnowledgeBaseInput = z.strictObject({
  query: z.string().trim().min(1).max(300),
});
export type SearchKnowledgeBaseInput = z.infer<typeof SearchKnowledgeBaseInput>;

export const KnowledgeChunk = z.strictObject({
  /** Stable chunk id, e.g. "returns-policy#eligibility". Used for citations and retrieval evals. */
  id: z.string(),
  source: z.string(),
  title: z.string(),
  text: z.string(),
  score: z.number(),
});
export type KnowledgeChunk = z.infer<typeof KnowledgeChunk>;

export const SearchKnowledgeBaseOutput = z.union([
  z.strictObject({ ok: z.literal(true), chunks: z.array(KnowledgeChunk), topScore: z.number() }),
  toolError("BACKEND_UNAVAILABLE"),
]);
export type SearchKnowledgeBaseOutput = z.infer<typeof SearchKnowledgeBaseOutput>;

// ---------------------------------------------------------------- searchProducts

export const SearchProductsInput = z.strictObject({
  query: z.string().trim().min(1).max(300),
  category: Category.optional(),
  maxPrice: z.number().positive().optional(),
  size: ShoeSize.optional(),
});
export type SearchProductsInput = z.infer<typeof SearchProductsInput>;

export const ProductHit = z.strictObject({
  ...ProductSummary.shape,
  score: z.number(),
  /** Only present when a size was requested. */
  inStockInRequestedSize: z.boolean().optional(),
});
export type ProductHit = z.infer<typeof ProductHit>;

export const SearchProductsOutput = z.union([
  z.strictObject({ ok: z.literal(true), products: z.array(ProductHit).max(5) }),
  toolError("BACKEND_UNAVAILABLE"),
]);
export type SearchProductsOutput = z.infer<typeof SearchProductsOutput>;

// ---------------------------------------------------------------- checkStock

export const CheckStockInput = z.strictObject({
  /** Product id ("P-001") or name ("Trail Runner X"). */
  product: z.string().trim().min(1).max(100),
  size: ShoeSize,
  width: Width.optional(),
  color: z.string().trim().min(1).optional(),
});
export type CheckStockInput = z.infer<typeof CheckStockInput>;

export const VariantStock = z.strictObject({
  size: ShoeSize,
  width: Width,
  color: z.string(),
  qty: z.number().int(),
});
export type VariantStock = z.infer<typeof VariantStock>;

export const CheckStockOutput = z.union([
  z.strictObject({
    ok: z.literal(true),
    product: ProductRef,
    requested: z.strictObject({ size: ShoeSize, width: Width, color: z.string().nullable() }),
    available: z.boolean(),
    quantity: z.number().int(),
    /** Filled when the requested variant is unavailable (F8). */
    alternatives: z.strictObject({
      nearbySizes: z.array(VariantStock),
      otherWidths: z.array(VariantStock),
      otherColors: z.array(VariantStock),
      similarProducts: z.array(ProductRef),
    }),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.literal("NOT_FOUND"),
    message: z.string(),
    suggestions: z.array(ProductRef),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.literal("INVALID_VARIANT"),
    message: z.string(),
    offered: z.strictObject({ sizes: z.array(ShoeSize), widths: z.array(Width), colors: z.array(z.string()) }),
  }),
  toolError("BACKEND_UNAVAILABLE"),
]);
export type CheckStockOutput = z.infer<typeof CheckStockOutput>;

// ---------------------------------------------------------------- getOrderStatus

export const GetOrderStatusInput = z.strictObject({ orderId: OrderId, email: Email });
export type GetOrderStatusInput = z.input<typeof GetOrderStatusInput>;

const OrderNotFound = z.strictObject({
  ok: z.literal(false),
  code: z.literal("NOT_FOUND"),
  message: z.string(),
  /** Only order IDs that belong to the same email are ever suggested (no enumeration). */
  suggestions: z.array(z.string()),
});

export const GetOrderStatusOutput = z.union([
  z.strictObject({ ok: z.literal(true), order: OrderView }),
  OrderNotFound,
  toolError("UNVERIFIED"),
  toolError("BACKEND_UNAVAILABLE"),
]);
export type GetOrderStatusOutput = z.infer<typeof GetOrderStatusOutput>;

// ---------------------------------------------------------------- returns

export const ItemCondition = z.enum(["unworn", "worn", "defective"]);
export type ItemCondition = z.infer<typeof ItemCondition>;

export const ReturnIneligibleReason = z.enum([
  "ORDER_CANCELLED",
  "NOT_DELIVERED",
  "OUTSIDE_WINDOW",
  "FINAL_SALE",
  "WORN_ITEM",
  "ALREADY_RETURNED",
]);
export type ReturnIneligibleReason = z.infer<typeof ReturnIneligibleReason>;

export const ReturnAlternative = z.enum(["warranty_claim", "cancel_order", "track_order", "contact_support"]);
export type ReturnAlternative = z.infer<typeof ReturnAlternative>;

export const ReturnType = z.enum(["refund", "exchange"]);
export type ReturnType = z.infer<typeof ReturnType>;

export const CheckReturnEligibilityInput = z.strictObject({
  orderId: OrderId,
  email: Email,
  itemId: z.string().trim().min(1),
  itemCondition: ItemCondition.default("unworn"),
});
export type CheckReturnEligibilityInput = z.input<typeof CheckReturnEligibilityInput>;

const ItemRef = z.strictObject({ itemId: z.string(), name: z.string() });

export const Eligible = z.strictObject({
  ok: z.literal(true),
  eligible: z.literal(true),
  item: ItemRef,
  daysSinceDelivery: z.number().int(),
  daysLeft: z.number().int(),
  options: z.array(ReturnType),
  policySource: z.string(),
});

export const Ineligible = z.strictObject({
  ok: z.literal(true),
  eligible: z.literal(false),
  item: ItemRef,
  reason: ReturnIneligibleReason,
  explanation: z.string(),
  policySource: z.string(),
  alternatives: z.array(ReturnAlternative),
});

const ItemNotFound = z.strictObject({
  ok: z.literal(false),
  code: z.literal("ITEM_NOT_FOUND"),
  message: z.string(),
  items: z.array(ItemRef),
});

export const CheckReturnEligibilityOutput = z.union([
  Eligible,
  Ineligible,
  OrderNotFound,
  ItemNotFound,
  toolError("UNVERIFIED"),
  toolError("BACKEND_UNAVAILABLE"),
]);
export type CheckReturnEligibilityOutput = z.infer<typeof CheckReturnEligibilityOutput>;

export const CreateReturnInput = z
  .strictObject({
    orderId: OrderId,
    email: Email,
    itemId: z.string().trim().min(1),
    reason: z.string().trim().min(1).max(500),
    type: ReturnType,
    exchangeSize: ShoeSize.optional(),
    itemCondition: ItemCondition.default("unworn"),
  })
  .refine((v) => v.type !== "exchange" || v.exchangeSize !== undefined, {
    message: "exchangeSize is required for exchanges",
    path: ["exchangeSize"],
  });
export type CreateReturnInput = z.input<typeof CreateReturnInput>;

export const CreateReturnOutput = z.union([
  z.strictObject({
    ok: z.literal(true),
    rma: z.string().regex(/^RMA-\d{6}$/),
    item: ItemRef,
    type: ReturnType,
    refundAmount: z.number().nullable(),
    exchangeSize: ShoeSize.nullable(),
    nextSteps: z.array(z.string()),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.literal("NOT_ELIGIBLE"),
    message: z.string(),
    eligibility: Ineligible,
  }),
  OrderNotFound,
  ItemNotFound,
  toolError("UNVERIFIED"),
  toolError("INVALID_VARIANT"),
  toolError("BACKEND_UNAVAILABLE"),
]);
export type CreateReturnOutput = z.infer<typeof CreateReturnOutput>;
