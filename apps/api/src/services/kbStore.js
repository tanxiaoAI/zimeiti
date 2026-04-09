import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";

const storageDir = process.env.STORAGE_DIR || path.join(process.cwd(), "apps", "api", ".data");
const docsDir = path.join(storageDir, "kb");

const documents = new Map(); // doc_id -> {id, project_id, filename, status, created_at}
const chunks = []; // {chunk_id, document_id, project_id, text, locator, created_at}

async function ensureDirs() {
  await fs.mkdir(docsDir, { recursive: true });
}

export async function createDocument({ project_id, originalname, buffer }) {
  await ensureDirs();
  const id = `doc_${nanoid(8)}`;
  const filename = originalname;
  const filePath = path.join(docsDir, `${id}_${filename}`);
  await fs.writeFile(filePath, buffer);
  const doc = { id, project_id, filename, storage_path: filePath, status: "uploaded", created_at: new Date().toISOString() };
  documents.set(id, doc);
  // 对外不暴露 storage_path
  const { storage_path, ...safe } = doc;
  return safe;
}

export function listDocuments(project_id) {
  return [...documents.values()]
    .filter((d) => d.project_id === project_id)
    .map((d) => {
      const { storage_path, ...safe } = d;
      return safe;
    });
}

export async function processDocument(document_id) {
  const doc = documents.get(document_id);
  if (!doc) return null;
  doc.status = "processing";
  const txt = await fs.readFile(doc.storage_path, "utf-8");
  // 简化：按空行分块
  const parts = txt
    .split(/\n\s*\n/g)
    .map((s) => s.trim())
    .filter(Boolean);
  parts.forEach((text, idx) => {
    chunks.push({
      chunk_id: `c_${nanoid(10)}`,
      document_id,
      project_id: doc.project_id,
      text,
      locator: { para: idx + 1 },
      created_at: new Date().toISOString()
    });
  });
  doc.status = "indexed";
  doc.indexed_at = new Date().toISOString();
  const { storage_path, ...safe } = doc;
  return { ...safe, chunks: parts.length };
}

export function search({ project_id, query, top_k = 5 }) {
  const q = (query || "").trim();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);

  const scored = chunks
    .filter((c) => c.project_id === project_id)
    .map((c) => {
      const textLower = c.text.toLowerCase();
      const score = terms.reduce((acc, t) => acc + (textLower.includes(t.toLowerCase()) ? 1 : 0), 0);
      return { ...c, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, top_k);

  return scored.map((c) => {
    const doc = documents.get(c.document_id);
    return {
      chunk_id: c.chunk_id,
      text: c.text,
      source: { document_id: c.document_id, filename: doc?.filename || "", locator: c.locator },
      score: c.score
    };
  });
}
