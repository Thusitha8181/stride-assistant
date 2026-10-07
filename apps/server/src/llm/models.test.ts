import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { createChatModel, missingApiKey, modelSpec } from "./models";

describe("model factory", () => {
  const config = loadConfig({ LLM_PROVIDER: "groq", LLM_MODEL: "big", LLM_FALLBACK_PROVIDER: "openai", LLM_FALLBACK_MODEL: "small" });

  it("resolves primary and fallback specs from config", () => {
    expect(modelSpec(config, "primary")).toEqual({ provider: "groq", model: "big" });
    expect(modelSpec(config, "fallback")).toEqual({ provider: "openai", model: "small" });
  });

  it("detects a missing provider API key", () => {
    expect(missingApiKey("groq", {})).toBe("GROQ_API_KEY");
    expect(missingApiKey("groq", { GROQ_API_KEY: "x" })).toBeNull();
    expect(missingApiKey("some-local-provider", {})).toBeNull();
  });

  it("fails fast with an actionable message when the key is missing", async () => {
    const saved = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      await expect(createChatModel(config, "primary")).rejects.toThrow(/GROQ_API_KEY is not set .*groq:big/);
    } finally {
      if (saved !== undefined) process.env.GROQ_API_KEY = saved;
    }
  });

  it("builds a tool-capable chat model through initChatModel (no network)", async () => {
    const saved = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "test-key";
    try {
      const model = await createChatModel(config, "primary");
      expect(typeof model.bindTools).toBe("function");
    } finally {
      if (saved === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = saved;
    }
  });
});
