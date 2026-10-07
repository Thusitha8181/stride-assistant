import { describe, expect, it } from "vitest";
import { findPii } from "../test/helpers";

/** Regression test for the \b blind spot: values starting with "+" were never matched. */
describe("fixture PII detection @F16", () => {
  it("detects phone numbers that start with +", () => {
    expect(findPii({ note: "call +1 512-555-0142" })).toHaveLength(1);
  });

  it("still matches whole values only", () => {
    expect(findPii({ tracking: "1Z999AA10000004111" })).toEqual([]);
  });
});
