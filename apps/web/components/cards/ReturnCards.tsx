import type { EligibilityResult, ReturnCreated } from "@stride/shared";
import { Badge, CardShell, money } from "../ui";

const REASONS: Record<string, string> = {
  OUTSIDE_WINDOW: "Outside the 30-day return window",
  FINAL_SALE: "Final-sale item",
  WORN_ITEM: "Worn items can't be returned",
  NOT_DELIVERED: "Not delivered yet",
  ORDER_CANCELLED: "Order was cancelled",
  ALREADY_RETURNED: "Return already started",
};

const ALTERNATIVES: Record<string, string> = {
  warranty_claim: "Warranty claim",
  cancel_order: "Cancel the order",
  track_order: "Track the order",
  contact_support: "Contact support",
};

export function ReturnEligibilityCard({ eligibility }: { eligibility: EligibilityResult }) {
  return (
    <CardShell
      label="Return eligibility"
      title={`Return: ${eligibility.item.name}`}
      aside={eligibility.eligible ? <Badge tone="good">Eligible</Badge> : <Badge tone="warn">Not eligible</Badge>}
    >
      {eligibility.eligible ? (
        <p className="text-sm text-stone-700">
          {eligibility.daysLeft === 0 ? "Last day to return" : `${eligibility.daysLeft} day${eligibility.daysLeft === 1 ? "" : "s"} left to return`} ·{" "}
          {eligibility.options.map((o) => (o === "refund" ? "refund" : "exchange")).join(" or ")}
        </p>
      ) : (
        <>
          <p className="text-sm font-medium text-stone-800">{REASONS[eligibility.reason] ?? eligibility.reason}</p>
          <p className="mt-1 text-sm text-stone-600">{eligibility.explanation}</p>
          {eligibility.alternatives.length > 0 && (
            <p className="mt-2 text-sm text-stone-700">Options: {eligibility.alternatives.map((a) => ALTERNATIVES[a] ?? a).join(" · ")}</p>
          )}
        </>
      )}
    </CardShell>
  );
}

export function ReturnCreatedCard({ result }: { result: ReturnCreated }) {
  return (
    <CardShell label="Return created" title={`Return started: ${result.item.name}`} aside={<Badge tone="good">{result.type === "refund" ? "Refund" : "Exchange"}</Badge>}>
      <p className="text-sm text-stone-500">Return number</p>
      <p className="font-mono text-xl font-semibold tracking-wide text-stone-900">{result.rma}</p>
      <p className="mt-1 text-sm text-stone-700">
        {result.refundAmount !== null ? `Refund of ${money(result.refundAmount)}` : `Exchange for size ${result.exchangeSize}`}
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-stone-700">
        {result.nextSteps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </CardShell>
  );
}
