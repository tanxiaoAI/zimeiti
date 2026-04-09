import { updateCustomerProfile } from "./appStore.js";

const GEMINI_API_KEY = "sk-KaylVs0oxM2tbPfJBm5bazob2BJliUzSZH1oIkBcKz3R5NzC";
const DEFAULT_MODEL = "gemini-3.1-flash-lite-preview";

export async function chatWithGemini(systemInstruction, history, newMessage, currentProfile, projectId, targetModel) {
  const modelName = targetModel || DEFAULT_MODEL;
  const API_URL = `https://api.ricoxueai.cn/v1beta/models/${modelName}:generateContent`;

  const instruction = `${systemInstruction || "你是账号定位专家。"}
      
【重要规则】
你在回复时，除了像人类一样自然地与用户对话外，还必须根据用户的回答，自动提取并更新“客户档案”。
档案字段包括：skills, interests, time_budget, finance_budget, unique_resources, track_selection, monetization_method, expected_income, target_audience, core_pain_points, ultimate_desire, platform_preference。

你必须始终以一个完整的 JSON 对象返回，不要包含其他任何 Markdown 代码块包裹，结构如下：
{
  "reply": "你原本要对用户说的话，引导式提问...",
  "extracted_profile": {
    "skills": "如果本次对话中提取到了，写在这里，没有则忽略",
    "interests": "...",
    "time_budget": "...",
    "finance_budget": "...",
    "unique_resources": "...",
    "track_selection": "...",
    "monetization_method": "...",
    "expected_income": "...",
    "target_audience": "...",
    "core_pain_points": "...",
    "ultimate_desire": "...",
    "platform_preference": "..."
  }
}
如果某个字段在这次对话中没有收集到，则不需包含在 extracted_profile 中或将其设为 null。

【当前客户档案参考】
如果你需要参考之前的档案：
${JSON.stringify(currentProfile, null, 2)}
`;

  const contents = [];
  
  // The system instruction can be passed as a user message at the very beginning
  contents.push({
    role: 'user',
    parts: [{ text: instruction }]
  });
  contents.push({
    role: 'model',
    parts: [{ text: "好的，我已经了解任务目标和档案提取要求，请开始对话。" }]
  });

  // Format history for Native Gemini format
  for (const msg of history) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    });
  }

  // Add the new message
  contents.push({
    role: 'user',
    parts: [{ text: newMessage }]
  });

  const payload = {
    contents: contents
  };

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GEMINI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("API Error:", errorText);
    throw new Error(`API Error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const totalTokens = data.usageMetadata?.totalTokenCount || null;
  
  let parsed = { reply: "抱歉，系统出现了一点小问题，请稍后再试。", extracted_profile: {} };
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse response as JSON:", text);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (e2) {
        console.error("Fallback JSON parsing failed too.");
      }
    }
  }

  const updates = {};
  if (parsed.extracted_profile) {
    for (const [key, value] of Object.entries(parsed.extracted_profile)) {
      if (value && value.trim() !== "" && value !== "..." && value !== "null") {
        updates[key] = value;
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    updateCustomerProfile(projectId, updates);
  }

  return {
    reply: parsed.reply || "（系统未返回回复内容）",
    updates,
    usage: { total_tokens: totalTokens }
  };
}
