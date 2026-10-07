import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import { evalsDir } from "./schema";
import type { RecordedResponse } from "./trace";

/**
 * Cassettes: the model's responses from a recorded live run, replayed deterministically
 * in CI (`npm run eval:mock`) with no API key. Tools, guards, cards and evaluators still
 * run for real on every replay; only the model's decisions are fixed.
 */
export const cassettesDir = path.join(evalsDir, "cassettes");

const Cassette = z.object({
  caseId: z.string(),
  recordedAt: z.string(),
  models: z.array(z.string()),
  responses: z.array(
    z.object({
      content: z.string(),
      tool_calls: z.array(z.object({ id: z.string().optional(), name: z.string(), args: z.record(z.string(), z.unknown()) })),
    }),
  ),
});
export type Cassette = z.infer<typeof Cassette>;

const fileFor = (caseId: string) => path.join(cassettesDir, `${caseId}.json`);

export function loadCassette(caseId: string): Cassette | null {
  const file = fileFor(caseId);
  return existsSync(file) ? Cassette.parse(JSON.parse(readFileSync(file, "utf8"))) : null;
}

export function saveCassette(cassette: Cassette) {
  mkdirSync(cassettesDir, { recursive: true });
  writeFileSync(fileFor(cassette.caseId), JSON.stringify(cassette, null, 2) + "\n");
}

export class CassetteExhaustedError extends Error {
  override name = "CassetteExhaustedError";
}

/** Chat model that returns recorded responses in order. */
export class ReplayChatModel extends BaseChatModel {
  private next = 0;

  constructor(private readonly responses: RecordedResponse[]) {
    super({});
  }

  _llmType() {
    return "replay";
  }

  override bindTools() {
    return this as never;
  }

  get remaining() {
    return this.responses.length - this.next;
  }

  async _generate() {
    const response = this.responses[this.next++];
    if (!response)
      throw new CassetteExhaustedError("The agent made more model calls than were recorded. Re-record: npm run eval:record");
    const message = new AIMessage({
      content: response.content,
      tool_calls: response.tool_calls.map((c, i) => ({ id: c.id ?? `replay_${this.next}_${i}`, name: c.name, args: c.args, type: "tool_call" as const })),
    });
    return { generations: [{ text: response.content, message }] };
  }
}
