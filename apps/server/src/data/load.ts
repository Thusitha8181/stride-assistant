import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Product } from "@stride/shared";
import { OrderRecords, type OrderRecord } from "./orderRecord";
import { companyDocsDir, ordersPath, productsPath } from "./paths";

export function loadProducts(file = productsPath): Product[] {
  return z.array(Product).parse(JSON.parse(readFileSync(file, "utf8")));
}

export function loadOrders(file = ordersPath): OrderRecord[] {
  return OrderRecords.parse(JSON.parse(readFileSync(file, "utf8")));
}

export type CompanyDoc = { slug: string; markdown: string };

export function loadCompanyDocs(dir = companyDocsDir): CompanyDoc[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => ({ slug: path.basename(f, ".md"), markdown: readFileSync(path.join(dir, f), "utf8") }));
}
