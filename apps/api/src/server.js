import "./loadEnv.js";
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { requestContext } from "./middlewares/requestContext.js";
import { authApiKey } from "./middlewares/authApiKey.js";
import { validateBody } from "./middlewares/validate.js";
import { ok, fail } from "@ai-media/shared/contracts";
import { ErrorCodes } from "@ai-media/shared/errors";
import multer from "multer";
import { dataDir, dbPath, kbStorageDir, uploadsDir } from "./dataPaths.js";

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
  deleteTopicLibraryItem,
  reorderTopicLibraryItems,
  createTopicExtractJob,
  getTopicExtractJob,
  findLatestActiveTopicExtractJob,
  updateTopicExtractJob
} from "./services/appStore.js";
import { addVideoTeardown, listVideoTeardowns, getVideoTeardown, updateVideoTeardown, deleteVideoTeardown } from "./services/appStore.js";

import { streamChatWithGemini, analyzeVideoWithGemini, analyzeTopicLibraryContent, generateContentProductionStep } from "./services/aiAgent.js";
import { getLlmProvider } from "./providers/llm/index.js";
import { getHotProvider } from "./providers/hot/index.js";
import { getCoverProvider } from "./providers/cover/index.js";
import { getRagProvider } from "./providers/rag/index.js";
import { createDocument, listDocuments, processDocument, search as kbSearch, deleteDocumentsByProject } from "./services/kbStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

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

function buildPreviewText(value, maxLength = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function getEnvValue(name) {
  return normalizeEnvValue(process.env[name]);
}

function isEnvConfigured(name) {
  return Boolean(getEnvValue(name));
}

function buildSystemEnvChecklist() {
  return [
    {
      key: "GPTS_API_KEY",
      label: "GPTS 聚合模型 Key",
      required: true,
      secret: true,
      configure_in: "zeabur",
      used_by: ["账号定位", "选题库 AI 分析", "视频拆解 AI", "生成封面"],
      note: "当前大部分 GPT/Claude/GPTS Gemini 模型都依赖它。"
    },
    {
      key: "GEMINI_API_KEY",
      label: "Gemini 原生 API Key",
      required: false,
      secret: true,
      configure_in: "zeabur",
      used_by: ["Gemini 原生模型调用"],
      note: "仅当选择原生 Gemini 路由时需要。"
    },
    {
      key: "GETONE_API_KEY",
      label: "GetOne 解析 Key",
      required: true,
      secret: true,
      configure_in: "zeabur",
      used_by: ["抖音/小红书链接解析"],
      note: "视频文案提取第一步依赖它。"
    },
    {
      key: "GETONE_API_BASE_URL",
      label: "GetOne Base URL",
      required: false,
      secret: false,
      configure_in: "zeabur",
      used_by: ["抖音/小红书链接解析"],
      default_value: "https://api.getoneapi.com",
      note: "通常无需改动。"
    },
    {
      key: "BAILIAN_API_KEY",
      label: "百炼 API Key",
      required: !isEnvConfigured("DASHSCOPE_API_KEY"),
      secret: true,
      configure_in: "zeabur",
      used_by: ["百炼 Qwen ASR 文件转写"],
      note: "用于调用 qwen3-asr-flash-filetrans。"
    },
    {
      key: "DASHSCOPE_API_KEY",
      label: "DashScope API Key",
      required: !isEnvConfigured("BAILIAN_API_KEY"),
      secret: true,
      configure_in: "zeabur",
      used_by: ["百炼 Qwen ASR 文件转写"],
      note: "与 BAILIAN_API_KEY 二选一即可。"
    },
    {
      key: "BAILIAN_BASE_URL",
      label: "百炼 API Base URL",
      required: false,
      secret: false,
      configure_in: "zeabur",
      used_by: ["百炼 Qwen ASR 文件转写"],
      default_value: "https://dashscope.aliyuncs.com/api/v1",
      note: "若配置了 compatible-mode/v1，服务端会自动换算为 api/v1。"
    },
    {
      key: "PUBLIC_BASE_URL",
      label: "站点公网 Base URL",
      required: false,
      secret: false,
      configure_in: "zeabur",
      used_by: ["生成封面", "公网静态资源地址"],
      note: "未配置时按请求头推断。"
    },
    {
      key: "MEDIA_PUBLIC_BASE_URL",
      label: "媒体公网 Base URL",
      required: false,
      secret: false,
      configure_in: "zeabur",
      used_by: ["视频/音频镜像地址", "百炼 ASR 拉取镜像媒体"],
      note: "推荐配置成可直接公网访问静态文件的域名。"
    },
    {
      key: "DATA_DIR",
      label: "业务数据目录",
      required: false,
      secret: false,
      configure_in: "zeabur",
      used_by: ["SQLite", "uploads", "知识库文件"],
      note: "线上建议指向 Zeabur 持久盘挂载目录。"
    },
    {
      key: "DB_PATH",
      label: "SQLite 数据库路径",
      required: false,
      secret: false,
      configure_in: "zeabur",
      used_by: ["SQLite"],
      note: "通常跟随 DATA_DIR 自动推导。"
    },
    {
      key: "UPLOADS_DIR",
      label: "上传文件目录",
      required: false,
      secret: false,
      configure_in: "zeabur",
      used_by: ["视频镜像", "封面临时文件"],
      note: "通常跟随 DATA_DIR 自动推导。"
    }
  ].map((item) => {
    const actualValue = getEnvValue(item.key);
    return {
      ...item,
      configured: Boolean(actualValue),
      value_preview: actualValue
        ? (item.secret ? `${actualValue.slice(0, 3)}***${actualValue.slice(-2)}` : actualValue)
        : "",
      source: actualValue ? "process.env" : (item.default_value ? "default" : "missing")
    };
  });
}

function buildSystemConfigStatus() {
  return {
    env_items: buildSystemEnvChecklist(),
    storage: {
      data_dir: dataDir,
      db_path: dbPath,
      uploads_dir: uploadsDir,
      kb_storage_dir: kbStorageDir,
      data_dir_exists: fs.existsSync(dataDir),
      uploads_dir_exists: fs.existsSync(uploadsDir),
      kb_storage_dir_exists: fs.existsSync(kbStorageDir)
    },
    runtime: {
      node_env: process.env.NODE_ENV || "development",
      port: Number(process.env.PORT || 8787),
      cap_llm: (process.env.CAP_LLM || "mock").toLowerCase(),
      cap_rag: (process.env.CAP_RAG || "mock").toLowerCase(),
      cap_cover: (process.env.CAP_COVER || "mock").toLowerCase(),
      cap_hot: (process.env.CAP_HOT || "mock").toLowerCase()
    }
  };
}

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(requestContext);

// 静态资源（封面SVG/PNG占位）
app.use("/static", express.static(path.join(__dirname, "..", "public", "static")));
app.use("/static/uploads", express.static(uploadsDir));

// 静态资源（前端构建产物）
let webDistPath = path.join(__dirname, "..", "web-dist");
if (!fs.existsSync(webDistPath)) {
  webDistPath = path.join(__dirname, "..", "..", "web", "dist");
}
app.use(express.static(webDistPath));

app.get("/health", (req, res) => {
  res.json({ ok: true, request_id: req.context?.requestId });
});

app.get("/api/v1/system/config-status", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  res.json(ok(buildSystemConfigStatus(), request_id));
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

const GETONE_API_BASE_URL = (process.env.GETONE_API_BASE_URL || "https://api.getoneapi.com").replace(/\/$/, "");
const GETONE_API_KEY = process.env.GETONE_API_KEY;
const BAILIAN_API_KEY = process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY;
const BAILIAN_BASE_URL = process.env.BAILIAN_BASE_URL || process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/api/v1";
const BAILIAN_ASR_MODEL = process.env.BAILIAN_ASR_MODEL || "qwen3-asr-flash-filetrans";
const MEDIA_PUBLIC_BASE_URL = process.env.MEDIA_PUBLIC_BASE_URL;
const YT_DLP_PYTHON = process.env.YT_DLP_PYTHON || "python3";
let ytDlpReadyPromise = null;
let ffmpegReadyPromise = null;

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000, timeoutLabel = "请求超时") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${timeoutLabel}(${timeoutMs}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function runProcess(command, args, { cwd, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`命令执行超时(${timeoutMs}ms): ${command} ${args.join(" ")}`));
        return;
      }
      if (code !== 0) {
        reject(new Error((stderr || stdout || `退出码 ${code}`).trim()));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function ensureYtDlpAvailable() {
  if (!ytDlpReadyPromise) {
    ytDlpReadyPromise = (async () => {
      try {
        await runProcess(YT_DLP_PYTHON, ["-m", "yt_dlp", "--version"], { timeoutMs: 10000 });
        return;
      } catch (_error) {
        await runProcess(
          YT_DLP_PYTHON,
          ["-m", "pip", "install", "--user", "--disable-pip-version-check", "yt-dlp"],
          { timeoutMs: Number(process.env.YT_DLP_INSTALL_TIMEOUT_MS || 120000) }
        );
        await runProcess(YT_DLP_PYTHON, ["-m", "yt_dlp", "--version"], { timeoutMs: 10000 });
      }
    })().catch((error) => {
      ytDlpReadyPromise = null;
      throw new Error(`yt-dlp 不可用: ${error.message}`);
    });
  }
  return ytDlpReadyPromise;
}

async function ensureFfmpegAvailable() {
  if (!ffmpegReadyPromise) {
    ffmpegReadyPromise = runProcess("ffmpeg", ["-version"], {
      timeoutMs: 10000
    }).catch((error) => {
      ffmpegReadyPromise = null;
      throw new Error(`ffmpeg 不可用: ${error.message}`);
    });
  }
  return ffmpegReadyPromise;
}

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
  const timeoutMs = Number(process.env.GETONE_TIMEOUT_MS || 20000);
  const response = await fetchWithTimeout(`${GETONE_API_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  }, timeoutMs, "GetOneAPI 请求超时");

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
    noteDesc: note?.desc || "",
    videoSource: "note.video_info_v2.media.stream",
    durationMs: Number(note?.video_info_v2?.media?.duration || 0) || null
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

function dedupeUrls(urls) {
  const seen = new Set();
  const result = [];
  for (const item of urls || []) {
    const value = String(item || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function buildDouyinVideoCandidates(aweme) {
  const candidates = [];
  const pushCandidates = (urls, source) => {
    for (const url of urls || []) {
      if (!url) continue;
      candidates.push({ url, source });
    }
  };

  pushCandidates(aweme?.video?.play_addr_h264?.url_list, "aweme.video.play_addr_h264.url_list");
  pushCandidates(aweme?.video?.play_addr?.url_list, "aweme.video.play_addr.url_list");
  pushCandidates(aweme?.video?.play_addr_265?.url_list, "aweme.video.play_addr_265.url_list");
  for (const bitRate of aweme?.video?.bit_rate || []) {
    pushCandidates(bitRate?.play_addr?.url_list, "aweme.video.bit_rate.play_addr.url_list");
  }
  pushCandidates(aweme?.video?.download_addr?.url_list, "aweme.video.download_addr.url_list");
  pushCandidates(aweme?.video?.download_suffix_logo_addr?.url_list, "aweme.video.download_suffix_logo_addr.url_list");

  const seen = new Set();
  return candidates.filter((item) => {
    if (!item?.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function rankDouyinCandidate(candidate) {
  const source = String(candidate?.source || "").toLowerCase();
  const url = String(candidate?.url || "").trim();
  let score = 0;

  if (source.includes("download_addr")) score += 160;
  if (source.includes("download_suffix_logo_addr")) score += 140;
  if (source.includes("play_addr_h264")) score += 80;
  if (source.includes("play_addr")) score += 70;
  if (source.includes("play_addr_265")) score += 40;
  if (source.includes("bit_rate")) score -= 120;
  if (/douyinvod\.com/i.test(url)) score += 30;
  if (/\/aweme\/v1\/play/i.test(url)) score -= 20;
  if (/\/media-video-(avc1|hvc1)\//i.test(url)) score -= 240;
  if (/\/aweme\/v1\/play\/dash\//i.test(url)) score -= 240;
  if (/watermark=1/i.test(url)) score -= 10;

  return score;
}

function isLikelyVideoOnlyDouyinUrl(url) {
  const value = String(url || "").trim().toLowerCase();
  return /\/media-video-(avc1|hvc1)\//i.test(value) || /\/aweme\/v1\/play\/dash\//i.test(value);
}

async function probeDouyinVideoCandidate(url) {
  const tryFetch = async (method, headers = {}) => {
    const response = await fetchWithTimeout(url, {
      method,
      headers,
      redirect: "follow"
    }, 6000, `抖音候选链接探测超时(${method})`);
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const finalUrl = String(response.url || url).trim();
    const isVideo = contentType.startsWith("video/") || /\.mp4(\?|$)/i.test(finalUrl);
    if (isVideo && response.ok && !isLikelyVideoOnlyDouyinUrl(finalUrl)) {
      if (response.body?.cancel) {
        try { await response.body.cancel(); } catch (_error) {}
      }
      return {
        ok: true,
        finalUrl
      };
    }
    if (response.body?.cancel) {
      try { await response.body.cancel(); } catch (_error) {}
    }
    return {
      ok: false,
      finalUrl
    };
  };

  try {
    return await tryFetch("HEAD");
  } catch (_error) {
    try {
      return await tryFetch("GET", { Range: "bytes=0-1" });
    } catch (_innerError) {
      return { ok: false, finalUrl: String(url || "").trim() };
    }
  }
}

async function pickReachableDouyinCandidate(candidates) {
  const ranked = [...(candidates || [])].sort((a, b) => rankDouyinCandidate(b) - rankDouyinCandidate(a));
  for (const candidate of ranked.slice(0, 8)) {
    const probed = await probeDouyinVideoCandidate(candidate.url);
    if (probed.ok) {
      return {
        selected: {
          ...candidate,
          url: probed.finalUrl || candidate.url
        },
        orderedUrls: dedupeUrls([
          probed.finalUrl || candidate.url,
          ...ranked.map((item) => item.url)
        ])
      };
    }
  }
  return {
    selected: ranked[0] || null,
    orderedUrls: dedupeUrls(ranked.map((item) => item.url))
  };
}

async function pickDouyinVideoUrl(getOneData) {
  const aweme =
    getOneData?.aweme_detail ||
    getOneData?.aweme_details?.[0] ||
    getOneData?.data?.aweme_detail ||
    getOneData?.data?.aweme_details?.[0] ||
    getOneData;

  const preferredCandidates = buildDouyinVideoCandidates(aweme);
  if (preferredCandidates.length > 0) {
    const picked = await pickReachableDouyinCandidate(preferredCandidates);
    return {
      videoUrl: picked.selected?.url || preferredCandidates[0].url,
      candidateVideoUrls: picked.orderedUrls,
      noteTitle: aweme?.desc || aweme?.title || "",
      noteDesc: aweme?.desc || "",
      videoSource: picked.selected?.source || preferredCandidates[0].source,
      durationMs: Number(aweme?.video?.duration || aweme?.duration || 0) || null
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
    candidateVideoUrls: dedupeUrls(candidates.map((item) => item.url)),
    noteTitle: aweme?.desc || aweme?.title || "",
    noteDesc: aweme?.desc || "",
    videoSource: candidates[0].path,
    durationMs: Number(aweme?.video?.duration || aweme?.duration || 0) || null
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
      parser: "getoneapi:xiaohongshu/fetch_video_detail_v6",
      parserDebug: {
        ok: true,
        stage: "getone",
        endpoint: "/api/xiaohongshu/fetch_video_detail_v6",
        noteId
      }
    };
  }

  if (platform === "抖音") {
    const awemeIdMatch = link.match(/(?:modal_id|item_id|video)=(\d+)|douyin\.com\/video\/(\d+)/i) || link.match(/modal_id=(\d+)/i) || link.match(/item_id=(\d+)/i) || link.match(/douyin\.com\/video\/(\d+)/i);
    const awemeId = awemeIdMatch?.[1] || awemeIdMatch?.[2] || "";
    const getOneData = await callGetOneApi("/api/douyin/fetch_video_detail", { share_text: link, aweme_id: awemeId });
    return {
      ...(await pickDouyinVideoUrl(getOneData)),
      parser: "getoneapi:douyin/fetch_video_detail",
      parserDebug: {
        ok: true,
        stage: "getone",
        endpoint: "/api/douyin/fetch_video_detail",
        awemeId: awemeId || null
      }
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

function buildBaseUrl(req, envName = "PUBLIC_BASE_URL") {
  const configuredBaseUrl = String(process.env[envName] || "").trim().replace(/\/+$/, "");
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }
  const host = req.get("host");
  const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const protocol = forwardedProto || (req.protocol === "http" && host.includes("zeabur.app") ? "https" : req.protocol);
  return `${protocol}://${host}`;
}

function getPublicBaseUrl(req) {
  return buildBaseUrl(req, "PUBLIC_BASE_URL");
}

function getMediaPublicBaseUrl(req) {
  return buildBaseUrl(req, "MEDIA_PUBLIC_BASE_URL");
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
    try {
      const response = await fetchWithTimeout(remoteUrl, { headers }, timeoutMs, "视频远程下载超时");

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

  return {
    publicUrl: `${getMediaPublicBaseUrl(req)}/static/uploads/${filename}`,
    localPath,
    filename,
    contentType: response.headers.get("content-type") || ""
  };
}

async function mirrorRemoteMediaCandidatesToPublicUrl(remoteUrls, req, prefix = "topic_media") {
  const attempts = [];
  for (const remoteUrl of dedupeUrls(remoteUrls)) {
    try {
      const result = await mirrorRemoteMediaToPublicUrl(remoteUrl, req, prefix);
      attempts.push({
        ok: true,
        method: "fetch",
        sourceUrl: remoteUrl,
        mirroredMediaUrl: result.publicUrl,
        localPath: result.localPath,
        filename: result.filename,
        contentType: result.contentType || ""
      });
      return {
        ...result,
        remoteUrl,
        attempts
      };
    } catch (error) {
      attempts.push({
        ok: false,
        method: "fetch",
        sourceUrl: remoteUrl,
        error: error.message
      });
    }
  }

  const error = new Error(attempts[attempts.length - 1]?.error || "媒体文件下载失败");
  error.attempts = attempts;
  throw error;
}

async function extractAudioTrackToPublicUrl(localPath, req, prefix = "topic_audio") {
  await ensureFfmpegAvailable();
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const filename = `${prefix}_${Date.now()}_${randomUUID()}.mp3`;
  const audioPath = path.join(uploadsDir, filename);
  const targetSampleRate = String(Number(process.env.EXTRACT_AUDIO_SAMPLE_RATE || 12000));
  const targetBitrate = String(process.env.EXTRACT_AUDIO_BITRATE || "24k");
  await runProcess("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    localPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    targetSampleRate,
    "-c:a",
    "libmp3lame",
    "-b:a",
    targetBitrate,
    audioPath
  ], {
    timeoutMs: Number(process.env.FFMPEG_TIMEOUT_MS || 120000)
  });

  if (!fs.existsSync(audioPath)) {
    throw new Error("ffmpeg 已执行，但未生成音频文件");
  }

  return {
    publicUrl: `${getMediaPublicBaseUrl(req)}/static/uploads/${filename}`,
    localPath: audioPath,
    filename,
    method: "ffmpeg-mp3"
  };
}

async function splitAudioTrackToPublicUrls(localPath, req, prefix = "topic_audio_segment") {
  await ensureFfmpegAvailable();
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const segmentSeconds = Math.max(30, Number(process.env.BAILIAN_ASR_SEGMENT_SECONDS || 150));
  const segmentPrefix = `${prefix}_${Date.now()}_${randomUUID()}`;
  const outPattern = path.join(uploadsDir, `${segmentPrefix}_%03d.mp3`);

  await runProcess("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    localPath,
    "-f",
    "segment",
    "-segment_time",
    String(segmentSeconds),
    "-reset_timestamps",
    "1",
    "-c",
    "copy",
    outPattern
  ], {
    timeoutMs: Number(process.env.FFMPEG_SEGMENT_TIMEOUT_MS || 120000)
  });

  const filenames = fs.readdirSync(uploadsDir)
    .filter((name) => name.startsWith(`${segmentPrefix}_`) && name.endsWith(".mp3"))
    .sort();

  if (filenames.length === 0) {
    throw new Error("ffmpeg 已执行，但未生成音频分片");
  }

  return filenames.map((filename, index) => ({
    index,
    filename,
    localPath: path.join(uploadsDir, filename),
    publicUrl: `${getMediaPublicBaseUrl(req)}/static/uploads/${filename}`,
    segmentSeconds
  }));
}

async function downloadMediaByYtDlp(sourceUrl, req, prefix = "topic_media") {
  await ensureYtDlpAvailable();
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const outTemplate = path.join(uploadsDir, `${prefix}_${Date.now()}_${randomUUID()}.%(ext)s`);
  const formatSelector = String(process.env.YT_DLP_FORMAT || "worst[ext=mp4]/worst").trim();
  const args = [
    "-m",
    "yt_dlp",
    "--no-playlist",
    "--no-progress",
    "--no-warnings",
    "--print",
    "after_move:filepath",
    "-o",
    outTemplate,
    "-f",
    formatSelector,
    sourceUrl
  ];
  const { stdout } = await runProcess(YT_DLP_PYTHON, args, {
    timeoutMs: Number(process.env.YT_DLP_TIMEOUT_MS || 180000)
  });
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const localPath = lines[lines.length - 1];
  if (!localPath || !fs.existsSync(localPath)) {
    throw new Error("yt-dlp 已执行，但未找到下载后的媒体文件");
  }

  return {
    publicUrl: `${getMediaPublicBaseUrl(req)}/static/uploads/${path.basename(localPath)}`,
    localPath,
    filename: path.basename(localPath),
    contentType: "",
    method: "yt-dlp"
  };
}

function getBailianApiBaseUrl() {
  const baseUrl = String(BAILIAN_BASE_URL || "").trim().replace(/\/$/, "");
  if (!baseUrl) return "https://dashscope.aliyuncs.com/api/v1";
  if (/\/compatible-mode\/v1$/i.test(baseUrl)) {
    return baseUrl.replace(/\/compatible-mode\/v1$/i, "/api/v1");
  }
  return baseUrl;
}

function getBailianAuthHeaders() {
  const apiKey = String(BAILIAN_API_KEY || "").trim() || getRequiredEnv("BAILIAN_API_KEY");
  return {
    Authorization: `Bearer ${apiKey}`
  };
}

function extractBailianTranscriptFromPayload(payload, seen = new WeakSet()) {
  const collected = [];

  function visit(value) {
    if (value == null) return;
    if (typeof value === "string") return;
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const directText = [
      value.text,
      value.transcript,
      value.transcription,
      value.transcription_text,
      value.sentence?.text
    ].find((item) => typeof item === "string" && item.trim());

    if (directText) {
      collected.push(String(directText).trim());
    }

    [
      value.output,
      value.result,
      value.results,
      value.sentences,
      value.segments,
      value.paragraphs,
      value.utterances,
      value.words
    ].forEach(visit);
  }

  visit(payload);
  return Array.from(new Set(collected.filter(Boolean))).join("\n").trim();
}

async function fetchBailianResultUrl(resultUrl) {
  if (!resultUrl) return null;
  const response = await fetchWithTimeout(resultUrl, {
    method: "GET"
  }, Number(process.env.BAILIAN_ASR_RESULT_TIMEOUT_MS || 30000), "百炼 ASR 结果下载超时");

  if (!response.ok) {
    throw new Error(`百炼 ASR 结果下载失败(${response.status})`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (/json/i.test(contentType)) {
    return response.json().catch(() => null);
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { text };
  }
}

function pickBailianResultUrls(data) {
  const output = data?.output || {};
  const urls = [
    output.result_url,
    output.transcription_url,
    output.file_url
  ];

  if (Array.isArray(output.results)) {
    output.results.forEach((item) => {
      urls.push(item?.result_url, item?.transcription_url, item?.file_url);
    });
  }

  return Array.from(new Set(urls.filter(Boolean)));
}

async function submitBailianAsrTask(mediaUrl) {
  const timeoutMs = Number(process.env.BAILIAN_ASR_TIMEOUT_MS || 30000);
  const language = String(process.env.BAILIAN_ASR_LANGUAGE || "").trim();
  const response = await fetchWithTimeout(`${getBailianApiBaseUrl()}/services/audio/asr/transcription`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
      ...getBailianAuthHeaders()
    },
    body: JSON.stringify({
      model: BAILIAN_ASR_MODEL,
      input: {
        file_url: mediaUrl
      },
      parameters: {
        enable_itn: true,
        ...(language ? { language } : {})
      }
    })
  }, timeoutMs, "百炼 ASR submit 超时");

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`百炼语音提交失败(${response.status}): ${data?.message || data?.code || "unknown error"}`);
  }

  const taskId = data?.output?.task_id || data?.output?.taskId || data?.task_id || data?.taskId;
  if (!taskId) {
    throw new Error("百炼语音提交成功，但未返回 task_id");
  }

  return {
    taskId,
    requestId: data?.request_id || null,
    raw: data
  };
}

async function queryBailianAsrTask(taskId) {
  const timeoutMs = Number(process.env.BAILIAN_ASR_QUERY_TIMEOUT_MS || process.env.BAILIAN_ASR_TIMEOUT_MS || 60000);
  const response = await fetchWithTimeout(`${getBailianApiBaseUrl()}/tasks/${taskId}`, {
    method: "GET",
    headers: {
      "X-DashScope-Async": "enable",
      "Content-Type": "application/json",
      ...getBailianAuthHeaders()
    }
  }, timeoutMs, "百炼 ASR query 超时");

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`百炼语音查询失败(${response.status}): ${data?.message || data?.code || "unknown error"}`);
  }

  return data;
}

function buildTopicExtractFallbackContent(parsed) {
  const parts = [parsed?.noteTitle, parsed?.noteDesc]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return Array.from(new Set(parts)).join("\n\n").trim();
}

function formatExtractDebugSummary(debug) {
  const parserStatus = debug?.parser?.ok ? "成功" : `失败(${debug?.parser?.error || "unknown"})`;
  const mirrorStatus = debug?.mirror?.ok ? "成功" : `失败(${debug?.mirror?.error || "unknown"})`;
  const asrStatus = debug?.asr?.ok ? "成功" : `失败(${debug?.asr?.error || debug?.asr?.finalStatusMessage || "unknown"})`;
  return [
    `1. GetOne解析: ${parserStatus}`,
    `2. 视频镜像到服务器: ${mirrorStatus}`,
    `3. 百炼ASR: ${asrStatus}`
  ].join("；");
}

function snapshotRequestMeta(req) {
  return {
    protocol: req.protocol,
    host: req.get("host") || "",
    forwardedProto: req.get("x-forwarded-proto") || ""
  };
}

function parseDateMs(value) {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
}

function getTopicExtractJobStaleTimeoutMs() {
  return Math.max(60000, Number(process.env.TOPIC_EXTRACT_JOB_STALE_MS || 900000));
}

function buildStaleExtractJobErrorMessage(job) {
  const staleMinutes = Math.max(1, Math.round(getTopicExtractJobStaleTimeoutMs() / 60000));
  return `提取任务已失效：任务超过 ${staleMinutes} 分钟未更新，可能因服务重启或异常中断。请重新点击“提取”发起新任务。`;
}

function isTopicExtractJobStale(job) {
  if (!job || (job.status !== "pending" && job.status !== "running")) return false;
  const now = Date.now();
  const latestActivityMs =
    parseDateMs(job.updated_at) ||
    parseDateMs(job.started_at) ||
    parseDateMs(job.created_at);
  if (!latestActivityMs) return false;
  return now - latestActivityMs > getTopicExtractJobStaleTimeoutMs();
}

function expireStaleTopicExtractJob(job) {
  if (!isTopicExtractJobStale(job)) return job;
  return updateTopicExtractJob(job.id, {
    status: "failed",
    stage: "failed",
    progress_text: "提取任务已失效，请重新提取",
    error_message: buildStaleExtractJobErrorMessage(job),
    debug_json: {
      ...(job.debug_json || {}),
      stale_job: true,
      stale_timeout_ms: getTopicExtractJobStaleTimeoutMs(),
      previous_status: job.status
    },
    finished_at: new Date().toISOString()
  });
}

function buildRequestFromSnapshot(snapshot) {
  return {
    protocol: snapshot?.protocol || "http",
    get(headerName) {
      const normalized = String(headerName || "").toLowerCase();
      if (normalized === "host") return snapshot?.host || "";
      if (normalized === "x-forwarded-proto") return snapshot?.forwardedProto || "";
      return "";
    }
  };
}

function resolveBailianPollingConfig(durationMs) {
  const pollIntervalMs = Number(process.env.BAILIAN_ASR_POLL_INTERVAL_MS || 3000);
  const configuredMaxPolls = Number(process.env.BAILIAN_ASR_MAX_POLLS || 60);
  const configuredMaxWaitMs = Number(process.env.BAILIAN_ASR_MAX_WAIT_MS || 1200000);
  const safeDurationMs = Number(durationMs || 0);
  const durationBasedWaitMs = safeDurationMs > 0
    ? Math.min(Math.max(Math.ceil(safeDurationMs * 2), 120000), 1200000)
    : configuredMaxPolls * pollIntervalMs;
  const maxWaitMs = Math.max(configuredMaxWaitMs, configuredMaxPolls * pollIntervalMs, durationBasedWaitMs);
  const maxPolls = Math.max(configuredMaxPolls, Math.ceil(maxWaitMs / pollIntervalMs));

  return {
    durationMs: safeDurationMs || null,
    pollIntervalMs,
    maxWaitMs,
    maxPolls
  };
}

async function transcribeMediaByBailian(mediaUrl, options = {}) {
  const submitInfo = await submitBailianAsrTask(mediaUrl);
  const pollingConfig = resolveBailianPollingConfig(options.durationMs);
  const debug = {
    ok: false,
    stage: "bailian_asr",
    mediaUrl,
    taskId: submitInfo.taskId,
    requestId: submitInfo.requestId,
    durationMs: pollingConfig.durationMs,
    pollIntervalMs: pollingConfig.pollIntervalMs,
    maxWaitMs: pollingConfig.maxWaitMs,
    maxPolls: pollingConfig.maxPolls,
    submitResponse: submitInfo.raw,
    queryHistory: []
  };

  for (let i = 0; i < pollingConfig.maxPolls; i += 1) {
    await new Promise(resolve => setTimeout(resolve, pollingConfig.pollIntervalMs));
    const data = await queryBailianAsrTask(submitInfo.taskId);
    const taskStatus = String(data?.output?.task_status || data?.output?.taskStatus || data?.task_status || data?.taskStatus || "").toUpperCase();
    const taskMessage = data?.output?.message || data?.message || data?.output?.task_message || null;
    debug.queryHistory.push({
      index: i,
      taskStatus,
      taskMessage,
      resultPreview: buildPreviewText(extractBailianTranscriptFromPayload(data), 120)
    });

    if (taskStatus === "SUCCEEDED") {
      let text = extractBailianTranscriptFromPayload(data);
      if (!text) {
        const resultUrls = pickBailianResultUrls(data);
        for (const resultUrl of resultUrls) {
          const resultPayload = await fetchBailianResultUrl(resultUrl);
          text = extractBailianTranscriptFromPayload(resultPayload);
          if (text) {
            debug.resultUrl = resultUrl;
            debug.resultPayloadPreview = buildPreviewText(JSON.stringify(resultPayload).slice(0, 500), 500);
            break;
          }
        }
      }
      if (!text) {
        const error = new Error("百炼语音已完成，但未返回可用文本");
        error.stepDebug = debug;
        throw error;
      }
      return {
        text,
        debug: {
          ...debug,
          ok: true,
          finalStatusCode: taskStatus,
          finalStatusMessage: taskMessage || "SUCCEEDED"
        }
      };
    }

    if (taskStatus === "PENDING" || taskStatus === "RUNNING" || !taskStatus) {
      continue;
    }

    const error = new Error(`百炼语音识别失败(${taskStatus || "unknown"}): ${taskMessage || "unknown error"}`);
    error.stepDebug = {
      ...debug,
      finalStatusCode: taskStatus,
      finalStatusMessage: taskMessage
    };
    throw error;
  }

  const lastQuery = debug.queryHistory[debug.queryHistory.length - 1] || null;
  const waitedSeconds = Math.round((debug.queryHistory.length * pollingConfig.pollIntervalMs) / 1000);
  const error = new Error(`百炼语音识别超时(已等待${waitedSeconds}秒)，最后状态=${lastQuery?.taskStatus || "unknown"} ${lastQuery?.taskMessage || ""}`.trim());
  error.stepDebug = {
    ...debug,
    finalStatusCode: lastQuery?.taskStatus || null,
    finalStatusMessage: lastQuery?.taskMessage || null
  };
  throw error;
}

async function transcribeMediaWithFallback(mediaUrls, options = {}) {
  const errors = [];
  const attempts = [];

  for (const mediaUrl of mediaUrls.filter(Boolean)) {
    try {
      const result = await transcribeMediaByBailian(mediaUrl, options);
      return {
        text: result.text,
        debug: {
          ok: true,
          stage: "bailian_asr",
          attempts: [...attempts, result.debug]
        }
      };
    } catch (error) {
      errors.push(`${mediaUrl} -> ${error.message}`);
      attempts.push(error.stepDebug || {
        ok: false,
        stage: "bailian_asr",
        mediaUrl,
        error: error.message
      });
      continue;
    }
  }

  const error = new Error(errors[errors.length - 1] || "未找到可用的语音识别地址");
  error.stepDebug = {
    ok: false,
    stage: "bailian_asr",
    attempts
  };
  throw error;
}

async function transcribeSegmentedMediaWithBailian(segments, options = {}) {
  const transcripts = [];
  const segmentDebugs = [];
  const segmentDurationMs = Number(options.segmentDurationMs || 0) || null;

  for (const segment of segments || []) {
    try {
      const result = await transcribeMediaWithFallback([segment.publicUrl], {
        durationMs: segmentDurationMs
      });
      const text = String(result.text || "").trim();
      if (text) transcripts.push(text);
      segmentDebugs.push({
        ok: true,
        index: segment.index,
        mediaUrl: segment.publicUrl,
        filename: segment.filename,
        textPreview: buildPreviewText(text, 120),
        debug: result.debug
      });
    } catch (error) {
      segmentDebugs.push({
        ok: false,
        index: segment.index,
        mediaUrl: segment.publicUrl,
        filename: segment.filename,
        error: error.message,
        debug: error.stepDebug || null
      });
      error.stepDebug = {
        ok: false,
        stage: "bailian_asr_segmented",
        segments: segmentDebugs
      };
      throw error;
    }
  }

  const mergedText = transcripts.join("\n").trim();
  if (!mergedText) {
    const error = new Error("分段语音识别完成，但未返回可用文本");
    error.stepDebug = {
      ok: false,
      stage: "bailian_asr_segmented",
      segments: segmentDebugs
    };
    throw error;
  }

  return {
    text: mergedText,
    debug: {
      ok: true,
      stage: "bailian_asr_segmented",
      segment_count: segments.length,
      segments: segmentDebugs
    }
  };
}

async function executeTopicLibraryExtract(link, platform, requestMeta, onProgress) {
  const requestLike = buildRequestFromSnapshot(requestMeta);
  const notifyProgress = async ({ stage, progressText, debugJson }) => {
    if (typeof onProgress !== "function") return;
    await Promise.resolve(onProgress({ stage, progressText, debugJson }));
  };

  const extractDebug = {
    parser: { ok: false, stage: "getone", error: "未开始" },
    mirror: { ok: false, stage: "mirror", error: "未开始" },
    asr: { ok: false, stage: "bailian_asr", error: "未开始" }
  };

  await notifyProgress({ stage: "parsing", progressText: "正在解析视频链接..." });

  const parsed = await resolveVideoUrlByPlatform(link, platform);
  const resolvedMediaUrls = dedupeUrls([...(parsed.candidateVideoUrls || []), parsed.videoUrl]);
  extractDebug.parser = {
    ...(parsed.parserDebug || {}),
    ok: true,
    parser: parsed.parser,
    videoSource: parsed.videoSource || null,
    resolvedVideoUrl: parsed.videoUrl,
    candidateVideoUrls: resolvedMediaUrls,
    durationMs: parsed.durationMs || null
  };

  let mirroredMediaUrl = null;
  let mirroredAudioUrl = null;
  let mirroredLocalPath = null;
  let audioSegments = [];
  await notifyProgress({
    stage: "mirroring",
    progressText: platform === "抖音" ? "正在下载视频并生成音频..." : "正在下载视频内容...",
    debugJson: extractDebug
  });

  const mirrorAttempts = [];
  if (platform === "抖音") {
    try {
      const ytDlpResult = await downloadMediaByYtDlp(link, requestLike, "topic_extract");
      mirroredMediaUrl = ytDlpResult.publicUrl;
      mirroredLocalPath = ytDlpResult.localPath;
      mirrorAttempts.push({
        ok: true,
        method: ytDlpResult.method,
        sourceUrl: link,
        mirroredMediaUrl,
        localPath: ytDlpResult.localPath,
          filename: ytDlpResult.filename,
          sizeBytes: fs.existsSync(ytDlpResult.localPath) ? fs.statSync(ytDlpResult.localPath).size : null
      });
    } catch (ytDlpError) {
      console.warn("topic-library extract yt-dlp failed:", ytDlpError.message);
      mirrorAttempts.push({
        ok: false,
        method: "yt-dlp",
        sourceUrl: link,
        error: /Fresh cookies/i.test(ytDlpError.message)
          ? "yt-dlp 需要 fresh cookies，当前服务端未提供可用 cookies"
          : ytDlpError.message
      });
    }
  }
  if (!mirroredMediaUrl) {
    try {
      const mirrorResult = await mirrorRemoteMediaCandidatesToPublicUrl(resolvedMediaUrls, requestLike, "topic_extract");
      mirroredMediaUrl = mirrorResult.publicUrl;
      mirroredLocalPath = mirrorResult.localPath;
      mirrorAttempts.push(...(mirrorResult.attempts || []));
    } catch (mirrorError) {
      console.warn("topic-library extract mirror failed:", mirrorError.message);
      if (Array.isArray(mirrorError.attempts) && mirrorError.attempts.length > 0) {
        mirrorAttempts.push(...mirrorError.attempts);
      } else {
        mirrorAttempts.push({
          ok: false,
          method: "fetch",
          sourceUrl: parsed.videoUrl,
          error: mirrorError.message
        });
      }
    }
  }

  let audioExtract = null;
  if (mirroredLocalPath) {
    try {
      const audioResult = await extractAudioTrackToPublicUrl(mirroredLocalPath, requestLike, "topic_extract_audio");
      mirroredAudioUrl = audioResult.publicUrl;
      const shouldSegmentAudio = Number(parsed.durationMs || 0) >= Number(process.env.BAILIAN_ASR_SEGMENT_THRESHOLD_MS || 0);
      if (shouldSegmentAudio) {
        audioSegments = await splitAudioTrackToPublicUrls(audioResult.localPath, requestLike, "topic_extract_audio_seg");
      }
      audioExtract = {
        ok: true,
        method: audioResult.method,
        mirroredAudioUrl,
        localPath: audioResult.localPath,
        filename: audioResult.filename,
        sizeBytes: fs.existsSync(audioResult.localPath) ? fs.statSync(audioResult.localPath).size : null,
        segmented: audioSegments.length > 0,
        segmentCount: audioSegments.length,
        segments: audioSegments.map((segment) => ({
          index: segment.index,
          filename: segment.filename,
          publicUrl: segment.publicUrl,
          sizeBytes: fs.existsSync(segment.localPath) ? fs.statSync(segment.localPath).size : null
        }))
      };
    } catch (audioError) {
      console.warn("topic-library extract audio convert failed:", audioError.message);
      audioExtract = {
        ok: false,
        method: "ffmpeg-mp3",
        error: audioError.message
      };
    }
  }

  const successfulMirrorAttempt = mirrorAttempts.find((item) => item.ok) || null;
  extractDebug.mirror = successfulMirrorAttempt
    ? {
        ok: true,
        stage: "mirror",
        method: successfulMirrorAttempt.method,
        remoteUrl: successfulMirrorAttempt.sourceUrl,
        mirroredMediaUrl: successfulMirrorAttempt.mirroredMediaUrl,
        localPath: successfulMirrorAttempt.localPath,
        filename: successfulMirrorAttempt.filename,
        contentType: successfulMirrorAttempt.contentType || "",
        mirroredAudioUrl,
        audioExtract,
        attempts: mirrorAttempts
      }
    : {
        ok: false,
        stage: "mirror",
        remoteUrl: parsed.videoUrl,
        error: mirrorAttempts[mirrorAttempts.length - 1]?.error || "媒体文件下载失败",
        mirroredAudioUrl,
        audioExtract,
        attempts: mirrorAttempts
      };

  await notifyProgress({
    stage: "transcribing",
    progressText: "正在调用百炼语音识别，请稍候...",
    debugJson: extractDebug
  });

  let transcript = "";
  let fallbackContent = "";
  let extractFallback = null;
  try {
    const transcribeResult = audioSegments.length > 0
      ? await transcribeSegmentedMediaWithBailian(audioSegments, {
          segmentDurationMs: Number(process.env.BAILIAN_ASR_SEGMENT_SECONDS || 150) * 1000
        })
      : await transcribeMediaWithFallback([
          mirroredAudioUrl,
          mirroredMediaUrl
        ], {
          durationMs: parsed.durationMs
        });
    transcript = transcribeResult.text;
    extractDebug.asr = transcribeResult.debug;
  } catch (transcribeError) {
    extractDebug.asr = {
      ...(transcribeError.stepDebug || {}),
      ok: false,
      error: transcribeError.message
    };
    fallbackContent = buildTopicExtractFallbackContent(parsed);
    if (!fallbackContent) {
      transcribeError.extractDebug = extractDebug;
      throw transcribeError;
    }
    extractFallback = {
      source: "title_desc_fallback",
      reason: transcribeError.message
    };
  }

  return {
    content: transcript,
    content_source: transcript ? "transcript" : null,
    fallback_content: fallbackContent || null,
    platform,
    source_link: link,
    resolved_video_url: parsed.videoUrl,
    resolved_video_candidates: resolvedMediaUrls,
    mirrored_media_url: mirroredMediaUrl,
    mirrored_audio_url: mirroredAudioUrl,
    extract_fallback: extractFallback,
    extract_debug: extractDebug,
    parser: parsed.parser,
    note_title: parsed.noteTitle,
    note_desc: parsed.noteDesc
  };
}

async function runTopicLibraryExtractJob(jobId, requestMeta) {
  const startedAt = new Date().toISOString();
  const existingJob = getTopicExtractJob(jobId);
  if (!existingJob) return;

  updateTopicExtractJob(jobId, {
    status: "running",
    stage: "parsing",
    progress_text: "正在解析视频链接...",
    error_message: null,
    started_at: startedAt,
    finished_at: null
  });

  try {
    const result = await executeTopicLibraryExtract(
      existingJob.link,
      existingJob.platform,
      requestMeta,
      ({ stage, progressText, debugJson }) => updateTopicExtractJob(jobId, {
        status: "running",
        stage,
        progress_text: progressText,
        debug_json: debugJson ?? undefined
      })
    );

    updateTopicExtractJob(jobId, {
      status: "succeeded",
      stage: "completed",
      progress_text: "提取完成",
      result_json: result,
      debug_json: result.extract_debug || null,
      error_message: null,
      finished_at: new Date().toISOString()
    });
  } catch (error) {
    console.error("topic-library extract job failed:", error);
    const extractDebug = error.extractDebug || error.stepDebug || null;
    const errorMessage = `提取失败：${error.message}${extractDebug ? `；${formatExtractDebugSummary(extractDebug)}` : ""}`;
    updateTopicExtractJob(jobId, {
      status: "failed",
      stage: "failed",
      progress_text: "提取失败",
      error_message: errorMessage,
      debug_json: extractDebug,
      finished_at: new Date().toISOString()
    });
  }
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

app.post("/api/v1/projects/:projectId/topic-library/reorder", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));

  const orderedIds = Array.isArray(req.body?.orderedIds)
    ? req.body.orderedIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (orderedIds.length === 0) {
    return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少排序后的选题 ID 列表" }, request_id));
  }

  try {
    const items = reorderTopicLibraryItems(project.id, orderedIds);
    res.json(ok({ items }, request_id));
  } catch (error) {
    res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: error.message || "排序保存失败" }, request_id));
  }
});

app.post("/api/v1/projects/:projectId/topic-library/extract", authApiKey, async (req, res) => {
  const request_id = req.context?.requestId;
  const { link, platform } = req.body;
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  if (!link) return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少参考链接" }, request_id));

  if (platform !== "小红书" && platform !== "抖音") {
    return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "仅支持解析小红书和抖音视频链接" }, request_id));
  }

  try {
    const parsed = await resolveVideoUrlByPlatform(link, platform);
    const resolvedMediaUrls = dedupeUrls([...(parsed.candidateVideoUrls || []), parsed.videoUrl]);
    res.json(ok({
      content: null,
      content_source: null,
      fallback_content: null,
      platform,
      source_link: link,
      resolved_video_url: parsed.videoUrl,
      resolved_video_candidates: resolvedMediaUrls,
      mirrored_media_url: null,
      mirrored_audio_url: null,
      extract_fallback: null,
      extract_debug: {
        parser: {
          ...(parsed.parserDebug || {}),
          ok: true,
          parser: parsed.parser,
          videoSource: parsed.videoSource || null,
          resolvedVideoUrl: parsed.videoUrl,
          candidateVideoUrls: resolvedMediaUrls,
          durationMs: parsed.durationMs || null
        }
      },
      parser: parsed.parser,
      note_title: parsed.noteTitle,
      note_desc: parsed.noteDesc
    }, request_id));
  } catch (e) {
    console.error(e);
    res.status(500).json(fail({
      code: ErrorCodes.INTERNAL_ERROR,
      message: `解析链接失败：${e.message}`
    }, request_id));
  }
});

app.get("/api/v1/projects/:projectId/topic-library/extract/:jobId", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const project = getProject(req.params.projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  res.status(410).json(fail({
    code: ErrorCodes.NOT_FOUND,
    message: "视频文本提取任务已停用，请直接使用“解析”按钮获取解析后链接"
  }, request_id));
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

app.post("/api/v1/projects/:projectId/topic-library/:id/content-production/generate", authApiKey, async (req, res) => {
  const request_id = req.context?.requestId;
  const user_id = req.context?.userId;
  const project_id = req.params.projectId;
  const { stepId, stepLabel, systemInstruction, model, inputContent } = req.body || {};

  const project = getProject(project_id);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));
  const topic = getTopicLibraryItem(req.params.id);
  if (!topic || topic.project_id !== project.id) {
    return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "选题不存在" }, request_id));
  }
  if (!String(stepId || "").trim()) {
    return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少流程标识" }, request_id));
  }
  if (!String(model || "").trim()) {
    return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少模型选择" }, request_id));
  }

  const normalizedInputContent = String(inputContent || "").trim() || "无";
  const normalizedInstruction = String(systemInstruction || "").trim() || "你是资深中文内容生产助手，请输出清晰、完整、可直接使用的内容。";
  const normalizedStepLabel = String(stepLabel || stepId || "内容生产").trim();

  try {
    const startedAt = Date.now();
    const generated = await generateContentProductionStep(
      normalizedInstruction,
      {
        stepId,
        stepLabel: normalizedStepLabel,
        topicName: topic.name,
        refContent: String(topic.ref_content || "").trim() || "无",
        inputContent: normalizedInputContent
      },
      model
    );

    addGenerationLog({
      user_id,
      project_id,
      feature: "content_production.generate",
      provider: "llm",
      mode: generated.apiMode,
      request_id,
      status: "ok",
      request_json: {
        step_id: stepId,
        step_label: normalizedStepLabel,
        model,
        topic_name: topic.name || "",
        input_preview: buildPreviewText(normalizedInputContent),
        prompt_preview: buildPreviewText(normalizedInstruction)
      },
      response_json: {
        actual_model: generated.actualModelName,
        api_mode: generated.apiMode,
        latency_ms: Date.now() - startedAt,
        usage: generated.usage,
        estimated_cost_usd: generated.estimated_cost_usd,
        result_preview: buildPreviewText(generated.text)
      }
    });

    res.json(ok({
      result: generated.text,
      usage: generated.usage,
      estimated_cost_usd: generated.estimated_cost_usd,
      api_mode: generated.apiMode
    }, request_id));
  } catch (e) {
    addGenerationLog({
      user_id,
      project_id,
      feature: "content_production.generate",
      provider: "llm",
      mode: null,
      request_id,
      status: "error",
      request_json: {
        step_id: stepId,
        step_label: normalizedStepLabel,
        model,
        topic_name: topic.name || "",
        input_preview: buildPreviewText(normalizedInputContent),
        prompt_preview: buildPreviewText(normalizedInstruction)
      },
      response_json: {
        error: e.message
      }
    });
    res.status(500).json(fail({ code: ErrorCodes.INTERNAL_ERROR, message: "内容生产失败：" + e.message }, request_id));
  }
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
