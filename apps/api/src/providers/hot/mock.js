import { loadMockJson } from "../mockLoader.js";

export const hotMock = {
  async trends() {
    return loadMockJson("hot/trends.json");
  }
};

