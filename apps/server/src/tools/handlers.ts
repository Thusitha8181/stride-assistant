import {
  CheckReturnEligibilityInput,
  CheckStockInput,
  CreateReturnInput,
  GetOrderStatusInput,
  SearchKnowledgeBaseInput,
  SearchProductsInput,
  type CheckReturnEligibilityOutput,
  type CheckStockOutput,
  type CreateReturnOutput,
  type GetOrderStatusOutput,
  type ProductHit,
  type SearchKnowledgeBaseOutput,
  type SearchProductsOutput,
} from "@stride/shared";
import type { Clock } from "../clock";
import type { OrderRecord } from "../data/orderRecord";
import type { Catalog } from "../domain/catalog";
import type { OrderService } from "../domain/orders";
import { nameSimilarity } from "../domain/fuzzy";
import { evaluateReturn } from "../domain/returnRules";
import type { ReturnStore } from "../domain/returnStore";
import type { KnowledgeIndex, ProductIndex } from "../rag/indexes";

export type ToolDeps = {
  catalog: Catalog;
  orders: OrderService;
  returns: ReturnStore;
  knowledge: KnowledgeIndex;
  products: ProductIndex;
  clock: Clock;
};

const KB_TOP_K = 4;
const PRODUCT_CANDIDATES = 10;
const MAX_PRODUCTS = 5;

const UNVERIFIED = {
  ok: false,
  code: "UNVERIFIED",
  message: "The order number and email address don't match our records.",
} as const;

const backendUnavailable = (what: string) =>
  ({ ok: false, code: "BACKEND_UNAVAILABLE", message: `${what} is temporarily unavailable.` }) as const;

/**
 * Tool implementations. Inputs are re-validated here (never trust model arguments, F3)
 * and every outcome is returned as data so the agent can explain it to the customer.
 */
export function createToolHandlers(deps: ToolDeps) {
  const { catalog, orders, returns } = deps;

  /** Shared by the order tools: verification happens INSIDE the tool, not in the prompt (F6, F10). */
  function verifiedOrder(orderId: string, email: string) {
    const result = orders.verify(orderId, email);
    if (result.kind === "unverified") return { ok: false as const, error: UNVERIFIED };
    if (result.kind === "not_found")
      return {
        ok: false as const,
        error: {
          ok: false as const,
          code: "NOT_FOUND" as const,
          message: `We couldn't find order ${orderId}.`,
          suggestions: result.suggestions,
        },
      };
    return { ok: true as const, order: result.order };
  }

  function findItem(order: OrderRecord, itemId: string) {
    const item = order.items.find((i) => i.itemId.toLowerCase() === itemId.trim().toLowerCase());
    if (item) return { ok: true as const, item };
    const items = orders.toView(order).items.map((i) => ({ itemId: i.itemId, name: i.name }));
    return {
      ok: false as const,
      error: { ok: false as const, code: "ITEM_NOT_FOUND" as const, message: `Order ${order.orderId} has no item "${itemId}".`, items },
    };
  }

  const itemRef = (item: { itemId: string; productId: string }) => ({
    itemId: item.itemId,
    name: catalog.get(item.productId)?.name ?? "Unknown item",
  });

  return {
    async searchKnowledgeBase(raw: SearchKnowledgeBaseInput): Promise<SearchKnowledgeBaseOutput> {
      const input = SearchKnowledgeBaseInput.parse(raw);
      try {
        const hits = await deps.knowledge.search(input.query, KB_TOP_K);
        const chunks = hits.map(({ chunk, score }) => ({ ...chunk, score }));
        return { ok: true, chunks, topScore: chunks[0]?.score ?? 0 };
      } catch {
        return backendUnavailable("Our help center search");
      }
    },

    async searchProducts(raw: SearchProductsInput): Promise<SearchProductsOutput> {
      const input = SearchProductsInput.parse(raw);
      let hits;
      try {
        hits = await deps.products.search(input.query, input, PRODUCT_CANDIDATES);
      } catch {
        return backendUnavailable("Product search");
      }

      const products = hits.flatMap(({ productId, score }): ProductHit[] => {
        const product = catalog.get(productId);
        if (!product) return [];
        const summary = catalog.summary(product);
        return [
          input.size === undefined
            ? { ...summary, score }
            : { ...summary, score, inStockInRequestedSize: summary.inStockSizes.includes(input.size) },
        ];
      });
      // A product the customer named always comes first, even when sold out in their size (live
      // finding: "Tempo Pro in size 9" fell off the list and the model searched in circles).
      // After that, show what the customer can actually buy (stable sort keeps relevance order).
      const named = (p: ProductHit) => Number(nameSimilarity(input.query, p.name) === 1 || input.query.toLowerCase().includes(p.name.toLowerCase()));
      products.sort((a, b) => named(b) - named(a) || Number(b.inStockInRequestedSize ?? 0) - Number(a.inStockInRequestedSize ?? 0));
      return { ok: true, products: products.slice(0, MAX_PRODUCTS) };
    },

    async checkStock(raw: CheckStockInput): Promise<CheckStockOutput> {
      return catalog.checkStock(CheckStockInput.parse(raw));
    },

    async getOrderStatus(raw: GetOrderStatusInput): Promise<GetOrderStatusOutput> {
      const input = GetOrderStatusInput.parse(raw);
      const verified = verifiedOrder(input.orderId, input.email);
      if (!verified.ok) return verified.error;
      return { ok: true, order: orders.toView(verified.order) };
    },

    async checkReturnEligibility(raw: CheckReturnEligibilityInput): Promise<CheckReturnEligibilityOutput> {
      const input = CheckReturnEligibilityInput.parse(raw);
      const verified = verifiedOrder(input.orderId, input.email);
      if (!verified.ok) return verified.error;
      const { order } = verified;
      const found = findItem(order, input.itemId);
      if (!found.ok) return found.error;

      const decision = evaluateReturn({
        order,
        item: found.item,
        condition: input.itemCondition ?? "unworn",
        alreadyReturned: returns.has(found.item.itemId),
      });
      return { ok: true, item: itemRef(found.item), ...decision };
    },

    async createReturn(raw: CreateReturnInput): Promise<CreateReturnOutput> {
      const input = CreateReturnInput.parse(raw);
      const verified = verifiedOrder(input.orderId, input.email);
      if (!verified.ok) return verified.error;
      const { order } = verified;
      const found = findItem(order, input.itemId);
      if (!found.ok) return found.error;
      const { item } = found;

      const decision = evaluateReturn({ order, item, condition: input.itemCondition ?? "unworn", alreadyReturned: returns.has(item.itemId) });
      if (!decision.eligible) {
        return {
          ok: false,
          code: "NOT_ELIGIBLE",
          message: decision.explanation,
          eligibility: { ok: true, item: itemRef(item), ...decision },
        };
      }

      let type = input.type;
      const nextSteps: string[] = [];
      if (type === "exchange") {
        const stock = catalog.checkStock({ product: item.productId, size: input.exchangeSize!, width: item.width, color: item.color });
        if (!stock.ok) return { ok: false, code: "INVALID_VARIANT", message: stock.message };
        if (!stock.available) {
          // Policy (returns-policy#exchanges): out-of-stock exchanges become refunds.
          type = "refund";
          nextSteps.push(`Size ${input.exchangeSize} is out of stock, so this has been set up as a refund instead.`);
        }
      }

      const record = returns.create({
        orderId: order.orderId,
        itemId: item.itemId,
        type,
        reason: input.reason,
        exchangeSize: type === "exchange" ? input.exchangeSize! : null,
        createdAt: deps.clock.now().toISOString(),
      });

      const domestic = order.shippingAddress.country === "US";
      nextSteps.push(
        domestic
          ? "A prepaid return label has been sent to the email address on the order."
          : "Please ship the item to our Returns Center; international return shipping is paid by the customer.",
        `Write ${record.rma} on the outside of the package.`,
        type === "refund"
          ? "Your refund will be issued to the original payment method within 5–7 business days after we receive the item."
          : `We'll ship size ${input.exchangeSize} as soon as your return is scanned by the carrier.`,
      );

      return {
        ok: true,
        rma: record.rma,
        item: itemRef(item),
        type,
        refundAmount: type === "refund" ? item.unitPrice * item.quantity : null,
        exchangeSize: record.exchangeSize,
        nextSteps,
      };
    },
  };
}

export type ToolHandlers = ReturnType<typeof createToolHandlers>;
