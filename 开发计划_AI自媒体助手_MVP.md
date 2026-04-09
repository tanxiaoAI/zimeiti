# 开发计划：AI辅助自媒体工具（小红书优先｜Web SaaS｜MVP）

## Summary
基于 PRD [View file](computer:///workspace/PRD_AI自媒体助手（小红书优先）.md) 输出一份可直接执行的开发计划，聚焦 MVP 闭环：**定位 → 选题 → 文案生成 → 封面模板排版 → 知识库（RAG-关键词检索） → 生成审计日志**。  
关键约束：外部能力（热点/LLM/封面渲染/分析/RAG）**全链路先 Mock，可一键切 Real**；API 形态为 **HTTP REST + API Key**；封面以**模板化排版**为主（内置 8 套模板）；RAG 首期仅**文档类 + 关键词检索**（不做向量）；登录为**邀请码/简单口令**。

---

## Current State Analysis
当前工作区只有 PRD 文档，无现成代码仓库与工程结构。  
因此本计划以“从 0 搭建工程 + 先 Mock 跑通端到端 + 再逐步切换 Real Provider”为主线，并把所有不确定性收敛为少量已确认决策与明确的待办契约点。

---

## Assumptions & Decisions
### 已确认（来自你补充）
1) **热点榜单/LLM/封面渲染/分析/RAG** 等能力均通过你提供的 **HTTP REST API + API Key** 对接；前期全部 **Mock**。  
2) 封面生成优先级：**模板排版渲染**。  
3) 需要接入 RAG，但首期 **不做向量检索**，仅做“文档+关键词检索”。  
4) 登录：**邀请码/简单口令**（偏内测）。  

### 需要我做出的工程决策（你已选择“我来建议”）
1) **技术栈（推荐）**：TypeScript 全栈 **Next.js（Web）+ Node.js API（REST）**，共享类型与 Schema，适合快速出 MVP。  
2) **数据库（推荐）**：PostgreSQL（同时用于业务数据 + 全文检索 tsvector）。  
3) **对象存储（推荐）**：S3 兼容（MinIO/S3），用于知识库上传文档、封面渲染产物。  
4) **关键词检索实现**：Postgres Full Text Search（tsvector/tsquery + rank）。  
5) **Mock/Real 切换**：通过环境变量对每个 capability provider 单独切换（例如 `CAP_LLM=mock|real`）。  

> 若你后续指定其它栈（如 Java/Go/Python），也可沿用本计划的**模块边界、契约与 Mock/Real 架构**，替换实现语言即可。

---

## Proposed Changes（实现步骤 + 具体文件/模块）

> 说明：本节按“先把闭环跑通，再完善能力”的顺序排列；每一步都明确要新增/修改哪些文件、为什么做、如何做。

### 1) 初始化工程与目录结构（从 0 创建代码仓库）
**目标**：形成 Web + API + Shared contracts 的最小可运行骨架，为后续并行开发打基础。

**新增目录（建议 Monorepo）**
- `/workspace/apps/web/`：前端 Next.js 工程  
- `/workspace/apps/api/`：后端 Node.js REST API 工程  
- `/workspace/packages/shared/`：共享类型、DTO、枚举、错误码、Schema  
- `/workspace/packages/mock-data/`：各 capability 的 mock 响应样例

**关键文件**
- `apps/api/src/server.ts`：REST server 启动、全局中间件（鉴权、日志、错误处理）  
- `packages/shared/src/contracts/*`：统一 DTO（分页、错误码、请求/响应结构）  
- `packages/shared/src/schemas/*`：输入输出 JSON Schema 或 Zod（用于运行时校验）  

**为什么**
- 你要求“全链路 Mock 可切换”，必须先固定**稳定契约层**与**provider 抽象层**，避免前端/业务域反复改动。

---

### 2) 统一 API 约定：鉴权/错误码/request_id/分页
**目标**：让所有前端/后端/Mock/Real 调用在同一套协议下工作，并为审计日志打基础。

**后端新增/修改**
- `apps/api/src/middlewares/authApiKey.ts`
  - 从请求头读取 `X-API-Key`
  - 校验 key（对比 hash / 或查库）
  - 将 `user_id` 注入 `req.context`
- `apps/api/src/middlewares/requestContext.ts`
  - 生成 `request_id`
  - 记录开始时间，结束后写入 access log
- `packages/shared/src/contracts/http.ts`
  - `ApiResponse<T>`, `ApiError`, `Pagination<T>` 的统一结构
- `packages/shared/src/contracts/errors.ts`
  - 错误码枚举：`AUTH_INVALID`, `AUTH_MISSING`, `RATE_LIMITED`, `VALIDATION_FAILED`, `NOT_FOUND`, `INTERNAL_ERROR` 等

**接口统一响应格式**
- 成功：`{ request_id, data, error: null }`
- 失败：`{ request_id, data: null, error: { code, message, details? } }`

**为什么**
- PRD 明确需要“可审计”：request_id + 统一错误码是后续排障、统计与对账的基础。

---

### 3) Provider 抽象层：Mock/Real 一键切换
**目标**：在不改业务域代码的情况下切换 Mock/Real；并确保 GenerationLog 自动打点“mock/real”。

**新增目录**
- `apps/api/src/providers/{hot,llm,cover,analytics,rag}/`
  - `types.ts`：该 provider 的接口契约（入参/出参 DTO）
  - `mock.ts`：从 `packages/mock-data` 读取并返回固定数据
  - `real.ts`：调用你提供的 HTTP REST API（API Key 注入）
  - `index.ts`：根据环境变量选择实现

**环境变量约定（示例）**
- `CAP_HOT=mock|real`
- `CAP_LLM=mock|real`
- `CAP_COVER=mock|real`
- `CAP_RAG=mock|real`
- `CAP_ANALYTICS=mock|real`

**为什么**
- 你要求“前期所有需要 API 的地方都先 mock 数据”，且后续要能平滑联调真 API，这一步是核心工程前置条件。

---

### 4) 数据层：DB 表结构 + 迁移 + 基础仓储
**目标**：支撑 PRD 的核心对象（项目、定位、选题、草稿、模板、配置、知识库、日志）。

**新增**
- `apps/api/src/db/`
  - `client.ts`（DB 连接）
  - `migrations/*`（迁移文件）
  - `repositories/*`（按实体的 CRUD）

**必须落表的实体（与 PRD 对齐）**
- `users`, `invite_codes`, `api_keys`
- `projects`
- `account_profiles`
- `topics`
- `drafts`
- `prompt_templates`
- `config_profiles`
- `kb_documents`, `kb_chunks`
- `cover_templates`, `cover_renders`
- `generation_logs`

**关键设计要求**
1) `generation_logs` 必须包含：`feature/provider/mode(mock|real)/template_id/version/effective_config_snapshot/request/response/latency/status/error_code/request_id`
2) `kb_chunks` 需要保存 `source_locator`（页码/段落号等），以满足“引用可追溯”

---

### 5) Auth：邀请码/简单口令登录 + API Key 发放
**目标**：满足内测期最小登录能力，并为 API 调用提供鉴权凭据。

**新增接口（v1）**
- `POST /api/v1/auth/login`（invite_code + passcode → 返回 api_key）
- `POST /api/v1/auth/api-keys/rotate`（轮换 key）

**后端模块**
- `apps/api/src/modules/auth/*`
  - 校验邀请码状态（未用/已用/过期）
  - 生成并存储 `api_key_hash`（明文仅返回一次）

**前端页面**
- `apps/web/src/app/login/*`（或 pages）
  - 输入邀请码/口令
  - 保存 api_key（建议存 localStorage；并在 api-client 里统一注入）

---

### 6) 核心业务闭环 API：定位 → 选题 → 草稿编辑器
**目标**：不依赖真实大模型，先用 Mock 跑通“从定位到产出内容”的完整链路。

**后端模块**
- `apps/api/src/modules/projects/*`
  - `POST /projects`, `GET /projects`
- `apps/api/src/modules/account-profile/*`
  - `POST /projects/:projectId/account-profile:generate`（走 LLM provider）
  - `GET/PUT /projects/:projectId/account-profile`
- `apps/api/src/modules/topics/*`
  - `POST /projects/:projectId/topics:generate`（LLM）
  - `GET /projects/:projectId/topics`
  - `PATCH /topics/:id`（状态流转）
- `apps/api/src/modules/drafts/*`
  - `POST /topics/:id/drafts:init`
  - `GET/PUT /drafts/:id`
  - `POST /drafts/:id/title:generate`（LLM）
  - `POST /drafts/:id/hook:generate`（LLM）
  - `POST /drafts/:id/body:generate`（LLM + 可选 RAG）

**前端页面（最小）**
- 工作台：项目列表/创建（绑定平台=小红书）
- 定位页：定位生成、内容支柱可编辑并保存
- 选题池：选题生成、卡片列表、状态切换、进入编辑器
- 编辑器：标题/开头/正文分块展示与编辑、保存

**为什么**
- 这是 PRD 的核心价值链路；先在 Mock 下闭环，后续切 Real 仅替换 provider。

---

### 7) Prompt & Config：可覆盖 + 可审计（系统/账号/个人/文件级）
**目标**：满足你提到的“每个功能提示词 + 文件个性化配置”，并且每次生成可复现。

**后端模块**
- `apps/api/src/modules/prompts/*`
  - 系统模板（seed 数据）+ 个人复制/编辑
  - `POST /prompts/:id/test-run`：用变量试跑（mock 也可）
- `apps/api/src/modules/configs/*`
  - 配置合并：系统 < 账号 < 用户 < 文件级
  - 列表字段默认合并去重，支持策略 `merge|override`
  - 输出“生效配置快照”写入 generation_logs

**关键文件**
- `packages/shared/src/schemas/output/*`：对标题候选、开头候选、正文块、拆解结果等输出结构做 schema 校验
- `apps/api/src/services/generation/compileContext.ts`
  - 拉取定位/用户配置/文件覆盖
  - 拼装 variables
  - 选择 template_id/version
  - 写入 generation log（含快照）

---

### 8) 封面：模板化排版渲染（8 套模板）+ 文案可编辑再渲染
**目标**：以“稳定一致、可控排版”为第一优先级落地封面能力。

**后端模块**
- `apps/api/src/modules/covers/*`
  - `GET /covers/templates`
  - `POST /covers/render`
  - 将渲染产物写入对象存储并返回 URL（PNG 必须；SVG 建议用于可编辑/二次渲染）

**模板规范（Template Spec）**
- 位置：`packages/shared/src/template-spec/*`
- 每套模板以 JSON 描述：
  - 画布尺寸（默认 1080x1440）
  - 背景（纯色/渐变/纹理占位）
  - 文本层（自动换行、字号自适应、最大行数、对齐方式、安全区）
  - 图形元素（圆角矩形、描边、分割线、贴纸形状）

**前端交互**
- 编辑器中选择模板 → 生成封面
- 用户修改“封面标题/副标题/标签” → 点击“重新渲染”

**Mock/Real**
- Mock：返回固定的占位图 URL
- Real：本地渲染引擎（Canvas/SVG 渲染）或你方提供的渲染 API（后续切换）

---

### 9) 知识库（RAG）：文档上传 → 文本抽取 → 分块 → 关键词检索 → 引用清单
**目标**：在不做向量的前提下，把“资料”变成可引用证据，并融入正文生成。

**后端模块**
- `apps/api/src/modules/kb/*`
  - `POST /kb/documents`：上传文档 + 存储 + 入库
  - `POST /kb/documents/:id/process`（或上传后异步处理）：抽取文本、分块、写 chunks、建索引
  - `POST /kb/search`：关键词检索 topK，返回 chunk + 来源定位

**文档处理策略（首期）**
- 支持：PDF/DOCX/TXT/Markdown（按 PRD 更新）
- 抽取后分块：按段落/标题切分 + 最大长度阈值（保证检索粒度）
- 索引：Postgres FTS（对 chunks 建 `tsvector`）

**与正文生成的结合**
- `POST /drafts/:id/body:generate` 入参增加 `rag.enabled/top_k/force_citations/tags`
- 生成结果返回 `citations[]`（必须带 `document_id/filename/locator`）
- generation_logs 记录：检索 query、命中 chunk_id 列表、是否满足强制引用

---

### 10) 热点榜单/数据分析：保留入口，先 Mock，后切换 Real
**目标**：满足“你提供 API”前提下的并行开发，且 UI/业务链路先跑通。

**后端能力入口**
- `GET /capabilities/hot/trends`（mock 先返回含示例内容的列表）
- `POST /analytics/imports`、`POST /analytics/reports:generate`（mock 先返回固定报告）

**切换到 Real 时**
- 仅替换 `providers/*/real.ts` 的调用实现
- 不允许修改业务域接口与前端使用方式（避免返工）

---

## Verification（验收与验证步骤）
### A. 接口与契约验证
1) OpenAPI（或等价文档）可以导出：`GET /api/v1/openapi.json`（如采用）  
2) 所有写接口入参都有运行时校验（Zod/JSON Schema），错误码为 `VALIDATION_FAILED`  
3) 生成类接口出参必须通过 `output_schema` 校验，否则返回 `INTERNAL_ERROR` 并记录日志  

### B. Mock/Real 切换验证（逐个 capability）
对 Hot/LLM/Cover/RAG/Analytics 分别验证：
1) `CAP_XXX=mock` 时：端到端页面可跑通且稳定返回数据  
2) `CAP_XXX=real` 时：仅 provider 实现变化，业务域接口/前端无需修改  
3) `generation_logs.mode` 与 `provider` 字段准确记录 mock/real 与来源

### C. 端到端 Smoke 用例（MVP 闭环）
1) 登录：邀请码+口令成功获取 API Key；错误 key 返回 `AUTH_INVALID`  
2) 定位：创建项目 → 生成定位 → 保存 → 再次打开可读取并编辑内容支柱  
3) 选题：基于定位+关键词生成选题池 → 状态流转（待创作/创作中/已发布/已复盘）  
4) 文案：进入编辑器 → 生成标题/开头/正文块 → 用户编辑保存  
5) 封面：选择模板 → 生成封面 → 修改文案 → 重新渲染，版式不崩（换行/缩放规则生效）  
6) 知识库：上传文档 → 处理完成 → 搜索命中 → 正文生成启用 RAG 且返回 citations ≥ force_citations  
7) 审计：上述每次生成都产生 generation log，可按 request_id 追溯“模板版本 + 生效配置快照 + 引用片段”
