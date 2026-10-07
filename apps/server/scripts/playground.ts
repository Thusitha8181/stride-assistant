/**
 * Try the Milestone 1 tools against your local Qdrant (no LLM yet).
 *
 *   npm run play                                   # guided tour of the PRD demo cases
 *   npm run play -- <tool> '<json input>'          # call one tool
 *   npm run play -- getOrderStatus '{"orderId":"O-1042","email":"jane@example.com"}'
 */
import "../src/env";
import { loadConfig } from "../src/config";
import { createServices } from "../src/services";

const { tools } = createServices(loadConfig());
type ToolName = keyof typeof tools;

async function call(name: string, input: unknown) {
  if (!(name in tools)) throw new Error(`Unknown tool "${name}". Tools: ${Object.keys(tools).join(", ")}`);
  const fn = tools[name as ToolName] as (input: unknown) => Promise<unknown>;
  try {
    return await fn(input);
  } catch (err) {
    // zod validation errors: what the agent will see as a malformed tool call (F3).
    return { invalidInput: err instanceof Error ? err.message : String(err) };
  }
}

const tour: Array<[title: string, tool: ToolName, input: unknown]> = [
  ["Policy question (RAG + citation id)", "searchKnowledgeBase", { query: "What's your return policy?" }],
  ["Policy question: shipping to Canada", "searchKnowledgeBase", { query: "Do you ship to Canada?" }],
  ["Product search with filters", "searchProducts", { query: "waterproof trail running shoes", category: "trail", maxPrice: 130, size: 10 }],
  ["F8: sold-out size → alternatives", "checkStock", { product: "Trail Runner X", size: 10, width: "wide" }],
  ["F5: product name typo", "checkStock", { product: "Trail Runer X", size: 10 }],
  ["Order status (verified; no personal info in the output)", "getOrderStatus", { orderId: "O-1042", email: "jane@example.com" }],
  ["F6: wrong email → nothing revealed", "getOrderStatus", { orderId: "O-1042", email: "bob@example.com" }],
  ["F5: order-number typo → suggestion (same email only)", "getOrderStatus", { orderId: "O-1024", email: "jane@example.com" }],
  ["F7: boots delivered 45 days ago", "checkReturnEligibility", { orderId: "O-1007", email: "sam.lee@example.com", itemId: "O-1007-1" }],
  ["F7: final-sale item", "checkReturnEligibility", { orderId: "O-1011", email: "maria.garcia@example.com", itemId: "O-1011-1" }],
  ["Eligible return → RMA", "createReturn", { orderId: "O-1046", email: "jane@example.com", itemId: "O-1046-1", reason: "Too small", type: "refund" }],
  ["Same return again → blocked", "createReturn", { orderId: "O-1046", email: "jane@example.com", itemId: "O-1046-1", reason: "Too small", type: "refund" }],
  ["F3: malformed tool input", "getOrderStatus", { orderId: "1042", email: "not-an-email" }],
];

const [name, json] = process.argv.slice(2);
if (name) {
  console.log(JSON.stringify(await call(name, json ? JSON.parse(json) : {}), null, 2));
} else {
  for (const [title, tool, input] of tour) {
    console.log(`\n\x1b[1m▶ ${title}\x1b[0m\n  ${tool}(${JSON.stringify(input)})`);
    console.log(JSON.stringify(await call(tool, input), null, 2).replace(/^/gm, "  "));
  }
}
