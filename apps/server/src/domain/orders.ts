import { OrderView } from "@stride/shared";
import { daysAgo, type Clock } from "../clock";
import type { OrderRecord } from "../data/orderRecord";
import type { Catalog } from "./catalog";
import { osaDistance } from "./fuzzy";

export type VerifyResult =
  | { kind: "ok"; order: OrderRecord }
  | { kind: "not_found"; suggestions: string[] }
  | { kind: "unverified" };

/**
 * The only component that touches raw order records (and their PII).
 * Everything it returns to callers is either a verification verdict or a
 * PII-free `OrderView` (PRD §4.4).
 */
export class OrderService {
  private readonly byId: Map<string, OrderRecord>;

  constructor(
    orders: OrderRecord[],
    private readonly catalog: Catalog,
    private readonly clock: Clock,
  ) {
    this.byId = new Map(orders.map((o) => [o.orderId, o]));
  }

  /**
   * Order ID + email check. Inputs arrive normalized by the tool schemas.
   * Typo suggestions are restricted to orders placed with the SAME email, so this
   * can't be used to discover other customers' order numbers. Brute-force attempts
   * are additionally capped by the session lockout (F6, Milestone 4).
   */
  verify(orderId: string, email: string): VerifyResult {
    const order = this.byId.get(orderId);
    if (order) return order.customer.email.toLowerCase() === email ? { kind: "ok", order } : { kind: "unverified" };

    const suggestions = [...this.byId.values()]
      .filter((o) => o.customer.email.toLowerCase() === email)
      .filter((o) => osaDistance(o.orderId, orderId) <= 1)
      .map((o) => o.orderId);
    return { kind: "not_found", suggestions };
  }

  toView(order: OrderRecord): OrderView {
    const subtotal = round(order.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0));
    const at = (days: number) => daysAgo(this.clock, days).toISOString();

    // Parsing with the strict schema is the privacy gate: any PII field fails loudly.
    return OrderView.parse({
      orderId: order.orderId,
      status: order.status,
      placedAt: at(order.placedDaysAgo),
      items: order.items.map((i) => ({
        itemId: i.itemId,
        productId: i.productId,
        name: this.catalog.get(i.productId)?.name ?? "Unknown item",
        size: i.size,
        width: i.width,
        color: i.color,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        finalSale: i.finalSale,
        status: i.status,
      })),
      timeline: order.timeline.map((t) => ({ status: t.status, at: at(t.daysAgo), ...(t.note && { note: t.note }) })),
      estimatedDelivery: order.etaDaysFromNow === null ? null : at(-order.etaDaysFromNow),
      carrier: order.carrier,
      trackingNumber: order.trackingNumber,
      destination: `${order.shippingAddress.city}, ${order.shippingAddress.region}`,
      totals: { subtotal, shipping: order.shippingCost, total: round(subtotal + order.shippingCost) },
    });
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
