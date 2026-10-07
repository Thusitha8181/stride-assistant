import { tool } from "langchain";
import {
  CheckReturnEligibilityInput,
  CheckStockInput,
  CreateReturnInput,
  GetOrderStatusInput,
  SearchKnowledgeBaseInput,
  SearchProductsInput,
} from "@stride/shared";
import type { BaseMessage } from "@langchain/core/messages";
import type { ToolHandlers } from "../tools/handlers";
import { repairCredentials } from "./credentials";

/**
 * Wraps the tool handlers as LangChain tools. The zod schemas (with descriptions) become
 * the JSON Schema the model sees; LangChain validates arguments before the handler runs
 * and returns validation errors to the model so it can correct itself (F3).
 * Results are returned as JSON so the stream layer can turn them into UI cards.
 */
export function createAgentTools(handlers: ToolHandlers) {
  const json = <I, O>(fn: (input: I) => Promise<O>) => async (input: I) => JSON.stringify(await fn(input));

  /** Order tools: repair credentials the model mis-copied, using what the customer actually typed. */
  const withTypedCredentials =
    <I extends { orderId?: string; email?: string }, O>(fn: (input: I) => Promise<O>) =>
    async (input: I, runtime?: { state?: unknown }) => {
      const messages = (runtime?.state as { messages?: BaseMessage[] } | undefined)?.messages ?? [];
      return JSON.stringify(await fn(repairCredentials(input, messages)));
    };

  return [
    tool(json(handlers.searchKnowledgeBase), {
      name: "searchKnowledgeBase",
      description:
        "Search Stride's help center: return/exchange policy, shipping, warranty, sizing, stores, contact, discounts, sustainability, company info. Returns chunks with an `id` to cite as [[id]]. Use for ANY policy or company question.",
      schema: SearchKnowledgeBaseInput,
    }),
    tool(json(handlers.searchProducts), {
      name: "searchProducts",
      description:
        "Find Stride shoes by description, with optional category, max price and size filters. Returns up to 5 products with price, sizes and `inStockSizes`.",
      schema: SearchProductsInput,
    }),
    tool(json(handlers.checkStock), {
      name: "checkStock",
      description:
        "Check live stock for one product in a specific size (and optional width/color). When the customer names a product, call this directly (no need to search first). When unavailable, returns nearby sizes, other widths/colors and similar products to suggest.",
      schema: CheckStockInput,
    }),
    tool(withTypedCredentials(handlers.getOrderStatus), {
      name: "getOrderStatus",
      description:
        "Get an order's status, items (with item ids), tracking timeline and delivery estimate. Requires BOTH the order number and the email address the customer gave you; never guess either.",
      schema: GetOrderStatusInput,
    }),
    tool(withTypedCredentials(handlers.checkReturnEligibility), {
      name: "checkReturnEligibility",
      description:
        "Check whether one item in an order can be returned or exchanged, and why not if it can't (with the policy id to cite and alternatives). Requires order number, email and the item id.",
      schema: CheckReturnEligibilityInput,
    }),
    tool(withTypedCredentials(handlers.createReturn), {
      name: "createReturn",
      description:
        "Start a return or exchange and get an RMA number. Only call after checkReturnEligibility says eligible AND the customer has confirmed refund vs exchange (and the new size for exchanges).",
      schema: CreateReturnInput,
    }),
  ];
}
