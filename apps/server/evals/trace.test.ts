import { describe, expect, it } from "vitest";
import { tokensUsed } from "./trace";

describe("tokensUsed", () => {
  it("reads LangChain usage_metadata", () => {
    expect(tokensUsed({ usage_metadata: { total_tokens: 128 } })).toBe(128);
  });

  it("reads Groq's streamed response_metadata.usage (usage_metadata is absent when streaming)", () => {
    expect(tokensUsed({ response_metadata: { usage: { prompt_tokens: 73, completion_tokens: 53 } } })).toBe(126);
  });

  it("falls back to llmOutput.tokenUsage, then 0", () => {
    expect(tokensUsed({}, { llmOutput: { tokenUsage: { totalTokens: 99 } } })).toBe(99);
    expect(tokensUsed({})).toBe(0);
  });
});
