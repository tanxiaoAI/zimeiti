import React, { useState, useEffect } from "react";
import {
  UserCheck,
  Scissors,
  Flame,
  ListTodo,
  Edit,
  MessageCircle,
  Database,
  LineChart,
  Settings,
  UploadCloud,
  X,
  ChevronRight,
  Plus,
  Image as ImageIcon,
  Sparkles,
  ChevronDown,
  Trash2,
  Send,
  ChevronLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { TopicLibraryView } from './TopicLibraryView';
import { GenerateCoverView } from './GenerateCoverView';
import './styles.css';

const NAV_GROUPS = [
  {
    label: "账号与资产",
    items: [
      { id: "freeChat", title: "自由对话", icon: MessageCircle },
      { id: "positioning", title: "账号定位", icon: UserCheck },
      { id: "teardown", title: "视频内容拆解", icon: Scissors },
    ]
  },
  {
    label: "创作中心",
    items: [
      { id: "topic_library", title: "选题库", icon: Database },
      { id: "content_production", title: "内容生产", icon: Edit },
      { id: "generate_cover", title: "生成封面", icon: ImageIcon },
    ]
  },
  {
    label: "数据与复盘",
    items: [
      { id: "analytics", title: "数据分析", icon: LineChart },
    ]
  },
  {
    label: "系统",
    items: [
      { id: "config", title: "配置中心", icon: Settings },
    ]
  }
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function getScopedConfigKey(accountId: string, tab: string, field: string) {
  return `config_${accountId}_${tab}_${field}`;
}

function getLegacyConfigKey(tab: string, field: string) {
  return `config_${tab}_${field}`;
}

function readScopedConfig(accountId: string, tab: string, field: string) {
  if (!accountId) return null;
  return localStorage.getItem(getScopedConfigKey(accountId, tab, field)) ?? localStorage.getItem(getLegacyConfigKey(tab, field));
}

function writeScopedConfig(accountId: string, tab: string, field: string, value: string) {
  if (!accountId) return;
  localStorage.setItem(getScopedConfigKey(accountId, tab, field), value);
}

function removeScopedConfig(accountId: string, tab: string, field: string) {
  if (accountId) {
    localStorage.removeItem(getScopedConfigKey(accountId, tab, field));
  }
  localStorage.removeItem(getLegacyConfigKey(tab, field));
}

function clearProjectScopedConfig(accountId: string) {
  if (!accountId) return;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(`config_${accountId}_`)) {
      localStorage.removeItem(key);
    }
  }
}

function decodeDisplayFilename(filename: string) {
  if (!filename) return "未知文件";
  if (/[\u4e00-\u9fff]/.test(filename)) return filename;

  try {
    const decoded = decodeURIComponent(escape(filename));
    if (/[\u4e00-\u9fff]/.test(decoded)) {
      return decoded;
    }
  } catch {
    // ignore decode failures
  }

  return filename;
}

function renderInlineRichText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} style={{ fontWeight: 800, color: 'inherit' }}>
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={index}
          style={{
            background: 'rgba(15, 23, 42, 0.08)',
            border: '1px solid rgba(15, 23, 42, 0.08)',
            borderRadius: 6,
            padding: '0.12rem 0.38rem',
            fontSize: '0.9em',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function RichMessageContent({ content, isUser = false }: { content: string; isUser?: boolean }) {
  const lines = (content || "").replace(/\r\n/g, "\n").split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      const language = trimmed.slice(3).trim();
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1;
      elements.push(
        <div key={`code-${i}`} style={{ margin: '10px 0' }}>
          {language && <div style={{ fontSize: '0.72rem', opacity: 0.7, marginBottom: 6 }}>{language}</div>}
          <pre
            style={{
              margin: 0,
              padding: '14px 16px',
              borderRadius: 14,
              background: isUser ? 'rgba(255,255,255,0.14)' : '#0f172a',
              color: isUser ? 'rgba(255,255,255,0.96)' : '#e2e8f0',
              overflowX: 'auto',
              fontSize: '0.84rem',
              lineHeight: 1.7,
              boxShadow: isUser ? 'none' : 'inset 0 0 0 1px rgba(148,163,184,0.14)'
            }}
          >
            <code>{codeLines.join("\n")}</code>
          </pre>
        </div>
      );
      continue;
    }

    if (/^#{1,3}\s/.test(trimmed)) {
      const level = trimmed.match(/^#+/)?.[0].length || 1;
      const title = trimmed.replace(/^#{1,3}\s*/, "");
      const size = level === 1 ? '1.18rem' : level === 2 ? '1.05rem' : '0.98rem';
      elements.push(
        <div key={`heading-${i}`} style={{ fontSize: size, fontWeight: 800, margin: '14px 0 8px', letterSpacing: '-0.01em' }}>
          {renderInlineRichText(title)}
        </div>
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      elements.push(
        <blockquote
          key={`quote-${i}`}
          style={{
            margin: '12px 0',
            padding: '10px 14px',
            borderLeft: isUser ? '3px solid rgba(255,255,255,0.5)' : '3px solid var(--primary)',
            background: isUser ? 'rgba(255,255,255,0.08)' : 'rgba(37,99,235,0.06)',
            borderRadius: 10,
            color: 'inherit'
          }}
        >
          {quoteLines.map((quoteLine, idx) => (
            <div key={idx} style={{ marginTop: idx === 0 ? 0 : 6 }}>
              {renderInlineRichText(quoteLine)}
            </div>
          ))}
        </blockquote>
      );
      continue;
    }

    if (/^(\-|\*|\d+\.)\s+/.test(trimmed)) {
      const items: { type: 'ul' | 'ol'; text: string }[] = [];
      while (i < lines.length && /^(\-|\*|\d+\.)\s+/.test(lines[i].trim())) {
        const current = lines[i].trim();
        items.push({
          type: /^\d+\./.test(current) ? 'ol' : 'ul',
          text: current.replace(/^(\-|\*|\d+\.)\s+/, "")
        });
        i += 1;
      }
      const ordered = items.every((item) => item.type === 'ol');
      const ListTag = ordered ? 'ol' : 'ul';
      elements.push(
        <ListTag
          key={`list-${i}`}
          style={{
            margin: '10px 0 10px 1.1rem',
            paddingLeft: '0.4rem',
            lineHeight: 1.8
          }}
        >
          {items.map((item, idx) => (
            <li key={idx} style={{ marginBottom: 4 }}>
              {renderInlineRichText(item.text)}
            </li>
          ))}
        </ListTag>
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^#{1,3}\s/.test(lines[i].trim()) && !lines[i].trim().startsWith(">") && !/^(\-|\*|\d+\.)\s+/.test(lines[i].trim()) && !lines[i].trim().startsWith("```")) {
      paragraphLines.push(lines[i]);
      i += 1;
    }

    elements.push(
      <p key={`p-${i}`} style={{ margin: '0 0 12px', lineHeight: 1.85 }}>
        {paragraphLines.map((paragraphLine, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && <br />}
            {renderInlineRichText(paragraphLine)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return <div>{elements}</div>;
}

async function readApiResponse(response: Response) {
  const rawText = await response.text();
  let json: any = null;

  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }

  return { rawText, json };
}

const CONTENT_PRODUCTION_STEPS = [
  { id: "topic_adjust", title: "AI选题调整", inputField: "cp_topic_adjust_input", resultField: "cp_topic_adjust_result", placeholder: "输入你对这个选题的补充要求、目标人群、风格限制或想调整的方向..." },
  { id: "outline", title: "AI生成框架", inputField: "cp_outline_input", resultField: "cp_outline_result", placeholder: "输入你希望生成的内容框架要求，例如结构、角度、篇幅、形式..." },
  { id: "draft", title: "AI生成初稿", inputField: "cp_draft_input", resultField: "cp_draft_result", placeholder: "输入初稿生成要求，例如字数、风格、是否口语化、是否带案例..." },
  { id: "value_review", title: "AI内容价值评估", inputField: "cp_value_review_input", resultField: "cp_value_review_result", placeholder: "输入你希望 AI 从哪些维度评估这篇内容，例如信息密度、传播性、差异化..." },
  { id: "final_optimize", title: "AI优化终稿", inputField: "cp_final_optimize_input", resultField: "cp_final_optimize_result", placeholder: "输入终稿优化要求，例如更流畅、更有说服力、更适合发布平台..." }
] as const;

function truncateTopicTitle(title: string, maxLength = 12) {
  const text = String(title || "").trim();
  if (!text) return "未命名选题";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export default function App() {
  const [activeNav, setActiveNav] = useState("freeChat");
  const [activeTopic, setActiveTopic] = useState<any>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [activeAccountId, setActiveAccountId] = useState("");

  const activeAccount = accounts.find(a => a.id === activeAccountId) || accounts[0];

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    if (!activeAccountId && accounts.length > 0) {
      setActiveAccountId(accounts[0].id);
    }
  }, [accounts, activeAccountId]);

  const fetchAccounts = async () => {
    try {
      const res = await fetch("/api/v1/projects", {
        headers: { "X-API-Key": "demo-key" }
      });
      if (!res.ok) throw new Error("账号列表加载失败");
      const data = await res.json();
      const items = data.data?.items || [];
      setAccounts(items);

      const savedActiveId = localStorage.getItem("active_account_id");
      if (savedActiveId && items.some((item: any) => item.id === savedActiveId)) {
        setActiveAccountId(savedActiveId);
      } else if (items[0]?.id) {
        setActiveAccountId(items[0].id);
        localStorage.setItem("active_account_id", items[0].id);
      }
    } catch (e) {
      console.error(e);
      alert("账号列表加载失败");
    }
  };

  const handleAddAccount = async () => {
    const name = prompt("请输入新账号名称：");
    if (name?.trim()) {
      try {
        const res = await fetch("/api/v1/projects", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": "demo-key"
          },
          body: JSON.stringify({ name: name.trim(), platform: "xiaohongshu" })
        });
        if (!res.ok) throw new Error("账号创建失败");
        const data = await res.json();
        const created = data.data;
        setAccounts((prev) => [...prev, created]);
        setActiveAccountId(created.id);
        localStorage.setItem("active_account_id", created.id);
        setIsAccountDropdownOpen(false);
      } catch (e) {
        console.error(e);
        alert("账号创建失败");
      }
    }
  };

  const handleDeleteAccount = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (accounts.length <= 1) {
      alert("必须至少保留一个账号！");
      return;
    }
    if (confirm("确定要删除这个账号吗？相关数据将被清除。")) {
      try {
        const res = await fetch(`/api/v1/projects/${id}`, {
          method: "DELETE",
          headers: { "X-API-Key": "demo-key" }
        });
        if (!res.ok) throw new Error("账号删除失败");

        clearProjectScopedConfig(id);
        const newAccounts = accounts.filter(a => a.id !== id);
        setAccounts(newAccounts);
        if (activeAccountId === id) {
          const nextId = newAccounts[0]?.id || "";
          setActiveAccountId(nextId);
          if (nextId) {
            localStorage.setItem("active_account_id", nextId);
          } else {
            localStorage.removeItem("active_account_id");
          }
        }
        setIsAccountDropdownOpen(false);
      } catch (e) {
        console.error(e);
        alert("账号删除失败");
      }
    }
  };

  const handleTopicSelect = (topic: any) => {
    setActiveTopic(topic);
    setActiveNav("content_production");
  };

  const renderContent = () => {
    switch (activeNav) {
      case "freeChat": return <FreeChatView activeAccountId={activeAccountId} />;
      case "positioning": return <PositioningView activeAccountId={activeAccountId} />;
      case "teardown": return <TeardownView activeAccountId={activeAccountId} />;
      case "topic_library": return <TopicLibraryView activeAccountId={activeAccountId} onEnterProduction={handleTopicSelect} />;
      case "generate_cover": return <GenerateCoverView activeAccountId={activeAccountId} />;
      case "content_production": return <EditorView activeAccountId={activeAccountId} topic={activeTopic} onTopicChange={setActiveTopic} />;
      case "analytics": return <AnalyticsView />;
      case "config": return <ConfigView activeAccountId={activeAccountId} />;
      default: return <div className="empty-state">建设中...</div>;
    }
  };

  const currentNavItem = NAV_GROUPS.flatMap(g => g.items).find(i => i.id === activeNav);

  return (
    <div className="app-container">
      {/* 侧边栏 */}
      <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`} style={{ transition: 'width 0.3s ease', width: isSidebarCollapsed ? '72px' : '220px', padding: isSidebarCollapsed ? '16px 10px' : '18px 12px' }}>
        <div className="brand brand-text-only" style={{ marginBottom: 10, justifyContent: isSidebarCollapsed ? 'center' : 'flex-start', padding: isSidebarCollapsed ? '0' : '0 8px' }}>
          {!isSidebarCollapsed && <h1>自媒体助手</h1>}
        </div>

        {/* 折叠按钮 */}
        <button 
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className="btn-icon sidebar-toggle"
          style={{ position: 'absolute', top: 18, right: -12, zIndex: 20 }}
        >
          {isSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        {/* 账号切换器 */}
        {!isSidebarCollapsed && (
          <div style={{ position: 'relative', marginBottom: 18, padding: '0 8px' }}>
            <button 
              onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 10px',
                background: 'var(--bg-hover)',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                color: 'var(--text-main)',
                fontWeight: 600,
                fontSize: '0.8rem'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                <UserCheck size={16} color="var(--primary)" />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {activeAccount?.name || "未选择账号"}
                </span>
              </div>
              <ChevronDown size={16} color="var(--text-muted)" style={{ transform: isAccountDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>

            <AnimatePresence>
              {isAccountDropdownOpen && (
                <>
                  <div 
                    style={{ position: 'fixed', inset: 0, zIndex: 90 }} 
                    onClick={() => setIsAccountDropdownOpen(false)} 
                  />
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.15 }}
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 12,
                      right: 12,
                      marginTop: 8,
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-light)',
                      borderRadius: 'var(--radius-md)',
                      boxShadow: 'var(--shadow-float)',
                      zIndex: 100,
                      overflow: 'hidden'
                    }}
                  >
                    <div style={{ padding: '7px 10px', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-hover)', borderBottom: '1px solid var(--border-light)' }}>
                      切换或管理工作台账号
                    </div>
                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                      {accounts.map(acc => (
                        <div 
                          key={acc.id}
                          onClick={() => {
                            setActiveAccountId(acc.id);
                            localStorage.setItem("active_account_id", acc.id);
                            setIsAccountDropdownOpen(false);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '9px 10px',
                            cursor: 'pointer',
                            background: acc.id === activeAccountId ? 'var(--primary-light)' : 'transparent',
                            borderBottom: '1px solid var(--border-light)'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, overflow: 'hidden' }}>
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: acc.id === activeAccountId ? 'var(--primary)' : 'transparent' }} />
                            <span style={{ fontSize: '0.8rem', color: acc.id === activeAccountId ? 'var(--primary)' : 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {acc.name}
                            </span>
                          </div>
                          <button 
                            onClick={(e) => handleDeleteAccount(acc.id, e)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                            title="删除账号"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button 
                      onClick={handleAddAccount}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        padding: '10px',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-main)',
                        fontSize: '0.78rem',
                        fontWeight: 600
                      }}
                    >
                      <Plus size={16} /> 新增矩阵账号
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        )}

        <nav style={{ flex: 1, overflowY: 'auto' }}>
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="nav-group" style={{ marginBottom: isSidebarCollapsed ? 12 : 16 }}>
              {!isSidebarCollapsed && <div className="nav-group-title">{group.label}</div>}
              {group.items.map((item) => (
                <button 
                  key={item.id}
                  title={isSidebarCollapsed ? item.title : ''}
                  className={`nav-item ${activeNav === item.id ? 'active' : ''}`}
                  onClick={() => setActiveNav(item.id)}
                  style={{ 
                    justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
                    padding: isSidebarCollapsed ? '9px' : '8px 10px'
                  }}
                >
                  <span className="nav-item-icon" aria-hidden="true">
                    <item.icon size={16} strokeWidth={activeNav === item.id ? 2.35 : 2} />
                  </span>
                  {!isSidebarCollapsed && <span>{item.title}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        
        <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--border-light)' }}>
          <div className="nav-item" style={{ fontSize: '0.72rem', cursor: 'default', justifyContent: isSidebarCollapsed ? 'center' : 'flex-start', padding: isSidebarCollapsed ? '9px' : '8px 10px' }} title={isSidebarCollapsed ? "API Mock 模式运行中" : ""}>
            <span className="nav-item-icon nav-item-status" aria-hidden="true">
              <span style={{ color: 'var(--success)', display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'currentColor' }} />
            </span>
            {!isSidebarCollapsed && "API Mock 模式运行中"}
          </div>
        </div>
      </aside>

      {/* 主工作区 */}
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="breadcrumb-muted">当前账号: {activeAccount?.name || "未选择账号"}</span>
            <ChevronRight size={16} className="breadcrumb-muted" />
            <span>{currentNavItem?.title}</span>
          </div>
        </header>

        <div className="content-scroll">
          <div className="content-wrapper">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeNav}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {renderContent()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* 个性化配置抽屉 */}
      <AnimatePresence>
        {isConfigOpen && (
          <>
            <motion.div 
              className="drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsConfigOpen(false)}
            />
            <motion.div 
              className="drawer"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: "spring", bounce: 0, duration: 0.4 }}
            >
              <div className="drawer-header">
                <h3>提示词与个性化配置</h3>
                <button className="btn-icon" onClick={() => setIsConfigOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="drawer-body">
                <div className="card" style={{ padding: '16px' }}>
                  <h4 style={{ marginBottom: 12, fontSize: '0.95rem' }}>层级覆盖说明</h4>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    系统默认配置 &lt; 账号定位配置 &lt; 个人偏好配置 &lt; 单篇临时覆盖。
                  </p>
                </div>
                
                <div className="input-group">
                  <label>默认文风与禁忌词 (全局生效)</label>
                  <textarea 
                    className="input-field" 
                    defaultValue="语气偏理性干货，多用短句，禁止使用“家人们”、“绝绝子”等过度营销词汇。"
                  />
                </div>
              </div>
              <div className="drawer-footer">
                <button className="btn-primary" onClick={() => setIsConfigOpen(false)}>保存全局配置</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function ConfigView({ activeAccountId }: { activeAccountId: string }) {
  const [activeTab, setActiveTab] = useState("free_chat");
  const [promptValue, setPromptValue] = useState("");
  const [greetingValue, setGreetingValue] = useState("");
  const [fileName, setFileName] = useState("");
  const [selectedModel, setSelectedModel] = useState("gpt-5.5");
  const [fileStatus, setFileStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [systemConfigStatus, setSystemConfigStatus] = useState<any>(null);
  const [systemConfigLoading, setSystemConfigLoading] = useState(false);
  const [systemConfigError, setSystemConfigError] = useState("");

  const configOptions = [
    { id: "free_chat", title: "自由对话" },
    { id: "positioning", title: "账号定位生成" },
    { id: "teardown", title: "视频内容拆解" },
    { id: "content_production", title: "内容生产" },
    { id: "analytics", title: "数据复盘诊断" },
  ];

  useEffect(() => {
    for (const option of configOptions) {
      removeScopedConfig(activeAccountId, option.id, "constraint");
    }
  }, [activeAccountId]);

  const fetchSystemConfigStatus = async () => {
    try {
      setSystemConfigLoading(true);
      setSystemConfigError("");
      const res = await fetch("/api/v1/system/config-status", {
        headers: { "X-API-Key": "demo-key" }
      });
      const payload = await readApiResponse(res);
      if (!res.ok || payload.json?.success === false || payload.json?.error) {
        throw new Error(payload.json?.message || payload.json?.error?.message || "系统配置检查失败");
      }
      setSystemConfigStatus(payload.json?.data || null);
    } catch (e: any) {
      console.error(e);
      setSystemConfigError(e.message || "系统配置检查失败");
    } finally {
      setSystemConfigLoading(false);
    }
  };

  useEffect(() => {
    fetchSystemConfigStatus();
  }, []);

  const fetchContextFileInfo = async (tab: string) => {
    if (!activeAccountId) {
      setFileName("");
      setFileStatus("");
      return;
    }

    try {
      const res = await fetch(`/api/v1/projects/${activeAccountId}/context-file?module_key=${encodeURIComponent(tab)}`, {
        headers: { "X-API-Key": "demo-key" }
      });
      const payload = await readApiResponse(res);
      const fileInfo = payload.json?.data;

      if (res.ok && fileInfo) {
        setFileName(fileInfo.filename || "");
        setFileStatus(`已挂载全文，${Math.ceil((fileInfo.size_bytes || 0) / 1024)} KB`);
      } else {
        setFileName("");
        setFileStatus("");
      }
    } catch (e) {
      console.error(e);
      setFileName("");
      setFileStatus("");
    }
  };

  // 当切换 tab 时读取配置
  useEffect(() => {
    const savedModel = readScopedConfig(activeAccountId, activeTab, "model");
    if (savedModel) {
      setSelectedModel(savedModel);
    } else {
      setSelectedModel("gpt-5.5");
    }

    const savedPrompt = readScopedConfig(activeAccountId, activeTab, "prompt");
    if (savedPrompt !== null) {
      setPromptValue(savedPrompt);
    } else {
      setPromptValue(`作为资深的【${configOptions.find(o => o.id === activeTab)?.title}】专家...\n1. 语气要求：专业、真诚、不爹味\n2. 格式要求：严格遵循输出结构...`);
    }

    const savedGreeting = readScopedConfig(activeAccountId, activeTab, "greeting");
    if (savedGreeting !== null) {
      setGreetingValue(savedGreeting);
    } else {
      setGreetingValue(
        activeTab === "free_chat"
          ? "你好，我是自由对话助手。你可以直接和我聊任何想法、问题或任务。"
          : "你好！我是账号定位专家。我们从你的技能和兴趣开始聊起吧？"
      );
    }
    
    fetchContextFileInfo(activeTab);
  }, [activeTab, activeAccountId]);

  const handleSave = () => {
    writeScopedConfig(activeAccountId, activeTab, "model", selectedModel);
    writeScopedConfig(activeAccountId, activeTab, "prompt", promptValue);
    removeScopedConfig(activeAccountId, activeTab, "constraint");
    if (activeTab === "positioning" || activeTab === "free_chat") {
      writeScopedConfig(activeAccountId, activeTab, "greeting", greetingValue);
    }
    alert('保存成功！');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!activeAccountId) {
      alert("请先选择账号项目后再上传文件");
      return;
    }

    const lowerName = file.name.toLowerCase();
    const allowedExtensions = [".md", ".txt", ".csv", ".json"];
    if (!allowedExtensions.some(ext => lowerName.endsWith(ext))) {
      alert("当前仅支持上传 .md、.txt、.csv、.json 文本类文件");
      return;
    }

    try {
      setUploading(true);
      setFileName(file.name);
      setFileStatus("上传中...");

      const formData = new FormData();
      formData.append("module_key", activeTab);
      formData.append("file", file);

      const uploadRes = await fetch(`/api/v1/projects/${activeAccountId}/context-file`, {
        method: "POST",
        headers: { "X-API-Key": "demo-key" },
        body: formData
      });
      const uploadPayload = await readApiResponse(uploadRes);
      const uploadJson = uploadPayload.json;
      if (!uploadRes.ok || uploadJson?.success === false || uploadJson?.error) {
        const fallbackMessage = uploadPayload.rawText?.trim().startsWith("<!DOCTYPE")
          ? `服务返回了 HTML 错误页，状态码 ${uploadRes.status}`
          : (uploadPayload.rawText || "").slice(0, 120);
        throw new Error(uploadJson?.message || uploadJson?.error?.message || fallbackMessage || "上传失败");
      }

      const uploadedDoc = uploadJson.data;
      const nextInfo = {
        fileName: uploadedDoc.filename || file.name,
        fileStatus: `已挂载全文，${Math.ceil((uploadedDoc.size_bytes || file.size) / 1024)} KB`,
        documentId: uploadedDoc.id
      };
      writeScopedConfig(activeAccountId, activeTab, "file", JSON.stringify(nextInfo));
      setFileName(nextInfo.fileName);
      setFileStatus(nextInfo.fileStatus);
      alert(`文件 ${nextInfo.fileName} 已挂载，后续对话会自动携带全文`);
    } catch (err: any) {
      console.error(err);
      setFileStatus("上传失败");
      alert(`文件上传失败：${err.message}`);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const envItems = systemConfigStatus?.env_items || [];
  const storage = systemConfigStatus?.storage || null;
  const runtime = systemConfigStatus?.runtime || null;
  const missingRequiredItems = envItems.filter((item: any) => item.required && !item.configured);

  return (
    <div>
      <div className="page-header">
        <h2>系统配置中心</h2>
        <p>这里分两层：模块提示词/文件配置保存在系统里；生产环境密钥请统一配置在 Zeabur 环境变量。</p>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem' }}>运行环境检查</h3>
            <p style={{ margin: '6px 0 0', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
              这里展示服务端实际读取到的依赖项状态。密钥不显示明文，只显示是否已配置。
            </p>
          </div>
          <button className="btn-ghost" onClick={fetchSystemConfigStatus} disabled={systemConfigLoading}>
            {systemConfigLoading ? '检查中...' : '刷新检查'}
          </button>
        </div>

        {systemConfigError ? (
          <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.16)', color: '#dc2626', fontSize: '0.86rem' }}>
            配置检查失败：{systemConfigError}
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 16 }}>
              <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--bg-app)', border: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 6 }}>必填缺失项</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: missingRequiredItems.length ? '#dc2626' : 'var(--success)' }}>
                  {missingRequiredItems.length}
                </div>
              </div>
              <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--bg-app)', border: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 6 }}>数据目录</div>
                <div style={{ fontSize: '0.88rem', fontWeight: 700, wordBreak: 'break-all' }}>{storage?.data_dir || '--'}</div>
              </div>
              <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--bg-app)', border: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 6 }}>当前运行模式</div>
                <div style={{ fontSize: '0.88rem', fontWeight: 700 }}>
                  LLM={runtime?.cap_llm || '--'} / NODE_ENV={runtime?.node_env || '--'}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.12)', fontSize: '0.84rem', lineHeight: 1.7 }}>
              <strong>推荐做法：</strong> 线上密钥统一配在 <code>Zeabur Environment Variables</code>；当前页面只负责告诉你缺了什么。像提示词、模块默认模型、挂载文件，这些才适合保存在系统数据目录和持久硬盘里。
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {envItems.map((item: any) => (
                <div key={item.key} style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--bg-app)', border: '1px solid var(--border-light)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <code style={{ fontSize: '0.82rem' }}>{item.key}</code>
                      <span style={{ fontSize: '0.84rem', fontWeight: 700 }}>{item.label}</span>
                      <span className="badge" style={{ background: item.configured ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: item.configured ? '#15803d' : '#dc2626', border: 'none' }}>
                        {item.configured ? '已配置' : '未配置'}
                      </span>
                      {item.required ? (
                        <span className="badge" style={{ background: 'rgba(245,158,11,0.14)', color: '#b45309', border: 'none' }}>
                          必填
                        </span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      建议位置：{item.configure_in === 'zeabur' ? 'Zeabur 环境变量' : '系统数据目录'}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
                    用途：{(item.used_by || []).join('、') || '未标注'}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
                    当前值：{item.value_preview || item.default_value || '未设置'}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
                    说明：{item.note || '无'}
                  </div>
                </div>
              ))}
            </div>

            {storage ? (
              <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 12, background: 'var(--bg-app)', border: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 8 }}>当前硬盘/目录落点</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.8, wordBreak: 'break-all' }}>
                  DATA_DIR：{storage.data_dir}<br />
                  DB_PATH：{storage.db_path}<br />
                  UPLOADS_DIR：{storage.uploads_dir}<br />
                  KB_STORAGE_DIR：{storage.kb_storage_dir}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <div className="card" style={{ width: 240, padding: 12 }}>
          <div className="nav-group-title" style={{ marginBottom: 12 }}>模块列表</div>
          {configOptions.map(opt => (
            <button 
              key={opt.id}
              className={`nav-item ${activeTab === opt.id ? 'active' : ''}`}
              onClick={() => setActiveTab(opt.id)}
              style={{ marginBottom: 4 }}
            >
              {opt.title}
            </button>
          ))}
        </div>

        <div className="card" style={{ flex: 1 }}>
          <h3 style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border-light)' }}>
            【{configOptions.find(o => o.id === activeTab)?.title}】专属配置
          </h3>

          <div className="form-row">
            <label>选用模型 (Model) </label>
            <select 
              className="input-field" 
              style={{ padding: '10px 12px', background: 'var(--bg-app)', cursor: 'pointer', appearance: 'auto' }}
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
            >
              <option value="gpt-5.4">gpt-5.4</option>
              <option value="gpt-5.5">gpt-5.5</option>
              <option value="claude-opus-4-6">claude-opus-4-6</option>
              <option value="claude-sonnet-4-6-thinking">claude-sonnet-4-6-thinking</option>
              <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
              <option value="gpts-gemini-3.1-pro-preview">gemini-3.1-pro-preview</option>
            </select>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 8 }}>
              该模块调用大语言模型时所使用的具体底层模型。
            </p>
          </div>

          <div className="form-row">
            <label>系统提示词 (System Prompt)</label>
            <textarea 
              className="input-field" 
              style={{ minHeight: 160 }}
              value={promptValue}
              onChange={e => setPromptValue(e.target.value)}
            />
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 8 }}>
              此提示词将作为该功能调用大模型时的 System Role。
            </p>
          </div>

          {(activeTab === "positioning" || activeTab === "free_chat") && (
            <div className="form-row">
              <label>开场白配置 (AI第一条发给用户的消息)</label>
              <input 
                className="input-field" 
                value={greetingValue}
                onChange={e => setGreetingValue(e.target.value)}
              />
            </div>
          )}

          <div className="form-row">
            <label>专属默认参考文件 (将自动挂载到此功能的上下文中)</label>
            <div className="upload-area" style={{ padding: '24px', border: '1px dashed var(--border-light)', borderRadius: 8, background: 'var(--bg-app)', display: 'flex', alignItems: 'center', gap: 16 }}>
              <UploadCloud size={24} color="var(--text-muted)" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>点击上传专用示例库/文件</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {fileName ? `文件：${fileName}` : '支持：.md / .txt / .csv / .json'}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {fileStatus || '上传后会完整挂载到当前模块，每轮对话都会自动携带全文内容'}
                </div>
              </div>
              <label className="btn-ghost" style={{ padding: '6px 12px', cursor: 'pointer' }}>
                <input type="file" accept=".md,.txt,.csv,.json,text/markdown,text/plain,application/json,text/csv" style={{ display: 'none' }} onChange={handleFileUpload} disabled={uploading} />
                {uploading ? '上传中...' : '浏览文件'}
              </label>
            </div>
          </div>

          <div style={{ marginTop: 32, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn-primary" onClick={handleSave}>保存此模块配置</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// Views
// ==========================================

function ProjectsView() {
  return (
    <div>
      <div className="page-header">
        <h2>工作台</h2>
        <p>管理您的多个小红书矩阵账号</p>
      </div>
      <div className="card">
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ width: 48, height: 48, background: 'var(--primary-light)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
            <UserCheck size={24} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>职场效能笔记 (当前)</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>平台: 小红书 | 创建时间: 2024-03-01</p>
          </div>
        </div>
      </div>
      <button className="btn-ghost" style={{ borderStyle: 'dashed', width: '100%', padding: '20px' }}>
        <Plus size={16} /> 创建新账号项目
      </button>
    </div>
  );
}

const DEFAULT_REPORT_PROMPT = `# Role: AI自媒体账号定位专家

## Profile
- language: 中文
- description: 专注于为AI相关自媒体账号提供精准定位策略的专业顾问
- background: 5年自媒体运营经验，3年AI领域深耕
- personality: 逻辑严谨、创意丰富、注重细节
- expertise: 自媒体账号定位、内容规划、受众分析
- target_audience: AI领域自媒体创作者、科技类内容创业者

## Skills

1. 账号定位分析
   - 行业洞察: 准确识别AI领域细分市场机会
   - 竞品分析: 系统评估同类账号优劣势
   - 受众画像: 构建精准的目标用户画像
   - 差异化策略: 制定独特的内容定位方案

2. 内容规划能力
   - 选题策划: 设计符合定位的内容主题库
   - 形式创新: 推荐适合的内容呈现方式
   - 更新节奏: 制定科学的发布频率计划
   - 效果预测: 预判内容的市场反响

## Rules

1. 定位原则：
   - 聚焦细分: 必须选择明确的垂直领域
   - 价值导向: 确保内容具有实用价值
   - 可持续性: 考虑长期运营可行性
   - 数据支撑: 所有建议需有依据

2. 分析准则：
   - 客观全面: 兼顾市场趋势和账号特色
   - 深度思考: 挖掘潜在机会点
   - 创新突破: 避免同质化方案
   - 实操落地: 建议需具有可执行性

3. 限制条件：
   - 不跨领域: 专注AI相关内容
   - 不夸大: 保持理性预期
   - 不抄袭: 坚持原创策略
   - 不空谈: 必须给出具体方案

## Workflows

- 目标: 根据上述聊天内容以及客户档案，为AI自媒体账号制定精准定位方案
- 步骤 1: 收集基础信息(账号现状、团队能力、资源情况)
- 步骤 2: 分析市场环境(趋势、竞品、用户需求)
- 步骤 3: 确定核心定位(领域、特色、价值主张)
- 步骤 4: 设计内容框架(主题、形式、节奏)
- 预期结果: 形成完整的账号定位报告

## Initialization
作为AI自媒体账号定位专家，你必须遵守上述Rules，按照Workflows执行任务。`;

function PositioningView({ activeAccountId }: { activeAccountId: string }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>({});
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportPrompt, setReportPrompt] = useState(DEFAULT_REPORT_PROMPT);
  const chatEndRef = React.useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  useEffect(() => {
    if (activeAccountId) {
      fetchChat();
      fetchProfile();
    }
  }, [activeAccountId]);

  const fetchChat = async () => {
    try {
      const res = await fetch(`/api/v1/projects/${activeAccountId}/positioning/chat`, {
        headers: { "X-API-Key": "demo-key" }
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.data?.items || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchProfile = async () => {
    try {
      const res = await fetch(`/api/v1/projects/${activeAccountId}/customer-profile`, {
        headers: { "X-API-Key": "demo-key" }
      });
      if (res.ok) {
        const data = await res.json();
        setProfile(data.data || {});
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!confirm("确定要删除这条消息吗？")) return;
    try {
      const res = await fetch(`/api/v1/projects/${activeAccountId}/positioning/chat/${messageId}`, {
        method: 'DELETE',
        headers: { "X-API-Key": "demo-key" }
      });
      if (res.ok) {
        setMessages(prev => prev.filter(m => m.id !== messageId));
      }
    } catch (e) {
      console.error(e);
      alert("删除失败");
    }
  };

  const sendMessage = async (overrideMsg?: string) => {
    const msg = overrideMsg || inputValue.trim();
    if (!msg || loading) return;
    
    if (!overrideMsg) {
      setInputValue("");
      // Reset textarea height
      const textarea = document.querySelector('.input-field[placeholder*="回复 AI"]') as HTMLTextAreaElement;
      if (textarea) textarea.style.height = 'auto';
    }
    
    setLoading(true);

    // Optimistic update
    const tempId = `temp_${Date.now()}`;
    setMessages(prev => [...prev, { id: tempId, role: "user", content: msg }]);

    try {
      const savedModel = readScopedConfig(activeAccountId, 'positioning', 'model') || "gpt-5.5";
      const savedPrompt = readScopedConfig(activeAccountId, 'positioning', 'prompt') || "你是一个资深的自媒体账号定位专家。你的目标是和用户对话，帮他们梳理出账号的赛道、人设和内容支柱。";
      const systemInstruction = savedPrompt;

      const res = await fetch(`/api/v1/projects/${activeAccountId}/positioning/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "demo-key"
        },
        body: JSON.stringify({ message: msg, systemInstruction, model: savedModel })
      });

      if (!res.ok) throw new Error("网络请求失败");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取流");
      const decoder = new TextDecoder("utf-8");
      
      let fullReply = "";
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.type === "userMsg") {
                setMessages(prev => prev.map(m => m.id === tempId ? data.message : m));
                // 插入一个临时的 AI 消息
                setMessages(prev => [...prev, { id: "temp_ai", role: "model", content: "" }]);
              } else if (data.type === "chunk") {
                let currentText = data.fullText;
                currentText = currentText.replace(/<think>[\s\S]*?(?:<\/think>)?/gi, '');
                const replyMatch = currentText.match(/<reply>([\s\S]*?)(?:<\/reply>)?/);
                if (replyMatch) {
                   fullReply = replyMatch[1];
                } else if (!currentText.includes("<reply>") && !currentText.includes("<profile>")) {
                   fullReply = currentText; 
                }
                setMessages(prev => prev.map(m => m.id === "temp_ai" ? { ...m, content: fullReply } : m));
              } else if (data.type === "done") {
                setMessages(prev => prev.map(m => m.id === "temp_ai" ? data.message : m));
                if (data.profile) setProfile(data.profile);
                setLoading(false);
                return;
              } else if (data.type === "error") {
                throw new Error(data.message);
              }
            } catch (e) {
               // ignore partial JSON parse error
            }
          }
        }
      }
    } catch (e: any) {
      console.error(e);
      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== tempId);
        return [...filtered, { role: "user", content: msg }, { id: `err_${Date.now()}`, role: "model", content: `⚠️ 抱歉，发生错误：\n${e.message}` }];
      });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReport = () => {
    setIsReportModalOpen(false);
    sendMessage(reportPrompt);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const adjustTextareaHeight = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  const profileFields = [
    { key: "skills", label: "技能 (你擅长什么？)" },
    { key: "interests", label: "兴趣 (你热爱什么？)" },
    { key: "time_budget", label: "时间预算 (每周能抽出多少小时？)" },
    { key: "finance_budget", label: "资金预算 (有多少资源可以投入？)" },
    { key: "unique_resources", label: "独特资源 (有什么别人没有的？)" },
    { key: "track_selection", label: "赛道选择 (想做什么领域？)" },
    { key: "monetization_method", label: "变现方式 (想怎么赚钱？)" },
    { key: "expected_income", label: "期望收入 (想赚多少钱？)" },
    { key: "target_audience", label: "人群画像 (最想把内容给谁看？)" },
    { key: "core_pain_points", label: "核心痛点 (他们最担心的是什么？)" },
    { key: "ultimate_desire", label: "终极渴望 (他们最想变成什么样的人？)" },
    { key: "platform_preference", label: "平台偏好 (倾向于在哪个平台做？)" },
  ];

  const greeting = readScopedConfig(activeAccountId, 'positioning', 'greeting') || "你好！我是账号定位专家。我们从你的技能和兴趣开始聊起吧？";

  const isProfileComplete = profileFields.every(f => profile[f.key] && String(profile[f.key]).trim() !== '');

  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 140px)' }}>
      {/* 聊天区域 */}
      <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
        <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--border-light)', marginBottom: 16 }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>账号定位助手</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>通过多轮对话，由 AI 引导您完成账号的梳理和定位。</p>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingRight: 8 }}>
          {messages.length === 0 && (
            <div className="empty-state" style={{ flex: 1, border: 'none' }}>
              <p>{greeting}</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={m.id || i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
              <div style={{
                background: m.role === 'user' ? 'var(--primary)' : 'var(--bg-hover)',
                color: m.role === 'user' ? 'white' : 'var(--text-main)',
                padding: '12px 16px',
                borderRadius: 'var(--radius-md)',
                borderBottomRightRadius: m.role === 'user' ? 0 : 'var(--radius-md)',
                borderBottomLeftRadius: m.role === 'user' ? 'var(--radius-md)' : 0,
                lineHeight: 1.5,
                fontSize: '0.95rem',
                whiteSpace: 'pre-wrap'
              }}>
                {m.role === 'model' ? <RichMessageContent content={m.content} /> : <RichMessageContent content={m.content} isUser />}
              </div>
              
              <div style={{ 
                display: 'flex', 
                justifyContent: m.role === 'user' ? 'flex-end' : 'space-between', 
                alignItems: 'center', 
                marginTop: 6, 
                fontSize: '0.75rem', 
                color: 'var(--text-muted)' 
              }}>
                {m.role === 'model' && (
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {m.latency_ms && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ fontSize: '10px' }}>⏱️</span> {(m.latency_ms / 1000).toFixed(1)}s</span>}
                    {m.total_tokens && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ fontSize: '10px' }}>🪙</span> {m.total_tokens} tokens</span>}
                  </div>
                )}
                {m.id && !m.id.startsWith('temp_') && !m.id.startsWith('err_') && (
                  <button 
                    onClick={() => handleDeleteMessage(m.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4, opacity: 0.6 }}
                    onMouseOver={e => e.currentTarget.style.opacity = '1'}
                    onMouseOut={e => e.currentTarget.style.opacity = '0.6'}
                    title="删除"
                  >
                    <Trash2 size={12} /> 删除
                  </button>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ alignSelf: 'flex-start', background: 'var(--bg-hover)', padding: '12px 16px', borderRadius: 'var(--radius-md)', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              正在思考...
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-light)', alignItems: 'flex-end' }}>
          <textarea 
            className="input-field" 
            style={{ 
              resize: 'none', 
              minHeight: '44px',
              maxHeight: '120px',
              overflowY: 'auto',
              lineHeight: '1.5',
              paddingTop: '10px',
              paddingBottom: '10px',
              borderRadius: 'var(--radius-md)'
            }}
            rows={1}
            placeholder="回复 AI... (Shift+Enter 换行)" 
            value={inputValue}
            onChange={adjustTextareaHeight}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <button 
            className="btn-primary" 
            style={{ 
              width: '44px', 
              height: '44px', 
              padding: 0, 
              flexShrink: 0, 
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }} 
            onClick={() => sendMessage()} 
            disabled={loading || !inputValue.trim()}
            title="发送 (Enter)"
          >
            <Send size={18} />
          </button>
        </div>
      </div>

      {/* 右侧客户档案 */}
      <div className="card" style={{ width: 320, display: 'flex', flexDirection: 'column', marginBottom: 0, padding: '20px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <UserCheck size={18} color="var(--primary)" /> 客户档案
          </h3>
          <button 
            className={isProfileComplete ? "btn-primary" : "btn-ghost"} 
            style={{ fontSize: '0.75rem', padding: '6px 10px', opacity: isProfileComplete ? 1 : 0.5, borderRadius: 'var(--radius-sm)' }}
            disabled={!isProfileComplete}
            onClick={() => setIsReportModalOpen(true)}
          >
            生成定位报告
          </button>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
          AI 会在对话过程中自动探测并提取关键信息，更新到下方档案中。
        </p>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {profileFields.map(f => (
            <div key={f.key} style={{ background: 'var(--bg-hover)', padding: '12px', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>{f.label}</div>
              <div style={{ fontSize: '0.9rem', color: profile[f.key] ? 'var(--text-main)' : 'var(--text-muted)', minHeight: 20 }}>
                {profile[f.key] || <span style={{ opacity: 0.5 }}>待完善...</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 生成报告的弹窗 */}
      <AnimatePresence>
        {isReportModalOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="card" 
              style={{ width: '600px', maxWidth: '90%', display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '90vh' }}
            >
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>生成账号定位报告</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                确认或修改下方的提示词，系统将结合左侧的客户档案信息发送给大模型，为您生成最终的账号定位报告。
              </p>
              <textarea 
                className="input-field" 
                style={{ flex: 1, minHeight: '300px', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: 1.5 }}
                value={reportPrompt}
                onChange={e => setReportPrompt(e.target.value)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
                <button className="btn-ghost" onClick={() => setIsReportModalOpen(false)}>取消</button>
                <button className="btn-primary" onClick={handleConfirmReport}>确认发送</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FreeChatView({ activeAccountId }: { activeAccountId: string }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [latestCitations, setLatestCitations] = useState<any[]>([]);
  const [mountedFile, setMountedFile] = useState<any>(null);
  const chatEndRef = React.useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  useEffect(() => {
    if (activeAccountId) {
      fetchChat();
      fetchMountedFile();
    }
  }, [activeAccountId]);

  const fetchChat = async () => {
    try {
      const res = await fetch(`/api/v1/projects/${activeAccountId}/free-chat`, {
        headers: { "X-API-Key": "demo-key" }
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.data?.items || []);
        setLatestCitations([]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchMountedFile = async () => {
    try {
      const res = await fetch(`/api/v1/projects/${activeAccountId}/context-file?module_key=free_chat`, {
        headers: { "X-API-Key": "demo-key" }
      });
      if (res.ok) {
        const data = await res.json();
        setMountedFile(data.data || null);
      } else {
        setMountedFile(null);
      }
    } catch (e) {
      console.error(e);
      setMountedFile(null);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!confirm("确定要删除这条消息吗？")) return;
    try {
      const res = await fetch(`/api/v1/projects/${activeAccountId}/free-chat/${messageId}`, {
        method: 'DELETE',
        headers: { "X-API-Key": "demo-key" }
      });
      if (res.ok) {
        setMessages(prev => prev.filter(m => m.id !== messageId));
      }
    } catch (e) {
      console.error(e);
      alert("删除失败");
    }
  };

  const sendMessage = async () => {
    const msg = inputValue.trim();
    if (!msg || loading) return;

    setInputValue("");
    const textarea = document.querySelector('.input-field[placeholder*="自由对话"]') as HTMLTextAreaElement;
    if (textarea) textarea.style.height = 'auto';

    setLoading(true);
    setLatestCitations([]);
    const tempId = `temp_${Date.now()}`;
    setMessages(prev => [...prev, { id: tempId, role: "user", content: msg }]);

    try {
      const savedModel = readScopedConfig(activeAccountId, 'free_chat', 'model') || "gpt-5.5";
      const savedPrompt = readScopedConfig(activeAccountId, 'free_chat', 'prompt') || "你是一个专业、友好、简洁的自由对话助手。请用中文与用户进行自然的多轮交流，优先给出清晰、可执行的回答。";
      const systemInstruction = savedPrompt;

      const res = await fetch(`/api/v1/projects/${activeAccountId}/free-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "demo-key"
        },
        body: JSON.stringify({ message: msg, systemInstruction, model: savedModel })
      });

      if (!res.ok) throw new Error("网络请求失败");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取流");
      const decoder = new TextDecoder("utf-8");

      let fullReply = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);
            if (data.type === "userMsg") {
              setMessages(prev => prev.map(m => m.id === tempId ? data.message : m));
              setMessages(prev => [...prev, { id: "temp_ai", role: "model", content: "" }]);
            } else if (data.type === "chunk") {
              fullReply = (data.fullText || "").replace(/<think>[\s\S]*?(?:<\/think>)?/gi, '');
              setMessages(prev => prev.map(m => m.id === "temp_ai" ? { ...m, content: fullReply } : m));
            } else if (data.type === "done") {
              setMessages(prev => prev.map(m => m.id === "temp_ai" ? data.message : m));
              setLatestCitations(data.citations || []);
              setLoading(false);
              return;
            } else if (data.type === "error") {
              throw new Error(data.message);
            }
          } catch (e) {
            // ignore partial JSON parse error
          }
        }
      }
    } catch (e: any) {
      console.error(e);
      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== tempId);
        return [...filtered, { role: "user", content: msg }, { id: `err_${Date.now()}`, role: "model", content: `⚠️ 抱歉，发生错误：\n${e.message}` }];
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const adjustTextareaHeight = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  const greeting = readScopedConfig(activeAccountId, 'free_chat', 'greeting') || "你好，我是自由对话助手。你可以直接和我聊任何想法、问题或任务。";

  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 140px)' }}>
      <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
        <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--border-light)', marginBottom: 16 }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>自由对话</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>支持多轮连续交流，适合临时咨询、头脑风暴、任务拆解与日常问答。</p>
          {mountedFile && (
            <div style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 999, background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.14)', fontSize: '0.82rem', color: 'var(--text-main)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)' }} />
              当前已挂载：{decodeDisplayFilename(mountedFile.filename)} · {Math.ceil((mountedFile.size_bytes || 0) / 1024)} KB
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingRight: 8 }}>
          {messages.length === 0 && (
            <div className="empty-state" style={{ flex: 1, border: 'none' }}>
              <p>{greeting}</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={m.id || i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
              <div style={{
                background: m.role === 'user' ? 'var(--primary)' : 'var(--bg-hover)',
                color: m.role === 'user' ? 'white' : 'var(--text-main)',
                padding: '12px 16px',
                borderRadius: 'var(--radius-md)',
                borderBottomRightRadius: m.role === 'user' ? 0 : 'var(--radius-md)',
                borderBottomLeftRadius: m.role === 'user' ? 'var(--radius-md)' : 0,
                lineHeight: 1.5,
                fontSize: '0.95rem',
                whiteSpace: 'pre-wrap'
              }}>
                {m.role === 'model' ? <RichMessageContent content={m.content} /> : <RichMessageContent content={m.content} isUser />}
              </div>

              <div style={{
                display: 'flex',
                justifyContent: m.role === 'user' ? 'flex-end' : 'space-between',
                alignItems: 'center',
                marginTop: 6,
                fontSize: '0.75rem',
                color: 'var(--text-muted)'
              }}>
                {m.role === 'model' && (
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {m.latency_ms && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ fontSize: '10px' }}>⏱️</span> {(m.latency_ms / 1000).toFixed(1)}s</span>}
                    {m.total_tokens && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ fontSize: '10px' }}>🪙</span> {m.total_tokens} tokens</span>}
                  </div>
                )}
                {m.id && !m.id.startsWith('temp_') && !m.id.startsWith('err_') && (
                  <button
                    onClick={() => handleDeleteMessage(m.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4, opacity: 0.6 }}
                    onMouseOver={e => e.currentTarget.style.opacity = '1'}
                    onMouseOut={e => e.currentTarget.style.opacity = '0.6'}
                    title="删除"
                  >
                    <Trash2 size={12} /> 删除
                  </button>
                )}
              </div>
              {m.role === 'model' && i === messages.length - 1 && latestCitations.length > 0 && (
                <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--bg-app)', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
                    {latestCitations.some((citation) => citation.full_document) ? '已挂载全文文件' : '已参考知识库'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {latestCitations.map((citation, idx) => (
                      <div key={`${citation.chunk_id || idx}`} style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        {idx + 1}. {decodeDisplayFilename(citation.source?.filename || '未知文件')}
                        {citation.full_document ? ' · 已完整挂载' : ''}
                        {!citation.full_document && citation.source?.locator?.para ? ` · 第${citation.source.locator.para}段` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div style={{ alignSelf: 'flex-start', background: 'var(--bg-hover)', padding: '12px 16px', borderRadius: 'var(--radius-md)', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              正在思考...
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-light)', alignItems: 'flex-end' }}>
          <textarea
            className="input-field"
            style={{
              resize: 'none',
              minHeight: '44px',
              maxHeight: '120px',
              overflowY: 'auto',
              lineHeight: '1.5',
              paddingTop: '10px',
              paddingBottom: '10px',
              borderRadius: 'var(--radius-md)'
            }}
            rows={1}
            placeholder="输入自由对话内容... (Shift+Enter 换行)"
            value={inputValue}
            onChange={adjustTextareaHeight}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <button
            className="btn-primary"
            style={{
              width: '44px',
              height: '44px',
              padding: 0,
              flexShrink: 0,
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onClick={() => sendMessage()}
            disabled={loading || !inputValue.trim()}
            title="发送 (Enter)"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

function TeardownView({ activeAccountId }: { activeAccountId: string }) {
  const [activeTab, setActiveTab] = useState<"link" | "local">("link");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [teardownData, setTeardownData] = useState<any>(null);

  const fetchHistory = async () => {
    if (!activeAccountId) return;
    try {
      const res = await fetch(`/api/v1/projects/${activeAccountId}/video-teardown`, {
        headers: { "X-API-Key": "demo-key" }
      });
      if (res.ok) {
        const data = await res.json();
        // 这里为了简单，我们只展示最近一次的记录，或者如果需要可以做历史列表
        if (data.data?.items?.length > 0) {
          setTeardownData(data.data.items[0]);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [activeAccountId]);

  const handleParse = async () => {
    if (!url) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projects/${activeAccountId}/video-teardown/parse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "demo-key"
        },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      if (res.ok && data.success !== false) {
        setTeardownData(data.data);
      } else {
        alert(data.message || data.error?.message || "解析失败");
      }
    } catch (e: any) {
      alert("解析异常: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const extractVideoFrame = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.src = URL.createObjectURL(file);
      video.onloadeddata = () => {
        video.currentTime = 0.5; 
      };
      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 360;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
        URL.revokeObjectURL(video.src);
      };
      video.onerror = () => {
        resolve('');
        URL.revokeObjectURL(video.src);
      };
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      try {
        const coverBase64 = await extractVideoFrame(file);
        if (coverBase64) {
          formData.append("cover_image", coverBase64);
        }
      } catch (err) {
        console.error("Frame extraction failed:", err);
      }
      
      const res = await fetch(`/api/v1/projects/${activeAccountId}/video-teardown/upload`, {
        method: "POST",
        headers: {
          "X-API-Key": "demo-key"
        },
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.success !== false) {
        setTeardownData(data.data);
      } else {
        alert(data.message || data.error?.message || "上传失败");
      }
    } catch (e: any) {
      alert("上传异常: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!teardownData || !teardownData.id) return;
    setAnalyzing(true);
    try {
      const savedModel = readScopedConfig(activeAccountId, 'teardown', 'model') || "gpt-5.5";
      const savedPrompt = readScopedConfig(activeAccountId, 'teardown', 'prompt') || "你是一个资深的视频内容拆解专家。请仔细分析提供的视频标题、内容、作者等信息，总结出这篇内容的钩子、结构、亮点和可复用模板。";
      const systemInstruction = savedPrompt;

      const res = await fetch(`/api/v1/projects/${activeAccountId}/video-teardown/${teardownData.id}/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "demo-key"
        },
        body: JSON.stringify({ systemInstruction, model: savedModel })
      });
      const data = await res.json();
      if (res.ok && data.success !== false) {
        setTeardownData(data.data);
      } else {
        alert(data.message || data.error?.message || "分析失败");
      }
    } catch (e: any) {
      alert("分析异常: " + e.message);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>视频内容拆解</h2>
        <p>通过上传视频链接或本地视频，自动解析并调用大模型进行深度内容拆解。</p>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, borderBottom: '1px solid var(--border-light)', paddingBottom: 12 }}>
          <button 
            className={`nav-item ${activeTab === "link" ? 'active' : ''}`}
            style={{ padding: '8px 16px', margin: 0, background: activeTab === "link" ? 'var(--bg-hover)' : 'transparent' }}
            onClick={() => setActiveTab("link")}
          >
            链接解析 (小红书/抖音)
          </button>
          <button 
            className={`nav-item ${activeTab === "local" ? 'active' : ''}`}
            style={{ padding: '8px 16px', margin: 0, background: activeTab === "local" ? 'var(--bg-hover)' : 'transparent' }}
            onClick={() => setActiveTab("local")}
          >
            上传本地视频
          </button>
        </div>

        {activeTab === "link" ? (
          <div className="form-row">
            <label>视频链接</label>
            <div style={{ display: 'flex', gap: 12 }}>
              <input 
                className="input-field" 
                style={{ flex: 1 }} 
                placeholder="例如: https://www.xiaohongshu.com/explore/..." 
                value={url}
                onChange={e => setUrl(e.target.value)}
              />
              <button className="btn-primary" onClick={handleParse} disabled={loading || !url}>
                {loading ? '解析中...' : '下载并解析'}
              </button>
            </div>
          </div>
        ) : (
          <div className="form-row">
            <label>选择本地视频</label>
            <div className="upload-area" style={{ padding: '32px', textAlign: 'center', border: '2px dashed var(--border-light)', borderRadius: 8, background: 'var(--bg-app)' }}>
              <UploadCloud size={32} color="var(--text-muted)" style={{ marginBottom: 12 }} />
              <div style={{ marginBottom: 16 }}>点击或拖拽视频文件到此处上传</div>
              <label className="btn-primary" style={{ cursor: 'pointer', display: 'inline-block' }}>
                <input type="file" accept="video/*" style={{ display: 'none' }} onChange={handleFileUpload} disabled={loading} />
                {loading ? '上传中...' : '上传视频'}
              </label>
              {loading && <div style={{ marginTop: 12, color: 'var(--accent)' }}>视频正在上传和处理中，请稍候...</div>}
            </div>
          </div>
        )}
      </div>

      {teardownData && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>解析结果</h3>
            <div style={{ display: 'flex', gap: 12 }}>
              {(teardownData.video_url || teardownData.local_video_path) && (
                <a 
                  href={teardownData.local_video_path || teardownData.video_url} 
                  target="_blank" 
                  rel="noreferrer" 
                  download
                  className="btn-ghost" 
                  style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <UploadCloud size={16} style={{ transform: 'rotate(180deg)' }} /> 下载视频
                </a>
              )}
              <button className="btn-primary" onClick={handleAnalyze} disabled={analyzing} style={{ background: 'var(--accent)', borderColor: 'var(--accent)' }}>
                <Sparkles size={16} /> {analyzing ? '分析中...' : '视频分析'}
              </button>
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {/* 左侧：封面或视频 */}
            <div style={{ width: '280px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {teardownData.cover_image && (
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>封面图</div>
                  <img src={teardownData.cover_image} alt="封面" style={{ width: '100%', borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border-light)' }} />
                </div>
              )}

            </div>

            {/* 右侧：信息与分析结果 */}
            <div style={{ flex: 1, minWidth: '300px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: 'var(--bg-app)', padding: 16, borderRadius: 8, border: '1px solid var(--border-light)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '8px 16px', fontSize: '0.9rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>标题：</span>
                  <span style={{ fontWeight: 600 }}>{teardownData.title}</span>
                  
                  <span style={{ color: 'var(--text-muted)' }}>作者：</span>
                  <span>{teardownData.user_name}</span>
                  
                  <span style={{ color: 'var(--text-muted)' }}>发布时间：</span>
                  <span>{teardownData.date_published}</span>
                  
                  <span style={{ color: 'var(--text-muted)' }}>内容描述：</span>
                  <span style={{ whiteSpace: 'pre-wrap', maxHeight: 100, overflowY: 'auto' }}>{teardownData.content}</span>
                </div>
              </div>

              {teardownData.ai_analysis && (
                <div className="result-box" style={{ flex: 1, background: 'var(--primary-light)', borderColor: 'var(--primary)', color: 'var(--text-main)' }}>
                  <h4 style={{ color: 'var(--primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Sparkles size={16} /> AI 拆解报告
                  </h4>
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: '0.95rem' }}>
                    {teardownData.ai_analysis}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HotView({ onUseKeyword }: { onUseKeyword: (kw: string) => void }) {
  return (
    <div>
      <div className="page-header">
        <h2>特定领域热点榜单</h2>
        <p>基于你的“职场效能”定位，系统抓取的近期小红书热门趋势。</p>
      </div>
      <div className="card">
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
              <th style={{ padding: '12px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>趋势关键词</th>
              <th style={{ padding: '12px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>热度指数</th>
              <th style={{ padding: '12px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>推荐切入角度</th>
              <th style={{ padding: '12px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {[
              { kw: "AI工作流", score: "9.8w", angle: "清单/测评" },
              { kw: "拒绝内卷", score: "8.5w", angle: "共鸣/观点" },
              { kw: "下班后的自我提升", score: "7.2w", angle: "Vlog/干货" }
            ].map(row => (
              <tr key={row.kw} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td style={{ padding: '16px 8px', fontWeight: 700 }}>#{row.kw}</td>
                <td style={{ padding: '16px 8px', color: 'var(--accent)' }}>🔥 {row.score}</td>
                <td style={{ padding: '16px 8px' }}><span className="badge">{row.angle}</span></td>
                <td style={{ padding: '16px 8px' }}>
                  <button className="btn-ghost" onClick={() => onUseKeyword(row.kw)}>去生成选题</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TopicsView({ onSelectTopic }: { onSelectTopic: (topic: any) => void }) {
  const [loading, setLoading] = useState(false);
  const [topics, setTopics] = useState<any[]>([]);

  const handleGen = async () => {
    setLoading(true);
    await sleep(1500);
    setTopics([
      { id: 1, title: "放弃无效加班！这3个AI工具让我每天准时闪人", status: "待创作", difficulty: "低", angle: "清单盘点" },
      { id: 2, title: "职场新人必看：如何用Notion搭建个人知识库？", status: "待创作", difficulty: "中", angle: "保姆教程" },
      { id: 3, title: "工作太满？教你一招“时间块管理法”", status: "已发布", difficulty: "中", angle: "方法论" },
    ]);
    setLoading(false);
  };

  return (
    <div>
      <div className="page-header">
        <h2>选题池</h2>
        <p>结合热点与你的账号内容支柱，批量生成高爆率选题。</p>
      </div>
      <div className="card">
        <div style={{ display: 'flex', gap: 12 }}>
          <input className="input-field" placeholder="输入灵感关键词，如：AI工具" style={{ flex: 1 }} />
          <button className="btn-primary" onClick={handleGen} disabled={loading}>
            <Flame size={16} /> 生成选题
          </button>
        </div>
      </div>

      {topics.length > 0 && (
        <div className="topic-grid">
          {topics.map(t => (
            <div key={t.id} className="topic-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span className={`badge ${t.status === '待创作' ? 'accent' : 'success'}`}>{t.status}</span>
                <span className="badge">难度: {t.difficulty}</span>
              </div>
              <h4>{t.title}</h4>
              <p>切入角度: {t.angle}</p>
              <button className="btn-primary" style={{ width: '100%' }} onClick={() => onSelectTopic(t)}>
                进入一体化编辑器 <ChevronRight size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EditorView({ activeAccountId, topic, onTopicChange }: { activeAccountId: string; topic: any; onTopicChange: (topic: any | null) => void }) {
  const [topics, setTopics] = useState<any[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [activeStepId, setActiveStepId] = useState(CONTENT_PRODUCTION_STEPS[0].id);
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [selectedModel, setSelectedModel] = useState("gpt-5.5");
  const [promptValue, setPromptValue] = useState("你是资深中文内容生产助手，请输出清晰、完整、可直接使用的内容。");
  const [inputDraft, setInputDraft] = useState("");
  const [resultDraft, setResultDraft] = useState("");
  const [savingInput, setSavingInput] = useState(false);
  const [savingResult, setSavingResult] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [statusText, setStatusText] = useState("");

  const activeStep = CONTENT_PRODUCTION_STEPS.find((item) => item.id === activeStepId) || CONTENT_PRODUCTION_STEPS[0];
  const selectedTopic = topics.find((item) => item.id === selectedTopicId) || null;

  const fetchTopics = async () => {
    if (!activeAccountId) return;
    try {
      setTopicsLoading(true);
      const res = await fetch(`/api/v1/projects/${activeAccountId}/topic-library`, {
        headers: { "X-API-Key": "demo-key" }
      });
      const payload = await readApiResponse(res);
      if (!res.ok || payload.json?.success === false || payload.json?.error) {
        throw new Error(payload.json?.message || payload.json?.error?.message || "加载选题库失败");
      }
      setTopics(payload.json?.data?.items || []);
    } catch (e) {
      console.error(e);
      setTopics([]);
    } finally {
      setTopicsLoading(false);
    }
  };

  useEffect(() => {
    fetchTopics();
  }, [activeAccountId]);

  useEffect(() => {
    const savedModel = readScopedConfig(activeAccountId, "content_production", "model");
    const savedPrompt = readScopedConfig(activeAccountId, "content_production", "prompt");
    setSelectedModel(savedModel || "gpt-5.5");
    setPromptValue(savedPrompt || "你是资深中文内容生产助手，请输出清晰、完整、可直接使用的内容。");
  }, [activeAccountId]);

  useEffect(() => {
    if (topic?.id) {
      setSelectedTopicId(topic.id);
      return;
    }
    if (!topics.length) {
      setSelectedTopicId("");
      onTopicChange(null);
      return;
    }
    if (selectedTopicId && topics.some((item) => item.id === selectedTopicId)) {
      return;
    }
    setSelectedTopicId(topics[0].id);
    onTopicChange(topics[0]);
  }, [topic, topics, selectedTopicId, onTopicChange]);

  useEffect(() => {
    if (!selectedTopic) {
      setInputDraft("");
      setResultDraft("");
      return;
    }
    setInputDraft(String(selectedTopic[activeStep.inputField] || ""));
    setResultDraft(String(selectedTopic[activeStep.resultField] || ""));
  }, [selectedTopic, activeStep]);

  const updateTopicInState = (updated: any) => {
    setTopics((prev) => prev.map((item) => item.id === updated.id ? updated : item));
    if (updated?.id === selectedTopicId) {
      onTopicChange(updated);
    }
  };

  const persistStepPatch = async (patch: Record<string, any>, savingKind: "input" | "result" | "both") => {
    if (!selectedTopic) return null;
    try {
      if (savingKind === "input" || savingKind === "both") setSavingInput(true);
      if (savingKind === "result" || savingKind === "both") setSavingResult(true);
      const res = await fetch(`/api/v1/projects/${activeAccountId}/topic-library/${selectedTopic.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "demo-key"
        },
        body: JSON.stringify(patch)
      });
      const payload = await readApiResponse(res);
      if (!res.ok || payload.json?.success === false || payload.json?.error) {
        throw new Error(payload.json?.message || payload.json?.error?.message || "保存失败");
      }
      const updated = payload.json?.data;
      if (updated) updateTopicInState(updated);
      return updated;
    } finally {
      setSavingInput(false);
      setSavingResult(false);
    }
  };

  const handleTopicSwitch = (nextTopic: any) => {
    setSelectedTopicId(nextTopic.id);
    onTopicChange(nextTopic);
    setStatusText("");
  };

  const handleModelChange = (nextModel: string) => {
    setSelectedModel(nextModel);
    writeScopedConfig(activeAccountId, "content_production", "model", nextModel);
    setStatusText("模型默认配置已保存");
  };

  const handlePromptBlur = () => {
    writeScopedConfig(activeAccountId, "content_production", "prompt", promptValue);
    setStatusText("提示词默认配置已保存");
  };

  const handleSaveInput = async () => {
    if (!selectedTopic) return;
    await persistStepPatch({ [activeStep.inputField]: inputDraft }, "input");
    setStatusText("当前流程输入内容已保存");
  };

  const handleSaveResult = async () => {
    if (!selectedTopic) return;
    await persistStepPatch({ [activeStep.resultField]: resultDraft }, "result");
    setStatusText("当前流程生成结果已保存");
  };

  const handleGenerate = async () => {
    if (!selectedTopic) return;
    try {
      setGenerating(true);
      setStatusText("");
      const res = await fetch(`/api/v1/projects/${activeAccountId}/topic-library/${selectedTopic.id}/content-production/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "demo-key"
        },
        body: JSON.stringify({
          stepId: activeStep.id,
          stepLabel: activeStep.title,
          systemInstruction: promptValue,
          model: selectedModel,
          inputContent: inputDraft
        })
      });
      const payload = await readApiResponse(res);
      if (!res.ok || payload.json?.success === false || payload.json?.error) {
        throw new Error(payload.json?.message || payload.json?.error?.message || "生成失败");
      }
      const nextResult = String(payload.json?.data?.result || "");
      setResultDraft(nextResult);
      await persistStepPatch({
        [activeStep.inputField]: inputDraft,
        [activeStep.resultField]: nextResult
      }, "both");
      setStatusText("已生成并保存当前流程结果");
    } catch (e: any) {
      console.error(e);
      alert(`内容生产异常：${e.message || "未知错误"}`);
    } finally {
      setGenerating(false);
    }
  };

  if (topicsLoading && !topics.length) {
    return (
      <div className="empty-state">
        <Edit size={48} />
        <h3>正在加载内容生产选题</h3>
        <p>稍等一下，正在读取当前账号的选题库。</p>
      </div>
    );
  }

  if (!selectedTopic) {
    return (
      <div className="empty-state">
        <Edit size={48} />
        <h3>还没有可生产的选题</h3>
        <p>请先去“选题库”新增选题，或在选题库列表里点击“进入内容生产”。</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h2>内容生产</h2>
        <p>围绕同一个选题，按 5 个流程分别推进；输入内容与生成结果都会按选题长期保存。</p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10 }}>选题切换</div>
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
              {topics.map((item) => (
                <button
                  key={item.id}
                  className={`nav-item ${selectedTopicId === item.id ? 'active' : ''}`}
                  style={{ width: 'auto', whiteSpace: 'nowrap', flexShrink: 0 }}
                  title={item.name || "未命名选题"}
                  onClick={() => handleTopicSwitch(item)}
                >
                  {truncateTopicTitle(item.name || "未命名选题")}
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--bg-app)', border: '1px solid var(--border-light)' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6 }}>当前选题</div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--primary)' }}>{selectedTopic.name || "未命名选题"}</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 6 }}>
              参考文案：{String(selectedTopic.ref_content || "").trim() ? truncateTopicTitle(String(selectedTopic.ref_content || ""), 36) : "暂无参考文案"}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10 }}>生产流程</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
              {CONTENT_PRODUCTION_STEPS.map((step) => (
                <button
                  key={step.id}
                  className={`nav-item ${activeStepId === step.id ? 'active' : ''}`}
                  style={{ justifyContent: 'center', minHeight: 42 }}
                  onClick={() => setActiveStepId(step.id)}
                >
                  {step.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.86rem', fontWeight: 700, marginBottom: 8 }}>模型选择</label>
              <select
                className="input-field"
                style={{ padding: '10px 12px', background: 'var(--bg-app)', cursor: 'pointer', appearance: 'auto' }}
                value={selectedModel}
                onChange={e => handleModelChange(e.target.value)}
              >
                <option value="gpt-5.4">gpt-5.4</option>
                <option value="gpt-5.5">gpt-5.5</option>
                <option value="claude-opus-4-6">claude-opus-4-6</option>
                <option value="claude-sonnet-4-6-thinking">claude-sonnet-4-6-thinking</option>
                <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
                <option value="gpts-gemini-3.1-pro-preview">gpts-gemini-3.1-pro-preview</option>
              </select>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 8 }}>
                当前模型会作为 5 个流程的默认模型，并自动保存。
              </p>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.86rem', fontWeight: 700, marginBottom: 8 }}>提示词配置</label>
              <textarea
                className="input-field"
                style={{ minHeight: 120 }}
                value={promptValue}
                onChange={e => setPromptValue(e.target.value)}
                onBlur={handlePromptBlur}
                placeholder="请输入内容生产默认提示词"
              />
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 8 }}>
                提示词对当前账号下全部选题、全部 5 个流程共用，离开输入框后自动保存。
              </p>
            </div>
          </div>

          {statusText ? (
            <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.12)', fontSize: '0.82rem', color: 'var(--primary)' }}>
              {statusText}
            </div>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <h3 style={{ margin: 0 }}>{activeStep.title} · 输入内容</h3>
                <button className="btn-ghost" onClick={handleSaveInput} disabled={savingInput}>
                  {savingInput ? "保存中..." : "保存输入"}
                </button>
              </div>
              <textarea
                className="input-field"
                style={{ minHeight: 320, resize: 'vertical' }}
                value={inputDraft}
                onChange={e => setInputDraft(e.target.value)}
                placeholder={activeStep.placeholder}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <h3 style={{ margin: 0 }}>{activeStep.title} · 生成结果</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-primary" onClick={handleGenerate} disabled={generating}>
                    <Sparkles size={15} /> {generating ? "生成中..." : "开始生成"}
                  </button>
                  <button className="btn-ghost" onClick={handleSaveResult} disabled={savingResult}>
                    {savingResult ? "保存中..." : "保存结果"}
                  </button>
                </div>
              </div>
              <textarea
                className="input-field"
                style={{ minHeight: 320, resize: 'vertical' }}
                value={resultDraft}
                onChange={e => setResultDraft(e.target.value)}
                placeholder="这里会显示当前流程的 AI 结果，你也可以继续手动修改。"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalyticsView() {
  return (
    <div>
      <div className="page-header">
        <h2>数据分析与复盘</h2>
        <p>通过导入小红书后台数据，分析爆款要素并沉淀复盘经验。</p>
      </div>
      <div className="card">
        <div className="form-row">
          <label>上传小红书数据报表 (CSV/Excel)</label>
          <input type="file" className="input-field" />
        </div>
        <button className="btn-primary">生成复盘报告</button>
        
        <div style={{ marginTop: 32, display: 'flex', gap: 20 }}>
          <div className="result-box" style={{ flex: 1, textAlign: 'center' }}>
            <h1 style={{ color: 'var(--accent)', fontSize: '2rem', margin: '16px 0' }}>12.5%</h1>
            <p className="text-muted">平均互动率</p>
          </div>
          <div className="result-box" style={{ flex: 2 }}>
            <h4>AI 诊断建议</h4>
            <p style={{ marginTop: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              分析发现，带有“清单盘点”和“干货教程”标签的笔记完播率比平均水平高 45%。建议下周增加该类话题比重，并在开头前 5 秒加快语速。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
