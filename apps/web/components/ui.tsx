import type { ReactNode } from "react";

type Tone = "neutral" | "good" | "warn" | "bad" | "brand";

const TONES: Record<Tone, string> = {
  neutral: "bg-stone-100 text-stone-700",
  good: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
  warn: "bg-amber-50 text-amber-900 ring-1 ring-amber-200",
  bad: "bg-rose-50 text-rose-800 ring-1 ring-rose-200",
  brand: "bg-brand/10 text-brand-ink ring-1 ring-brand/20",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function CardShell({ title, aside, children, label }: { title: ReactNode; aside?: ReactNode; children: ReactNode; label: string }) {
  return (
    <section aria-label={label} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-stone-900">{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** A quick-reply button: sends its text as the customer's next message. */
export function Chip({ children, onClick, disabled }: { children: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-brand/30 bg-white px-3 py-1.5 text-sm text-brand-ink transition hover:bg-brand/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export const shortDate = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));

export const sizeRange = (sizes: number[]) => (sizes.length ? `${Math.min(...sizes)}–${Math.max(...sizes)}` : "—");
