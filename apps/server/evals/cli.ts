/**
 * Agent eval runner (PRD §9).
 *
 *   npm run eval:mock                       # replay recorded cassettes: deterministic, offline (CI)
 *   npm run eval                            # live against the configured model (Groq)
 *   npm run eval:record                     # live, and (re)record cassettes for eval:mock
 *
 * Options: --dataset happy-path,retrieval  --case order-   --repeats 3   --model openai/gpt-oss-20b
 *          --missing (only cases without a cassette)   --update-baseline
 * Exits non-zero when a release gate fails.
 */
import "../src/env";
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config";
import { createChatModel } from "../src/llm/models";
import { createEmbeddings } from "../src/rag/embeddings";
import { checkGates, computeMetrics, type RunMode } from "./metrics";
import { loadCassette, ReplayChatModel, saveCassette } from "./replay";
import { diffBaseline, renderSummary, writeBaseline, writeReport } from "./report";
import { createWorld, runChatCase, runRetrievalCase, type CaseModels, type CaseResult } from "./runner";
import { loadDatasets } from "./schema";

const { values: args } = parseArgs({
  options: {
    mode: { type: "string", default: "replay" },
    dataset: { type: "string" },
    case: { type: "string" },
    repeats: { type: "string", default: "1" },
    record: { type: "boolean", default: false },
    /** Only run chat cases that have no cassette yet (cheap way to finish a recording). */
    missing: { type: "boolean", default: false },
    model: { type: "string" },
    "update-baseline": { type: "boolean", default: false },
  },
});

const mode = args.mode as RunMode;
if (mode !== "live" && mode !== "replay") throw new Error(`--mode must be live or replay`);
if (args.record && mode !== "live") throw new Error("--record needs --mode live");
const repeats = Math.max(1, Number(args.repeats));

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

const config = loadConfig({ ...process.env, ...(args.model && { LLM_MODEL: args.model }) });
const datasets = loadDatasets().filter((d) => !args.dataset || args.dataset.split(",").includes(d.dataset));
const selected = (id: string, kind: string) =>
  (!args.case || id.includes(args.case)) && (!args.missing || (kind === "chat" && !loadCassette(id)));

console.log(`Evals: ${mode} mode · embeddings ${config.EMBEDDINGS_PROVIDER}${mode === "live" ? ` · ${config.LLM_PROVIDER}:${config.LLM_MODEL}` : ""}\n`);

const world = createWorld(createEmbeddings(config));
const live: CaseModels | null =
  mode === "live"
    ? { model: await createChatModel(config, "primary"), fallbackModel: await createChatModel(config, "fallback") }
    : null;

const results: CaseResult[] = [];
const report = (r: CaseResult, ms: number) => {
  if (r.skipped) return console.log(`${dim("○")} ${r.dataset}/${r.id} ${dim(`skipped: pending recording (${r.skipped})`)}`);
  const status = r.pass ? green("✓") : red("✖");
  const why = r.pass ? "" : red(` ${r.infraError ?? r.results.filter((x) => !x.pass).map((x) => `${x.key}: ${x.comment}`).join(" · ")}`);
  const failure = r.logs?.find((l) => l.startsWith("chat turn failed"));
  console.log(`${status} ${r.dataset}/${r.id}${r.repeat > 1 ? `#${r.repeat}` : ""} ${dim(`${(ms / 1000).toFixed(1)}s`)}${why}`);
  if (failure) console.log(dim(`    ↳ ${failure.slice(0, 400)}`));
};

for (const dataset of datasets) {
  for (const c of dataset.cases.filter((c) => selected(c.id, dataset.kind))) {
    for (let repeat = 1; repeat <= (dataset.kind === "chat" ? repeats : 1); repeat++) {
      const started = Date.now();
      let result: CaseResult;
      if (dataset.kind === "retrieval") {
        result = await runRetrievalCase(world, dataset.dataset, c as never);
      } else if (live) {
        const run = await runChatCase(world, dataset.dataset, c as never, live, repeat);
        result = run.result;
        // Don't record runs that failed for infrastructure reasons (rate limits), only real behavior.
        if (args.record && repeat === 1 && !result.infraError) saveCassette(run.cassette);
      } else {
        const cassette = loadCassette(c.id);
        const pending = (c as { pendingRecording?: string }).pendingRecording;
        result = !cassette && pending
          ? { id: c.id, dataset: dataset.dataset, kind: "chat", repeat, pass: true, results: [], skipped: pending }
          : cassette
          ? (await runChatCase(world, dataset.dataset, c as never, { model: new ReplayChatModel(cassette.responses) })).result
          : { id: c.id, dataset: dataset.dataset, kind: "chat", repeat, pass: false, results: [], infraError: "no cassette; run npm run eval:record" };
      }
      results.push(result);
      report(result, Date.now() - started);
    }
  }
}

const skipped = results.filter((r) => r.skipped);
const scored = results.filter((r) => !r.skipped);
const metrics = computeMetrics(scored, mode === "live" ? config.LLM_MODEL : undefined);
const gates = checkGates(metrics, mode);
const diff = diffBaseline(scored);
const markdown = renderSummary({ mode, results: scored, skipped, metrics, gates, diff, model: live ? `${config.LLM_PROVIDER}:${config.LLM_MODEL}` : undefined });
const file = writeReport(markdown, { mode, metrics, gates, results, skipped }, mode);

console.log("\nGates:");
for (const g of gates) {
  const v = g.value === null ? "n/a" : g.metric === "privacyViolations" || g.metric === "infraErrors" ? g.value : `${(g.value * 100).toFixed(1)}%`;
  console.log(`  ${g.pass ? green("✓") : red("✖")} ${g.label}: ${v} (${g.op} ${g.metric === "privacyViolations" || g.metric === "infraErrors" ? g.threshold : `${g.threshold * 100}%`})`);
}
if (metrics.latencyP50Ms !== null)
  console.log(dim(`  latency p50 ${(metrics.latencyP50Ms / 1000).toFixed(1)}s · p95 ${(metrics.latencyP95Ms! / 1000).toFixed(1)}s · ~${Math.round(metrics.avgTokensPerConversation ?? 0)} tokens/conversation${metrics.fallbackRate !== null ? ` · fallback used in ${(metrics.fallbackRate * 100).toFixed(0)}% of cases` : ""}`));
if (skipped.length) console.log(dim(`  ${skipped.length} case(s) pending recording: ${skipped.map((r) => r.id).join(", ")}`));
if (diff) console.log(dim(`  vs baseline: ${diff.regressions.length} regression(s)${diff.regressions.length ? ` (${diff.regressions.join(", ")})` : ""}, ${diff.fixes.length} fixed`));
console.log(dim(`\nReport: ${file}`));

if (args["update-baseline"]) {
  writeBaseline(scored, mode);
  console.log(dim("Baseline updated."));
}
process.exit(gates.every((g) => g.pass) && !diff?.regressions.length ? 0 : 1);
