const API_URL = "https://api.gptsapi.net/v1/chat/completions";
const GPTS_API_KEY = process.env.GPTS_API_KEY;
const modelName = "gemini-3.1-pro-preview";

if (!GPTS_API_KEY) {
  throw new Error("Missing required env: GPTS_API_KEY");
}

const payload = {
  model: modelName,
  messages: [{ role: "user", content: "你好" }],
  max_tokens: 1000
};

fetch(API_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${GPTS_API_KEY}`
  },
  body: JSON.stringify(payload)
}).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2))).catch(console.error);
