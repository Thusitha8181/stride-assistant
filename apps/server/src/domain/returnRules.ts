import type { ItemCondition, ReturnAlternative, ReturnIneligibleReason, ReturnType } from "@stride/shared";
import type { OrderRecord } from "../data/orderRecord";

export const RETURN_WINDOW_DAYS = 30;
export const WARRANTY_DAYS = 365;

type Item = OrderRecord["items"][number];

export type ReturnDecision =
  | { eligible: true; daysSinceDelivery: number; daysLeft: number; options: ReturnType[]; policySource: string }
  | {
      eligible: false;
      reason: ReturnIneligibleReason;
      explanation: string;
      policySource: string;
      alternatives: ReturnAlternative[];
    };

/** KB chunk ids (data/company/*.md "## " sections) that justify each decision; cited in answers. */
export const POLICY_SOURCES = {
  window: "returns-policy#return-window",
  eligibility: "returns-policy#eligibility",
  finalSale: "returns-policy#final-sale-items",
  howTo: "returns-policy#how-to-start-a-return",
  cancel: "shipping#changing-or-cancelling-an-order",
} as const;

/**
 * Pure return-eligibility rules (PRD §5, F7). Checks run in a fixed order so the
 * customer always hears the most fundamental reason first.
 */
export function evaluateReturn(args: {
  order: OrderRecord;
  item: Item;
  condition: ItemCondition;
  alreadyReturned: boolean;
}): ReturnDecision {
  const { order, item, condition } = args;
  const no = (
    reason: ReturnIneligibleReason,
    explanation: string,
    policySource: string,
    alternatives: ReturnAlternative[],
  ): ReturnDecision => ({ eligible: false, reason, explanation, policySource, alternatives });

  if (order.status === "cancelled" || item.status === "cancelled")
    return no("ORDER_CANCELLED", "This order was cancelled, so there is nothing to return.", POLICY_SOURCES.cancel, ["contact_support"]);

  if (item.returned || args.alreadyReturned)
    return no("ALREADY_RETURNED", "A return has already been started for this item.", POLICY_SOURCES.howTo, ["contact_support"]);

  const days = item.deliveredDaysAgo;
  if (days === null)
    return no(
      "NOT_DELIVERED",
      "This item hasn't been delivered yet. Returns open once it arrives.",
      POLICY_SOURCES.eligibility,
      item.status === "processing" ? ["cancel_order", "track_order"] : ["track_order"],
    );

  const warranty: ReturnAlternative[] = days <= WARRANTY_DAYS ? ["warranty_claim"] : [];

  if (item.finalSale)
    return no(
      "FINAL_SALE",
      "This item was a final sale, so it can't be returned or exchanged. It is still covered by the 1-year warranty against defects.",
      POLICY_SOURCES.finalSale,
      [...warranty, "contact_support"],
    );

  if (days > RETURN_WINDOW_DAYS)
    return no(
      "OUTSIDE_WINDOW",
      `This item was delivered ${days} days ago. Returns are accepted within ${RETURN_WINDOW_DAYS} days of delivery.`,
      POLICY_SOURCES.window,
      [...warranty, "contact_support"],
    );

  if (condition === "worn")
    return no(
      "WORN_ITEM",
      "Worn shoes can't be returned, but defects are covered by the 1-year warranty.",
      POLICY_SOURCES.eligibility,
      [...warranty, "contact_support"],
    );

  return {
    eligible: true,
    daysSinceDelivery: days,
    daysLeft: RETURN_WINDOW_DAYS - days,
    options: ["refund", "exchange"],
    policySource: POLICY_SOURCES.window,
  };
}
