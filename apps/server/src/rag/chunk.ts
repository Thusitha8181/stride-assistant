import type { CompanyDoc } from "../data/load";

export type Chunk = { id: string; source: string; title: string; text: string };

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * One chunk per "## " section. Chunk ids ("returns-policy#final-sale-items") are
 * stable, so they can be cited in answers and used as retrieval-eval labels.
 */
export function chunkMarkdown(doc: CompanyDoc): Chunk[] {
  const docTitle = doc.markdown.match(/^# (.+)$/m)?.[1]?.trim() ?? doc.slug;
  const sections = doc.markdown.split(/^## /m).slice(1);
  return sections.map((section) => {
    const [heading = "", ...body] = section.split("\n");
    return {
      id: `${doc.slug}#${slugify(heading)}`,
      source: doc.slug,
      title: `${docTitle}: ${heading.trim()}`,
      text: `${heading.trim()}\n${body.join("\n").trim()}`,
    };
  });
}
