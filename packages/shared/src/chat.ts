import { z } from "zod";
import { OrderView } from "./order";
import { EligibilityResult, ProductHit, ReturnCreated, StockResult } from "./tools";

/**
 * Chat API contract (PRD §10.1): POST /api/chat streams Server-Sent Events, one
 * `ChatEvent` JSON object per `data:` line. Server and web both validate against this.
 */

export const MAX_MESSAGE_CHARS = 4000;

export const ChatRequest = z.strictObject({
  /** Omit on the first turn; reuse the id from the `session` event afterwards. */
  sessionId: z.uuid().optional(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

/** Rich UI cards derived from successful tool results. */
export const Card = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("products"), products: z.array(ProductHit).min(1) }),
  z.strictObject({ kind: z.literal("stock"), stock: StockResult }),
  z.strictObject({ kind: z.literal("order"), order: OrderView }),
  z.strictObject({ kind: z.literal("return-eligibility"), eligibility: EligibilityResult }),
  z.strictObject({ kind: z.literal("return-created"), result: ReturnCreated }),
]);
export type Card = z.infer<typeof Card>;

export const CitationSource = z.strictObject({ id: z.string(), title: z.string() });
export type CitationSource = z.infer<typeof CitationSource>;

export const ChatErrorCode = z.enum(["MODEL_UNAVAILABLE", "AGENT_LIMIT", "INTERNAL"]);
export type ChatErrorCode = z.infer<typeof ChatErrorCode>;

export const ChatEvent = z.discriminatedUnion("type", [
  /** Always first. */
  z.strictObject({ type: z.literal("session"), sessionId: z.uuid() }),
  /** Streamed assistant text. Policy citations appear inline as `[[chunk-id]]`. */
  z.strictObject({ type: z.literal("text-delta"), delta: z.string() }),
  z.strictObject({ type: z.literal("tool-start"), toolCallId: z.string(), name: z.string() }),
  z.strictObject({
    type: z.literal("tool-end"),
    toolCallId: z.string(),
    name: z.string(),
    ok: z.boolean(),
    /** Tool error code (NOT_FOUND, UNVERIFIED, …) or INVALID_ARGUMENTS when the model sent bad args (F3). */
    code: z.string().nullable(),
  }),
  z.strictObject({ type: z.literal("card"), card: Card }),
  /** Sources the answer actually cited, restricted to chunks that were retrieved this turn. */
  z.strictObject({ type: z.literal("citation"), sources: z.array(CitationSource).min(1) }),
  z.strictObject({ type: z.literal("chips"), chips: z.array(z.string()).min(1) }),
  z.strictObject({ type: z.literal("error"), code: ChatErrorCode, message: z.string(), retryable: z.boolean() }),
  /** Always last. `runId` is the LangSmith run id for the turn. */
  z.strictObject({ type: z.literal("done"), sessionId: z.uuid(), runId: z.uuid() }),
]);
export type ChatEvent = z.infer<typeof ChatEvent>;

export const ApiError = z.strictObject({
  error: z.strictObject({ code: z.string(), message: z.string(), issues: z.array(z.string()).optional() }),
});
export type ApiError = z.infer<typeof ApiError>;
