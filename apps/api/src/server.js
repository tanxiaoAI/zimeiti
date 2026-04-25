import "./loadEnv.js";
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { requestContext } from "./middlewares/requestContext.js";
import { authApiKey } from "./middlewares/authApiKey.js";
import { validateBody } from "./middlewares/validate.js";
import { ok, fail } from "@ai-media/shared/contracts";
import { ErrorCodes } from "@ai-media/shared/errors";
import multer from "multer";

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
  deleteChatMessage
} from "./services/appStore.js";
import { addVideoTeardown, listVideoTeardowns, getVideoTeardown, updateVideoTeardown, deleteVideoTeardown } from "./services/appStore.js";

import { streamChatWithGemini, analyzeVideoWithGemini } from "./services/aiAgent.js";
import { getLlmProvider } from "./providers/llm/index.js";
import { getHotProvider } from "./providers/hot/index.js";
import { getCoverProvider } from "./providers/cover/index.js";
import { getRagProvider } from "./providers/rag/index.js";
import { createDocument, listDocuments, processDocument, search as kbSearch } from "./services/kbStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(requestContext);

// 静态资源（封面SVG/PNG占位）
app.use("/static", express.static(path.join(__dirname, "..", "public", "static")));
app.use("/static/uploads", express.static(path.join(__dirname, "..", "public", "uploads")));

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

    if (options.kbEnabled) {
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
  return handleProjectChat(req, res, "free_chat", { profileMode: false, kbEnabled: true, kbTopK: 4 });
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
    const uploadDir = path.join(__dirname, "..", "public", "uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, local_video_path), req.file.buffer);

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
  const doc = await createDocument({ project_id, originalname: req.file.originalname, buffer: req.file.buffer });
  res.json(ok(doc, request_id));
});

app.post("/api/v1/kb/documents/:id/process", authApiKey, async (req, res) => {
  const request_id = req.context?.requestId;
  const out = await processDocument(req.params.id);
  if (!out) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "文档不存在" }, request_id));
  res.json(ok(out, request_id));
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
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  res.json(ok({ items: listGenerationLogs({ user_id, project_id, limit }) }, request_id));
});

// API 兜底404 (仅处理 /api 前缀的请求)
app.use("/api", (req, res) => {
  res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "Not Found" }, req.context?.requestId));
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
