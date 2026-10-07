import { Embeddings } from "@langchain/core/embeddings";
import type { Config } from "../config";
import { tokenize } from "../domain/fuzzy";

const STOPWORDS = new Set(
  "a an and are as at be by can do does for from have how i if in is it me my of on or our the to what when where which who will with you your".split(
    " ",
  ),
);

const stem = (t: string) => (t.length > 4 && t.endsWith("ing") ? t.slice(0, -3) : t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t);

/** FNV-1a 32-bit. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * Deterministic, offline embeddings (feature hashing of unigrams + bigrams).
 * Lexical rather than semantic, but stable across runs: used by tests, CI and
 * the mock evals so they need no model download and no API key.
 */
export class HashEmbeddings extends Embeddings {
  constructor(private readonly dims = 384) {
    super({});
  }

  embed(text: string): number[] {
    const tokens = tokenize(text).filter((t) => !STOPWORDS.has(t)).map(stem);
    const features = [...tokens, ...tokens.slice(1).map((t, i) => `${tokens[i]}_${t}`)];
    const v = new Array<number>(this.dims).fill(0);
    for (const f of features) {
      const h = hash(f);
      v[h % this.dims]! += h & 0x80000000 ? -1 : 1;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  }

  async embedDocuments(texts: string[]) {
    return texts.map((t) => this.embed(t));
  }

  async embedQuery(text: string) {
    return this.embed(text);
  }
}

type Extractor = (texts: string[], opts: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

/** Local sentence-transformer via Transformers.js. Downloads the model once (~25 MB), no API key. */
export class LocalTransformersEmbeddings extends Embeddings {
  private extractor?: Promise<Extractor>;

  constructor(private readonly model: string) {
    super({});
  }

  private load(): Promise<Extractor> {
    this.extractor ??= import("@huggingface/transformers").then(
      ({ pipeline }) => pipeline("feature-extraction", this.model, { dtype: "fp32" }) as unknown as Promise<Extractor>,
    );
    return this.extractor;
  }

  async embedDocuments(texts: string[]) {
    const extract = await this.load();
    return (await extract(texts, { pooling: "mean", normalize: true })).tolist();
  }

  async embedQuery(text: string) {
    const [vector] = await this.embedDocuments([text]);
    return vector!;
  }
}

export function createEmbeddings(config: Pick<Config, "EMBEDDINGS_PROVIDER" | "EMBEDDINGS_MODEL">): Embeddings {
  switch (config.EMBEDDINGS_PROVIDER) {
    case "hash":
      return new HashEmbeddings();
    case "local":
      return new LocalTransformersEmbeddings(config.EMBEDDINGS_MODEL);
  }
}
