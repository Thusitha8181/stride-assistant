import { fakeModel } from "@langchain/core/testing";
import { AIMessage } from "@langchain/core/messages";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { ApiError, ChatEvent } from "@stride/shared";
import { agentSetup, parseSse } from "../../test/helpers";
import { runChatTurn } from "../chat/turn";
import { createApp, type AppDeps } from "./app";

const healthy: AppDeps["health"] = async () => ({ status: "ok", checks: { qdrant: { ok: true } } });

function appWith(model: ReturnType<typeof fakeModel>, health = healthy) {
  const { agent, sources } = agentSetup(model);
  return createApp({ chat: (input) => runChatTurn({ agent, sources }, input), health });
}

const chat = (app: ReturnType<typeof createApp>, body: unknown) =>
  request(app).post("/api/chat").set("Content-Type", "application/json").send(body as object);

describe("POST /api/chat", () => {
  it("streams contract-valid SSE events: session first, done last", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "getOrderStatus", args: { orderId: "O-1042", email: "jane@example.com" } }])
      .respond(new AIMessage("It has shipped."));
    const res = await chat(appWith(model), { message: "Where is O-1042? jane@example.com" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(res.headers["cache-control"]).toContain("no-cache");
    const events = parseSse(res.text);
    for (const e of events) expect(ChatEvent.safeParse(e).success, JSON.stringify(e).slice(0, 100)).toBe(true);
    const types = events.map((e) => (e as ChatEvent).type);
    expect(types[0]).toBe("session");
    expect(types.at(-1)).toBe("done");
    expect(types).toContain("card");
  });

  it("creates a session id on the first turn and keeps history when it is reused", async () => {
    const model = fakeModel().respond(new AIMessage("What size?")).respond(new AIMessage("Size 10 noted."));
    const app = appWith(model);
    const first = parseSse((await chat(app, { message: "running shoes please" })).text) as ChatEvent[];
    const session = first[0] as Extract<ChatEvent, { type: "session" }>;
    expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);

    const second = parseSse((await chat(app, { message: "size 10", sessionId: session.sessionId })).text) as ChatEvent[];
    expect(second[0]).toEqual({ type: "session", sessionId: session.sessionId });
    expect(JSON.stringify(model.calls[1]!.messages)).toContain("running shoes please");
  });

  it.each([
    ["missing message", {}],
    ["empty message", { message: "   " }],
    ["too long", { message: "x".repeat(4001) }],
    ["bad session id", { message: "hi", sessionId: "123" }],
    ["unknown field", { message: "hi", admin: true }],
    ["wrong type", { message: 42 }],
  ])("rejects %s with a 400 error envelope", async (_label, body) => {
    const res = await chat(appWith(fakeModel()), body);
    expect(res.status).toBe(400);
    expect(ApiError.parse(res.body).error.code).toBe("INVALID_REQUEST");
    expect(res.body.error.issues.length).toBeGreaterThan(0);
  });

  it("rejects malformed JSON without leaking a stack trace", async () => {
    const res = await request(appWith(fakeModel())).post("/api/chat").set("Content-Type", "application/json").send('{"message": ');
    expect(res.status).toBe(400);
    expect(ApiError.parse(res.body).error.code).toBe("INVALID_REQUEST");
    expect(res.text).not.toMatch(/at .+\.(js|ts):\d+/);
  });

  it("rejects bodies over 32 KB", async () => {
    const res = await chat(appWith(fakeModel()), { message: "x".repeat(40_000) });
    expect(res.status).toBe(413);
    expect(ApiError.parse(res.body).error.code).toBe("INVALID_REQUEST");
  });

  it("reports model failures as an error event, still ending with done @F1", async () => {
    const outage = Object.assign(new Error("upstream 503"), { status: 503 });
    const res = await chat(appWith(fakeModel().alwaysThrow(outage)), { message: "hi" });
    expect(res.status).toBe(200);
    const events = parseSse(res.text) as ChatEvent[];
    expect(events.map((e) => e.type)).toEqual(["session", "error", "done"]);
    expect(res.text).not.toContain("upstream 503");
  });

  it("returns 500 with an envelope when the chat pipeline throws before streaming", async () => {
    const app = createApp({
      health: healthy,
      chat: () => {
        throw new Error("boom");
      },
    });
    const res = await chat(app, { message: "hi" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: "INTERNAL", message: "Something went wrong on our side." } });
  });
});

describe("stream failures", () => {
  it("turns a mid-stream failure into an error event and closes the stream", async () => {
    const app = createApp({
      health: healthy,
      async *chat({ sessionId }) {
        yield { type: "session", sessionId } as const;
        throw new Error("checkpoint store exploded");
      },
    });
    const res = await chat(app, { message: "hi" });
    const events = parseSse(res.text) as ChatEvent[];
    expect(events.map((e) => e.type)).toEqual(["session", "error"]);
    expect(events[1]).toMatchObject({ code: "INTERNAL", retryable: true });
    expect(res.text).not.toContain("exploded");
  });
});

describe("other routes", () => {
  it("GET /api/health returns the health report", async () => {
    const res = await request(appWith(fakeModel())).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", checks: { qdrant: { ok: true } } });
  });

  it("unknown /api routes return a JSON 404", async () => {
    const res = await request(appWith(fakeModel())).get("/api/nope");
    expect(res.status).toBe(404);
    expect(ApiError.parse(res.body).error.code).toBe("NOT_FOUND");
  });

  it("does not advertise Express", async () => {
    const res = await request(appWith(fakeModel())).get("/api/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
