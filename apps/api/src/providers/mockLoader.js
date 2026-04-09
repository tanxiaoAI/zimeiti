import fs from "node:fs/promises";
import path from "node:path";

export async function loadMockJson(relativePath) {
  // relativePath e.g. "llm/title_generate.json"
  const p = path.join(process.cwd(), "..", "..", "packages", "mock-data", relativePath);
  const txt = await fs.readFile(p, "utf-8");
  return JSON.parse(txt);
}

