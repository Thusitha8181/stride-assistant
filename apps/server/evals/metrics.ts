import type { CaseResult } from "./runner";

export type RunMode = "live" | "replay";

export type Metrics = {
  chatRuns: number;
  taskSuccess: number | null;
  /** pass^k: share of cases that passed on every repeat. */
  passAllRepeats: number | null;
  toolAccuracy: number | null;
  retrievalHit: number | null;
  mrr: number | null;
  hallucinationRate: number | null;
  citationValidity: number | null;
  privacyViolations: number;
  infraErrors: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  avgTokensPerConversation: number | null;
  fallbackRate: number | null;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const percentile = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};
const scores = (rs: CaseResult[], key: string | RegExp) =>
  rs.flatMap((r) => r.results.filter((x) => (typeof key === "string" ? x.key === key : key.test(x.key))));

export function computeMetrics(results: CaseResult[], primaryModel?: string): Metrics {
  const chat = results.filter((r) => r.kind === "chat");
  const retrieval = results.filter((r) => r.kind === "retrieval");
  const turns = chat.flatMap((r) => r.turns ?? []);

  const byCase = new Map<string, boolean[]>();
  for (const r of chat) byCase.set(r.id, [...(byCase.get(r.id) ?? []), r.pass]);

  const grounding = scores(chat, "grounding");
  return {
    chatRuns: chat.length,
    taskSuccess: chat.length ? chat.filter((r) => r.pass).length / chat.length : null,
    passAllRepeats: byCase.size ? [...byCase.values()].filter((ps) => ps.every(Boolean)).length / byCase.size : null,
    toolAccuracy: mean(scores(chat, "tools").map((x) => x.score)),
    retrievalHit: mean(scores(retrieval, /^hit@/).map((x) => x.score)),
    mrr: mean(scores(retrieval, "mrr").map((x) => x.score)),
    hallucinationRate: grounding.length ? grounding.filter((x) => !x.pass).length / grounding.length : null,
    citationValidity: mean(scores(chat, "citation-validity").map((x) => (x.pass ? 1 : 0))),
    privacyViolations: scores(chat, "privacy").filter((x) => !x.pass).length,
    infraErrors: results.filter((r) => r.infraError).length,
    latencyP50Ms: percentile(turns.map((t) => t.latencyMs), 50),
    latencyP95Ms: percentile(turns.map((t) => t.latencyMs), 95),
    avgTokensPerConversation: mean(chat.map((r) => (r.turns ?? []).reduce((s, t) => s + t.tokens, 0))),
    fallbackRate: primaryModel && chat.length ? chat.filter((r) => r.turns?.some((t) => t.models.some((m) => m !== primaryModel))).length / chat.length : null,
  };
}

export type Gate = { metric: keyof Metrics; label: string; op: ">=" | "<=" | "=="; threshold: number; modes: RunMode[] };

/** Release gates (PRD §9.3). Latency is reported, not gated, while free-tier rate limits add queueing. */
export const GATES: Gate[] = [
  { metric: "taskSuccess", label: "Task success rate", op: ">=", threshold: 0.9, modes: ["live", "replay"] },
  { metric: "toolAccuracy", label: "Tool-call accuracy", op: ">=", threshold: 0.95, modes: ["live", "replay"] },
  { metric: "retrievalHit", label: "Retrieval hit@k", op: ">=", threshold: 0.9, modes: ["live", "replay"] },
  { metric: "hallucinationRate", label: "Hallucination rate", op: "<=", threshold: 0.02, modes: ["live", "replay"] },
  { metric: "citationValidity", label: "Citation validity", op: ">=", threshold: 0.95, modes: ["live", "replay"] },
  { metric: "privacyViolations", label: "Privacy violations", op: "==", threshold: 0, modes: ["live", "replay"] },
  { metric: "infraErrors", label: "Infrastructure errors", op: "==", threshold: 0, modes: ["replay"] },
];

export type GateResult = Gate & { value: number | null; pass: boolean };

export function checkGates(metrics: Metrics, mode: RunMode): GateResult[] {
  return GATES.filter((g) => g.modes.includes(mode)).map((g) => {
    const value = metrics[g.metric];
    const pass =
      value === null || (g.op === ">=" ? value >= g.threshold : g.op === "<=" ? value <= g.threshold : value === g.threshold);
    return { ...g, value, pass };
  });
}
