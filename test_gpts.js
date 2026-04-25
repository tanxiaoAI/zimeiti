const API_URL = "https://api.gptsapi.net/v1/chat/completions";
const GEMINI_API_KEY = "sk-gf0b55ed57f88401d11c6ea2f96e345c00c2ddfa5b8z4XfJ";
const modelName = "gemini-3.1-pro-preview";

const payload = {
  model: modelName,
  messages: [{ role: "user", content: "你好" }],
  max_tokens: 1000
};

fetch(API_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${GEMINI_API_KEY}`
  },
  body: JSON.stringify(payload)
}).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2))).catch(console.error);
