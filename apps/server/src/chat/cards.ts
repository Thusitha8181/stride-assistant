import { Card } from "@stride/shared";

/** Maps a successful tool result to the UI card that shows it (PRD §4.2). */
export function cardFor(toolName: string, result: unknown): Card | null {
  const r = result as { ok?: boolean; [key: string]: unknown } | null;
  if (!r?.ok) return null;

  const candidate = (() => {
    switch (toolName) {
      case "searchProducts":
        return Array.isArray(r.products) && r.products.length ? { kind: "products", products: r.products } : null;
      case "checkStock":
        return { kind: "stock", stock: r };
      case "getOrderStatus":
        return { kind: "order", order: r.order };
      case "checkReturnEligibility":
        return { kind: "return-eligibility", eligibility: r };
      case "createReturn":
        return { kind: "return-created", result: r };
      default:
        return null;
    }
  })();

  // Never emit a card that breaks the contract (or would carry unexpected fields to the browser).
  const parsed = candidate && Card.safeParse(candidate);
  return parsed?.success ? parsed.data : null;
}

const CITATION = /\[\[([a-z0-9-]+#[a-z0-9-]+)\]\]/g;

/** Ids cited inline as [[chunk-id]], in order of first appearance. */
export function citedIds(text: string): string[] {
  return [...new Set([...text.matchAll(CITATION)].map((m) => m[1]!))];
}
