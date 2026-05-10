import { updateCustomerProfile } from "./appStore.js";

const GPTS_API_BASE_URL = (process.env.GPTS_API_BASE_URL || "https://api.gptsapi.net").replace(/\/$/, "");
const DEFAULT_MODEL = process.env.DEFAULT_LLM_MODEL || "claude-opus-4-6";

const GPTS_MODEL_ALIASES = {
  "gpts-gemini-3.1-pro-preview": "gemini-3.1-pro-preview"
};

const GPTS_MESSAGES_MODELS = new Set([
  "claude-sonnet-4-6-thinking"
]);

const MODEL_PRICING_USD_PER_MILLION = {
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-6-thinking": { input: 3, output: 15 },
  "gpt-5.4": { input: 2.5, output: 15 },
  "gpt-5.5": { input: 5, output: 30 },
  "gemini-3.1-pro-preview": { input: 2, output: 12 },
  "gpts-gemini-3.1-pro-preview": { input: 2, output: 12 }
};

function normalizeEnvValue(value) {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function getRequiredEnv(name) {
  const value = normalizeEnvValue(process.env[name]);
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function estimateUsdCost(modelName, usage) {
  const pricing = MODEL_PRICING_USD_PER_MILLION[modelName];
  if (!pricing || !usage) return null;

  const promptTokens = Number(usage.prompt_tokens || 0);
  const completionTokens = Number(usage.completion_tokens || 0);
  const cost =
    (promptTokens / 1_000_000) * pricing.input +
    (completionTokens / 1_000_000) * pricing.output;

  return Number(cost.toFixed(6));
}

function isNativeGeminiModel(modelName) {
  return modelName === "gemini-3.1-flash-lite-preview" || modelName === "gemini-3.1-pro-preview";
}

function resolveModelConfig(targetModel) {
  const modelName = targetModel || DEFAULT_MODEL;
  const actualModelName = GPTS_MODEL_ALIASES[modelName] || modelName;
  const apiMode = isNativeGeminiModel(modelName)
    ? "native-gemini"
    : (GPTS_MESSAGES_MODELS.has(modelName) ? "gpts-messages" : "gpts-chat");

  return {
    modelName,
    actualModelName,
    apiMode,
    useGptsChatApi: apiMode === "gpts-chat",
    useGptsMessagesApi: apiMode === "gpts-messages"
  };
}

function extractAnthropicText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function estimateTokensFromText(text) {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

function buildPositioningInstruction(systemInstruction, currentProfile) {
  return `${systemInstruction || "你是账号定位专家。"}
      
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
}

function buildChatInstruction(systemInstruction) {
  return systemInstruction || "你是一个专业、友好、简洁的中文助手。";
}

function resolveContentProductionRequestOptions(targetModel) {
  const normalizedModel = String(targetModel || "").trim();
  if (normalizedModel === "claude-opus-4-6" || normalizedModel === "claude-opus-4-7") {
    return {
      // GPTS upstream is unstable for long-form Opus generations; tighter caps are more reliable.
      maxTokens: Number(process.env.CONTENT_PRODUCTION_OPUS_MAX_TOKENS || 512),
      timeoutMs: Number(process.env.CONTENT_PRODUCTION_OPUS_TIMEOUT_MS || 150000)
    };
  }

  if (normalizedModel === "claude-sonnet-4-6-thinking") {
    return {
      // Sonnet via GPTS messages is more stable with smaller content-production outputs.
      maxTokens: Number(process.env.CONTENT_PRODUCTION_SONNET_MAX_TOKENS || 2048),
      timeoutMs: Number(process.env.CONTENT_PRODUCTION_SONNET_TIMEOUT_MS || 150000)
    };
  }

  return {
    maxTokens: Number(process.env.CONTENT_PRODUCTION_MAX_TOKENS || 4096),
    timeoutMs: Number(process.env.CONTENT_PRODUCTION_TIMEOUT_MS || 150000)
  };
}

export async function* streamChatWithGemini(systemInstruction, history, newMessage, currentProfile, projectId, targetModel, options = {}) {
  const modelConfig = resolveModelConfig(targetModel);
  const { actualModelName, useGptsChatApi, useGptsMessagesApi, apiMode } = modelConfig;
  const profileMode = options.profileMode !== false;

  const API_URL = useGptsChatApi
    ? `${GPTS_API_BASE_URL}/v1/chat/completions`
    : useGptsMessagesApi
      ? `${GPTS_API_BASE_URL}/v1/messages`
      : `https://api.ricoxueai.cn/v1beta/models/${actualModelName}:streamGenerateContent?alt=sse`;

  const instruction = profileMode
    ? buildPositioningInstruction(systemInstruction, currentProfile)
    : buildChatInstruction(systemInstruction);

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
    const apiKey = getRequiredEnv("GPTS_API_KEY");
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
      "Authorization": `Bearer ${apiKey}`
    };
  } else if (useGptsMessagesApi) {
    const apiKey = getRequiredEnv("GPTS_API_KEY");
    const messages = [];
    messages.push({ role: 'user', content: `${instruction}\n\n请先确认你已理解以上规则，然后继续回答用户问题。` });
    messages.push({ role: 'assistant', content: "好的，我已理解规则。" });
    for (const msg of history) {
      messages.push({ role: msg.role === 'model' ? 'assistant' : 'user', content: msg.content });
    }
    messages.push({ role: 'user', content: newMessage });

    payload = {
      model: actualModelName,
      messages,
      max_tokens: 8192
    };
    headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    };
  } else {
    const apiKey = getRequiredEnv("GEMINI_API_KEY");
    payload = { contents: contents };
    headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
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

  let fullText = "";
  let usage = null;

  if (useGptsMessagesApi) {
    const data = await response.json();
    fullText = extractAnthropicText(data.content);
    usage = data.usage
      ? {
          prompt_tokens: data.usage.input_tokens || 0,
          completion_tokens: data.usage.output_tokens || 0,
          total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)
        }
      : null;

    if (fullText) {
      yield { chunk: fullText, fullText };
    }
  } else {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

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
            const streamUsage = data.usage || data.x_gpts_usage || null;
            if (streamUsage) usage = streamUsage;
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
  }

  // Final parsing
  let replyText = fullText;
  let profileJson = {};
  
  // Remove <think> blocks
  const cleanText = fullText.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const updates = {};

  if (profileMode) {
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
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          profileJson = JSON.parse(jsonMatch[0]);
          replyText = replyText.replace(jsonMatch[0], "").trim();
        } catch (e) {}
      }
    }

    for (const [key, value] of Object.entries(profileJson)) {
      if (value && value.trim() !== "" && value !== "..." && value !== "null") {
        updates[key] = value;
      }
    }

    if (Object.keys(updates).length > 0) {
      updateCustomerProfile(projectId, updates);
    }
  } else {
    replyText = cleanText.trim() || "（系统未返回回复内容）";
  }

  const estimatedUsage = usage || {
    prompt_tokens: estimateTokensFromText(instruction) + history.reduce((sum, msg) => sum + estimateTokensFromText(msg.content), 0) + estimateTokensFromText(newMessage),
    completion_tokens: estimateTokensFromText(replyText),
    total_tokens: 0
  };
  estimatedUsage.total_tokens = estimatedUsage.total_tokens || (estimatedUsage.prompt_tokens + estimatedUsage.completion_tokens);

  yield { done: true, finalReply: replyText || "（系统未返回回复内容）", updates, usage: estimatedUsage };
}


export async function analyzeVideoWithGemini(systemInstruction, teardown, targetModel) {
  const modelConfig = resolveModelConfig(targetModel);
  const { actualModelName, useGptsChatApi, useGptsMessagesApi } = modelConfig;

  const API_URL = useGptsChatApi
    ? `${GPTS_API_BASE_URL}/v1/chat/completions`
    : useGptsMessagesApi
      ? `${GPTS_API_BASE_URL}/v1/messages`
      : `https://api.ricoxueai.cn/v1beta/models/${actualModelName}:generateContent`;

  let promptText = `请分析以下视频内容：\n标题：${teardown.title}\n作者：${teardown.user_name}\n发布时间：${teardown.date_published}\n内容描述：${teardown.content}`;
  if (teardown.video_url) {
    promptText += `\n视频原始链接：${teardown.video_url}`;
  }

  const response = await callLlmWithPrompt(API_URL, actualModelName, modelConfig, systemInstruction, promptText, teardown.cover_image);
  return response.text;
}

export async function analyzeTopicLibraryContent(systemInstruction, topicData, targetModel) {
  const modelConfig = resolveModelConfig(targetModel);
  const { actualModelName, useGptsChatApi, useGptsMessagesApi } = modelConfig;

  const API_URL = useGptsChatApi
    ? `${GPTS_API_BASE_URL}/v1/chat/completions`
    : useGptsMessagesApi
      ? `${GPTS_API_BASE_URL}/v1/messages`
      : `https://api.ricoxueai.cn/v1beta/models/${actualModelName}:generateContent`;

  const promptText = [
    "请基于以下信息进行内容拆解分析：",
    "",
    "分析提示词：",
    systemInstruction || "未填写",
    "",
    "选题名称：",
    topicData?.topicName || "未填写",
    "",
    "参考文案内容：",
    topicData?.refContent || "未填写"
  ].join("\n");

  return await callLlmWithPrompt(API_URL, actualModelName, modelConfig, systemInstruction, promptText);
}

export async function generateContentProductionStep(systemInstruction, stepData, targetModel) {
  const modelConfig = resolveModelConfig(targetModel);
  const { actualModelName, useGptsChatApi, useGptsMessagesApi } = modelConfig;
  const requestOptions = resolveContentProductionRequestOptions(targetModel);

  const API_URL = useGptsChatApi
    ? `${GPTS_API_BASE_URL}/v1/chat/completions`
    : useGptsMessagesApi
      ? `${GPTS_API_BASE_URL}/v1/messages`
      : `https://api.ricoxueai.cn/v1beta/models/${actualModelName}:generateContent`;

  const promptText = [
    "请执行以下内容生产任务：",
    "",
    `当前流程：${stepData?.stepLabel || "未命名流程"}`,
    "",
    "选题名称：",
    stepData?.topicName || "未填写",
    "",
    "参考文案：",
    stepData?.refContent || "无",
    "",
    "当前输入内容：",
    stepData?.inputContent || "无",
    "",
    "请直接输出可用于当前流程的结果正文，不要解释模型规则，不要添加多余前后缀。"
  ].join("\n");

  return await callLlmWithPrompt(
    API_URL,
    actualModelName,
    modelConfig,
    systemInstruction || "你是资深中文内容生产助手，请输出清晰、完整、可直接使用的内容。",
    promptText,
    null,
    requestOptions
  );
}

async function callLlmWithPrompt(API_URL, actualModelName, apiConfig, systemInstruction, promptText, cover_image = null, requestOptions = {}) {
  const { useGptsChatApi, useGptsMessagesApi, apiMode, modelName } = apiConfig;
  const maxTokens = Number(requestOptions.maxTokens || 8192);
  let payload, headers;

  if (useGptsChatApi) {
    const apiKey = getRequiredEnv("GPTS_API_KEY");
    const userContent = cover_image
      ? [
          { type: "text", text: promptText },
          { type: "image_url", image_url: { url: cover_image } }
        ]
      : promptText;

    payload = {
      model: actualModelName,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userContent }
      ],
      max_tokens: maxTokens
    };
    headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    };
  } else if (useGptsMessagesApi) {
    const apiKey = getRequiredEnv("GPTS_API_KEY");
    let userContent = `${promptText}`;
    if (cover_image) {
      userContent += `\n\n参考图片链接：${cover_image}`;
    }
    payload = {
      model: actualModelName,
      messages: [
        { role: 'user', content: `${systemInstruction}\n\n${userContent}` }
      ],
      max_tokens: maxTokens
    };
    headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    };
  } else {
    const apiKey = getRequiredEnv("GEMINI_API_KEY");
    const parts = [{ text: systemInstruction + "\n\n" + promptText }];
    
    if (cover_image && cover_image.startsWith('data:image')) {
      const mimeType = cover_image.split(';')[0].split(':')[1];
      const base64Data = cover_image.split(',')[1];
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Data
        }
      });
    } else if (cover_image) {
       parts[0].text += `\n封面图链接：${cover_image}`;
    }

    payload = { contents: [{ role: 'user', parts }] };
    headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    };
  }

  const timeoutMs = Number(requestOptions.timeoutMs || process.env.LLM_REQUEST_TIMEOUT_MS || 90000);

  const requestOnce = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(API_URL, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`API Timeout: ${Math.round(timeoutMs / 1000)}s`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  // Avoid automatic replays because upstream retries can create duplicate billable requests.
  const response = await requestOnce();

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 504) {
      throw new Error("API Error: 504 网关超时，请稍后重试或切换模型");
    }
    if (response.status === 570 || response.status === 520 || response.status === 522 || response.status === 524) {
      throw new Error("API Error: 上游 Claude 服务暂时不可用，请稍后重试或切换模型");
    }
    const compactError = String(errorText || "")
      .replace(/\s+/g, " ")
      .replace(/<[^>]*>/g, "")
      .slice(0, 220);
    throw new Error(`API Error: ${response.status} ${compactError || "请求失败"}`);
  }

  const data = await response.json();
  let text = "";
  let usage = null;

  if (useGptsChatApi) {
    text = data.choices?.[0]?.message?.content || "";
    if (data.usage) {
      usage = {
        prompt_tokens: data.usage.prompt_tokens || 0,
        completion_tokens: data.usage.completion_tokens || 0,
        total_tokens: data.usage.total_tokens || ((data.usage.prompt_tokens || 0) + (data.usage.completion_tokens || 0))
      };
    }
  } else if (useGptsMessagesApi) {
    text = extractAnthropicText(data.content);
    if (data.usage) {
      usage = {
        prompt_tokens: data.usage.input_tokens || 0,
        completion_tokens: data.usage.output_tokens || 0,
        total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)
      };
    }
  } else {
    text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (data.usageMetadata) {
      usage = {
        prompt_tokens: data.usageMetadata.promptTokenCount || 0,
        completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
        total_tokens: data.usageMetadata.totalTokenCount || ((data.usageMetadata.promptTokenCount || 0) + (data.usageMetadata.candidatesTokenCount || 0))
      };
    }
  }

  const cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() || "（系统未返回回复内容）";
  const normalizedUsage = usage || {
    prompt_tokens: estimateTokensFromText(`${systemInstruction || ""}\n${promptText || ""}`),
    completion_tokens: estimateTokensFromText(cleanText),
    total_tokens: 0
  };
  normalizedUsage.total_tokens = normalizedUsage.total_tokens || (normalizedUsage.prompt_tokens + normalizedUsage.completion_tokens);

  return {
    text: cleanText,
    usage: normalizedUsage,
    apiMode,
    model: modelName,
    actualModelName,
    apiUrl: API_URL,
    estimated_cost_usd: estimateUsdCost(modelName, normalizedUsage)
  };
}
