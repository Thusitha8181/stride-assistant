import { expect, test, type Page, type Route } from "@playwright/test";
import type { ChatEvent } from "@stride/shared";
import { order, orderTurn, RUN, SESSION, soldOut } from "../test/fixtures";

const sse = (events: ChatEvent[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
const turn = (...events: ChatEvent[]): ChatEvent[] => [{ type: "session", sessionId: SESSION }, ...events, { type: "done", sessionId: SESSION, runId: RUN }];

/** Answers successive POST /api/chat calls with the given streams; records request bodies. */
async function mockChat(page: Page, ...responses: Array<ChatEvent[] | { status: number; json: unknown }>) {
  const bodies: Array<{ message: string; sessionId?: string }> = [];
  await page.route("**/api/chat", async (route: Route) => {
    bodies.push(route.request().postDataJSON());
    const next = responses.shift();
    if (!next) return route.abort();
    if (Array.isArray(next)) return route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(next) });
    return route.fulfill({ status: next.status, contentType: "application/json", body: JSON.stringify(next.json) });
  });
  return bodies;
}

const composer = (page: Page) => page.getByLabel("Message the Stride assistant");
/** Alerts inside the chat (Next.js adds its own hidden role="alert" route announcer). */
const chatAlert = (page: Page) => page.getByRole("main").getByRole("alert");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("order lookup: starter chip → order card with progress, citation pill and follow-ups", async ({ page }) => {
  const bodies = await mockChat(page, orderTurn());
  await page.getByRole("button", { name: "Track my order" }).click();

  const card = page.getByRole("region", { name: "Order O-1042" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Austin, TX")).toBeVisible();
  await expect(card.locator('[aria-current="step"]')).toContainText("Shipped");
  await expect(page.getByText("Tracking your order")).toBeVisible();
  await expect(page.getByText("[[")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Track another order" })).toBeVisible();
  expect(bodies[0]).toEqual({ message: "Track my order" });
});

test("sold-out size: tapping an alternative asks about it in the same session @F8", async ({ page }) => {
  const bodies = await mockChat(
    page,
    turn({ type: "card", card: { kind: "stock", stock: soldOut } }, { type: "text-delta", delta: "Size 10 wide is sold out." }),
    turn({ type: "text-delta", delta: "Yes! 10.5 wide in Black is in stock." }),
  );
  await composer(page).fill("Is the Trail Runner X in 10 wide?");
  await composer(page).press("Enter");
  await expect(page.getByText("Sold out", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "10.5 wide · Black" }).click();
  await expect(page.getByText("Yes! 10.5 wide in Black is in stock.")).toBeVisible();
  expect(bodies[1]).toEqual({ message: "Is the Trail Runner X available in 10.5 wide in Black?", sessionId: SESSION });
});

test("wrong email: no order details are shown @F6", async ({ page }) => {
  await mockChat(
    page,
    turn(
      { type: "tool-start", toolCallId: "t", name: "getOrderStatus" },
      { type: "tool-end", toolCallId: "t", name: "getOrderStatus", ok: false, code: "UNVERIFIED" },
      { type: "text-delta", delta: "Those details don't match our records." },
    ),
  );
  await composer(page).fill("Where is O-1042? bob@example.com");
  await composer(page).press("Enter");
  await expect(page.getByText("Those details don't match our records.")).toBeVisible();
  await expect(page.getByRole("region", { name: /Order O-/ })).toHaveCount(0);
});

test("model outage: friendly error, Try again recovers @F1", async ({ page }) => {
  await mockChat(
    page,
    turn({ type: "error", code: "MODEL_UNAVAILABLE", message: "I'm having trouble thinking right now. Please try again in a moment.", retryable: true }),
    orderTurn("Found it: your order has shipped."),
  );
  await composer(page).fill("Where is O-1042? jane@example.com");
  await composer(page).press("Enter");
  const alert = chatAlert(page);
  await expect(alert).toContainText("trouble thinking");
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Found it: your order has shipped.")).toBeVisible();
  await expect(chatAlert(page)).toHaveCount(0);
});

test("ineligible return: reason and alternatives @F7", async ({ page }) => {
  await mockChat(
    page,
    turn(
      {
        type: "card",
        card: {
          kind: "return-eligibility",
          eligibility: { ok: true, eligible: false, item: { itemId: "O-1007-1", name: "Highland Chelsea Boot" }, reason: "OUTSIDE_WINDOW", explanation: "This item was delivered 45 days ago.", policySource: "returns-policy#return-window", alternatives: ["warranty_claim", "contact_support"] },
        },
      },
      { type: "text-delta", delta: "Sorry, it's past the 30-day window." },
    ),
  );
  await composer(page).fill("Return the boots from O-1007, sam.lee@example.com");
  await composer(page).press("Enter");
  await expect(page.getByText("Outside the 30-day return window")).toBeVisible();
  await expect(page.getByRole("button", { name: "How do I make a warranty claim?" })).toBeVisible();
});

test("invalid request: the API's validation message is shown without a retry @F12", async ({ page }) => {
  await mockChat(page, { status: 400, json: { error: { code: "INVALID_REQUEST", message: "Please keep messages under 4000 characters." } } });
  await composer(page).fill("hello");
  await composer(page).press("Enter");
  await expect(chatAlert(page)).toContainText("under 4000 characters");
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

test("conversation survives a reload; New chat clears it", async ({ page }) => {
  await mockChat(page, orderTurn());
  await page.getByRole("button", { name: "Track my order" }).click();
  await expect(page.getByRole("region", { name: "Order O-1042" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("region", { name: "Order O-1042" })).toBeVisible();
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByRole("heading", { name: "Hi! How can I help?" })).toBeVisible();
});

test("inspector shows tool calls and the run id", async ({ page }) => {
  await mockChat(page, orderTurn());
  await page.getByRole("button", { name: "Track my order" }).click();
  await expect(page.getByRole("region", { name: "Order O-1042" })).toBeVisible();
  await page.getByRole("button", { name: "Inspector" }).click();
  const panel = page.getByRole("complementary", { name: "Inspector" });
  await expect(panel.getByText("getOrderStatus")).toBeVisible();
  await expect(panel.getByText(RUN)).toBeVisible();
});

test("layout fits the screen without horizontal scrolling", async ({ page }) => {
  await mockChat(page, turn({ type: "card", card: { kind: "order", order } }, { type: "text-delta", delta: "Here's your order." }));
  await page.getByRole("button", { name: "Track my order" }).click();
  await expect(page.getByRole("region", { name: "Order O-1042" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
