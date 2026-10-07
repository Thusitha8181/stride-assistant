/** Optimal string alignment distance: Levenshtein plus adjacent transpositions ("1024" ↔ "1042" = 1). */
export function osaDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

export const tokenize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Token-level similarity in [0, 1] that tolerates one typo per token ("runer" ≈ "runner"). */
export function nameSimilarity(query: string, name: string): number {
  const q = tokenize(query);
  const n = tokenize(name);
  if (!q.length || !n.length) return 0;
  const matches = q.filter((qt) => n.some((nt) => nt === qt || (qt.length >= 4 && osaDistance(qt, nt) <= 1))).length;
  return matches / Math.max(q.length, n.length);
}
