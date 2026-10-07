import { describe, expect, it } from "vitest";
import { loadCompanyDocs } from "../data/load";
import { POLICY_SOURCES } from "../domain/returnRules";
import { chunkMarkdown, slugify } from "./chunk";

const chunks = loadCompanyDocs().flatMap(chunkMarkdown);

describe("chunkMarkdown", () => {
  it("creates one chunk per ## section with a stable id", () => {
    const [first] = chunkMarkdown({ slug: "doc", markdown: "# Doc Title\nintro\n\n## First Part\nalpha\n\n## Second\nbeta\n" });
    expect(first).toEqual({ id: "doc#first-part", source: "doc", title: "Doc Title: First Part", text: "First Part\nalpha" });
  });

  it("slugifies headings", () => {
    expect(slugify("Do you offer gift cards?")).toBe("do-you-offer-gift-cards");
  });

  it("produces unique chunk ids across the knowledge base", () => {
    const ids = chunks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(30);
  });

  it("every policy source cited by the return rules exists in the KB @F7", () => {
    const ids = new Set(chunks.map((c) => c.id));
    for (const source of Object.values(POLICY_SOURCES)) expect(ids, source).toContain(source);
  });
});

describe("knowledge base privacy @F16", () => {
  it("contains no personal phone numbers or personal email addresses", () => {
    const text = chunks.map((c) => c.text).join("\n");
    const emails = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];
    expect(emails.every((e) => /^(support|press|partners)@stride\.example$/.test(e))).toBe(true);
    const phones = text.match(/\+?\d[\d\s().-]{8,}\d/g) ?? [];
    expect(phones).toEqual(["1-800-555-0199"]);
  });
});
