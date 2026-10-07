import type {
  CheckStockInput,
  CheckStockOutput,
  Product,
  ProductRef,
  ProductSummary,
  VariantStock,
  Width,
} from "@stride/shared";
import { nameSimilarity } from "./fuzzy";

const MAX_ALTERNATIVES = 4;

export class Catalog {
  private readonly byId: Map<string, Product>;

  constructor(readonly products: Product[]) {
    this.byId = new Map(products.map((p) => [p.id, p]));
  }

  get(id: string): Product | undefined {
    return this.byId.get(id.trim().toUpperCase());
  }

  /** Resolves "P-006", "Trail Runner X" or "trail runner x". */
  resolve(idOrName: string): Product | undefined {
    const key = idOrName.trim().toLowerCase();
    return this.get(idOrName) ?? this.products.find((p) => p.name.toLowerCase() === key);
  }

  suggest(query: string, limit = 3): ProductRef[] {
    return this.products
      .map((p) => ({ p, score: nameSimilarity(query, p.name) }))
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => ref(x.p));
  }

  inStockSizes(product: Product, width?: Width): number[] {
    const sizes = new Set(
      product.inventory.filter((e) => e.qty > 0 && (!width || e.width === width)).map((e) => e.size),
    );
    return product.sizes.filter((s) => sizes.has(s));
  }

  summary(product: Product): ProductSummary {
    return {
      id: product.id,
      name: product.name,
      category: product.category,
      price: product.price,
      description: product.description,
      colors: product.colors,
      widths: product.widths,
      sizes: product.sizes,
      inStockSizes: this.inStockSizes(product),
    };
  }

  checkStock(input: CheckStockInput): CheckStockOutput {
    const product = this.resolve(input.product);
    if (!product) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: `No product called "${input.product}".`,
        suggestions: this.suggest(input.product),
      };
    }

    const width = input.width ?? "standard";
    const color = input.color ? product.colors.find((c) => c.toLowerCase() === input.color!.toLowerCase()) : undefined;
    const problems = [
      !product.sizes.includes(input.size) && `size ${input.size}`,
      !product.widths.includes(width) && `${width} width`,
      input.color && !color && `the color "${input.color}"`,
    ].filter(Boolean);
    if (problems.length) {
      return {
        ok: false,
        code: "INVALID_VARIANT",
        message: `${product.name} isn't made in ${problems.join(" or ")}.`,
        offered: { sizes: product.sizes, widths: product.widths, colors: product.colors },
      };
    }

    const inStock = (e: VariantStock) => e.qty > 0;
    const matchesColor = (e: VariantStock) => !color || e.color === color;
    const requested = product.inventory.filter((e) => e.size === input.size && e.width === width && matchesColor(e));
    const quantity = requested.reduce((sum, e) => sum + e.qty, 0);
    const available = quantity > 0;

    const alternatives = available
      ? { nearbySizes: [], otherWidths: [], otherColors: [], similarProducts: [] }
      : {
          nearbySizes: product.inventory
            .filter((e) => e.width === width && matchesColor(e) && inStock(e))
            .filter((e) => e.size !== input.size && Math.abs(e.size - input.size) <= 1)
            .sort((a, b) => Math.abs(a.size - input.size) - Math.abs(b.size - input.size) || a.size - b.size)
            .slice(0, MAX_ALTERNATIVES),
          otherWidths: product.inventory
            .filter((e) => e.size === input.size && e.width !== width && matchesColor(e) && inStock(e))
            .slice(0, MAX_ALTERNATIVES),
          otherColors: color
            ? product.inventory
                .filter((e) => e.size === input.size && e.width === width && e.color !== color && inStock(e))
                .slice(0, MAX_ALTERNATIVES)
            : [],
          similarProducts: this.similar(product, input.size, width),
        };

    return {
      ok: true,
      product: ref(product),
      requested: { size: input.size, width, color: color ?? null },
      available,
      quantity,
      alternatives,
    };
  }

  /** Same category, has the size in stock, ranked by shared tags. */
  similar(product: Product, size: number, width: Width, limit = 3): ProductRef[] {
    return this.products
      .filter((p) => p.id !== product.id && p.category === product.category)
      .filter((p) => p.inventory.some((e) => e.size === size && e.width === width && e.qty > 0))
      .map((p) => ({ p, shared: p.tags.filter((t) => product.tags.includes(t)).length }))
      .sort((a, b) => b.shared - a.shared)
      .slice(0, limit)
      .map((x) => ref(x.p));
  }
}

const ref = (p: Product): ProductRef => ({ id: p.id, name: p.name, price: p.price });
