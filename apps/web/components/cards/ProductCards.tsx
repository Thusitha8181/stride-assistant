import type { ProductHit } from "@stride/shared";
import { Badge, money, sizeRange } from "../ui";

const ICONS: Record<ProductHit["category"], string> = { running: "👟", trail: "🥾", casual: "👞", boots: "🥾", kids: "👟", sandals: "🩴" };

export function ProductCards({ products, onAsk }: { products: ProductHit[]; onAsk: (text: string) => void }) {
  return (
    <section aria-label="Products" className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
      {products.map((p) => (
        <article key={p.id} className="flex w-56 shrink-0 snap-start flex-col rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
          <div aria-hidden className="mb-2 flex h-20 items-center justify-center rounded-xl bg-gradient-to-br from-brand/10 to-stone-100 text-3xl">
            {ICONS[p.category]}
          </div>
          <h3 className="font-semibold leading-tight text-stone-900">{p.name}</h3>
          <p className="mt-0.5 text-sm text-stone-500 capitalize">{p.category}</p>
          <p className="mt-1 line-clamp-2 text-sm text-stone-600">{p.description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-stone-900">{money(p.price)}</span>
            {p.inStockInRequestedSize === true && <Badge tone="good">In your size</Badge>}
            {p.inStockInRequestedSize === false && <Badge tone="bad">Sold out in your size</Badge>}
          </div>
          <p className="mt-1 text-xs text-stone-500">
            US {sizeRange(p.sizes)} · {p.widths.join(" & ")}
          </p>
          <button
            type="button"
            onClick={() => onAsk(`Which sizes is the ${p.name} in stock in?`)}
            className="mt-auto pt-3 text-left text-sm font-medium text-brand hover:underline"
          >
            Check sizes →
          </button>
        </article>
      ))}
    </section>
  );
}
