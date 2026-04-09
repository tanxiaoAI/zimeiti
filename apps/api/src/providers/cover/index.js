import { coverMock } from "./mock.js";
import { coverReal } from "./real.js";

export function getCoverProvider() {
  const mode = (process.env.CAP_COVER || "mock").toLowerCase();
  return mode === "real" ? coverReal : coverMock;
}

