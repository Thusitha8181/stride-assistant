import { Category } from "@stride/shared";

/** Placeholder shell. The chat experience (streaming, chips, cards) lands in Milestone 5. */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-10">
      <header>
        <p className="text-sm font-semibold uppercase tracking-widest text-brand">Stride Footwear</p>
        <h1 className="mt-1 text-3xl font-bold text-brand-ink">Customer Assistant</h1>
      </header>
      <p className="text-stone-600">
        Ask about our shoes, track an order, or start a return. The chat is coming soon.
      </p>
      <section aria-label="Shop by category">
        <ul className="flex flex-wrap gap-2">
          {Category.options.map((category) => (
            <li key={category} className="rounded-full border border-stone-300 px-3 py-1 text-sm capitalize">
              {category}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
