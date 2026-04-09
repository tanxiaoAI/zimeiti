const GEMINI_API_KEY = "sk-KaylVs0oxM2tbPfJBm5bazob2BJliUzSZH1oIkBcKz3R5NzC";
const MODEL_NAME = "gemini-3.1-flash-lite-preview";

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