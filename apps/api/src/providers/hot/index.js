import { hotMock } from "./mock.js";
import { hotReal } from "./real.js";

export function getHotProvider() {
  const mode = (process.env.CAP_HOT || "mock").toLowerCase();
  return mode === "real" ? hotReal : hotMock;
}

