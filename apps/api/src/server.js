import express from "express";
import cors from "cors";
import path from "node:path";
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
import { chatWithGemini } from "./services/aiAgent.js";
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

// 静态资源（前端构建产物）
const webDistPath = path.join(__dirname, "..", "..", "web", "dist");
app.use(express.static(webDistPath));

app.get("/health", (req, res) => {
  res.json({ ok: true, request_id: req.context?.requestId });
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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
  res.json(ok({ items: listChatMessages(project.id) }, request_id));
});

app.post("/api/v1/projects/:projectId/positioning/chat", authApiKey, async (req, res) => {
  const request_id = req.context?.requestId;
  const project_id = req.params.projectId;
  const project = getProject(project_id);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));

  const { message, systemInstruction, model } = req.body;
  if (!message) return res.status(400).json(fail({ code: ErrorCodes.VALIDATION_FAILED, message: "缺少聊天内容" }, request_id));

  // Save user message
  const userMsg = addChatMessage(project_id, "user", message);

  try {
    const history = listChatMessages(project_id);
    const currentProfile = getCustomerProfile(project_id);
    
    // Pass everything up to the new user message
    const pastHistory = history.slice(0, -1);

    const startTime = Date.now();
    const { reply, updates, usage } = await chatWithGemini(systemInstruction, pastHistory, message, currentProfile, project_id, model);
    const latency_ms = Date.now() - startTime;
    
    // Save AI reply with metrics
    const aiMessage = addChatMessage(project_id, "model", reply, latency_ms, usage?.total_tokens || null);

    // Get the updated profile
    const newProfile = getCustomerProfile(project_id);

    res.json(ok({ reply: aiMessage, updates, profile: newProfile, userMessage: userMsg }, request_id));
  } catch (e) {
    console.error(e);
    res.status(500).json(fail({ code: ErrorCodes.INTERNAL_ERROR, message: String(e) }, request_id));
  }
});

app.delete("/api/v1/projects/:projectId/positioning/chat/:messageId", authApiKey, (req, res) => {
  const request_id = req.context?.requestId;
  const { projectId, messageId } = req.params;
  const project = getProject(projectId);
  if (!project) return res.status(404).json(fail({ code: ErrorCodes.NOT_FOUND, message: "项目不存在" }, request_id));

  const success = deleteChatMessage(messageId, projectId);
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
