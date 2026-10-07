import { describe, expect, it } from "vitest";
import { nameSimilarity, osaDistance, tokenize } from "./fuzzy";

describe("osaDistance", () => {
  it.each([
    ["O-1042", "O-1042", 0],
    ["O-1024", "O-1042", 1], // transposition
    ["O-1043", "O-1042", 1], // substitution
    ["O-104", "O-1042", 1], // deletion
    ["O-1099", "O-1042", 2],
    ["", "abc", 3],
  ])("%s → %s = %i", (a, b, d) => {
    expect(osaDistance(a, b)).toBe(d);
  });
});

describe("nameSimilarity", () => {
  it("tolerates one typo per token", () => {
    expect(nameSimilarity("trail runer x", "Trail Runner X")).toBe(1);
  });

  it("is 0 for unrelated names and empty input", () => {
    expect(nameSimilarity("chelsea", "Trail Runner X")).toBe(0);
    expect(nameSimilarity("", "Trail Runner X")).toBe(0);
  });

  it("tokenizes punctuation and case", () => {
    expect(tokenize("Kids' Light-Up!")).toEqual(["kids", "light", "up"]);
  });
});
