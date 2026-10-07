import type { ChatEvent } from "@stride/shared";
import type { OrderRecord } from "../src/data/orderRecord";
import type { KnowledgeIndex } from "../src/rag/indexes";
import type { RetrievalCase, TurnExpect } from "./schema";
import type { TurnTrace } from "./trace";

export type TurnRun = {
  user: string;
  expect: TurnExpect;
  events: ChatEvent[];
  trace: TurnTrace;
  text: string;
  latencyMs: number;
};

export type EvalResult = { key: string; pass: boolean; score: number; comment?: string };

export type EvalEnv = {
  kbIds: Set<string>;
  /** Every PII value in the order fixtures. */
  pii: string[];
};

/** Models like Unicode punctuation ("O\u20111042" with a non-breaking hyphen, curly quotes); compare on plain ASCII. */
export const normalize = (s: string) =>
  s
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u00a0\u202f]/g, " ");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Matches a value only as a whole token. Lookarounds instead of \b: \b never matches
 * before a non-word character, so "+1 512-555-0142" would be invisible to a \b pattern.
 */
export const wholeValue = (v: string) => new RegExp(`(?<![\\w])${escape(v)}(?![\\w])`, "i");

export function piiValues(orders: OrderRecord[]): string[] {
  const values = orders.flatMap((o) => [
    o.customer.name,
    o.customer.email,
    o.customer.phone,
    o.shippingAddress.line1,
    ...(o.shippingAddress.line2 ? [o.shippingAddress.line2] : []),
    o.shippingAddress.postalCode,
    o.payment.last4,
  ]);
  return [...new Set(values)];
}

const result = (key: string, checks: Array<[ok: boolean, failure: string]>): EvalResult | null => {
  if (!checks.length) return null;
  const failed = checks.filter(([ok]) => !ok).map(([, msg]) => msg);
  return { key, pass: !failed.length, score: (checks.length - failed.length) / checks.length, ...(failed.length && { comment: failed.join("; ") }) };
};

const same = (actual: unknown, expected: unknown): boolean => {
  if (typeof expected === "string") return typeof actual === "string" && normalize(actual).trim().toLowerCase() === expected.trim().toLowerCase();
  if (typeof expected === "number") return Number(actual) === expected;
  return JSON.stringify(actual) === JSON.stringify(expected);
};

// ---------------------------------------------------------------- per-turn evaluators

type TurnEvaluator = (turn: TurnRun, ctx: { history: TurnRun[]; env: EvalEnv }) => EvalResult | null;

const calledTools = (t: TurnRun) => t.events.flatMap((e) => (e.type === "tool-start" ? [e.name] : []));

export const toolsEvaluator: TurnEvaluator = (t) => {
  const called = calledTools(t);
  const codes = t.events.flatMap((e) => (e.type === "tool-end" && e.code ? [e.code] : []));
  const x = t.expect;
  return result("tools", [
    ...x.toolsCalled.map((name): [boolean, string] => [called.includes(name), `expected ${name} to be called (called: ${called.join(", ") || "none"})`]),
    ...(x.toolsAnyOf.length ? [[x.toolsAnyOf.some((n) => called.includes(n)), `expected one of ${x.toolsAnyOf.join("/")}`] as [boolean, string]] : []),
    ...x.toolsNotCalled.map((name): [boolean, string] => [!called.includes(name), `${name} must not be called`]),
    ...Object.entries(x.toolArgs).map(([name, args]): [boolean, string] => {
      const calls = t.trace.tools.filter((c) => c.name === name);
      const ok = calls.some((c) => Object.entries(args ?? {}).every(([k, v]) => same((c.args as Record<string, unknown>)?.[k], v)));
      return [ok, `expected ${name} with ${JSON.stringify(args)} (got ${calls.map((c) => JSON.stringify(c.args)).join(" | ") || "no calls"})`];
    }),
    ...x.toolCodes.map((code): [boolean, string] => [codes.includes(code), `expected a tool to report ${code}`]),
  ]);
};

export const cardsEvaluator: TurnEvaluator = (t) => {
  const kinds = t.events.flatMap((e) => (e.type === "card" ? [e.card.kind] : []));
  return result("cards", t.expect.cards.map((k) => [kinds.includes(k as never), `expected a ${k} card`]));
};

export const citationsEvaluator: TurnEvaluator = (t) => {
  const cited = t.events.flatMap((e) => (e.type === "citation" ? e.sources.map((s) => s.id) : []));
  return result("citations", t.expect.citations.map((id) => [cited.includes(id), `expected citation ${id} (cited: ${cited.join(", ") || "none"})`]));
};

/** Every [[marker]] in the answer must be a real KB chunk; anything else is a hallucinated citation. */
export const citationValidityEvaluator: TurnEvaluator = (t, { env }) => {
  const markers = [...t.text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]!);
  return result("citation-validity", markers.map((m) => [env.kbIds.has(m), `invalid citation [[${m}]]`]));
};

export const retrievedEvaluator: TurnEvaluator = (t) => {
  const ids = t.trace.tools
    .filter((c) => c.name === "searchKnowledgeBase")
    .flatMap((c) => ((c.output as { chunks?: Array<{ id: string }> })?.chunks ?? []).map((ch) => ch.id));
  return result("retrieval", t.expect.retrieved.map((id) => [ids.includes(id), `expected ${id} to be retrieved (got: ${ids.join(", ") || "none"})`]));
};

export const contentEvaluator: TurnEvaluator = (t) => {
  const text = normalize(t.text);
  return result("content", [
    ...t.expect.mustContain.map((re): [boolean, string] => [new RegExp(re, "i").test(text), `missing /${re}/`]),
    ...t.expect.mustNotContain.map((re): [boolean, string] => [!new RegExp(re, "i").test(text), `must not contain /${re}/`]),
  ]);
};

/**
 * Hallucination check: every price and identifier in the answer must appear in a tool
 * result (this turn or earlier) or in what the customer typed.
 */
export const groundingEvaluator: TurnEvaluator = (t, { history }) => {
  const text = normalize(t.text);
  const sources = normalize(JSON.stringify([...history, t].map((h) => [h.user, h.trace.tools.map((c) => c.output)])));
  const numbers = new Set([...sources.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])));

  const prices = [...text.matchAll(/\$\s?(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)/g)].map((m) => m[1]!.replace(/,/g, ""));
  const ids = [...text.matchAll(/\b(O-\d{4}|RMA-\d{6}|P-\d{3}|1Z[0-9A-Z]{16})\b/g)].map((m) => m[1]!);
  return result("grounding", [
    ...prices.map((p): [boolean, string] => [numbers.has(Number(p)), `ungrounded price $${p}`]),
    ...ids.map((id): [boolean, string] => [sources.includes(id), `ungrounded identifier ${id}`]),
  ]);
};

/**
 * Zero-tolerance privacy check (PRD §4.4): no fixture PII in the answer or in anything
 * sent to the model, except values the customer typed themselves.
 */
export const privacyEvaluator: TurnEvaluator = (t, { history, env }) => {
  const typed = normalize([...history, t].map((h) => h.user).join("\n")).toLowerCase();
  const watched = env.pii.filter((v) => !typed.includes(v.toLowerCase()));
  const leaks = (haystack: string) => watched.filter((v) => wholeValue(v).test(haystack));
  const inAnswer = leaks(normalize(t.text));
  const toModel = leaks(t.trace.modelCalls.map((c) => c.input).join("\n"));
  return result("privacy", [
    [!inAnswer.length, `PII in answer: ${inAnswer.join(", ")}`],
    [!toModel.length, `PII sent to the model: ${toModel.join(", ")}`],
  ]);
};

export const errorsEvaluator: TurnEvaluator = (t) => {
  const errors = t.events.flatMap((e) => (e.type === "error" ? [e.code] : []));
  const expected = t.expect.errorCode;
  return result("errors", [
    expected ? [errors.includes(expected), `expected error ${expected}`] : [!errors.length, `unexpected error ${errors.join(", ")}`],
  ]);
};

export const TURN_EVALUATORS: TurnEvaluator[] = [
  toolsEvaluator,
  cardsEvaluator,
  citationsEvaluator,
  citationValidityEvaluator,
  retrievedEvaluator,
  contentEvaluator,
  groundingEvaluator,
  privacyEvaluator,
  errorsEvaluator,
];

/** Scores a whole conversation: each evaluator runs per turn, then results merge per key. */
export function evaluateConversation(turns: TurnRun[], env: EvalEnv): EvalResult[] {
  const byKey = new Map<string, Array<EvalResult & { turn: number }>>();
  turns.forEach((turn, i) => {
    for (const evaluator of TURN_EVALUATORS) {
      const r = evaluator(turn, { history: turns.slice(0, i), env });
      if (r) byKey.set(r.key, [...(byKey.get(r.key) ?? []), { ...r, turn: i + 1 }]);
    }
  });
  return [...byKey.entries()].map(([key, rs]) => {
    const failed = rs.filter((r) => !r.pass);
    return {
      key,
      pass: !failed.length,
      score: rs.reduce((s, r) => s + r.score, 0) / rs.length,
      ...(failed.length && { comment: failed.map((r) => (turns.length > 1 ? `turn ${r.turn}: ${r.comment}` : r.comment)).join(" | ") }),
    };
  });
}

// ---------------------------------------------------------------- retrieval cases

export async function evaluateRetrieval(c: RetrievalCase, index: KnowledgeIndex): Promise<{ results: EvalResult[]; ranked: string[] }> {
  const ranked = (await index.search(c.query, Math.max(c.k, 10))).map((h) => h.chunk.id);
  const rank = ranked.findIndex((id) => c.expected.includes(id)) + 1; // 0 = not found
  const hit = rank > 0 && rank <= c.k;
  return {
    ranked,
    results: [
      { key: `hit@${c.k}`, pass: hit, score: hit ? 1 : 0, ...(!hit && { comment: `expected ${c.expected.join(" or ")}, top ${c.k}: ${ranked.slice(0, c.k).join(", ")}` }) },
      { key: "mrr", pass: true, score: rank ? 1 / rank : 0 },
    ],
  };
}
