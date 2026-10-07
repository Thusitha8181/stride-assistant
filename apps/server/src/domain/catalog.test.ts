import { describe, expect, it } from "vitest";
import { setup } from "../../test/helpers";

const { catalog } = setup();

describe("Catalog.resolve", () => {
  it("resolves by id or by name, case-insensitively", () => {
    expect(catalog.resolve("P-006")?.name).toBe("Trail Runner X");
    expect(catalog.resolve("p-006")?.name).toBe("Trail Runner X");
    expect(catalog.resolve("trail runner x")?.id).toBe("P-006");
  });

  it("suggests close names for typos @F5", () => {
    expect(catalog.suggest("trail runer x").map((p) => p.name)).toContain("Trail Runner X");
    expect(catalog.suggest("zzzz")).toEqual([]);
  });
});

describe("Catalog.checkStock", () => {
  it("reports an in-stock variant with no alternatives", () => {
    const r = catalog.checkStock({ product: "Trail Runner X", size: 10, color: "Black" });
    expect(r).toMatchObject({ ok: true, available: true, quantity: 6, requested: { size: 10, width: "standard", color: "Black" } });
    if (r.ok) expect(r.alternatives.nearbySizes).toEqual([]);
  });

  it("offers nearby sizes, widths and similar products when sold out @F8", () => {
    const r = catalog.checkStock({ product: "Trail Runner X", size: 10, width: "wide" });
    expect(r).toMatchObject({ ok: true, available: false, quantity: 0 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.alternatives.nearbySizes).toContainEqual(expect.objectContaining({ size: 10.5, width: "wide" }));
    expect(r.alternatives.nearbySizes.every((v) => v.qty > 0 && v.width === "wide")).toBe(true);
    expect(r.alternatives.otherWidths.every((v) => v.size === 10 && v.width === "standard" && v.qty > 0)).toBe(true);
    expect(r.alternatives.similarProducts.map((p) => p.name)).toContain("Trail Runner Y");
  });

  it("offers other colors when a specific color is sold out @F8", () => {
    const r = catalog.checkStock({ product: "Trail Runner X", size: 10, color: "Forest Green" });
    expect(r).toMatchObject({ ok: true, available: false });
    if (r.ok) expect(r.alternatives.otherColors).toEqual([{ color: "Black", width: "standard", size: 10, qty: 6 }]);
  });

  it("matches colors case-insensitively", () => {
    expect(catalog.checkStock({ product: "P-006", size: 10, color: "black" })).toMatchObject({ ok: true, available: true });
  });

  it("returns NOT_FOUND with suggestions for unknown products @F5", () => {
    const r = catalog.checkStock({ product: "Trail Runer X", size: 10 });
    expect(r).toMatchObject({ ok: false, code: "NOT_FOUND" });
    if (!r.ok && r.code === "NOT_FOUND") expect(r.suggestions[0]?.name).toBe("Trail Runner X");
  });

  it.each([
    [{ size: 15 }, "size 15"],
    [{ size: 10, width: "wide" as const, product: "Cloudpace" }, "wide width"],
    [{ size: 10, color: "Purple" }, 'the color "Purple"'],
  ])("returns INVALID_VARIANT for variants that don't exist (%o)", (patch, phrase) => {
    const r = catalog.checkStock({ product: "Trail Runner X", ...patch });
    expect(r).toMatchObject({ ok: false, code: "INVALID_VARIANT" });
    if (!r.ok) expect(r.message).toContain(phrase);
  });

  it("knows a size that is sold out across every variant", () => {
    expect(catalog.inStockSizes(catalog.resolve("Tempo Pro")!)).not.toContain(9);
  });
});
