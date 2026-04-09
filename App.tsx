import React, { useMemo, useState } from "react";
import { apiGet, apiPost, apiUpload, API_BASE } from "./api";
import { clearApiKey, getApiKey, setApiKey } from "./storage";

type NavKey = "login" | "projects" | "positioning" | "topics" | "editor" | "covers" | "kb" | "logs";

type Project = { id: string; name: string; platform: string; created_at: string };
type Topic = { id: string; title: string; status: string; angles?: string[] };
type Draft = { id: string; topic_id: string; title_candidates: any; hook_candidates: any; body_blocks: any; citations: any[] };

export default function App() {
  const [nav, setNav] = useState<NavKey>("projects");
  const [toast, setToast] = useState<string>("");
  const [apiKey, setKey] = useState<string>(() => getApiKey());

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);

  const [topics, setTopics] = useState<Topic[]>([]);
  const [activeDraft, setActiveDraft] = useState<Draft | null>(null);

  const authed = useMemo(() => Boolean(apiKey), [apiKey]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 3200);
  };

  const safe = async <T,>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e: any) {
      showToast(e?.message || "请求失败");
      throw e;
    }
  };

  // ---------- Actions ----------
  const doLogin = async () => {
    const out = await safe(() => apiPost<{ ok: true; api_key: string; user: { id: string } }>("/api/v1/auth/login", { invite_code: "DEMO", passcode: "123456" }));
    setKey(out.api_key);
    setApiKey(out.api_key);
    showToast("登录成功：已保存 API Key（本地）");
  };

  const doLogout = () => {
    clearApiKey();
    setKey("");
    setActiveProject(null);
    setProjects([]);
    setTopics([]);
    setActiveDraft(null);
    showToast("已退出");
    setNav("login");
  };

  const loadProjects = async () => {
    const out = await safe(() => apiGet<{ items: Project[] }>("/api/v1/projects", apiKey));
    setProjects(out.items);
    if (!activeProject && out.items[0]) setActiveProject(out.items[0]);
  };

  const createProject = async (name: string) => {
    const p = await safe(() => apiPost<Project>("/api/v1/projects", { name, platform: "xiaohongshu" }, apiKey));
    setProjects((prev) => [p, ...prev]);
    setActiveProject(p);
    showToast("项目已创建");
  };

  const genPositioning = async () => {
    if (!activeProject) return showToast("请先选择项目");
    const out = await safe(() => apiPost<any>(`/api/v1/projects/${activeProject.id}/account-profile:generate`, { domain: "护肤" }, apiKey));
    showToast("定位已生成（Mock）");
    return out;
  };

  const loadTopics = async () => {
    if (!activeProject) return showToast("请先选择项目");
    const out = await safe(() => apiGet<{ items: Topic[] }>(`/api/v1/projects/${activeProject.id}/topics`, apiKey));
    setTopics(out.items);
  };

  const genTopics = async (keyword: string) => {
    if (!activeProject) return showToast("请先选择项目");
    const out = await safe(() => apiPost<{ items: Topic[] }>(`/api/v1/projects/${activeProject.id}/topics:generate`, { keywords: keyword ? [keyword] : [], count: 2 }, apiKey));
    setTopics(out.items);
    showToast("选题已生成（Mock）");
  };

  const initDraft = async (topicId: string) => {
    const d = await safe(() => apiPost<Draft>(`/api/v1/topics/${topicId}/drafts:init`, {}, apiKey));
    const full = await safe(() => apiGet<Draft>(`/api/v1/drafts/${d.id}`, apiKey));
    setActiveDraft(full);
    setNav("editor");
  };

  const genTitle = async () => {
    if (!activeDraft) return showToast("请先进入草稿");
    const out = await safe(() => apiPost<any>(`/api/v1/drafts/${activeDraft.id}/title:generate`, {}, apiKey));
    setActiveDraft((prev) => (prev ? { ...prev, title_candidates: out } : prev));
  };
  const genHook = async () => {
    if (!activeDraft) return showToast("请先进入草稿");
    const out = await safe(() => apiPost<any>(`/api/v1/drafts/${activeDraft.id}/hook:generate`, {}, apiKey));
    setActiveDraft((prev) => (prev ? { ...prev, hook_candidates: out } : prev));
  };
  const genBody = async (ragEnabled: boolean) => {
    if (!activeDraft) return showToast("请先进入草稿");
    if (!activeProject) return showToast("缺少项目上下文");
    const out = await safe(() =>
      apiPost<any>(
        `/api/v1/drafts/${activeDraft.id}/body:generate`,
        ragEnabled
          ? { rag: { enabled: true, project_id: activeProject.id, query: "烟酰胺 敏感肌", top_k: 5, force_citations: 1 } }
          : { evidence: [] },
        apiKey
      )
    );
    setActiveDraft((prev) => (prev ? { ...prev, body_blocks: { blocks: out.blocks }, citations: out.citations || [] } : prev));
  };

  const renderCover = async (template_id: string) => {
    const out = await safe(() =>
      apiPost<any>(
        "/api/v1/covers/render",
        { template_id, texts: { title: "敏感肌烟酰胺避坑", subtitle: "3类人群直接劝退", tags: ["避坑", "成分党"] } },
        apiKey
      )
    );
    return out;
  };

  const uploadKb = async (file: File) => {
    if (!activeProject) return showToast("请先选择项目");
    const form = new FormData();
    form.append("project_id", activeProject.id);
    form.append("file", file);
    const doc = await safe(() => apiUpload<any>("/api/v1/kb/documents", form, apiKey));
    await safe(() => apiPost<any>(`/api/v1/kb/documents/${doc.id}/process`, {}, apiKey));
    showToast("知识库文档已上传并索引");
  };

  // ---------- UI ----------
  const Sidebar = (
    <div className="panel sidebar">
      <div className="brand">
        <div className="brandMark" />
        <div>
          <div className="brandTitle">Studio Desk</div>
          <div className="brandSub">小红书优先 · Mock驱动联调</div>
        </div>
      </div>

      <div className="nav">
        <NavItem k="login" label="登录" meta={authed ? "已登录" : "未登录"} />
        <NavItem k="projects" label="工作台 / 项目" meta={activeProject ? activeProject.name : "未选择"} />
        <NavItem k="positioning" label="账号定位" meta="生成/保存" />
        <NavItem k="topics" label="选题池" meta={`${topics.length} 条`} />
        <NavItem k="editor" label="编辑器" meta={activeDraft ? activeDraft.id : "未进入"} />
        <NavItem k="covers" label="封面模板" meta="8套" />
        <NavItem k="kb" label="知识库（RAG）" meta="上传/检索" />
        <NavItem k="logs" label="生成日志" meta="审计" />
      </div>

      <div className="card" style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13 }}>API</div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{API_BASE}</div>
          </div>
          {authed ? (
            <button className="btn btnDanger" onClick={doLogout}>
              退出
            </button>
          ) : (
            <button className="btn btnPrimary" onClick={() => setNav("login")}>
              去登录
            </button>
          )}
        </div>
      </div>

      <div style={{ fontSize: 12, opacity: 0.6 }}>
        Tip：建议先在终端启动 API：<span className="mono">npm run dev:api</span>
      </div>
    </div>
  );

  function NavItem(props: { k: NavKey; label: string; meta?: string }) {
    return (
      <div
        className={`navItem ${nav === props.k ? "navItemActive" : ""}`}
        onClick={() => {
          setNav(props.k);
          if (props.k === "projects" && authed) loadProjects();
          if (props.k === "topics" && authed) loadTopics();
        }}
      >
        <div className="navLabel">{props.label}</div>
        <div className="navMeta">{props.meta || ""}</div>
      </div>
    );
  }

  return (
    <div className="app">
      {Sidebar}
      <div className="content">
        <div className="topbar">
          <h1>{titleOf(nav)}</h1>
          <div className="pill">{activeProject ? `项目：${activeProject.name}` : "未选择项目"}</div>
        </div>

        <div className="main">
          {nav === "login" && <LoginCard authed={authed} apiKey={apiKey} setKey={setKey} onLogin={doLogin} />}
          {nav === "projects" && <ProjectsCard authed={authed} projects={projects} active={activeProject} onPick={setActiveProject} onCreate={createProject} onRefresh={loadProjects} />}
          {nav === "positioning" && <PositioningCard authed={authed} onGenerate={genPositioning} />}
          {nav === "topics" && <TopicsCard authed={authed} topics={topics} onGenerate={genTopics} onOpen={initDraft} />}
          {nav === "editor" && <EditorCard authed={authed} draft={activeDraft} onTitle={genTitle} onHook={genHook} onBody={() => genBody(false)} onBodyRag={() => genBody(true)} />}
          {nav === "covers" && <CoverCard authed={authed} onRender={renderCover} />}
          {nav === "kb" && <KbCard authed={authed} onUpload={uploadKb} apiKey={apiKey} activeProjectId={activeProject?.id || ""} />}
          {nav === "logs" && <LogsCard authed={authed} apiKey={apiKey} />}
        </div>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

function titleOf(k: NavKey) {
  switch (k) {
    case "login":
      return "登录 / 会话";
    case "projects":
      return "工作台 / 项目";
    case "positioning":
      return "账号定位（Mock）";
    case "topics":
      return "选题池（Mock）";
    case "editor":
      return "编辑器（标题 / 开头 / 正文）";
    case "covers":
      return "封面模板（SVG示例）";
    case "kb":
      return "知识库（RAG：关键词检索）";
    case "logs":
      return "生成日志（审计）";
    default:
      return "Studio Desk";
  }
}

function LoginCard(props: { authed: boolean; apiKey: string; setKey: (v: string) => void; onLogin: () => Promise<void> }) {
  return (
    <div className="card">
      <div className="cardTitle">
        <h2>快速登录（内测邀请码）</h2>
        <span>邀请码 DEMO / 口令 123456</span>
      </div>
      <div className="btnRow">
        <button className="btn btnPrimary" onClick={props.onLogin}>
          一键登录（写入本地）
        </button>
      </div>
      <div style={{ height: 12 }} />
      <label>当前 API Key（本地存储）</label>
      <input value={props.apiKey} onChange={(e) => props.setKey(e.target.value)} placeholder="登录后自动填充" />
      <div style={{ marginTop: 10, fontSize: 12, color: "rgba(23,24,26,0.62)" }}>
        说明：这里是联调模式，后续可替换为正式账号体系。
      </div>
    </div>
  );
}

function ProjectsCard(props: {
  authed: boolean;
  projects: Project[];
  active: Project | null;
  onPick: (p: Project) => void;
  onCreate: (name: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [name, setName] = useState("护肤成分党");
  return (
    <div className="card">
      <div className="cardTitle">
        <h2>项目工作台</h2>
        <span>小红书平台固定</span>
      </div>

      <div className="row row2">
        <div>
          <label>新建项目名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div style={{ display: "flex", alignItems: "end", gap: 10 }}>
          <button className="btn btnPrimary" onClick={() => props.onCreate(name)}>
            新建
          </button>
          <button className="btn" onClick={props.onRefresh}>
            刷新
          </button>
        </div>
      </div>

      <div style={{ height: 12 }} />
      <div className="gridCards">
        {props.projects.map((p) => (
          <div key={p.id} className="miniCard" onClick={() => props.onPick(p)} style={props.active?.id === p.id ? { borderColor: "rgba(255,77,109,0.5)" } : undefined}>
            <div className="miniTitle">{p.name}</div>
            <div className="miniMeta">
              {p.platform} · {new Date(p.created_at).toLocaleString()}
            </div>
            <div className="miniMeta" style={{ marginTop: 8 }}>
              ID：<span className="mono">{p.id}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PositioningCard(props: { authed: boolean; onGenerate: () => Promise<any> }) {
  const [out, setOut] = useState<any>(null);
  return (
    <div className="card">
      <div className="cardTitle">
        <h2>账号定位（结构化输出）</h2>
        <span>当前为 Mock Provider</span>
      </div>
      <div className="btnRow">
        <button className="btn btnPrimary" onClick={async () => setOut(await props.onGenerate())}>
          生成定位
        </button>
      </div>
      <div style={{ height: 12 }} />
      <div className="mono">{out ? JSON.stringify(out, null, 2) : "点击生成后展示定位JSON（可用于后续变量/Prompt/选题生成）。"}</div>
    </div>
  );
}

function TopicsCard(props: { authed: boolean; topics: Topic[]; onGenerate: (kw: string) => Promise<void>; onOpen: (topicId: string) => Promise<void> }) {
  const [kw, setKw] = useState("烟酰胺");
  return (
    <div className="card">
      <div className="cardTitle">
        <h2>选题池</h2>
        <span>一键进入编辑器</span>
      </div>
      <div className="row row2">
        <div>
          <label>关键词（可空）</label>
          <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="例如：烟酰胺 / 早C晚A" />
        </div>
        <div style={{ display: "flex", alignItems: "end", gap: 10 }}>
          <button className="btn btnPrimary" onClick={() => props.onGenerate(kw)}>
            生成选题
          </button>
        </div>
      </div>
      <div style={{ height: 12 }} />
      <div className="gridCards">
        {props.topics.map((t) => (
          <div key={t.id} className="miniCard" onClick={() => props.onOpen(t.id)}>
            <div className="miniTitle">{t.title}</div>
            <div className="miniMeta">
              状态：{t.status} · {t.angles?.join(" / ") || "—"}
            </div>
            <div className="miniMeta" style={{ marginTop: 8 }}>
              进入编辑器 →
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditorCard(props: { authed: boolean; draft: Draft | null; onTitle: () => Promise<void>; onHook: () => Promise<void>; onBody: () => Promise<void>; onBodyRag: () => Promise<void> }) {
  return (
    <div className="card">
      <div className="cardTitle">
        <h2>编辑器（块结构）</h2>
        <span>{props.draft ? `draft_id: ${props.draft.id}` : "请从选题池进入"}</span>
      </div>
      <div className="btnRow">
        <button className="btn btnPrimary" onClick={props.onTitle} disabled={!props.draft}>
          生成标题
        </button>
        <button className="btn btnPrimary" onClick={props.onHook} disabled={!props.draft}>
          生成开头
        </button>
        <button className="btn btnGreen" onClick={props.onBody} disabled={!props.draft}>
          生成正文（无RAG）
        </button>
        <button className="btn btnGreen" onClick={props.onBodyRag} disabled={!props.draft}>
          生成正文（带RAG引用）
        </button>
      </div>

      <div style={{ height: 12 }} />
      <div className="row row2">
        <div>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>标题候选</div>
          <div className="mono">{props.draft?.title_candidates ? JSON.stringify(props.draft.title_candidates, null, 2) : "—"}</div>
        </div>
        <div>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>开头候选</div>
          <div className="mono">{props.draft?.hook_candidates ? JSON.stringify(props.draft.hook_candidates, null, 2) : "—"}</div>
        </div>
      </div>

      <div style={{ height: 12 }} />
      <div>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>正文块（blocks）</div>
        <div className="mono">{props.draft?.body_blocks ? JSON.stringify(props.draft.body_blocks, null, 2) : "—"}</div>
      </div>

      <div style={{ height: 12 }} />
      <div>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>引用清单（citations）</div>
        <div className="mono">{props.draft?.citations?.length ? JSON.stringify(props.draft.citations, null, 2) : "—"}</div>
      </div>
    </div>
  );
}

function CoverCard(props: { authed: boolean; onRender: (template_id: string) => Promise<any> }) {
  const [tpl, setTpl] = useState("tpl_03");
  const [out, setOut] = useState<any>(null);
  return (
    <div className="card">
      <div className="cardTitle">
        <h2>封面模板（SVG）</h2>
        <span>当前为 Mock Render（返回静态 SVG）</span>
      </div>

      <div className="row row2">
        <div>
          <label>模板ID</label>
          <select value={tpl} onChange={(e) => setTpl(e.target.value)}>
            {["tpl_01", "tpl_02", "tpl_03", "tpl_04", "tpl_05", "tpl_06", "tpl_07", "tpl_08"].map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "end", gap: 10 }}>
          <button className="btn btnPrimary" onClick={async () => setOut(await props.onRender(tpl))}>
            渲染
          </button>
        </div>
      </div>

      <div style={{ height: 12 }} />
      {out?.assets?.[0]?.url ? (
        <div className="row row2">
          <div className="mono">{JSON.stringify(out, null, 2)}</div>
          <div className="card" style={{ background: "rgba(0,0,0,0.03)" }}>
            <img src={`${API_BASE}${out.assets[0].url}`} style={{ width: "100%", borderRadius: 14, border: "1px solid rgba(0,0,0,0.12)" }} />
          </div>
        </div>
      ) : (
        <div className="mono">点击渲染后展示返回结构与 SVG 预览。</div>
      )}
    </div>
  );
}

function KbCard(props: { authed: boolean; onUpload: (f: File) => Promise<void>; apiKey: string; activeProjectId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [q, setQ] = useState("烟酰胺 敏感肌");
  const [out, setOut] = useState<any>(null);
  return (
    <div className="card">
      <div className="cardTitle">
        <h2>知识库（文档 + 关键词检索）</h2>
        <span>PDF/DOCX/TXT/MD（首期简化：纯文本读取分块）</span>
      </div>

      <div className="row row2">
        <div>
          <label>上传文档</label>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>
        <div style={{ display: "flex", alignItems: "end", gap: 10 }}>
          <button className="btn btnPrimary" disabled={!file} onClick={() => file && props.onUpload(file)}>
            上传并索引
          </button>
        </div>
      </div>

      <div style={{ height: 12 }} />
      <div className="row row2">
        <div>
          <label>检索Query</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div style={{ display: "flex", alignItems: "end", gap: 10 }}>
          <button
            className="btn btnGreen"
            onClick={async () => {
              const data = await apiPost<any>("/api/v1/kb/search", { project_id: props.activeProjectId, query: q, top_k: 5 }, props.apiKey);
              setOut(data);
            }}
          >
            搜索
          </button>
        </div>
      </div>

      <div style={{ height: 12 }} />
      <div className="mono">{out ? JSON.stringify(out, null, 2) : "上传并索引后，可在这里检索命中片段（含来源定位）。"}</div>
    </div>
  );
}

function LogsCard(props: { authed: boolean; apiKey: string }) {
  const [out, setOut] = useState<any>(null);
  return (
    <div className="card">
      <div className="cardTitle">
        <h2>生成日志</h2>
        <span>mock/real、request_id、请求/响应快照</span>
      </div>
      <div className="btnRow">
        <button
          className="btn btnPrimary"
          onClick={async () => {
            const data = await apiGet<any>("/api/v1/generation-logs?limit=50", props.apiKey);
            setOut(data);
          }}
        >
          刷新
        </button>
      </div>
      <div style={{ height: 12 }} />
      <div className="mono">{out ? JSON.stringify(out, null, 2) : "点击刷新展示最近50条生成日志。"}</div>
    </div>
  );
}

