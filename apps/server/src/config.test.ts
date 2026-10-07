import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig({})).toMatchObject({
      EMBEDDINGS_PROVIDER: "local",
      QDRANT_URL: "http://localhost:6333",
      QDRANT_KB_COLLECTION: "stride_kb",
    });
  });

  it("fails fast with a readable message", () => {
    expect(() => loadConfig({ EMBEDDINGS_PROVIDER: "openai", QDRANT_URL: "not a url" })).toThrow(
      /Invalid configuration:[\s\S]*EMBEDDINGS_PROVIDER[\s\S]*QDRANT_URL/,
    );
  });
});
