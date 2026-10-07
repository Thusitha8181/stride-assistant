/**
 * Generates data/products.json: a fixed catalog with seeded (reproducible) inventory,
 * plus explicit overrides that the demo script and tests rely on.
 *
 *   npm run data:generate
 */
import { writeFileSync } from "node:fs";
import { Product, type Category, type InventoryEntry, type Width } from "@stride/shared";
import { productsPath } from "../src/data/paths";

type Base = {
  name: string;
  category: Category;
  price: number;
  description: string;
  tags: string[];
  colors: string[];
  widths: Width[];
};

const ADULT = range(6, 13, 0.5);
const KIDS = range(1, 6, 0.5);
const SANDAL = range(6, 13, 1);

const catalog: Base[] = [
  { name: "Swift 3", category: "running", price: 120, colors: ["Black", "Ocean Blue", "White"], widths: ["standard", "wide"], tags: ["neutral", "lightweight", "daily trainer", "breathable"], description: "Lightweight neutral daily trainer with a breathable engineered mesh upper and responsive foam for everyday road runs." },
  { name: "Cloudpace", category: "running", price: 140, colors: ["Grey", "Coral"], widths: ["standard"], tags: ["max cushion", "long distance", "recovery"], description: "Maximum-cushion road shoe built for long runs and recovery days, with a plush heel and rocker sole." },
  { name: "Tempo Pro", category: "running", price: 160, colors: ["Volt", "Black"], widths: ["standard"], tags: ["race", "carbon plate", "fast", "marathon"], description: "Race-day shoe with a full-length carbon plate and ultralight foam for 5K to marathon racing." },
  { name: "Daily Jog", category: "running", price: 85, colors: ["Navy", "Black", "Red"], widths: ["standard", "wide"], tags: ["budget", "beginner", "gym"], description: "Affordable, durable running shoe for beginners, gym sessions and casual jogs." },
  { name: "Stability GT", category: "running", price: 135, colors: ["Blue", "Grey"], widths: ["standard", "wide"], tags: ["stability", "overpronation", "support"], description: "Supportive stability shoe with a guide rail midsole for runners who overpronate." },
  { name: "Trail Runner X", category: "trail", price: 129, colors: ["Black", "Forest Green"], widths: ["standard", "wide"], tags: ["waterproof", "grip", "mud", "rock plate"], description: "Waterproof trail running shoe with a StormShield membrane, 5mm grippy lugs and a rock plate for technical terrain." },
  { name: "Trail Runner Y", category: "trail", price: 115, colors: ["Slate", "Orange"], widths: ["standard", "wide"], tags: ["waterproof", "lightweight", "trail"], description: "Lighter waterproof trail runner with a StormShield membrane and a nimble outsole for fast, wet trail runs." },
  { name: "Ridge Hiker Mid", category: "trail", price: 150, colors: ["Brown", "Black"], widths: ["standard", "wide"], tags: ["waterproof", "hiking", "ankle support", "mid"], description: "Waterproof mid-cut hiking shoe with ankle support, a stiff shank and deep lugs for day hikes and backpacking." },
  { name: "Mudlark Trail", category: "trail", price: 99, colors: ["Olive", "Grey"], widths: ["standard"], tags: ["trail", "drainage", "grip"], description: "Fast-draining, non-waterproof trail shoe with an aggressive outsole for muddy, wet conditions." },
  { name: "Everyday Knit Sneaker", category: "casual", price: 79, colors: ["Black", "Oat", "Sky"], widths: ["standard", "wide"], tags: ["knit", "comfortable", "walking", "machine washable"], description: "Soft knit everyday sneaker with a cushioned footbed. Machine washable and great for walking." },
  { name: "Court Classic", category: "casual", price: 95, colors: ["White", "White/Green"], widths: ["standard"], tags: ["leather", "classic", "tennis style"], description: "Timeless leather court sneaker with a padded collar and cupsole." },
  { name: "Canvas Low", category: "casual", price: 55, colors: ["Navy", "White", "Red"], widths: ["standard"], tags: ["canvas", "lightweight", "summer"], description: "Lightweight canvas low-top with a vulcanized rubber sole." },
  { name: "Comfort Slip-On", category: "casual", price: 89, colors: ["Brown", "Black"], widths: ["standard", "wide"], tags: ["slip-on", "loafer", "comfortable", "office"], description: "Slip-on loafer with memory foam and a flexible sole, smart enough for the office." },
  { name: "EcoStep Sneaker", category: "casual", price: 99, colors: ["Sand", "Charcoal"], widths: ["standard"], tags: ["recycled", "sustainable", "vegan"], description: "Vegan sneaker made from 70% recycled materials with a natural rubber sole." },
  { name: "Highland Chelsea Boot", category: "boots", price: 175, colors: ["Brown", "Black"], widths: ["standard"], tags: ["leather", "chelsea", "dress boot"], description: "Full-grain leather Chelsea boot with elastic gussets and a stacked heel." },
  { name: "Summit Winter Boot", category: "boots", price: 189, colors: ["Black", "Tan"], widths: ["standard", "wide"], tags: ["waterproof", "insulated", "snow", "winter"], description: "Insulated, waterproof winter boot rated to -25°C with a slip-resistant ice grip outsole." },
  { name: "Workline Steel Toe", category: "boots", price: 165, colors: ["Wheat", "Black"], widths: ["standard", "wide"], tags: ["safety", "steel toe", "work", "slip resistant"], description: "Steel-toe work boot with slip- and oil-resistant outsole and a waterproof leather upper." },
  { name: "Desert Chukka", category: "boots", price: 130, colors: ["Sand Suede", "Brown Suede"], widths: ["standard"], tags: ["suede", "chukka", "casual boot"], description: "Classic suede chukka boot with a crepe sole." },
  { name: "Kids Dash Runner", category: "kids", price: 55, colors: ["Blue", "Pink"], widths: ["standard", "wide"], tags: ["kids", "running", "velcro"], description: "Durable kids' running shoe with easy hook-and-loop straps and a reinforced toe." },
  { name: "Kids Light-Up Sneaker", category: "kids", price: 49, colors: ["Black", "Purple"], widths: ["standard"], tags: ["kids", "light-up", "fun"], description: "Kids' sneaker with LED lights in the sole that flash with every step." },
  { name: "Kids Puddle Boot", category: "kids", price: 45, colors: ["Yellow", "Green"], widths: ["standard"], tags: ["kids", "waterproof", "rain boot"], description: "Waterproof kids' rain boot with easy pull-on handles." },
  { name: "Coastline Slide", category: "sandals", price: 35, colors: ["Black", "Sand"], widths: ["standard"], tags: ["slide", "beach", "pool"], description: "Cushioned slide sandal for the beach and pool." },
  { name: "Trailhead Sport Sandal", category: "sandals", price: 65, colors: ["Black", "Olive"], widths: ["standard"], tags: ["sport sandal", "hiking", "water", "adjustable"], description: "Adjustable sport sandal with a grippy outsole for river crossings and light hikes." },
  { name: "Recovery Flip", category: "sandals", price: 40, colors: ["Black", "Blue"], widths: ["standard"], tags: ["recovery", "flip-flop", "arch support"], description: "Supportive recovery flip-flop with arch support for post-run comfort." },
  { name: "Harbor Leather Sandal", category: "sandals", price: 70, colors: ["Tan", "Brown"], widths: ["standard"], tags: ["leather", "sandal", "summer"], description: "Leather strap sandal with a contoured cork footbed." },
];

/** Explicit stock values the demo script and tests depend on (PRD §11). */
const overrides: Array<{ product: string; size: number; width?: Width; color?: string; qty: number }> = [
  // F8 demo: Trail Runner X is sold out in 10 wide (every color), 10.5 wide is in stock.
  { product: "Trail Runner X", size: 10, width: "wide", qty: 0 },
  { product: "Trail Runner X", size: 10.5, width: "wide", color: "Black", qty: 4 },
  { product: "Trail Runner X", size: 10.5, width: "wide", color: "Forest Green", qty: 2 },
  { product: "Trail Runner X", size: 10, width: "standard", color: "Black", qty: 6 },
  { product: "Trail Runner Y", size: 10, width: "wide", color: "Slate", qty: 5 },
  // A fully sold-out size across every variant.
  { product: "Tempo Pro", size: 9, qty: 0 },
];

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let s = from; s <= to; s += step) out.push(s);
  return out;
}

/** mulberry32: tiny seeded PRNG so `npm run data:generate` is reproducible. */
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = prng(20261007);

const products: Product[] = catalog.map((base, i) => {
  const sizes = base.category === "kids" ? KIDS : base.category === "sandals" ? SANDAL : ADULT;
  const inventory: InventoryEntry[] = [];
  for (const color of base.colors)
    for (const width of base.widths)
      for (const size of sizes) {
        const soldOut = rand() < 0.15;
        inventory.push({ color, width, size, qty: soldOut ? 0 : 1 + Math.floor(rand() * 12) });
      }

  for (const o of overrides.filter((o) => o.product === base.name))
    for (const entry of inventory)
      if (entry.size === o.size && (!o.width || entry.width === o.width) && (!o.color || entry.color === o.color))
        entry.qty = o.qty;

  return Product.parse({ id: `P-${String(i + 1).padStart(3, "0")}`, ...base, sizes, inventory });
});

writeFileSync(productsPath, JSON.stringify(products, null, 2) + "\n");
console.log(`Wrote ${products.length} products to ${productsPath}`);
