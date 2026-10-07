import { z } from "zod";
import { ShoeSize, Width } from "./product";

export const OrderStatus = z.enum([
  "processing",
  "shipped",
  "out_for_delivery",
  "delivered",
  "delayed",
  "partially_shipped",
  "cancelled",
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const ItemStatus = z.enum(["processing", "shipped", "delivered", "cancelled"]);
export type ItemStatus = z.infer<typeof ItemStatus>;

export const TimelineEvent = z.strictObject({
  status: z.enum(["ordered", "shipped", "out_for_delivery", "delivered", "delayed", "cancelled"]),
  at: z.iso.datetime(),
  note: z.string().optional(),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const OrderItemView = z.strictObject({
  itemId: z.string(),
  productId: z.string(),
  name: z.string(),
  size: ShoeSize,
  width: Width,
  color: z.string(),
  quantity: z.number().int().positive(),
  unitPrice: z.number(),
  finalSale: z.boolean(),
  status: ItemStatus,
});
export type OrderItemView = z.infer<typeof OrderItemView>;

/**
 * The ONLY order shape that leaves the order service (PRD §4.4).
 * Strict on purpose: it contains no name, email, street address, phone or payment
 * data, and adding any unknown field makes parsing fail.
 */
export const OrderView = z.strictObject({
  orderId: z.string(),
  status: OrderStatus,
  placedAt: z.iso.datetime(),
  items: z.array(OrderItemView).min(1),
  timeline: z.array(TimelineEvent),
  estimatedDelivery: z.iso.datetime().nullable(),
  carrier: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  /** City-level only, e.g. "Austin, TX". */
  destination: z.string(),
  totals: z.strictObject({
    subtotal: z.number(),
    shipping: z.number(),
    total: z.number(),
  }),
});
export type OrderView = z.infer<typeof OrderView>;
