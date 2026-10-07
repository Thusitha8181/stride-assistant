import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler, type Response } from "express";
import { ChatRequest, type ApiError, type ChatEvent } from "@stride/shared";

export type Health = {
  status: "ok" | "degraded";
  checks: Record<string, { ok: boolean; detail?: string }>;
};

export type AppDeps = {
  chat: (input: { sessionId: string; message: string; signal: AbortSignal }) => AsyncIterable<ChatEvent>;
  health: () => Promise<Health>;
};

const sendError = (res: Response, status: number, code: string, message: string, issues?: string[]) =>
  res.status(status).json({ error: { code, message, ...(issues && { issues }) } } satisfies ApiError);

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", async (_req, res) => {
    res.json(await deps.health());
  });

  /** Streams one chat turn as Server-Sent Events: one ChatEvent JSON per `data:` line. */
  app.post("/api/chat", async (req, res) => {
    const parsed = ChatRequest.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        res,
        400,
        "INVALID_REQUEST",
        "Send JSON like { \"message\": \"...\", \"sessionId\"?: \"<uuid>\" }.",
        parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
      );
    }

    const sessionId = parsed.data.sessionId ?? randomUUID();
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort(); // client went away: stop the agent (and the LLM spend)
    });

    // Failing before the first byte → a normal 500 envelope (via the error handler).
    const events = deps.chat({ sessionId, message: parsed.data.message, signal: controller.signal });

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: ChatEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    try {
      for await (const event of events) {
        if (controller.signal.aborted) break;
        send(event);
      }
    } catch (err) {
      // Failing mid-stream → the client still gets a contract-valid error event.
      console.error("Chat stream failed:", err);
      if (!controller.signal.aborted)
        send({ type: "error", code: "INTERNAL", message: "Something went wrong on our side. Please try again.", retryable: true });
    } finally {
      res.end();
    }
  });

  app.use("/api", (_req, res) => sendError(res, 404, "NOT_FOUND", "Unknown endpoint."));

  // Malformed JSON and anything unexpected: a stable envelope, never a stack trace.
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (res.headersSent) return res.end();
    const status = typeof err?.status === "number" && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error("Unhandled API error:", err);
    return status === 500
      ? sendError(res, 500, "INTERNAL", "Something went wrong on our side.")
      : sendError(res, status, "INVALID_REQUEST", "The request body must be valid JSON under 32 KB.");
  };
  app.use(onError);

  return app;
}
