import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";
import { Card, ChatErrorCode } from "@stride/shared";

export const evalsDir = path.dirname(fileURLToPath(import.meta.url));

export const TOOL_NAMES = [
  "searchKnowledgeBase",
  "searchProducts",
  "checkStock",
  "getOrderStatus",
  "checkReturnEligibility",
  "createReturn",
] as const;
const ToolName = z.enum(TOOL_NAMES);
const CardKind = z.enum(Card.options.map((o) => o.shape.kind.value) as [string, ...string[]]);

/** What one turn must (not) do. Every field is optional; unset = not checked. Regexes are case-insensitive. */
export const TurnExpect = z.strictObject({
  toolsCalled: z.array(ToolName).default([]),
  /** At least one of these must be called. */
  toolsAnyOf: z.array(ToolName).default([]),
  toolsNotCalled: z.array(ToolName).default([]),
  /** Some call of the tool must include these argument values (strings compared case-insensitively). */
  toolArgs: z.partialRecord(ToolName, z.record(z.string(), z.unknown())).default({}),
  /** Failure codes that tool calls must report (e.g. UNVERIFIED). */
  toolCodes: z.array(z.string()).default([]),
  cards: z.array(CardKind).default([]),
  /** Knowledge-base chunks the answer must cite. */
  citations: z.array(z.string()).default([]),
  /** Knowledge-base chunks searchKnowledgeBase must return this turn. */
  retrieved: z.array(z.string()).default([]),
  mustContain: z.array(z.string()).default([]),
  mustNotContain: z.array(z.string()).default([]),
  /** Expected error event; without it, any error event fails the turn. */
  errorCode: ChatErrorCode.optional(),
});
export type TurnExpect = z.infer<typeof TurnExpect>;

const CaseId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "kebab-case ids");

export const ChatCase = z.strictObject({
  id: CaseId,
  description: z.string().optional(),
  turns: z.array(z.strictObject({ user: z.string().min(1), expect: TurnExpect.default(TurnExpect.parse({})) })).min(1),
});
export type ChatCase = z.infer<typeof ChatCase>;

export const RetrievalCase = z.strictObject({
  id: CaseId,
  query: z.string().min(1),
  /** Any of these chunk ids in the top k counts as a hit. */
  expected: z.array(z.string()).min(1),
  k: z.number().int().positive().default(3),
});
export type RetrievalCase = z.infer<typeof RetrievalCase>;

export const DatasetFile = z.discriminatedUnion("kind", [
  z.strictObject({ dataset: z.string(), kind: z.literal("chat"), description: z.string().optional(), cases: z.array(ChatCase).min(1) }),
  z.strictObject({
    dataset: z.string(),
    kind: z.literal("retrieval"),
    description: z.string().optional(),
    cases: z.array(RetrievalCase).min(1),
  }),
]);
export type DatasetFile = z.infer<typeof DatasetFile>;

/** Loads and validates every evals/cases/*.yaml file; case ids must be unique across datasets. */
export function loadDatasets(dir = path.join(evalsDir, "cases")): DatasetFile[] {
  const datasets = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => {
      const parsed = DatasetFile.safeParse(parse(readFileSync(path.join(dir, f), "utf8")));
      if (!parsed.success) throw new Error(`${f}: ${z.prettifyError(parsed.error)}`);
      return parsed.data;
    });
  const ids = datasets.flatMap((d) => d.cases.map((c) => c.id));
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`Duplicate eval case ids: ${[...new Set(dupes)].join(", ")}`);
  return datasets;
}
