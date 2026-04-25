import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRootDir = path.resolve(__dirname, "..");

export const dataDir = process.env.DATA_DIR || path.join(apiRootDir, ".data");
export const dbPath = process.env.DB_PATH || (process.env.DATA_DIR ? path.join(dataDir, "database.sqlite") : path.join(apiRootDir, "database.sqlite"));
export const uploadsDir = process.env.UPLOADS_DIR || (process.env.DATA_DIR ? path.join(dataDir, "uploads") : path.join(apiRootDir, "public", "uploads"));
export const kbStorageDir = process.env.STORAGE_DIR || path.join(dataDir, "kb");
