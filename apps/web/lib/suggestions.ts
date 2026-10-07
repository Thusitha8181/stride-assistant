import type { Card } from "@stride/shared";
import type { AssistantMessage } from "./messages";

export const STARTER_CHIPS = [
  "Track my order",
  "Find running shoes",
  "What's your return policy?",
  "Do you ship internationally?",
  "Start a return",
];

const variant = (v: { size: number; width: string; color: string }) =>
  `${v.size}${v.width === "wide" ? " wide" : ""} in ${v.color.toLowerCase()}`;

function fromCard(card: Card): string[] {
  switch (card.kind) {
    case "order":
      return card.order.status === "delivered" || card.order.items.some((i) => i.status === "delivered")
        ? ["Start a return", "Track another order"]
        : ["When will it arrive?", "Track another order"];
    case "stock": {
      const { stock } = card;
      if (stock.available) return [`Show me other colors of the ${stock.product.name}`];
      const alt = [...stock.alternatives.nearbySizes, ...stock.alternatives.otherWidths, ...stock.alternatives.otherColors][0];
      const similar = stock.alternatives.similarProducts[0];
      return [
        ...(alt ? [`Is the ${stock.product.name} available in ${variant(alt)}?`] : []),
        ...(similar ? [`Tell me about the ${similar.name}`] : []),
      ];
    }
    case "products":
      return card.products.slice(0, 2).map((p) => `Tell me more about the ${p.name}`);
    case "return-eligibility":
      return card.eligibility.eligible
        ? ["I'd like a refund", "I'd like to exchange for a different size"]
        : card.eligibility.alternatives.includes("warranty_claim")
          ? ["How do I make a warranty claim?"]
          : ["How do I contact support?"];
    case "return-created":
      return ["Where do I send my return?", "When will I get my refund?"];
  }
}

/** Contextual quick replies after an answer, derived from what the agent just showed. */
export function suggestionsFor(msg: AssistantMessage): string[] {
  if (msg.status !== "done" || msg.error) return [];
  let chips = msg.cards.flatMap(fromCard);
  // Don't offer to start a return we just explained isn't possible.
  const blocked = msg.cards.some((c) => c.kind === "return-eligibility" && !c.eligibility.eligible);
  if (blocked) chips = chips.filter((c) => c !== "Start a return");
  if (!chips.length && msg.citations.length) chips.push("Track my order", "Find shoes");
  return [...new Set(chips)].slice(0, 3);
}
