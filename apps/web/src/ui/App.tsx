import React, { useState, useEffect } from "react";
import { 
  Home, UserCheck, Scissors, Flame, ListTodo, Edit, MessageCircle,
  Database, LineChart, Settings, UploadCloud, X, ChevronRight, 
  CheckCircle2, Plus, Play, Image as ImageIcon, Copy, Sparkles, ChevronDown, Trash2, Send
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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
      { id: "hot", title: "热点榜单", icon: Flame },
      { id: "topics", title: "选题池", icon: ListTodo },
      { id: "editor", title: "内容编辑器", icon: Edit },
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

export default function App() {
  const [activeNav, setActiveNav] = useState("freeChat");
  const [activeTopic, setActiveTopic] = useState<any>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
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
    setActiveNav("editor");
  };

  const renderContent = () => {
    switch (activeNav) {
      case "freeChat": return <FreeChatView activeAccountId={activeAccountId} />;
      case "positioning": return <PositioningView activeAccountId={activeAccountId} />;
      case "teardown": return <TeardownView activeAccountId={activeAccountId} />;
      case "hot": return <HotView onUseKeyword={(kw) => { setActiveNav("topics"); }} />;
      case "topics": return <TopicsView onSelectTopic={handleTopicSelect} />;
      case "editor": return <EditorView topic={activeTopic} />;
      case "analytics": return <AnalyticsView />;
      case "config": return <ConfigView activeAccountId={activeAccountId} />;
      default: return <div className="empty-state">建设中...</div>;
    }
  };

  const currentNavItem = NAV_GROUPS.flatMap(g => g.items).find(i => i.id === activeNav);

  return (
    <div className="app-container">
      {/* 侧边栏 */}
      <aside className="sidebar">
        <div className="brand" style={{ marginBottom: 16 }}>
          <div className="brand-icon">
            <Edit size={22} />
          </div>
          <h1>自媒体助手</h1>
        </div>

        {/* 账号切换器 */}
        <div style={{ position: 'relative', marginBottom: 32, padding: '0 12px' }}>
          <button 
            onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px',
              background: 'var(--bg-hover)',
              border: '1px solid var(--border-light)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              color: 'var(--text-main)',
              fontWeight: 600,
              fontSize: '0.9rem'
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
                  <div style={{ padding: '8px 12px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-hover)', borderBottom: '1px solid var(--border-light)' }}>
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
                          padding: '12px',
                          cursor: 'pointer',
                          background: acc.id === activeAccountId ? 'var(--primary-light)' : 'transparent',
                          borderBottom: '1px solid var(--border-light)'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, overflow: 'hidden' }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: acc.id === activeAccountId ? 'var(--primary)' : 'transparent' }} />
                          <span style={{ fontSize: '0.9rem', color: acc.id === activeAccountId ? 'var(--primary)' : 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                      padding: '12px',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-main)',
                      fontSize: '0.85rem',
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

        <nav style={{ flex: 1, overflowY: 'auto' }}>
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="nav-group">
              <div className="nav-group-title">{group.label}</div>
              {group.items.map((item) => (
                <button 
                  key={item.id}
                  className={`nav-item ${activeNav === item.id ? 'active' : ''}`}
                  onClick={() => setActiveNav(item.id)}
                >
                  <item.icon size={18} strokeWidth={activeNav === item.id ? 2.5 : 2} />
                  {item.title}
                </button>
              ))}
            </div>
          ))}
        </nav>
        
        <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--border-light)' }}>
          <div className="nav-item" style={{ fontSize: '0.8rem', cursor: 'default' }}>
            <span style={{ color: 'var(--success)', display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'currentColor', marginRight: 8 }} />
            API Mock 模式运行中
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
  const [constraintValue, setConstraintValue] = useState("");
  const [greetingValue, setGreetingValue] = useState("");
  const [fileName, setFileName] = useState("");
  const [selectedModel, setSelectedModel] = useState("claude-opus-4-6");
  const [fileStatus, setFileStatus] = useState("");
  const [uploading, setUploading] = useState(false);

  const configOptions = [
    { id: "free_chat", title: "自由对话" },
    { id: "positioning", title: "账号定位生成" },
    { id: "teardown", title: "视频内容拆解" },
    { id: "topics", title: "选题池生成" },
    { id: "title", title: "标题生成" },
    { id: "hook", title: "开头 (Hook) 生成" },
    { id: "body", title: "正文与脚本填充" },
    { id: "analytics", title: "数据复盘诊断" },
  ];

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
      setSelectedModel("claude-opus-4-6");
    }

    const savedPrompt = readScopedConfig(activeAccountId, activeTab, "prompt");
    if (savedPrompt !== null) {
      setPromptValue(savedPrompt);
    } else {
      setPromptValue(`作为资深的【${configOptions.find(o => o.id === activeTab)?.title}】专家...\n1. 语气要求：专业、真诚、不爹味\n2. 格式要求：严格遵循输出结构...`);
    }

    const savedConstraint = readScopedConfig(activeAccountId, activeTab, "constraint");
    if (savedConstraint !== null) {
      setConstraintValue(savedConstraint);
    } else {
      setConstraintValue("必须包含具体的数字指标，结尾不要加多余的问候语。");
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
    writeScopedConfig(activeAccountId, activeTab, "constraint", constraintValue);
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

  return (
    <div>
      <div className="page-header">
        <h2>系统配置中心</h2>
        <p>为每个功能模块单独配置系统提示词 (System Prompt)、预设参数与专属知识库约束。</p>
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
              <option value="claude-opus-4-6">claude-opus-4-6</option>
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

          <div className="form-row">
            <label>个性化偏好约束 (User Prompt 补充)</label>
            <input 
              className="input-field" 
              value={constraintValue}
              onChange={e => setConstraintValue(e.target.value)}
            />
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
      const savedModel = readScopedConfig(activeAccountId, 'positioning', 'model') || "claude-opus-4-6";
      const savedPrompt = readScopedConfig(activeAccountId, 'positioning', 'prompt') || "你是一个资深的自媒体账号定位专家。你的目标是和用户对话，帮他们梳理出账号的赛道、人设和内容支柱。";
      const savedConstraint = readScopedConfig(activeAccountId, 'positioning', 'constraint') || "";
      
      const systemInstruction = savedPrompt + (savedConstraint ? `\n\n用户补充的偏好约束：\n${savedConstraint}` : "");

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
                {m.content}
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
      const savedModel = readScopedConfig(activeAccountId, 'free_chat', 'model') || "claude-opus-4-6";
      const savedPrompt = readScopedConfig(activeAccountId, 'free_chat', 'prompt') || "你是一个专业、友好、简洁的自由对话助手。请用中文与用户进行自然的多轮交流，优先给出清晰、可执行的回答。";
      const savedConstraint = readScopedConfig(activeAccountId, 'free_chat', 'constraint') || "";
      const systemInstruction = savedPrompt + (savedConstraint ? `\n\n用户补充的偏好约束：\n${savedConstraint}` : "");

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
                {m.content}
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
      const savedModel = readScopedConfig(activeAccountId, 'teardown', 'model') || "claude-opus-4-6";
      const savedPrompt = readScopedConfig(activeAccountId, 'teardown', 'prompt') || "你是一个资深的视频内容拆解专家。请仔细分析提供的视频标题、内容、作者等信息，总结出这篇内容的钩子、结构、亮点和可复用模板。";
      const savedConstraint = readScopedConfig(activeAccountId, 'teardown', 'constraint') || "";
      const systemInstruction = savedPrompt + (savedConstraint ? `\n\n补充要求：\n${savedConstraint}` : "");

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

function EditorView({ topic }: { topic: any }) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState({ title: "", hook: "", body: "", cover: false });
  const [loading, setLoading] = useState(false);

  if (!topic) {
    return (
      <div className="empty-state">
        <Edit size={48} />
        <h3>未选择选题</h3>
        <p>请先在“选题池”中选择一个选题进行创作。</p>
      </div>
    );
  }

  const simulateGen = async (field: string, val: string, nextStep: number) => {
    setLoading(true);
    await sleep(1500);
    setData(prev => ({ ...prev, [field]: val }));
    setStep(nextStep);
    setLoading(false);
  };

  return (
    <div>
      <div className="page-header">
        <h2>一体化内容编辑器</h2>
        <p>当前选题：<strong style={{ color: 'var(--primary)' }}>{topic.title}</strong></p>
      </div>

      {/* 第一步：标题 */}
      <div className={`editor-section ${step >= 1 ? 'active' : ''}`}>
        <div className="editor-section-header">
          <h3>1. 爆款标题候选</h3>
          {step === 1 && (
            <button className="btn-ghost" onClick={() => simulateGen('title', "1. 别再瞎忙了！打工人必备的3个“王炸”AI工具🔥\n2. 偷偷变卷：让我按时下班的隐藏神器🤫\n3. 建议收藏！小白也能看懂的AI提效攻略", 2)}>
              <Sparkles size={14} /> 生成标题
            </button>
          )}
        </div>
        {data.title && <div className="result-box">{data.title}</div>}
      </div>

      {/* 第二步：开头 */}
      <div className={`editor-section ${step >= 2 ? 'active' : ''}`} style={{ opacity: step >= 2 ? 1 : 0.5 }}>
        <div className="editor-section-header">
          <h3>2. 黄金三秒开头 (Hook)</h3>
          {step === 2 && (
            <button className="btn-ghost" onClick={() => simulateGen('hook', "“你是不是也经常这样：找资料2小时，写PPT3小时，最后排版还要搞半天？别滑走，今天分享的这3个神仙工具，能让你直接把工作效率提升3倍！”", 3)}>
              <Sparkles size={14} /> 生成开头
            </button>
          )}
        </div>
        {data.hook && <div className="result-box">{data.hook}</div>}
      </div>

      {/* 第三步：正文填充 */}
      <div className={`editor-section ${step >= 3 ? 'active' : ''}`} style={{ opacity: step >= 3 ? 1 : 0.5 }}>
        <div className="editor-section-header">
          <h3>3. 正文/脚本填充</h3>
          {step === 3 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost" onClick={() => simulateGen('body', "正文块1：痛点引入...\n正文块2：工具A演示...\n正文块3：工具B演示...\n结尾CTA：你平时都用什么工具？评论区见！", 4)}>
                直接生成
              </button>
              <button className="btn-primary" onClick={() => simulateGen('body', "[引用知识库: 效率工具清单.pdf]\n正文块1：根据知识库，推荐Notion...\n正文块2：推荐ChatGPT...\n结尾CTA：点赞收藏不迷路！", 4)}>
                <Database size={14} /> 结合 RAG 生成
              </button>
            </div>
          )}
        </div>
        {data.body && <div className="result-box">{data.body}</div>}
      </div>

      {/* 第四步：封面 */}
      <div className={`editor-section ${step >= 4 ? 'active' : ''}`} style={{ opacity: step >= 4 ? 1 : 0.5, borderLeftColor: 'transparent' }}>
        <div className="editor-section-header">
          <h3>4. 模板化封面渲染</h3>
          {step === 4 && (
            <button className="btn-primary" onClick={() => simulateGen('cover', "done", 5)}>
              <ImageIcon size={14} /> 一键渲染 8 套模板
            </button>
          )}
        </div>
        {data.cover && (
          <div className="cover-grid">
            {[1,2,3,4].map(i => (
              <div key={i} className="cover-item">
                <img src={`https://placehold.co/300x400/1890ff/ffffff?text=Template+0${i}`} alt={`Tpl ${i}`} />
                <div className="overlay">
                  <button className="btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>采用此封面</button>
                </div>
              </div>
            ))}
          </div>
        )}
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
