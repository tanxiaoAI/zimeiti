import { loadMockJson } from "../mockLoader.js";

export const llmMock = {
  async accountProfileGenerate() {
    return loadMockJson("llm/account_profile_generate.json");
  },
  async topicsGenerate() {
    return loadMockJson("llm/topics_generate.json");
  },
  async titleGenerate() {
    return loadMockJson("llm/title_generate.json");
  },
  async hookGenerate() {
    return loadMockJson("llm/hook_generate.json");
  },
  async bodyGenerate() {
    return loadMockJson("llm/body_generate.json");
  }
};

