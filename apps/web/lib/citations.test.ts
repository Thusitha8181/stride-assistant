import { describe, expect, it } from "vitest";
import { linkCitations } from "./citations";

const sources = [{ id: "returns-policy#return-window", title: "Return Policy: Return window" }];

describe("linkCitations", () => {
  it("turns confirmed markers into cite: links with a short title", () => {
    expect(linkCitations("30 days [[returns-policy#return-window]].", sources)).toBe(
      "30 days [Return window](cite:returns-policy%23return-window).",
    );
  });

  it("hides markers the server did not confirm (still streaming, or invented)", () => {
    expect(linkCitations("Yes [[searchProducts]].", sources)).toBe("Yes.");
    expect(linkCitations("30 days [[returns-policy#return-window]].", [])).toBe("30 days.");
  });

  it("hides a marker that is still streaming in", () => {
    expect(linkCitations("30 days [[returns-pol", sources)).toBe("30 days ");
  });
});
