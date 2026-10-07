import { z } from "zod";
import { ItemStatus, OrderStatus, ShoeSize, Width } from "@stride/shared";

/**
 * Raw order as stored in data/orders.json. Contains (fake) PII on purpose so tests can
 * prove it never leaves the order service. Dates are relative ("days ago") so the demo
 * data never goes stale; `materialize` turns them into absolute timestamps.
 */
export const OrderRecord = z.strictObject({
  orderId: z.string().regex(/^O-\d{4}$/),
  customer: z.strictObject({ name: z.string(), email: z.email(), phone: z.string() }),
  shippingAddress: z.strictObject({
    line1: z.string(),
    line2: z.string().optional(),
    city: z.string(),
    region: z.string(),
    postalCode: z.string(),
    country: z.string(),
  }),
  payment: z.strictObject({ brand: z.string(), last4: z.string().regex(/^\d{4}$/) }),
  status: OrderStatus,
  placedDaysAgo: z.number().int().min(0),
  carrier: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  /** Negative = already past. Null = no ETA (delivered or cancelled). */
  etaDaysFromNow: z.number().int().nullable(),
  shippingCost: z.number().min(0),
  items: z
    .array(
      z.strictObject({
        itemId: z.string(),
        productId: z.string().regex(/^P-\d{3}$/),
        size: ShoeSize,
        width: Width,
        color: z.string(),
        quantity: z.number().int().positive(),
        unitPrice: z.number().positive(),
        finalSale: z.boolean(),
        status: ItemStatus,
        deliveredDaysAgo: z.number().int().min(0).nullable(),
        returned: z.boolean().default(false),
      }),
    )
    .min(1),
  timeline: z.array(
    z.strictObject({
      status: z.enum(["ordered", "shipped", "out_for_delivery", "delivered", "delayed", "cancelled"]),
      daysAgo: z.number().int().min(0),
      note: z.string().optional(),
    }),
  ),
});
export type OrderRecord = z.infer<typeof OrderRecord>;
export const OrderRecords = z.array(OrderRecord);
