import axe from "axe-core";
import { expect } from "vitest";

/** Fails on any axe violation (color contrast is skipped: jsdom can't compute styles). */
export async function expectAccessible(container: Element) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
}
