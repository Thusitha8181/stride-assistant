import { describe, expect, it } from "vitest";
import { loadCompanyDocs } from "../src/data/load";
import { chunkMarkdown } from "../src/rag/chunk";
import { loadCassette } from "./replay";
import { loadDatasets } from "./schema";

/** Guards the eval cases themselves: a typo in an expectation would silently test nothing. */
describe("eval cases", () => {
  const datasets = loadDatasets();
  const kbIds = new Set(loadCompanyDocs().flatMap(chunkMarkdown).map((c) => c.id));

  it("load, validate and have unique ids", () => {
    expect(datasets.map((d) => d.dataset).sort()).toEqual(["happy-path", "multi-turn", "retrieval"]);
  });

  it("reference only real knowledge-base chunks", () => {
    const referenced = datasets.flatMap((d) =>
      d.kind === "retrieval"
        ? d.cases.flatMap((c) => c.expected)
        : d.cases.flatMap((c) => c.turns.flatMap((t) => [...t.expect.citations, ...t.expect.retrieved])),
    );
    expect(referenced.filter((id) => !kbIds.has(id))).toEqual([]);
  });

  it("have valid regexes", () => {
    for (const d of datasets)
      if (d.kind === "chat")
        for (const c of d.cases)
          for (const t of c.turns) for (const re of [...t.expect.mustContain, ...t.expect.mustNotContain]) expect(() => new RegExp(re, "i"), `${c.id}: ${re}`).not.toThrow();
  });

  it("every chat turn checks something", () => {
    for (const d of datasets)
      if (d.kind === "chat")
        for (const c of d.cases)
          for (const t of c.turns) {
            const x = t.expect;
            const checks = x.toolsCalled.length + x.toolsAnyOf.length + x.toolsNotCalled.length + Object.keys(x.toolArgs).length + x.cards.length + x.mustContain.length;
            expect(checks, `${c.id}: "${t.user}"`).toBeGreaterThan(0);
          }
  });

  it("marks a case pendingRecording only while it has no cassette", () => {
    for (const d of datasets)
      if (d.kind === "chat")
        for (const c of d.cases)
          if (c.pendingRecording) expect(loadCassette(c.id), `${c.id} is recorded: remove pendingRecording`).toBeNull();
  });
});
