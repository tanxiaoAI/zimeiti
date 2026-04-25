import { updateCustomerProfile } from "./appStore.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "sk-KaylVs0oxM2tbPfJBm5bazob2BJliUzSZH1oIkBcKz3R5NzC";
const GPTS_API_BASE_URL = (process.env.GPTS_API_BASE_URL || "https://api.gptsapi.net").replace(/\/$/, "");
const GPTS_API_KEY = process.env.GPTS_API_KEY || "sk-gf0b55ed57f88401d11c6ea2f96e345c00c2ddfa5b8z4XfJ";
const DEFAULT_MODEL = process.env.DEFAULT_LLM_MODEL || "claude-opus-4-6";

const GPTS_MODEL_ALIASES = {
  "gpts-gemini-3.1-pro-preview": "gemini-3.1-pro-preview"
};

function isNativeGeminiModel(modelName) {
  return modelName === "gemini-3.1-flash-lite-preview" || modelName === "gemini-3.1-pro-preview";
}

function resolveModelConfig(targetModel) {
  const modelName = targetModel || DEFAULT_MODEL;
  const actualModelName = GPTS_MODEL_ALIASES[modelName] || modelName;
  const useGptsChatApi = !isNativeGeminiModel(modelName);

  return {
    modelName,
    actualModelName,
    useGptsChatApi
  };
}

export async function* streamChatWithGemini(systemInstruction, history, newMessage, currentProfile, projectId, targetModel) {
  const { actualModelName, useGptsChatApi } = resolveModelConfig(targetModel);

  const API_URL = useGptsChatApi
    ? `${GPTS_API_BASE_URL}/v1/chat/completions`
    : `https://api.ricoxueai.cn/v1beta/models/${actualModelName}:streamGenerateContent?alt=sse`;

  const instruction = `${systemInstruction || "你是账号定位专家。"}
      
【重要规则】
你在回复时，除了像人类一样自然地与用户对话外，还必须根据用户的回答，自动提取并更新“客户档案”。
档案字段包括：skills, interests, time_budget, finance_budget, unique_resources, track_selection, monetization_method, expected_income, target_audience, core_pain_points, ultimate_desire, platform_preference。

你必须严格按照以下XML标签格式输出你的回复（不要输出Markdown代码块包裹）：
<reply>
在此处写上你原本要对用户说的话，引导式提问...
</reply>
<profile>
{
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
</profile>
注意：如果某个字段在这次对话中没有收集到，则将其设为 null。

【当前客户档案参考】
如果你需要参考之前的档案：
${JSON.stringify(currentProfile, null, 2)}
`;

  const contents = [];
  contents.push({ role: 'user', parts: [{ text: instruction }] });
  contents.push({ role: 'model', parts: [{ text: "好的，我已了解规则，请开始。" }] });

  for (const msg of history) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    });
  }
  contents.push({ role: 'user', parts: [{ text: newMessage }] });

  let payload, headers;

  if (useGptsChatApi) {
    const messages = [];
    messages.push({ role: 'system', content: instruction });
    for (const msg of history) {
      messages.push({ role: msg.role === 'model' ? 'assistant' : 'user', content: msg.content });
    }
    messages.push({ role: 'user', content: newMessage });

    payload = {
      model: actualModelName,
      messages: messages,
      max_tokens: 8192,
      stream: true
    };
    headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GPTS_API_KEY}`
    };
  } else {
    payload = { contents: contents };
    headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GEMINI_API_KEY}`
    };
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error: ${response.status} ${errorText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete line
    
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const dataStr = line.slice(6).trim();
        if (dataStr === "[DONE]") continue;
        if (!dataStr) continue;
        
        try {
          const data = JSON.parse(dataStr);
          let textChunk = "";
          if (useGptsChatApi) {
            textChunk = data.choices?.[0]?.delta?.content || "";
          } else {
            textChunk = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
          }
          
          if (textChunk) {
            fullText += textChunk;
            yield { chunk: textChunk, fullText };
          }
        } catch (e) {
          // ignore parse error
        }
      }
    }
  }

  // Final parsing
  let replyText = fullText;
  let profileJson = {};
  
  // Remove <think> blocks
  const cleanText = fullText.replace(/<think>[\s\S]*?<\/think>/gi, '');
  
  const replyMatch = cleanText.match(/<reply>([\s\S]*?)<\/reply>/);
  if (replyMatch) {
    replyText = replyMatch[1].trim();
  } else if (!cleanText.includes("<profile>")) {
    replyText = cleanText.trim();
  } else {
    replyText = cleanText.split("<profile>")[0].replace("<reply>", "").trim();
  }

  const profileMatch = cleanText.match(/<profile>([\s\S]*?)<\/profile>/);
  if (profileMatch) {
    try {
      profileJson = JSON.parse(profileMatch[1].trim());
    } catch (e) {
      console.error("Failed to parse profile JSON");
    }
  } else {
      // Fallback: look for JSON anywhere
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
          try {
             profileJson = JSON.parse(jsonMatch[0]);
             replyText = replyText.replace(jsonMatch[0], '').trim();
          } catch(e){}
      }
  }

  const updates = {};
  for (const [key, value] of Object.entries(profileJson)) {
    if (value && value.trim() !== "" && value !== "..." && value !== "null") {
      updates[key] = value;
    }
  }

  if (Object.keys(updates).length > 0) {
    updateCustomerProfile(projectId, updates);
  }

  yield { done: true, finalReply: replyText || "（系统未返回回复内容）", updates };
}


export async function analyzeVideoWithGemini(systemInstruction, teardown, targetModel) {
  const { actualModelName, useGptsChatApi } = resolveModelConfig(targetModel);

  const API_URL = useGptsChatApi
    ? `${GPTS_API_BASE_URL}/v1/chat/completions`
    : `https://api.ricoxueai.cn/v1beta/models/${actualModelName}:generateContent`;

  let promptText = `请分析以下视频内容：\n标题：${teardown.title}\n作者：${teardown.user_name}\n发布时间：${teardown.date_published}\n内容描述：${teardown.content}`;
  if (teardown.video_url) {
    promptText += `\n视频原始链接：${teardown.video_url}`;
  }

  let payload, headers;

  if (useGptsChatApi) {
    const userContent = [
      { type: "text", text: promptText }
    ];

    // For OpenAI format with base64 image
    if (teardown.cover_image) {
      userContent.push({
        type: "image_url",
        image_url: { url: teardown.cover_image }
      });
    }

    payload = {
      model: actualModelName,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userContent }
      ],
      max_tokens: 8192
    };
    headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GPTS_API_KEY}`
    };
  } else {
    const parts = [{ text: systemInstruction + "\n\n" + promptText }];
    
    if (teardown.cover_image && teardown.cover_image.startsWith('data:image')) {
      const mimeType = teardown.cover_image.split(';')[0].split(':')[1];
      const base64Data = teardown.cover_image.split(',')[1];
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Data
        }
      });
    } else if (teardown.cover_image) {
       // Gemini Native API cannot take a direct URL in inlineData, so we just add the URL to the text
       parts[0].text += `\n封面图链接：${teardown.cover_image}`;
    }

    payload = { contents: [{ role: 'user', parts }] };
    headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GEMINI_API_KEY}`
    };
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  let text = "";

  if (useGptsChatApi) {
    text = data.choices?.[0]?.message?.content || "";
  } else {
    text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() || "（系统未返回回复内容）";
}
