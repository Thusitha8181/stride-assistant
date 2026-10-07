import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { EligibilityResult, OrderView } from "@stride/shared";
import { expectAccessible } from "@/test/a11y";
import { order, product, soldOut } from "@/test/fixtures";
import { OrderCard } from "./OrderCard";
import { ProductCards } from "./ProductCards";
import { ReturnCreatedCard, ReturnEligibilityCard } from "./ReturnCards";
import { StockCard } from "./StockCard";

describe("ProductCards", () => {
  it("shows price and in-stock state for the requested size", async () => {
    const { container } = render(
      <ProductCards products={[product({ inStockInRequestedSize: true }), product({ id: "P-003", name: "Tempo Pro", price: 160, inStockInRequestedSize: false })]} onAsk={() => {}} />,
    );
    expect(screen.getByText("$85.00")).toBeInTheDocument();
    expect(screen.getByText("In your size")).toBeInTheDocument();
    expect(screen.getByText("Sold out in your size")).toBeInTheDocument();
    await expectAccessible(container);
  });

  it("asks about sizes when a product's button is clicked", async () => {
    const onAsk = vi.fn();
    render(<ProductCards products={[product()]} onAsk={onAsk} />);
    await userEvent.click(screen.getByRole("button", { name: /check sizes/i }));
    expect(onAsk).toHaveBeenCalledWith("Which sizes is the Daily Jog in stock in?");
  });
});

describe("StockCard @F8", () => {
  it("offers in-stock alternatives and similar shoes as one-tap replies", async () => {
    const onAsk = vi.fn();
    const { container } = render(<StockCard stock={soldOut} onAsk={onAsk} />);
    expect(screen.getByText("Sold out")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "10.5 wide · Black" }));
    expect(onAsk).toHaveBeenCalledWith("Is the Trail Runner X available in 10.5 wide in Black?");
    await userEvent.click(screen.getByRole("button", { name: /Trail Runner Y/ }));
    expect(onAsk).toHaveBeenLastCalledWith("Tell me about the Trail Runner Y");
    await expectAccessible(container);
  });

  it("shows quantity and no alternatives when in stock", () => {
    render(<StockCard stock={{ ...soldOut, available: true, quantity: 6 }} onAsk={() => {}} />);
    expect(screen.getByText("In stock (6)")).toBeInTheDocument();
    expect(screen.queryByText("Available instead")).not.toBeInTheDocument();
  });
});

describe("OrderCard", () => {
  it("shows progress, items, ETA, tracking and city-level destination only", async () => {
    const { container } = render(<OrderCard order={order} />);
    const progress = screen.getByRole("list", { name: "Delivery progress" });
    expect(within(progress).getByText("Shipped").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Trail Runner X")).toBeInTheDocument();
    expect(screen.getByText("1Z999AA10000000142")).toBeInTheDocument();
    expect(screen.getByText("Austin, TX")).toBeInTheDocument();
    await expectAccessible(container);
  });

  it.each<[OrderView["status"], string]>([
    ["processing", "Processing"],
    ["out_for_delivery", "Out for delivery"],
    ["delivered", "Delivered"],
    ["delayed", "Delayed"],
    ["partially_shipped", "Partially shipped"],
    ["cancelled", "Cancelled"],
  ])("renders the %s status", (status, label) => {
    render(<OrderCard order={{ ...order, status }} />);
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it("counts a delivered order as complete even without an out-for-delivery event", () => {
    const delivered = { ...order, status: "delivered" as const, timeline: [...order.timeline, { status: "delivered" as const, at: "2026-10-08T12:00:00.000Z" }] };
    render(<OrderCard order={delivered} />);
    const progress = screen.getByRole("list", { name: "Delivery progress" });
    expect(within(progress).getByText("Out for delivery").closest("li")).toHaveTextContent("done");
  });

  it("shows carrier notes such as delays", () => {
    render(<OrderCard order={{ ...order, status: "delayed", timeline: [...order.timeline, { status: "delayed", at: "2026-10-07T00:00:00.000Z", note: "Severe weather at carrier hub." }] }} />);
    expect(screen.getByText("Severe weather at carrier hub.")).toBeInTheDocument();
  });
});

describe("return cards", () => {
  const base = { ok: true as const, item: { itemId: "O-1007-1", name: "Highland Chelsea Boot" }, policySource: "returns-policy#return-window" };

  it("explains an ineligible return with alternatives @F7", async () => {
    const eligibility: EligibilityResult = { ...base, eligible: false, reason: "OUTSIDE_WINDOW", explanation: "Delivered 45 days ago.", alternatives: ["warranty_claim", "contact_support"] };
    const { container } = render(<ReturnEligibilityCard eligibility={eligibility} />);
    expect(screen.getByText("Outside the 30-day return window")).toBeInTheDocument();
    expect(screen.getByText(/Warranty claim · Contact support/)).toBeInTheDocument();
    await expectAccessible(container);
  });

  it("shows days left for an eligible return", () => {
    render(<ReturnEligibilityCard eligibility={{ ...base, eligible: true, daysSinceDelivery: 12, daysLeft: 18, options: ["refund", "exchange"] }} />);
    expect(screen.getByText(/18 days left to return/)).toBeInTheDocument();
  });

  it("shows the RMA and next steps", async () => {
    const { container } = render(
      <ReturnCreatedCard result={{ ok: true, rma: "RMA-100001", item: base.item, type: "refund", refundAmount: 175, exchangeSize: null, nextSteps: ["Print the label.", "Ship it."] }} />,
    );
    expect(screen.getByText("RMA-100001")).toBeInTheDocument();
    expect(screen.getByText("Refund of $175.00")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    await expectAccessible(container);
  });
});
