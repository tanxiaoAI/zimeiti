import { ragMock } from "./mock.js";
import { ragReal } from "./real.js";

export function getRagProvider() {
  const mode = (process.env.CAP_RAG || "mock").toLowerCase();
  return mode === "real" ? ragReal : ragMock;
}

