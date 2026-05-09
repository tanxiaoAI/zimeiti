import "./loadEnv.js";
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { requestContext } from "./middlewares/requestContext.js";
import { authApiKey } from "./middlewares/authApiKey.js";
import { validateBody } from "./middlewares/validate.js";
import { ok, fail } from "@ai-media/shared/contracts";
import { ErrorCodes } from "@ai-media/shared/errors";
import multer from "multer";
import { uploadsDir } from "./dataPaths.js";

import {
  LoginSchema,
  CreateProjectSchema,
  AccountProfileGenerateSchema,
  TopicsGenerateSchema,
  TopicPatchSchema,
  DraftSaveSchema,
  BodyGenerateSchema,
  CoverRenderSchema,
  RagSearchSchema
} from "./schemas.js";
import { loginWithInvite, rotateApiKey } from "./services/authStore.js";
import {
  addGenerationLog,
  createDraft,
  createProject,
  deleteProject,
  createTopic,
  getAccountProfile,
  getDraft,
  getProject,
  listGenerationLogs,
  listProjects,
  listTopics,
  saveAccountProfile,
  saveDraft,
  updateTopic,
  getCustomerProfile,
  updateCustomerProfile,
  listChatMessages,
  addChatMessage,
  deleteChatMessage,
  saveContextFile,
  getContextFile,
  getContextFileMeta,
  listTopicOptions,
  createTopicOption,
  getTopicOption,
  updateTopicOption,
  deleteTopicOption,
  listTopicLibrary,
  createTopicLibraryItem,
  getTopicLibraryItem,
  updateTopicLibraryItem,
  deleteTopicLibraryItem
} from "./services/appStore.js";
import { addVideoTeardown, listVideoTeardowns, getVideoTeardown, updateVideoTeardown, deleteVideoTeardown } from "./services/appStore.js";

import { streamChatWithGemini, analyzeVideoWithGemini, analyzeTopicLibraryContent } from "./services/aiAgent.js";
import { getLlmProvider } from "./providers/llm/index.js";
import { getHotProvider } from "./providers/hot/index.js";
import { getCoverProvider } from "./providers/cover/index.js";
import { getRagProvider } from "./providers/rag/index.js";
import { createDocument, listDocuments, processDocument, search as kbSearch, deleteDocumentsByProject } from "./services/kbStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

function getRequiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function buildPreviewText(value, maxLength = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(requestContext);

// 静态资源（封面SVG/PNG占位）
app.use("/static", express.static(path.join(__dirname, "..", "public", "static")));
app.use("/static/uploads", express.static(uploadsDir));

// 静态资源（前端构建产物）
let webDistPath = path.join(__dirname, "..", "dist");
if (!fs.existsSync(webDistPath)) {
  webDistPath = path.join(__dirname, "..", "..", "web", "dist");
}
app.use(express.static(webDistPath));

app.get("/health", (req, res) => {
  res.json({ ok: true, request_id: req.context?.requestId });
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

const GETONE_API_BASE_URL = (process.env.GETONE_API_BASE_URL || "https://api.getoneapi.com").replace(/\/$/, "");
const GETONE_API_KEY = process.env.GETONE_API_KEY;
const VOLC_ASR_API_KEY = process.env.VOLC_ASR_API_KEY;
const VOLC_APP_ID = process.env.VOLC_APP_ID;
const VOLC_ACCESS_TOKEN = process.env.VOLC_ACCESS_TOKEN;
const VOLC_ASR_RESOURCE_ID = process.env.VOLC_ASR_RESOURCE_ID || "volc.seedasr.auc";

function extractXiaohongshuNoteId(link) {
  const patterns = [
    /xiaohongshu\.com\/explore\/([a-zA-Z0-9]+)/i,
    /xiaohongshu\.com\/discovery\/item\/([a-zA-Z0-9]+)/i,
    /noteId=([a-zA-Z0-9]+)/i
  ];

  for (const pattern of patterns) {
    const match = link.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function callGetOneApi(endpoint, body) {
  const apiKey = GETONE_API_KEY || getRequiredEnv("GETONE_API_KEY");
  const response = await fetch(`${GETONE_API_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const result = await response.json();
  if (result?.code !== 200) {
    throw new Error(result?.message || `GetOneAPI 调用失败(code=${result?.code ?? "unknown"})`);
  }
  return result.data;
}

function pickXiaohongshuVideoUrl(getOneData) {
  const note = getOneData?.note_list?.[0];
  const streams = [
    ...(note?.video_info_v2?.media?.stream?.h264 || []),
    ...(note?.video_info_v2?.media?.stream?.h265 || [])
  ].filter(item => item?.master_url);

  if (streams.length === 0) {
    throw new Error("小红书详情接口已返回成功，但未找到可用的视频下载地址");
  }

  const preferred = streams.find(item => item.default_stream === 1) || streams[0];
  return {
    videoUrl: preferred.master_url,
    noteTitle: note?.title || "",
    noteDesc: note?.desc || ""
  };
}

function collectCandidateVideoUrls(node, hits = [], path = "root") {
  if (!node) return hits;

  if (typeof node === "string") {
    const value = node.trim();
    if (/^https?:\/\//i.test(value) && /\.(mp4|m3u8|mov|mp3|wav|aac)(\?|$)/i.test(value)) {
      hits.push({ url: value, path });
    }
    return hits;
  }

  if (Array.isArray(node)) {
    node.forEach((item, index) => collectCandidateVideoUrls(item, hits, `${path}[${index}]`));
    return hits;
  }

  if (typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      collectCandidateVideoUrls(value, hits, `${path}.${key}`);
    }
  }

  return hits;
}

function rankCandidateVideoUrl(candidate) {
  const key = candidate.path.toLowerCase();
  let score = 0;
  if (key.includes("play_addr")) score += 50;
  if (key.includes("playapi")) score += 30;
  if (key.includes("url_list")) score += 25;
  if (key.includes("uri")) score -= 20;
  if (key.includes("cover")) score -= 60;
  if (key.includes("dynamic_cover")) score -= 60;
  if (key.includes("origin_cover")) score -= 60;
  if (key.includes("images")) score -= 60;
  if (/\.(mp4|mov|m3u8)(\?|$)/i.test(candidate.url)) score += 20;
  if (/watermark/i.test(candidate.url)) score -= 5;
  return score;
}

function pickDouyinVideoUrl(getOneData) {
  const aweme =
    getOneData?.aweme_detail ||
    getOneData?.aweme_details?.[0] ||
    getOneData?.data?.aweme_detail ||
    getOneData?.data?.aweme_details?.[0] ||
    getOneData;

  const preferredUrls = [
    ...(aweme?.video?.download_addr?.url_list || []),
    ...(aweme?.video?.play_addr?.url_list || []),
    ...(aweme?.video?.play_addr_h264?.url_list || []),
    ...((aweme?.video?.bit_rate || []).flatMap(item => item?.play_addr?.url_list || []))
  ].filter(Boolean);

  if (preferredUrls.length > 0) {
    return {
      videoUrl: preferredUrls[0],
      noteTitle: aweme?.desc || aweme?.title || "",
      noteDesc: aweme?.desc || ""
    };
  }

  const candidates = collectCandidateVideoUrls(getOneData)
    .filter(item => !/cover|image|avatar/i.test(item.path))
    .sort((a, b) => rankCandidateVideoUrl(b) - rankCandidateVideoUrl(a));

  if (candidates.length === 0) {
    throw new Error("抖音详情接口已返回成功，但未找到可用的视频下载地址");
  }

  return {
    videoUrl: candidates[0].url,
    noteTitle: aweme?.desc || aweme?.title || "",
    noteDesc: aweme?.desc || ""
  };
}

async function resolveVideoUrlByPlatform(link, platform) {
  if (platform === "小红书") {
    const noteId = extractXiaohongshuNoteId(link);
    if (!noteId) {
      throw new Error("未能从小红书链接中识别 noteId，请检查链接是否完整");
    }
    const getOneData = await callGetOneApi("/api/xiaohongshu/fetch_video_detail_v6", { noteId });
    return {
      ...pickXiaohongshuVideoUrl(getOneData),
      parser: "getoneapi:xiaohongshu/fetch_video_detail_v6"
    };
  }

  if (platform === "抖音") {
    const awemeIdMatch = link.match(/(?:modal_id|item_id|video)=(\d+)|douyin\.com\/video\/(\d+)/i) || link.match(/modal_id=(\d+)/i) || link.match(/item_id=(\d+)/i) || link.match(/douyin\.com\/video\/(\d+)/i);
    const awemeId = awemeIdMatch?.[1] || awemeIdMatch?.[2] || "";
    const getOneData = await callGetOneApi("/api/douyin/fetch_video_detail", { share_text: link, aweme_id: awemeId });
    return {
      ...pickDouyinVideoUrl(getOneData),
      parser: "getoneapi:douyin/fetch_video_detail"
    };
  }

  throw new Error("仅支持解析小红书和抖音视频链接");
}

function guessAsrFormatFromUrl(mediaUrl) {
  const rawUrl = String(mediaUrl || "");
  const cleanUrl = rawUrl.split("?")[0].toLowerCase();
  if (cleanUrl.endsWith(".wav")) return "wav";
  if (cleanUrl.endsWith(".ogg")) return "ogg";
  if (cleanUrl.endsWith(".mp3")) return "mp3";
  if (cleanUrl.endsWith(".mp4") || /mime_type=video_mp4/i.test(rawUrl) || /\/video\//i.test(rawUrl) || /douyinvod\.com/i.test(rawUrl)) return "mp4";
  if (/mime_type=audio_mp3/i.test(rawUrl)) return "mp3";
  return "mp3";
}

function inferMediaExtension(mediaUrl, contentType = "") {
  const rawUrl = String(mediaUrl || "");
  const cleanUrl = rawUrl.split("?")[0].toLowerCase();
  const contentTypeLower = String(contentType || "").toLowerCase();
  const pathnameExt = path.extname(cleanUrl);

  if (pathnameExt) return pathnameExt;
  if (contentTypeLower.includes("video/mp4")) return ".mp4";
  if (contentTypeLower.includes("audio/mpeg")) return ".mp3";
  if (contentTypeLower.includes("audio/wav")) return ".wav";
  if (contentTypeLower.includes("audio/ogg")) return ".ogg";
  if (/mime_type=video_mp4/i.test(rawUrl) || /douyinvod\.com/i.test(rawUrl) || /\/video\//i.test(rawUrl)) return ".mp4";
  if (/mime_type=audio_mp3/i.test(rawUrl)) return ".mp3";
  return ".bin";
}

function getPublicBaseUrl(req) {
  const configuredBaseUrl = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }
  const host = req.get("host");
  const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const protocol = forwardedProto || (req.protocol === "http" && host.includes("zeabur.app") ? "https" : req.protocol);
  return `${protocol}://${host}`;
}

function buildRemoteMediaHeaderCandidates(remoteUrl) {
  const baseHeaders = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache"
  };
  const rawUrl = String(remoteUrl || "").toLowerCase();

  if (/douyinvod\.com|douyin\.com/.test(rawUrl)) {
    return [
      {
        ...baseHeaders,
        "Referer": "https://www.douyin.com/",
        "Origin": "https://www.douyin.com"
      },
      {
        ...baseHeaders,
        "Referer": "https://www.iesdouyin.com/",
        "Origin": "https://www.iesdouyin.com"
      },
      baseHeaders
    ];
  }

  return [baseHeaders];
}

async function fetchRemoteMediaForMirror(remoteUrl) {
  const timeoutMs = Number(process.env.MEDIA_FETCH_TIMEOUT_MS || 20000);
  const errors = [];

  for (const headers of buildRemoteMediaHeaderCandidates(remoteUrl)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(remoteUrl, {
        headers,
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        errors.push(`status=${response.status || "unknown"} headers=${headers.Referer || "default"}`);
        continue;
      }

      return response;
    } catch (error) {
      const message = error?.name === "AbortError"
        ? `timeout(${timeoutMs}ms) headers=${headers.Referer || "default"}`
        : `${error.message} headers=${headers.Referer || "default"}`;
      errors.push(message);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`媒体文件下载失败: ${errors.join(" | ") || "unknown error"}`);
}

async function mirrorRemoteMediaToPublicUrl(remoteUrl, req, prefix = "topic_media") {
  const response = await fetchRemoteMediaForMirror(remoteUrl);

  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const ext = inferMediaExtension(remoteUrl, response.headers.get("content-type"));
  const filename = `${prefix}_${Date.now()}_${randomUUID()}${ext}`;
  const localPath = path.join(uploadsDir, filename);

  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(localPath));

  return `${getPublicBaseUrl(req)}/static/uploads/${filename}`;
}

function getVolcAsrAuthHeaders() {
  const appId = String(VOLC_APP_ID || "").trim();
  const accessToken = String(VOLC_ACCESS_TOKEN || "").trim();
  if (appId && accessToken) {
    return {
      "X-Api-App-Id": appId,
      "X-Api-Access-Key": accessToken
    };
  }

  const volcAsrApiKey = String(VOLC_ASR_API_KEY || "").trim() || getRequiredEnv("VOLC_ASR_API_KEY");
  return {
    "X-Api-Key": volcAsrApiKey
  };
}

async function submitVolcAsrTask(mediaUrl) {
  const requestId = randomUUID();
  const format = guessAsrFormatFromUrl(mediaUrl);
  const response = await fetch("https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Resource-Id": VOLC_ASR_RESOURCE_ID,
      "X-Api-Request-Id": requestId,
      "X-Api-Sequence": "-1",
      ...getVolcAsrAuthHeaders()
    },
    body: JSON.stringify({
      user: { uid: "ai-media-topic-library" },
      audio: {
        url: mediaUrl,
        format
      },
      request: {
        model_name: "bigmodel",
        enable_itn: true,
        enable_punc: true,
        enable_ddc: false,
        enable_speaker_info: false,
        enable_channel_split: false,
        show_utterances: false,
        vad_segment: false,
        sensitive_words_filter: ""
      }
    })
  });

  const statusCode = response.headers.get("X-Api-Status-Code");
  const statusMessage = response.headers.get("X-Api-Message");
  if (statusCode !== "20000000") {
    throw new Error(`火山语音提交失败(${statusCode || "unknown"}): ${statusMessage || "unknown error"}`);
  }

  return requestId;
}

async function queryVolcAsrTask(requestId) {
  const response = await fetch("https://openspeech.bytedance.com/api/v3/auc/bigmodel/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Resource-Id": VOLC_ASR_RESOURCE_ID,
      "X-Api-Request-Id": requestId,
      ...getVolcAsrAuthHeaders()
    },
    body: JSON.stringify({})
  });

  const statusCode = response.headers.get("X-Api-Status-Code");
  const statusMessage = response.headers.get("X-Api-Message");
  const data = await response.json().catch(() => ({}));

  return { statusCode, statusMessage, data };
}

function isVolcUriError(message) {
  const text = String(message || "");
  return /Invalid audio URI|audio download failed/i.test(text);
}

function buildTopicExtractFallbackContent(parsed) {
  const parts = [parsed?.noteTitle, parsed?.noteDesc]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return Array.from(new Set(parts)).join("\n\n").trim();
}

async function transcribeMediaByVolc(mediaUrl) {
  const requestId = await submitVolcAsrTask(mediaUrl);

  for (let i = 0; i < 20; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const { statusCode, statusMessage, data } = await queryVolcAsrTask(requestId);

    if (statusCode === "20000000") {
      const text = data?.result?.text?.trim();
      if (!text) {
        throw new Error("火山语音已完成，但未返回可用文本");
      }
      return text;
    }

    if (statusCode === "20000001" || statusCode === "20000002") {
      continue;
    }

    throw new Error(`火山语音识别失败(${statusCode || "unknown"}): ${statusMessage || "unknown error"}`);
  }

  throw new Error("火山语音识别超时，请稍后重试");
}

async function transcribeMediaWithFallback(mediaUrls) {
  const errors = [];

  for (const mediaUrl of mediaUrls.filter(Boolean)) {
    try {
      return await transcribeMediaByVolc(mediaUrl);
    } catch (error) {
      errors.push(`${mediaUrl} -> ${error.message}`);
      if (!isVolcUriError(error.message)) {
        throw error;
      }
    }
  }

  throw new Error(errors[errors.length - 1] || "未找到可用的语音识别地址");
}

async function handleProjectChat(req, res, chatType, options = {}) {
  const request_id = req.context?.requestId;
  const project_id = req.params.projectId;
  const project = getProject(project_id);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));

  const { message, systemInstruction, model } = req.body;
  if (!message) return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少聊天内容" }, request_id));

  const userMsg = addChatMessage(project_id, "user", message, null, null, chatType);

  try {
    const history = listChatMessages(project_id, chatType);
    const currentProfile = options.profileMode === false ? null : getCustomerProfile(project_id);
    const pastHistory = history.slice(0, -1);
    const startTime = Date.now();
    let citations = [];
    let finalSystemInstruction = systemInstruction;
    let fullContextFile = null;

    if (options.fullContextModule) {
      fullContextFile = getContextFile(project_id, options.fullContextModule);
      if (fullContextFile?.content) {
        citations = [
          {
            source: { filename: fullContextFile.filename, locator: null },
            full_document: true,
            size_bytes: fullContextFile.size_bytes
          }
        ];

        finalSystemInstruction = `${systemInstruction || "你是一个专业、友好、简洁的中文助手。"}

【已挂载全文参考文件】
以下是用户为当前模块长期挂载的完整参考文件。回答时请优先基于该文件，不要声称“没有收到文件”或“无法查看附件”。
如果用户的问题与文件相关，请尽量直接引用、整理、改写和执行。

文件名：${fullContextFile.filename}
文件全文如下：
<<<FULL_CONTEXT_FILE
${fullContextFile.content}
FULL_CONTEXT_FILE>>>`;
      }
    } else if (options.kbEnabled) {
      citations = kbSearch({
        project_id,
        query: message,
        top_k: options.kbTopK || 4
      });

      if (citations.length > 0) {
        const kbContext = citations
          .map((hit, index) => {
            const source = `${hit.source?.filename || "未知文件"} ${hit.source?.locator?.para ? `第${hit.source.locator.para}段` : ""}`.trim();
            return `[参考${index + 1}] ${source}\n${hit.text}`;
          })
          .join("\n\n");

        finalSystemInstruction = `${systemInstruction || "你是一个专业、友好、简洁的中文助手。"}

【知识库参考】
请优先参考以下项目知识库内容回答；如果命中内容不足，再结合通用能力补充，但不要虚构文档中不存在的事实。

${kbContext}`;
      }
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ type: "userMsg", message: userMsg })}\n\n`);

    let finalReply = "";
    let updates = {};
    let usage = null;

    for await (const event of streamChatWithGemini(finalSystemInstruction, pastHistory, message, currentProfile, project_id, model, options)) {
      if (event.chunk) {
        finalReply = event.fullText || finalReply + event.chunk;
        res.write(`data: ${JSON.stringify({ type: "chunk", chunk: event.chunk, fullText: event.fullText || finalReply })}\n\n`);
      }

      if (event.done) {
        finalReply = event.finalReply || finalReply;
        updates = event.updates || {};
        usage = event.usage || usage;
      }
    }

    const latency_ms = Date.now() - startTime;
    const total_tokens = usage?.total_tokens || null;
    const aiMessage = addChatMessage(project_id, "model", finalReply || "（系统未返回回复内容）", latency_ms, total_tokens, chatType);
    const payload = { type: "done", message: aiMessage, updates, citations };

    if (options.profileMode !== false) {
      payload.profile = getCustomerProfile(project_id);
    }

    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) {
      res.status(500).json(fail({ code: ErrorCodes.INTERNAL_ERROR, message: String(e) }, request_id));
      return;
    }

    res.write(`data: ${JSON.stringify({ type: "error", message: String(e) })}\n\n`);
    res.end();
  }
}

// -----------------------
// API v1
// -----------------------

app.post("/api/v1/auth/login", validateBody(LoginSchema), (req, res) => {
  const request_id = req.context?.requestId;
  const result = loginWithInvite(req.validated.body);
  if (!result.ok) {
    res.status(403).json(fail({ code: ErrorCodes.AUTH_INVALID, message: result.reason }, request_id));
    return;
  }
  res.json(ok(result, request_id));
});

app.post("/api/v1/auth/api-keys/rotate", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const user_id = req.context?.userId;
  res.json(ok(rotateApiKey(user_id), request_id));
});

app.post("/api/v1/projects/:projectId/generate-cover", authApiKey, upload.single("file"), async (req, res) => {
  const request_id = req.context?.requestId;
  try {
    const { prompt } = req.body;
    if (!req.file || !prompt) {
      return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少图片文件或提示词" }, request_id));
    }

    // 保存图片到本地 uploads 目录
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const ext = path.extname(req.file.originalname) || ".png";
    const filename = `cover_${Date.now()}_${randomUUID()}${ext}`;
    const localPath = path.join(uploadsDir, filename);
    fs.writeFileSync(localPath, req.file.buffer);

    // 拼接对外访问的完整 URL
    // 如果是部署在 Zeabur，req.get("host") 将是 Zeabur 提供的公网域名
    const host = req.get("host");
    const protocol = req.protocol === "http" && host.includes("zeabur.app") ? "https" : req.protocol;
    const imageUrl = `${protocol}://${host}/static/uploads/${filename}`;

    // 调用 GPTS API 提交生图请求
    const apiKey = getRequiredEnv("GPTS_API_KEY");
    const gptsRes = await fetch("https://api.gptsapi.net/api/v3/google/gemini-3.1-flash-image-preview/image-edit", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: prompt,
        images: [imageUrl],
        output_format: "jpeg"
      })
    });

    const data = await gptsRes.json();
    if (data.code !== 200 || !data.data?.id) {
      throw new Error(`API 提交失败: ${data.message || JSON.stringify(data)}`);
    }

    // 返回轮询需要的 result_id
    res.json(ok({ result_id: data.data.id, image_url: imageUrl, host_warning: host.includes("localhost") ? "注意: 当前为本地 localhost，外部 API 无法下载你的图片，可能会导致生成失败。请部署到公网后再试。" : null }, request_id));
  } catch (e) {
    console.error(e);
    res.status(500).json(fail({ code: ErrorCodes.INTERNAL_ERROR, message: "生成封面请求失败：" + e.message }, request_id));
  }
});

app.get("/api/v1/projects/:projectId/generate-cover/:resultId", authApiKey, async (req, res) => {
  const request_id = req.context?.requestId;
  try {
    const { resultId } = req.params;
    const apiKey = getRequiredEnv("GPTS_API_KEY");
    const gptsRes = await fetch(`https://api.gptsapi.net/api/v3/predictions/${resultId}/result`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`
      }
    });

    const data = await gptsRes.json();
    if (data.code !== 200) {
      throw new Error(`查询失败: ${data.message}`);
    }

    const status = data.data?.status; // created, processing, succeeded, failed
    if (status === "succeeded") {
      // 成功，提取结果图片
      const outputUrl = data.data.outputs?.[0] || null;
      return res.json(ok({ status: "success", result_url: outputUrl }, request_id));
    } else if (status === "failed") {
      return res.json(ok({ status: "error", message: data.data.error || "生成失败" }, request_id));
    } else {
      // 还在处理中
      return res.json(ok({ status: "processing" }, request_id));
    }
  } catch (e) {
    console.error(e);
    res.status(500).json(fail({ code: ErrorCodes.INTERNAL_ERROR, message: "查询状态失败：" + e.message }, request_id));
  }
});

app.get("/api/v1/projects", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const user_id = req.context?.userId;
  res.json(ok({ items: listProjects(user_id) }, request_id));
});

app.post("/api/v1/projects", authApiKey, validateBody(CreateProjectSchema), (req, res) => {
  const request_id = req.context?.requestId;
  const user_id = req.context?.userId;
  const p = createProject({ user_id, ...req.validated.body });
  res.json(ok(p, request_id));
});

app.delete("/api/v1/projects/:projectId", authApiKey, async (req, res) => {
  const request_id = req.context?.requestId;
  const user_id = req.context?.userId;
  const project_id = req.params.projectId;
  const project = getProject(project_id);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));

  const deleted = deleteProject(project_id, user_id);
  if (!deleted) {
    return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在或无权限删除" }, request_id));
  }

  await deleteDocumentsByProject(project_id);
  res.json(ok({ deleted: true }, request_id));
});

app.get("/api/v1/projects/:projectId/customer-profile", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  res.json(ok(getCustomerProfile(project.id), request_id));
});

app.put("/api/v1/projects/:projectId/customer-profile", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  const saved = updateCustomerProfile(project.id, req.body || {});
  res.json(ok(saved, request_id));
});

app.get("/api/v1/projects/:projectId/positioning/chat", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  res.json(ok({ items: listChatMessages(project.id, "positioning") }, request_id));
});

app.post("/api/v1/projects/:projectId/positioning/chat", authApiKey, async (req, res) => {
  return handleProjectChat(req, res, "positioning", { profileMode: true });
});

app.delete("/api/v1/projects/:projectId/positioning/chat/:messageId", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const { projectId, messageId } = req.params;
  const project = getProject(projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));

  const success = deleteChatMessage(messageId, projectId, "positioning");
  if (!success) {
    return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "消息不存在或已删除" }, request_id));
  }

  res.json(ok({ deleted: true }, request_id));
});

app.get("/api/v1/projects/:projectId/free-chat", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  res.json(ok({ items: listChatMessages(project.id, "free_chat") }, request_id));
});

app.post("/api/v1/projects/:projectId/free-chat", authApiKey, async (req, res) => {
  return handleProjectChat(req, res, "free_chat", { profileMode: false, fullContextModule: "free_chat" });
});

app.delete("/api/v1/projects/:projectId/free-chat/:messageId", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const { projectId, messageId } = req.params;
  const project = getProject(projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));

  const success = deleteChatMessage(messageId, projectId, "free_chat");
  if (!success) {
    return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "消息不存在或已删除" }, request_id));
  }

  res.json(ok({ deleted: true }, request_id));
});

app.get("/api/v1/projects/:projectId/topics", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  res.json(ok({ items: listTopics(project.id) }, request_id));
});

app.post("/api/v1/projects/:projectId/topics:generate", authApiKey, validateBody(TopicsGenerateSchema), async (req, res) => {
  const request_id = req.context?.requestId;
  const user_id = req.context?.userId;
  const project_id = req.params.projectId;
  const project = getProject(project_id);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  const provider = getLlmProvider();
  const mode = (process.env.CAP_LLM || "mock").toLowerCase();
  try {
    const out = await provider.topicsGenerate(req.validated.body);
    const created = (out.items || []).map((it) => createTopic(project_id, it));
    addGenerationLog({
      user_id,
      project_id,
      feature: "topics.generate",
      provider: "llm",
      mode,
      request_id,
      request_json: req.validated.body,
      response_json: out,
      status: "ok"
    });
    res.json(ok({ items: created }, request_id));
  } catch (e) {
    res.status(500).json(fail({ code: ErrorCodes.INTERNAL_ERROR, message: "生成失败" }, request_id));
  }
});

app.patch("/api/v1/topics/:id", authApiKey, validateBody(TopicPatchSchema), (req, res) => {
  const request_id = req.context?.requestId;
  const updated = updateTopic(req.params.id, req.validated.body);
  if (!updated) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "选题不存在" }, request_id));
  res.json(ok(updated, request_id));
});

app.post("/api/v1/topics/:id/drafts:init", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const topic = updateTopic(req.params.id, {}); // hack: 取topic
  if (!topic) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "选题不存在" }, request_id));
  const d = createDraft(topic.id);
  res.json(ok(d, request_id));
});

app.get("/api/v1/drafts/:id", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const d = getDraft(req.params.id);
  if (!d) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "草稿不存在" }, request_id));
  res.json(ok(d, request_id));
});

app.put("/api/v1/drafts/:id", authApiKey, validateBody(DraftSaveSchema), (req, res) => {
  const request_id = req.context?.requestId;
  const d = saveDraft(req.params.id, req.validated.body);
  if (!d) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "草稿不存在" }, request_id));
  res.json(ok(d, request_id));
});

app.post("/api/v1/drafts/:id/title:generate", authApiKey, async (req, res) => {
  const request_id = req.context?.requestId;
  const user_id = req.context?.userId;
  const d = getDraft(req.params.id);
  if (!d) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "草稿不存在" }, request_id));
  const provider = getLlmProvider();
  const mode = (process.env.CAP_LLM || "mock").toLowerCase();
  const out = await provider.titleGenerate({ draft_id: d.id });
  const saved = saveDraft(d.id, { title_candidates: out });
  addGenerationLog({ user_id, feature: "draft.title.generate", provider: "llm", mode, request_id, request_json: { draft_id: d.id }, response_json: out, status: "ok" });
  res.json(ok(saved.title_candidates, request_id));
});

app.post("/api/v1/drafts/:id/hook:generate", authApiKey, async (req, res) => {
  const request_id = req.context?.requestId;
  const user_id = req.context?.userId;
  const d = getDraft(req.params.id);
  if (!d) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "草稿不存在" }, request_id));
  const provider = getLlmProvider();
  const mode = (process.env.CAP_LLM || "mock").toLowerCase();
  const out = await provider.hookGenerate({ draft_id: d.id });
  const saved = saveDraft(d.id, { hook_candidates: out });
  addGenerationLog({ user_id, feature: "draft.hook.generate", provider: "llm", mode, request_id, request_json: { draft_id: d.id }, response_json: out, status: "ok" });
  res.json(ok(saved.hook_candidates, request_id));
});

app.post("/api/v1/drafts/:id/body:generate", authApiKey, validateBody(BodyGenerateSchema), async (req, res) => {
  const request_id = req.context?.requestId;
  const user_id = req.context?.userId;
  const d = getDraft(req.params.id);
  if (!d) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "草稿不存在" }, request_id));

  // RAG：首期默认使用内置关键词检索（modules/kb），CAP_RAG仅用于mock对照
  let citations = [];
  if (req.validated.body.rag?.enabled) {
    const project_id = req.validated.body.rag.project_id;
    if (!project_id) {
      return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "启用RAG时必须提供rag.project_id" }, request_id));
    }
    const q = req.validated.body.rag.query || "";
    citations = kbSearch({ project_id, query: q, top_k: req.validated.body.rag.top_k });
    if ((req.validated.body.rag.force_citations || 0) > 0 && citations.length < req.validated.body.rag.force_citations) {
      // 降级：再走 mock rag provider 补齐（便于演示强制引用）
      const ragProvider = getRagProvider();
      const ragMode = (process.env.CAP_RAG || "mock").toLowerCase();
      if (ragMode === "mock") {
        const mockHits = await ragProvider.search({ query: q, top_k: req.validated.body.rag.top_k });
        citations = mockHits.hits || citations;
      }
    }
  }

  const provider = getLlmProvider();
  const mode = (process.env.CAP_LLM || "mock").toLowerCase();
  const out = await provider.bodyGenerate({ draft_id: d.id, citations });
  const saved = saveDraft(d.id, { body_blocks: out, citations: citations });
  addGenerationLog({
    user_id,
    feature: "draft.body.generate",
    provider: "llm",
    mode,
    request_id,
    request_json: { draft_id: d.id, ...req.validated.body, citations },
    response_json: out,
    status: "ok"
  });
  res.json(ok({ blocks: saved.body_blocks?.blocks || [], citations }, request_id));
});


// Video Teardown Routes
app.get("/api/v1/projects/:projectId/video-teardown", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  res.json(ok({ items: listVideoTeardowns(project.id) }, request_id));
});

app.post("/api/v1/projects/:projectId/video-teardown/parse", authApiKey, async (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  
  const { url } = req.body;
  if (!url) return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少url参数" }, request_id));

  try {
    
    const response = await fetch("https://videoparser2.p.rapidapi.com/api/media", {
      method: "POST",
      headers: {
        "x-rapidapi-key": "079b6bc2f2msh2d9995646bf2483p190e49jsndf0d32e9281c",
        "x-rapidapi-host": "videoparser2.p.rapidapi.com",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url })
    });
    const resJson = await response.json();
    if (!resJson || !resJson.data) {
       throw new Error("解析失败，无有效数据");
    }
    const result = resJson.data;

    // 找到分辨率最低的视频 URL
    let lowestVideoUrl = "";
    if (result.video_url) {
      lowestVideoUrl = result.video_url;
    } else if (result.medias && result.medias.length > 0) {
      const firstMedia = result.medias[0];
      if (firstMedia.variants && firstMedia.variants.length > 0) {
        const sorted = firstMedia.variants.sort((a, b) => (a.size || 0) - (b.size || 0));
        lowestVideoUrl = sorted[0].url || sorted[0].video_url;
      } else {
        lowestVideoUrl = firstMedia.url || firstMedia.video_url;
      }
    } else if (result.url && result.url.includes('.mp4')) {
      lowestVideoUrl = result.url;
    }

    // 构建并保存数据
    const dataToSave = {
      url: url,
      title: result.title || "未知标题",
      content: result.content || result.desc || "",
      date_published: result.date_published || result.create_time || "",
      cover_image: result.cover_image || result.cover_url || result.cover || "",
      user_name: result.user_name || result.author?.nickname || "未知作者",
      video_url: lowestVideoUrl || "",
      local_video_path: "" // 后续若需要可自行下载后更新该字段
    };

    const saved = addVideoTeardown(project.id, dataToSave);
    res.json(ok(saved, request_id));
  } catch (e) {
    console.error(e);
    res.status(500).json(fail({ code: ErrorCodes.INTERNAL_ERROR, message: "解析视频信息失败：" + e.message }, request_id));
  }
});

app.post("/api/v1/projects/:projectId/video-teardown/upload", authApiKey, upload.single("file"), (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  if (!req.file) return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少file" }, request_id));
  
  try {
    
    // 模拟将 buffer 保存为本地文件，这里只记录元数据
    // 解决 ENAMETOOLONG 问题：截断文件名或生成唯一短 ID
    const ext = path.extname(req.file.originalname);
    const safeName = Date.now() + "_" + Math.random().toString(36).substring(2, 8) + ext;
    const local_video_path = safeName;
    
    // 我们在此简单保存到 uploads 目录，假设有这个目录
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, local_video_path), req.file.buffer);

    const dataToSave = {
      url: "",
      title: Buffer.from(req.file.originalname, "latin1").toString("utf8"),
      content: "",
      date_published: new Date().toISOString(),
      cover_image: req.body.cover_image || "",
      user_name: "本地上传",
      video_url: "",
      local_video_path: "/static/uploads/" + local_video_path
    };

    const saved = addVideoTeardown(project.id, dataToSave);
    res.json(ok(saved, request_id));
  } catch (e) {
    console.error(e);
    res.status(500).json(fail({ code: ErrorCodes.INTERNAL_ERROR, message: "上传失败：" + e.message }, request_id));
  }
});

app.post("/api/v1/projects/:projectId/video-teardown/:id/analyze", authApiKey, async (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  
  const teardown = getVideoTeardown(req.params.id);
  if (!teardown || teardown.project_id !== project.id) {
    return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "拆解记录不存在" }, request_id));
  }

  const { systemInstruction, model } = req.body;
  if (!systemInstruction) return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少 systemInstruction" }, request_id));

  try {
    const reply = await analyzeVideoWithGemini(systemInstruction, teardown, model);
    
    const updated = updateVideoTeardown(teardown.id, { ai_analysis: reply });
    res.json(ok(updated, request_id));
  } catch (e) {
    console.error(e);
    res.status(500).json(fail({ code: ErrorCodes.INTERNAL_ERROR, message: "AI分析失败：" + e.message }, request_id));
  }
});

app.delete("/api/v1/projects/:projectId/video-teardown/:id", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  
  const success = deleteVideoTeardown(req.params.id, project.id);
  if (!success) {
    return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "删除失败，记录不存在" }, request_id));
  }
  res.json(ok({ deleted: true }, request_id));
});

// -----------------------
// Topic Library API
// -----------------------

app.get("/api/v1/projects/:projectId/topic-options", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  
  const field = req.query.field;
  if (!field) return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少 field 参数" }, request_id));
  
  res.json(ok({ items: listTopicOptions(project.id, field) }, request_id));
});

app.post("/api/v1/projects/:projectId/topic-options", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  
  if (!req.body.field || !req.body.value) {
    return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少必填字段" }, request_id));
  }
  
  const created = createTopicOption(project.id, req.body);
  res.json(ok(created, request_id));
});

app.put("/api/v1/projects/:projectId/topic-options/:id", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const updated = updateTopicOption(req.params.id, req.body);
  res.json(ok(updated, request_id));
});

app.delete("/api/v1/projects/:projectId/topic-options/:id", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  deleteTopicOption(req.params.id);
  res.json(ok({ deleted: true }, request_id));
});

app.get("/api/v1/projects/:projectId/topic-library", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  res.json(ok({ items: listTopicLibrary(project.id) }, request_id));
});

app.post("/api/v1/projects/:projectId/topic-library", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  if (!req.body.name) return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "选题名称必填" }, request_id));
  
  const created = createTopicLibraryItem(project.id, req.body);
  res.json(ok(created, request_id));
});

app.put("/api/v1/projects/:projectId/topic-library/:id", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  
  const updated = updateTopicLibraryItem(req.params.id, req.body);
  res.json(ok(updated, request_id));
});

app.delete("/api/v1/projects/:projectId/topic-library/:id", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  deleteTopicLibraryItem(req.params.id);
  res.json(ok({ deleted: true }, request_id));
});

app.post("/api/v1/projects/:projectId/topic-library/extract", authApiKey, async (req, res) => {
  const request_id = req.context?.requestId;
  const { link, platform } = req.body;
  if (!link) return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少参考链接" }, request_id));
  
  if (platform !== "小红书" && platform !== "抖音") {
    return res.json(ok({ content: "仅能解析小红书和抖音视频内容" }, request_id));
  }
  
  try {
    const parsed = await resolveVideoUrlByPlatform(link, platform);
    let mirroredMediaUrl = null;
    try {
      mirroredMediaUrl = await mirrorRemoteMediaToPublicUrl(parsed.videoUrl, req, "topic_extract");
    } catch (mirrorError) {
      console.warn("topic-library extract mirror failed:", mirrorError.message);
    }
    let transcript = "";
    let fallbackContent = "";
    let extractFallback = null;
    try {
      transcript = await transcribeMediaWithFallback([mirroredMediaUrl, parsed.videoUrl]);
    } catch (transcribeError) {
      fallbackContent = buildTopicExtractFallbackContent(parsed);
      if (!fallbackContent) {
        throw transcribeError;
      }
      extractFallback = {
        source: "title_desc_fallback",
        reason: transcribeError.message
      };
    }

    res.json(ok({
      content: transcript,
      content_source: transcript ? "transcript" : null,
      fallback_content: fallbackContent || null,
      platform,
      source_link: link,
      resolved_video_url: parsed.videoUrl,
      mirrored_media_url: mirroredMediaUrl,
      extract_fallback: extractFallback,
      parser: parsed.parser,
      note_title: parsed.noteTitle,
      note_desc: parsed.noteDesc
    }, request_id));
  } catch (e) {
    console.error(e);
    res.status(500).json(fail({ code: ErrorCodes.INTERNAL_ERROR, message: "提取失败：" + e.message }, request_id));
  }
});

app.post("/api/v1/projects/:projectId/topic-library/analyze", authApiKey, async (req, res) => {
  const request_id = req.context?.requestId;
  const user_id = req.context?.userId;
  const project_id = req.params.projectId;
  const { systemInstruction, models, topicName, refContent } = req.body;
  const normalizedRefContent = String(refContent || "").trim() || "无";
  
  if (!models || models.length === 0) return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "至少需要选择一个模型" }, request_id));
  
  try {
    const promises = models.map(async (model) => {
      const startedAt = Date.now();
      try {
        const analysis = await analyzeTopicLibraryContent(
          systemInstruction || "你是一个资深自媒体内容分析师。",
          { topicName, refContent: normalizedRefContent },
          model
        );

        addGenerationLog({
          user_id,
          project_id,
          feature: "topic_library.analyze",
          provider: "llm",
          mode: analysis.apiMode,
          request_id,
          status: "ok",
          request_json: {
            model,
            topic_name: topicName || "",
            ref_content_preview: buildPreviewText(normalizedRefContent),
            prompt_preview: buildPreviewText(systemInstruction || "你是一个资深自媒体内容分析师。")
          },
          response_json: {
            actual_model: analysis.actualModelName,
            api_mode: analysis.apiMode,
            latency_ms: Date.now() - startedAt,
            usage: analysis.usage,
            estimated_cost_usd: analysis.estimated_cost_usd,
            result_preview: buildPreviewText(analysis.text)
          }
        });

        return {
          model,
          result: analysis.text,
          error: null,
          usage: analysis.usage,
          estimated_cost_usd: analysis.estimated_cost_usd,
          api_mode: analysis.apiMode
        };
      } catch (e) {
        addGenerationLog({
          user_id,
          project_id,
          feature: "topic_library.analyze",
          provider: "llm",
          mode: null,
          request_id,
          status: "error",
          request_json: {
            model,
            topic_name: topicName || "",
            ref_content_preview: buildPreviewText(normalizedRefContent),
            prompt_preview: buildPreviewText(systemInstruction || "你是一个资深自媒体内容分析师。")
          },
          response_json: {
            latency_ms: Date.now() - startedAt,
            error: e.message
          }
        });

        return { model, result: null, error: e.message };
      }
    });
    
    const results = await Promise.all(promises);
    res.json(ok({ results }, request_id));
  } catch (e) {
    console.error(e);
    res.status(500).json(fail({ code: ErrorCodes.INTERNAL_ERROR, message: "AI分析失败：" + e.message }, request_id));
  }
});

app.get("/api/v1/projects/:projectId/topic-library/analyze-logs", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const user_id = req.context?.userId;
  const project_id = req.params.projectId;
  const limit = req.query.limit ? Number(req.query.limit) : 50;

  res.json(ok({
    items: listGenerationLogs({
      user_id,
      project_id,
      feature: "topic_library.analyze",
      limit
    })
  }, request_id));
});

// capabilities/hot
app.get("/api/v1/capabilities/hot/trends", authApiKey, async (req, res) => {
  const request_id = req.context?.requestId;
  const provider = getHotProvider();
  const out = await provider.trends(req.query);
  res.json(ok(out, request_id));
});

// covers
app.get("/api/v1/covers/templates", authApiKey, async (req, res) => {
  const request_id = req.context?.requestId;
  const provider = getCoverProvider();
  res.json(ok(await provider.templates(), request_id));
});

app.post("/api/v1/covers/render", authApiKey, validateBody(CoverRenderSchema), async (req, res) => {
  const request_id = req.context?.requestId;
  const user_id = req.context?.userId;
  const provider = getCoverProvider();
  const mode = (process.env.CAP_COVER || "mock").toLowerCase();
  const out = await provider.render(req.validated.body);
  addGenerationLog({ user_id, feature: "cover.render", provider: "cover", mode, request_id, request_json: req.validated.body, response_json: out, status: "ok" });
  res.json(ok(out, request_id));
});

// knowledge base
app.get("/api/v1/projects/:projectId/context-file", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  const module_key = String(req.query.module_key || "");
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  if (!module_key) return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少module_key" }, request_id));
  res.json(ok(getContextFileMeta(project.id, module_key), request_id));
});

app.post("/api/v1/projects/:projectId/context-file", authApiKey, upload.single("file"), async (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  const module_key = String(req.body.module_key || "");
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  if (!module_key) return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少module_key" }, request_id));
  if (!req.file) return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少file" }, request_id));

  try {
    const filename = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    const content = req.file.buffer.toString("utf8");
    const saved = saveContextFile(project.id, module_key, filename, content);
    res.json(ok(saved, request_id));
  } catch (e) {
    console.error(e);
    res.status(500).json(fail({ code: ErrorCodes.INTERNAL_ERROR, message: `全文文件上传失败：${e.message}` }, request_id));
  }
});

app.get("/api/v1/kb/documents", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const project_id = String(req.query.project_id || "");
  if (!project_id) return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少project_id" }, request_id));
  res.json(ok({ items: listDocuments(project_id) }, request_id));
});

app.post("/api/v1/kb/documents", authApiKey, upload.single("file"), async (req, res) => {
  const request_id = req.context?.requestId;
  const project_id = String(req.body.project_id || "");
  if (!project_id) return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少project_id" }, request_id));
  if (!req.file) return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少file" }, request_id));
  try {
    const doc = await createDocument({ project_id, originalname: req.file.originalname, buffer: req.file.buffer });
    res.json(ok(doc, request_id));
  } catch (e) {
    console.error(e);
    res.status(500).json(fail({ code: ErrorCodes.INTERNAL_ERROR, message: `知识库上传失败：${e.message}` }, request_id));
  }
});

app.post("/api/v1/kb/documents/:id/process", authApiKey, async (req, res) => {
  const request_id = req.context?.requestId;
  try {
    const out = await processDocument(req.params.id);
    if (!out) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "文档不存在" }, request_id));
    res.json(ok(out, request_id));
  } catch (e) {
    console.error(e);
    res.status(500).json(fail({ code: ErrorCodes.INTERNAL_ERROR, message: `知识库索引失败：${e.message}` }, request_id));
  }
});

app.post("/api/v1/kb/search", authApiKey, validateBody(RagSearchSchema), (req, res) => {
  const request_id = req.context?.requestId;
  const hits = kbSearch(req.validated.body);
  res.json(ok({ hits }, request_id));
});

app.get("/api/v1/generation-logs", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const user_id = req.context?.userId;
  const project_id = req.query.project_id ? String(req.query.project_id) : undefined;
  const feature = req.query.feature ? String(req.query.feature) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  res.json(ok({ items: listGenerationLogs({ user_id, project_id, feature, limit }) }, request_id));
});

// API 兜底404 (仅处理 /api 前缀的请求)
app.use("/api", (req, res) => {
  res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "Not Found" }, req.context?.requestId));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res
    .status(err.status || 500)
    .json(fail({ code: ErrorCodes.INTERNAL_ERROR, message: err.message || "服务器内部错误" }, req.context?.requestId));
});

// 所有其他未匹配的请求全部返回 index.html（支持前端路由）
app.get("*", (req, res) => {
  res.sendFile(path.join(webDistPath, "index.html"));
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`[WEB] Serving static files from ${webDistPath}`);
});
