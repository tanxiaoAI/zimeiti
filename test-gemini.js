const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = "gemini-3.1-flash-lite-preview";

if (!GEMINI_API_KEY) {
  throw new Error("Missing required env: GEMINI_API_KEY");
}

async function testNativeGemini() {
  const payload1 = {
    contents: [
      { parts: [{ text: "测试一下，如果你能听到请回复1" }] }
    ]
  };

  const payload2 = {
    systemInstruction: { parts: [{ text: "You are a helpful assistant" }] },
    contents: [
      { parts: [{ text: "测试一下，如果你能听到请回复1" }] }
    ]
  };

  const modelsToTest = [
    "gpt-3.5-turbo",
    "gpt-4o",
    "gpt-4o-mini",
    "gemini-1.5-flash"
  ];

  for (const model of modelsToTest) {
    console.log("Testing:", model);
    try {
      const response = await fetch(`https://api.ricoxueai.cn/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GEMINI_API_KEY}`
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "user", content: "Hello" }]
        })
      });
      const text = await response.text();
      console.log(`Status: ${response.status}`);
      console.log(`Response: ${text.substring(0, 100)}`);
    } catch (e) {
      console.error(e.message);
    }
    console.log("-------------------");
  }
}

testNativeGemini();
