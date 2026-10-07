import type { Card } from "@stride/shared";
import { OrderCard } from "./OrderCard";
import { ProductCards } from "./ProductCards";
import { ReturnCreatedCard, ReturnEligibilityCard } from "./ReturnCards";
import { StockCard } from "./StockCard";

export function CardView({ card, onAsk, disabled }: { card: Card; onAsk: (text: string) => void; disabled?: boolean }) {
  switch (card.kind) {
    case "products":
      return <ProductCards products={card.products} onAsk={onAsk} />;
    case "stock":
      return <StockCard stock={card.stock} onAsk={onAsk} disabled={disabled} />;
    case "order":
      return <OrderCard order={card.order} />;
    case "return-eligibility":
      return <ReturnEligibilityCard eligibility={card.eligibility} />;
    case "return-created":
      return <ReturnCreatedCard result={card.result} />;
  }
}
