import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo-root `data/` directory. Overridable for tests via DATA_DIR. */
export const dataDir = process.env.DATA_DIR ?? path.resolve(here, "../../../../data");
export const productsPath = path.join(dataDir, "products.json");
export const ordersPath = path.join(dataDir, "orders.json");
export const companyDocsDir = path.join(dataDir, "company");
