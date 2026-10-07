import type { StockResult, VariantStock } from "@stride/shared";
import { Badge, CardShell, Chip, money } from "../ui";

const label = (v: Pick<VariantStock, "size" | "width" | "color">) => `${v.size}${v.width === "wide" ? " wide" : ""} · ${v.color}`;

export function StockCard({ stock, onAsk, disabled }: { stock: StockResult; onAsk: (text: string) => void; disabled?: boolean }) {
  const { product, requested, alternatives } = stock;
  const variants = [...alternatives.nearbySizes, ...alternatives.otherWidths, ...alternatives.otherColors];
  const unique = [...new Map(variants.map((v) => [label(v), v])).values()].slice(0, 5);

  return (
    <CardShell
      label="Stock"
      title={`${product.name} · ${money(product.price)}`}
      aside={stock.available ? <Badge tone="good">In stock ({stock.quantity})</Badge> : <Badge tone="bad">Sold out</Badge>}
    >
      <p className="text-sm text-stone-600">
        Size {requested.size} · {requested.width}
        {requested.color ? ` · ${requested.color}` : ""}
      </p>
      {!stock.available && unique.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-sm font-medium text-stone-700">Available instead</p>
          <div className="flex flex-wrap gap-2">
            {unique.map((v) => (
              <Chip key={label(v)} disabled={disabled} onClick={() => onAsk(`Is the ${product.name} available in ${v.size}${v.width === "wide" ? " wide" : ""} in ${v.color}?`)}>
                {label(v)}
              </Chip>
            ))}
          </div>
        </div>
      )}
      {!stock.available && alternatives.similarProducts.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-sm font-medium text-stone-700">Similar shoes in your size</p>
          <div className="flex flex-wrap gap-2">
            {alternatives.similarProducts.map((p) => (
              <Chip key={p.id} disabled={disabled} onClick={() => onAsk(`Tell me about the ${p.name}`)}>
                {`${p.name} · ${money(p.price)}`}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </CardShell>
  );
}
