import { llmMock } from "./mock.js";
import { llmReal } from "./real.js";

export function getLlmProvider() {
  const mode = (process.env.CAP_LLM || "mock").toLowerCase();
  return mode === "real" ? llmReal : llmMock;
}

