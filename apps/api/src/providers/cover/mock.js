import { nanoid } from "nanoid";
import { loadMockJson } from "../mockLoader.js";

export const coverMock = {
  async templates() {
    const { templates } = await loadMockJson("cover/templates.json");
    return { templates };
  },
  async render(input) {
    const render_id = `cr_${nanoid(8)}`;
    const template_id = input?.template_id || "tpl_01";
    return {
      render_id,
      assets: [
        { type: "svg", url: `/static/covers/${template_id}.svg` }
      ],
      editable_layers: [
        { id: "title", type: "text", value: input?.texts?.title || "", max_chars: 18 },
        { id: "subtitle", type: "text", value: input?.texts?.subtitle || "", max_chars: 28 }
      ]
    };
  }
};
