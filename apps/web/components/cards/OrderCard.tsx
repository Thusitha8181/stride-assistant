import type { OrderView } from "@stride/shared";
import { Badge, CardShell, money, shortDate } from "../ui";

const STEPS = [
  { key: "ordered", label: "Ordered" },
  { key: "shipped", label: "Shipped" },
  { key: "out_for_delivery", label: "Out for delivery" },
  { key: "delivered", label: "Delivered" },
] as const;

const STATUS: Record<OrderView["status"], { text: string; tone: "good" | "warn" | "bad" | "brand" | "neutral" }> = {
  processing: { text: "Processing", tone: "neutral" },
  shipped: { text: "Shipped", tone: "brand" },
  out_for_delivery: { text: "Out for delivery", tone: "brand" },
  delivered: { text: "Delivered", tone: "good" },
  delayed: { text: "Delayed", tone: "warn" },
  partially_shipped: { text: "Partially shipped", tone: "warn" },
  cancelled: { text: "Cancelled", tone: "bad" },
};

export function OrderCard({ order }: { order: OrderView }) {
  const when = new Map(order.timeline.map((t) => [t.status, t.at]));
  // Progress runs up to the furthest step reached (a delivered order may skip "out for delivery").
  const furthest = Math.max(0, ...STEPS.map((s, i) => (when.has(s.key) ? i : -1)));
  const notes = order.timeline.filter((t) => t.note);
  const status = STATUS[order.status];

  return (
    <CardShell label={`Order ${order.orderId}`} title={`Order ${order.orderId}`} aside={<Badge tone={status.tone}>{status.text}</Badge>}>
      {order.status !== "cancelled" && (
        <ol className="mb-4 grid grid-cols-4 gap-1" aria-label="Delivery progress">
          {STEPS.map((step, i) => {
            const done = i <= furthest;
            const late = order.status === "delayed" && i > 0;
            return (
              <li key={step.key} className="flex flex-col items-center text-center" aria-current={i === furthest ? "step" : undefined}>
                <span aria-hidden className={`mb-1 h-2 w-full rounded-full ${done ? (late ? "bg-amber-400" : "bg-brand") : "bg-stone-200"}`} />
                <span className={`text-xs ${done ? "font-medium text-stone-800" : "text-stone-400"}`}>{step.label}</span>
                {when.get(step.key) && <span className="text-[11px] text-stone-500">{shortDate(when.get(step.key)!)}</span>}
                <span className="sr-only">{done ? "done" : "not yet"}</span>
              </li>
            );
          })}
        </ol>
      )}

      {notes.map((n) => (
        <p key={n.at} className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {n.note}
        </p>
      ))}

      <ul className="divide-y divide-stone-100 text-sm">
        {order.items.map((item) => (
          <li key={item.itemId} className="flex items-center justify-between gap-3 py-2">
            <div>
              <p className="font-medium text-stone-900">{item.name}</p>
              <p className="text-stone-500">
                Size {item.size}
                {item.width === "wide" ? " wide" : ""} · {item.color}
                {item.quantity > 1 ? ` · ×${item.quantity}` : ""}
                {item.finalSale ? " · Final sale" : ""}
              </p>
            </div>
            <div className="text-right">
              <p className="text-stone-900">{money(item.unitPrice * item.quantity)}</p>
              <p className="text-xs capitalize text-stone-500">{item.status}</p>
            </div>
          </li>
        ))}
      </ul>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-stone-100 pt-3 text-sm">
        {order.estimatedDelivery && order.status !== "delivered" && (
          <>
            <dt className="text-stone-500">Estimated delivery</dt>
            <dd className="text-stone-900">{shortDate(order.estimatedDelivery)}</dd>
          </>
        )}
        {order.carrier && (
          <>
            <dt className="text-stone-500">Carrier</dt>
            <dd className="text-stone-900">
              {order.carrier}
              {order.trackingNumber && <span className="block break-all text-xs text-stone-500">{order.trackingNumber}</span>}
            </dd>
          </>
        )}
        <dt className="text-stone-500">Shipping to</dt>
        <dd className="text-stone-900">{order.destination}</dd>
        <dt className="text-stone-500">Total</dt>
        <dd className="font-medium text-stone-900">{money(order.totals.total)}</dd>
      </dl>
    </CardShell>
  );
}
