import { z } from "zod";

export const Category = z.enum(["running", "trail", "casual", "boots", "kids", "sandals"]);
export type Category = z.infer<typeof Category>;

export const Width = z.enum(["standard", "wide"]);
export type Width = z.infer<typeof Width>;

/** US sizes in half steps, kids sizes included (e.g. 1–6). */
export const ShoeSize = z.number().min(1).max(16).multipleOf(0.5);

export const InventoryEntry = z.strictObject({
  color: z.string(),
  width: Width,
  size: ShoeSize,
  qty: z.number().int().min(0),
});
export type InventoryEntry = z.infer<typeof InventoryEntry>;

/** Full catalog record as stored in data/products.json. */
export const Product = z.strictObject({
  id: z.string().regex(/^P-\d{3}$/),
  name: z.string(),
  category: Category,
  price: z.number().positive(),
  description: z.string(),
  tags: z.array(z.string()),
  colors: z.array(z.string()).min(1),
  widths: z.array(Width).min(1),
  sizes: z.array(ShoeSize).min(1),
  inventory: z.array(InventoryEntry),
});
export type Product = z.infer<typeof Product>;

/** What tools hand to the model and the UI: no raw inventory rows. */
export const ProductSummary = z.strictObject({
  id: z.string(),
  name: z.string(),
  category: Category,
  price: z.number(),
  description: z.string(),
  colors: z.array(z.string()),
  widths: z.array(Width),
  sizes: z.array(ShoeSize),
  inStockSizes: z.array(ShoeSize),
});
export type ProductSummary = z.infer<typeof ProductSummary>;

export const ProductRef = z.strictObject({
  id: z.string(),
  name: z.string(),
  price: z.number(),
});
export type ProductRef = z.infer<typeof ProductRef>;
