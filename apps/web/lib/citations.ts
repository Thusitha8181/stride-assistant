import type { CitationSource } from "@stride/shared";

const MARKER = /\[\[([^\]\s]+)\]\]/g;
/** A marker still being streamed, e.g. "… delivery [[returns-pol". */
const PARTIAL_MARKER = /\[\[[^\]]*\]?$/;

export const CITE_SCHEME = "cite:";

/**
 * Turns the model's inline `[[chunk-id]]` markers into markdown links (`cite:` scheme)
 * that the renderer shows as source pills. Only ids confirmed by the server's `citation`
 * event become pills; anything else (still streaming, or invented by the model) is hidden.
 */
export function linkCitations(text: string, sources: CitationSource[]): string {
  const titles = new Map(sources.map((s) => [s.id, s.title]));
  return text
    .replace(PARTIAL_MARKER, "")
    .replace(MARKER, (_, id: string) => {
      const title = titles.get(id);
      return title ? `[${shortTitle(title)}](${CITE_SCHEME}${encodeURIComponent(id)})` : "";
    })
    .replace(/[ \t]+([.,;:!?])/g, "$1");
}

/** "Return Policy: Return window" → "Return window". */
export const shortTitle = (title: string) => title.split(": ").at(-1) ?? title;
