import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { GateResult, Metrics, RunMode } from "./metrics";
import type { CaseResult } from "./runner";
import { evalsDir } from "./schema";

export const reportsDir = path.join(evalsDir, "reports");
export const baselinePath = path.join(evalsDir, "baseline.json");

type Baseline = { mode: RunMode; updatedAt: string; cases: Record<string, boolean> };

export type BaselineDiff = { regressions: string[]; fixes: string[]; new: string[] };

const caseKey = (r: CaseResult) => `${r.dataset}/${r.id}`;

/** Per case, a run passes only if every repeat passed. */
const passMap = (results: CaseResult[]) => {
  const map: Record<string, boolean> = {};
  for (const r of results) map[caseKey(r)] = (map[caseKey(r)] ?? true) && r.pass;
  return map;
};

export function diffBaseline(results: CaseResult[]): BaselineDiff | null {
  if (!existsSync(baselinePath)) return null;
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
  const now = passMap(results);
  const keys = Object.keys(now);
  return {
    regressions: keys.filter((k) => baseline.cases[k] === true && !now[k]),
    fixes: keys.filter((k) => baseline.cases[k] === false && now[k]),
    new: keys.filter((k) => !(k in baseline.cases)),
  };
}

export function writeBaseline(results: CaseResult[], mode: RunMode) {
  const baseline: Baseline = { mode, updatedAt: new Date().toISOString(), cases: passMap(results) };
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
}

const fmt = (metric: keyof Metrics, v: number | null) => {
  if (v === null) return "n/a";
  if (/Ms$/.test(metric)) return `${(v / 1000).toFixed(1)}s`;
  if (/Violations|Errors|Runs|Tokens/.test(metric)) return String(Math.round(v));
  return `${(v * 100).toFixed(1)}%`;
};

export function renderSummary(args: {
  mode: RunMode;
  results: CaseResult[];
  metrics: Metrics;
  gates: GateResult[];
  diff: BaselineDiff | null;
  model?: string;
}): string {
  const { mode, results, metrics, gates, diff } = args;
  const lines: string[] = [];
  lines.push(`# Eval report (${mode}${args.model ? `, ${args.model}` : ""})`, "");
  lines.push(`Generated ${new Date().toISOString()}`, "");

  const datasets = [...new Set(results.map((r) => r.dataset))];
  lines.push("| Dataset | Passed | Total |", "|---|---|---|");
  for (const d of datasets) {
    const rs = results.filter((r) => r.dataset === d);
    lines.push(`| ${d} | ${rs.filter((r) => r.pass).length} | ${rs.length} |`);
  }

  lines.push("", "## Metrics", "", "| Metric | Value | Gate |", "|---|---|---|");
  const gated = new Map(gates.map((g) => [g.metric, g]));
  for (const [k, v] of Object.entries(metrics) as Array<[keyof Metrics, number | null]>) {
    const g = gated.get(k);
    lines.push(`| ${k} | ${fmt(k, v)} | ${g ? `${g.pass ? "✅" : "❌"} ${g.op} ${fmt(k, g.threshold)}` : ""} |`);
  }

  const failures = results.filter((r) => !r.pass);
  if (failures.length) {
    lines.push("", "## Failures", "");
    for (const r of failures) {
      lines.push(`### ${caseKey(r)}${r.repeat > 1 ? ` (repeat ${r.repeat})` : ""}`);
      if (r.infraError) lines.push(`- ⚠️ ${r.infraError}`);
      for (const x of r.results.filter((x) => !x.pass)) lines.push(`- **${x.key}**: ${x.comment ?? "failed"}`);
      for (const t of r.turns ?? []) {
        lines.push(`- 👤 ${t.user}`, `  - 🔧 ${t.tools.join(", ") || "no tools"} · ${t.models.join(", ") || "?"}`);
        lines.push(`  - 🤖 ${t.text.replace(/\s+/g, " ").slice(0, 400) || "(no text)"}`);
      }
      if (r.ranked) lines.push(`- ranked: ${r.ranked.slice(0, 5).join(", ")}`);
      lines.push("");
    }
  }

  if (diff) {
    lines.push("", "## Compared with baseline", "");
    lines.push(`- Regressions: ${diff.regressions.join(", ") || "none"}`);
    lines.push(`- Fixed: ${diff.fixes.join(", ") || "none"}`);
    if (diff.new.length) lines.push(`- New cases: ${diff.new.join(", ")}`);
  }
  return lines.join("\n") + "\n";
}

export function writeReport(markdown: string, data: unknown, mode: RunMode): string {
  mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(reportsDir, `${stamp}-${mode}`);
  writeFileSync(`${base}.md`, markdown);
  writeFileSync(`${base}.json`, JSON.stringify(data, null, 2));
  return `${base}.md`;
}
