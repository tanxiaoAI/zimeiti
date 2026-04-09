const GEMINI_API_KEY = "sk-KaylVs0oxM2tbPfJBm5bazob2BJliUzSZH1oIkBcKz3R5NzC";
const API_URL = "https://api.ricoxueai.cn/v1/chat/completions";

async function checkAvailableModels() {
  try {
    const response = await fetch("https://api.ricoxueai.cn/v1/models", {
      headers: {
        "Authorization": `Bearer ${GEMINI_API_KEY}`
      }
    });
    if (!response.ok) {
      console.error(`Failed to fetch models: ${response.status} ${await response.text()}`);
      return;
    }
    const data = await response.json();
    if (data && data.data && Array.isArray(data.data)) {
      const models = data.data.map(m => m.id);
      console.log("Available models:");
      // Show ALL models
      console.log(models.slice(0, 50).join("\n"));
      
      console.log("\nTesting a chat completion with the first available model...");
      if (models.length > 0) {
        const testModel = models[0];
        console.log(`Testing model: ${testModel}`);
        const chatRes = await fetch(API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${GEMINI_API_KEY}`
          },
          body: JSON.stringify({
            model: testModel,
            messages: [{ role: "user", content: "Hi" }]
          })
        });
        const chatData = await chatRes.json();
        console.log(`Status: ${chatRes.status}`);
        console.log(chatData);
      }
    } else {
      console.log("Unexpected models response format:", data);
    }
  } catch (e) {
    console.error(e.message);
  }
}

checkAvailableModels();