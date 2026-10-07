import { describe, expect, it } from "vitest";
import { createEmbeddings, HashEmbeddings, LocalTransformersEmbeddings } from "./embeddings";

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);

describe("HashEmbeddings", () => {
  const e = new HashEmbeddings();

  it("is deterministic and unit-length", async () => {
    const [a] = await e.embedDocuments(["waterproof trail shoe"]);
    const b = await e.embedQuery("waterproof trail shoe");
    expect(a).toEqual(b);
    expect(dot(b, b)).toBeCloseTo(1, 6);
    expect(b).toHaveLength(384);
  });

  it("scores related text above unrelated text", () => {
    const q = e.embed("how long do I have to return shoes");
    const related = e.embed("Return window: you can return items within 30 days of delivery");
    const unrelated = e.embed("Clean suede with a suede brush");
    expect(dot(q, related)).toBeGreaterThan(dot(q, unrelated));
  });

  it("returns a zero-safe vector for stopword-only text", () => {
    expect(e.embed("the and of").every((x) => x === 0)).toBe(true);
  });
});

describe("createEmbeddings", () => {
  it("selects the provider from config", () => {
    expect(createEmbeddings({ EMBEDDINGS_PROVIDER: "hash", EMBEDDINGS_MODEL: "x" })).toBeInstanceOf(HashEmbeddings);
    expect(createEmbeddings({ EMBEDDINGS_PROVIDER: "local", EMBEDDINGS_MODEL: "x" })).toBeInstanceOf(LocalTransformersEmbeddings);
  });
});
