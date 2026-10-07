import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { osaDistance } from "../domain/fuzzy";

const INVISIBLE = /[\u200b-\u200d\u2060\ufeff]/g;
const DASHES = /[\u2010-\u2015\u2212]/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const ORDER_ID = /\bO\s*-?\s*(\d{4})\b/gi;

const clean = (s: string) => s.replace(INVISIBLE, "").replace(DASHES, "-");
const textOf = (m: BaseMessage) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));

/** Emails and order numbers the customer has typed in this conversation (normalized). */
export function typedCredentials(messages: BaseMessage[]) {
  const text = clean(messages.filter((m) => HumanMessage.isInstance(m)).map(textOf).join("\n"));
  return {
    emails: [...new Set([...text.matchAll(EMAIL)].map((m) => m[0].toLowerCase().replace(/\.$/, "")))],
    orderIds: [...new Set([...text.matchAll(ORDER_ID)].map((m) => `O-${m[1]}`))],
  };
}

/**
 * Models occasionally corrupt values while copying them into tool calls (live finding:
 * gpt-oss sent "priyaa.shah@example.com" for "priya.shah@example.com"). If the model's value
 * is not something the customer typed but is within `maxEdits` of exactly one typed value,
 * use the typed value. This never invents credentials: the result is always either the
 * model's own value or one the customer entered, so it cannot widen access.
 */
export function repairToTyped(value: string, typed: string[], maxEdits: number): string {
  if (typed.includes(value)) return value;
  const close = typed.map((t) => ({ t, d: osaDistance(t, value) })).filter((x) => x.d <= maxEdits);
  const best = Math.min(...close.map((x) => x.d));
  const winners = close.filter((x) => x.d === best);
  return winners.length === 1 ? winners[0]!.t : value;
}

export function repairCredentials<T extends { orderId?: string; email?: string }>(input: T, messages: BaseMessage[]): T {
  const typed = typedCredentials(messages);
  return {
    ...input,
    ...(input.email && { email: repairToTyped(input.email, typed.emails, 2) }),
    ...(input.orderId && { orderId: repairToTyped(input.orderId, typed.orderIds, 1) }),
  };
}
