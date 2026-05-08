const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = "gemini-3.1-flash-lite-preview";

if (!GEMINI_API_KEY) {
  throw new Error("Missing required env: GEMINI_API_KEY");
}

async function testNativeGemini() {
  const nativePayload = {
    contents: [
      { parts: [{ text: "测试一下，如果你能听到请回复1" }] }
    ]
  };

  const openaiPayload = {
    model: MODEL_NAME,
    messages: [{ role: "user", content: "测试一下，如果你能听到请回复1" }]
  };

  const endpoints = [
    { name: "Native (No /v1)", url: `https://api.ricoxueai.cn/v1beta/models/${MODEL_NAME}:generateContent`, payload: nativePayload },
    { name: "Native (With /v1)", url: `https://api.ricoxueai.cn/v1/v1beta/models/${MODEL_NAME}:generateContent`, payload: nativePayload },
    { name: "OpenAI Compatible", url: `https://api.ricoxueai.cn/v1/chat/completions`, payload: openaiPayload }
  ];

  for (const ep of endpoints) {
    console.log(`Testing ${ep.name} -> ${ep.url}`);
    try {
      const response = await fetch(ep.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GEMINI_API_KEY}`
        },
        body: JSON.stringify(ep.payload)
      });
      const text = await response.text();
      console.log(`Status: ${response.status}`);
      console.log(`Response: ${text.substring(0, 150)}`);
    } catch (e) {
      console.error(e.message);
    }
    console.log("-------------------");
  }
}

testNativeGemini();
