import { loadMockJson } from "../mockLoader.js";

export const ragMock = {
  async search() {
    return loadMockJson("rag/search.json");
  }
};

