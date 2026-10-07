import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

/** Loads the repo-root .env (if present). Real environment variables win. */
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"), quiet: true });
