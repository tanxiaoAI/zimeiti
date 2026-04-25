import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir, dbPath, uploadsDir, kbStorageDir } from "./dataPaths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRootDir = path.resolve(__dirname, "..");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDirIfMissing(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  ensureDir(destDir);

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyDirIfMissing(srcPath, destPath);
      continue;
    }

    if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function migrateLegacyDataIfNeeded() {
  if (!process.env.DATA_DIR) return;

  ensureDir(dataDir);
  ensureDir(uploadsDir);
  ensureDir(kbStorageDir);

  const legacyDbPath = path.join(apiRootDir, "database.sqlite");
  if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
    fs.copyFileSync(legacyDbPath, dbPath);
  }

  const legacyUploadsDir = path.join(apiRootDir, "public", "uploads");
  copyDirIfMissing(legacyUploadsDir, uploadsDir);

  const legacyKbDir = path.join(apiRootDir, ".data", "kb");
  copyDirIfMissing(legacyKbDir, kbStorageDir);
}
