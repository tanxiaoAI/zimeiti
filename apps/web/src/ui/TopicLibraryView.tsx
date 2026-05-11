import React, { useState, useEffect } from "react";
import { Plus, Settings, Trash2, FileText, Loader2, Sparkles, Link2 } from 'lucide-react';
import { apiGet, apiPost, apiPut, apiDelete } from './api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';

const MODEL_OPTIONS = [
  "gpt-5.4",
  "gpt-5.5",
  "claude-opus-4-6",
  "claude-sonnet-4-6-thinking",
  "gemini-3-flash-preview",
  "gpts-gemini-3.1-pro-preview"
];

const TOPIC_LIBRARY_PROMPT_FALLBACK = "你是一个资深自媒体内容分析师，请对提供的文案进行深度拆解分析。";
const TOPIC_LIBRARY_DEFAULT_MODELS = ["gpt-5.5", "claude-opus-4-6", "gpts-gemini-3.1-pro-preview"];
const ANALYSIS_RESULT_FIELDS = ["ai_analysis_1", "ai_analysis_2", "ai_analysis_3"] as const;

type TopicAiResultEntry = {
  model: string;
  result: string | null;
  error: string | null;
  usage?: any;
  estimated_cost_usd?: number | null;
  api_mode?: string;
  agreed?: boolean;
};

type TopicAnalysisJobState = {
  analyzing: boolean;
  results: TopicAiResultEntry[];
};

function getTopicLibraryConfigKey(accountId: string, field: string) {
  return `topic_library:${accountId}:${field}`;
}

function readTopicLibraryConfig(accountId: string, field: string) {
  if (!accountId) return "";
  return localStorage.getItem(getTopicLibraryConfigKey(accountId, field)) || "";
}

function writeTopicLibraryConfig(accountId: string, field: string, value: string) {
  if (!accountId) return;
  localStorage.setItem(getTopicLibraryConfigKey(accountId, field), value);
}

function formatDateTime(isoStr: string) {
  if (!isoStr) return "";
  const str = isoStr.endsWith('Z') ? isoStr : isoStr.replace(' ', 'T') + 'Z';
  const d = new Date(str);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatLinkPreview(value: string, placeholder: string) {
  const raw = String(value || "").trim();
  if (!raw) return placeholder;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/^www\./i, "");
    const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
    const compactPath = path.length > 18 ? `${path.slice(0, 18)}...` : path;
    return `${host}${compactPath}` || host || raw;
  } catch (error) {
    return raw.length > 24 ? `${raw.slice(0, 24)}...` : raw;
  }
}


function parseStoredTopicAnalysisResult(fallbackModel: string, value: string | null | undefined) {
  if (!value) return null;
  const text = String(value);
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && ("result" in parsed || "error" in parsed)) {
      return {
        model: parsed.model || fallbackModel,
        result: typeof parsed.result === "string" ? parsed.result : "",
        error: parsed.error ? String(parsed.error) : null,
        usage: parsed.usage,
        estimated_cost_usd: typeof parsed.estimated_cost_usd === "number" ? parsed.estimated_cost_usd : null,
        api_mode: parsed.api_mode ? String(parsed.api_mode) : undefined,
        agreed: Boolean(parsed.agreed)
      } as TopicAiResultEntry;
    }
  } catch (e) {
    // keep backward compatibility with plain text storage
  }
  if (/^API Error:/i.test(text) || /balance is insufficient/i.test(text) || /^Error:/i.test(text)) {
    return { model: fallbackModel, result: "", error: text } as TopicAiResultEntry;
  }
  return { model: fallbackModel, result: text, error: null } as TopicAiResultEntry;
}

function buildExtractDebugText(debug: any) {
  if (!debug) return "";
  const parserLine = debug?.parser?.ok
    ? `1. GetOne解析成功${debug?.parser?.parser ? `：${debug.parser.parser}` : ""}`
    : `1. GetOne解析失败：${debug?.parser?.error || "未知错误"}`;
  const mirrorLine = debug?.mirror?.ok
    ? `2. 视频已下载到服务器(${debug?.mirror?.method || "unknown"})：${debug?.mirror?.mirroredMediaUrl || "已生成镜像地址"}`
    : `2. 视频未下载到服务器：${debug?.mirror?.error || "未知错误"}`;
  const asrLine = debug?.asr?.ok
    ? "3. 火山ASR解析成功"
    : `3. 火山ASR解析失败：${debug?.asr?.error || debug?.asr?.finalStatusMessage || "未知错误"}`;
  return [parserLine, mirrorLine, asrLine].join("\n");
}

function stringifyTopicAnalysisResult(entry: TopicAiResultEntry | undefined) {
  if (!entry) return "";
  return JSON.stringify({
    model: entry.model,
    result: entry.result || "",
    error: entry.error || null,
    usage: entry.usage || null,
    estimated_cost_usd: entry.estimated_cost_usd ?? null,
    api_mode: entry.api_mode || null,
    agreed: Boolean(entry.agreed)
  });
}

function normalizeTopicModels(input: unknown) {
  const fallback = [...TOPIC_LIBRARY_DEFAULT_MODELS];
  if (!Array.isArray(input)) return fallback;
  const next = input
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 3);
  return next.length > 0 ? next : fallback;
}

function getNextTopicModel(currentModels: string[]) {
  return MODEL_OPTIONS.find((option) => !currentModels.includes(option)) || MODEL_OPTIONS[0];
}

function buildStoredAnalysisResults(topic: any, targetModels: string[]) {
  return ANALYSIS_RESULT_FIELDS.map((field, index) => {
    const fallbackModel = targetModels[index] || targetModels[targetModels.length - 1] || TOPIC_LIBRARY_DEFAULT_MODELS[0];
    return parseStoredTopicAnalysisResult(fallbackModel, topic?.[field]);
  }).filter(Boolean) as TopicAiResultEntry[];
}

function EditableInput({ value, onChange, placeholder, style, className }: any) {
  const [localValue, setLocalValue] = useState(value || "");
  
  useEffect(() => {
    setLocalValue(value || "");
  }, [value]);

  return (
    <input 
      className={className} 
      style={style} 
      value={localValue} 
      onChange={e => setLocalValue(e.target.value)} 
      onBlur={() => {
        if (localValue !== value) onChange(localValue);
      }}
      placeholder={placeholder}
    />
  );
}

function CompactTagSelect({ value, options, placeholder, onChange }: any) {
  const current = options.find((item: any) => item.value === value);
  const shorten = (text: string) => {
    if (!text) return text;
    return text.length > 4 ? `${text.slice(0, 4)}...` : text;
  };

  return (
    <Select value={value || ""} onValueChange={onChange}>
      <SelectTrigger className="topic-library-tag-trigger shadow-none">
        {current ? (
          <span
            className="topic-library-tag"
            style={{
              backgroundColor: `${current.color || "#CBD5E1"}22`,
              color: current.color || "#475569",
              borderColor: `${current.color || "#CBD5E1"}55`
            }}
            title={current.value}
          >
            {shorten(current.value)}
          </span>
        ) : (
          <span className="topic-library-tag topic-library-tag-empty">{placeholder}</span>
        )}
      </SelectTrigger>
      <SelectContent>
        {options.map((item: any) => (
          <SelectItem key={item.id} value={item.value}>
            <span
              className="topic-library-tag"
              style={{
                backgroundColor: `${item.color || "#CBD5E1"}22`,
                color: item.color || "#475569",
                borderColor: `${item.color || "#CBD5E1"}55`
              }}
              title={item.value}
            >
              {shorten(item.value)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ExpandableTextCell({
  value,
  placeholder,
  onChange,
  className,
  style,
  multiline = true,
  isLink = false,
  displayValue
}: any) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  useEffect(() => {
    setDraft(value || "");
  }, [value]);

  const saveAndClose = () => {
    if (draft !== value) onChange(draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="topic-library-expand-cell">
        {multiline ? (
          <textarea
            autoFocus
            className={`input-field topic-library-input topic-library-input-expanded ${className || ""}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveAndClose}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                saveAndClose();
              }
            }}
            style={style}
          />
        ) : (
          <input
            autoFocus
            className={`input-field topic-library-input topic-library-input-expanded ${className || ""}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveAndClose}
            style={style}
          />
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`topic-library-text-preview ${className || ""}`}
      style={style}
      onClick={() => setEditing(true)}
      title={value || placeholder}
    >
      {isLink && value ? <Link2 size={12} className="topic-library-link-icon" /> : null}
      <span>{displayValue || value || placeholder}</span>
    </button>
  );
}

export function TopicLibraryView({ activeAccountId, onEnterProduction, productionTopicIds = [] }: { activeAccountId: string; onEnterProduction?: (topic: any) => void; productionTopicIds?: string[] }) {
  const [topics, setTopics] = useState<any[]>([]);
  const [options, setOptions] = useState<{ judgment_result: any[], source: any[] }>({ judgment_result: [], source: [] });
  const [optionModal, setOptionModal] = useState<string | null>(null);
  const [copyDrawer, setCopyDrawer] = useState<any | null>(null);
  const [aiDrawer, setAiDrawer] = useState<any | null>(null);
  const [topicAnalysisJobs, setTopicAnalysisJobs] = useState<Record<string, TopicAnalysisJobState>>({});
  const [analysisConfigOpen, setAnalysisConfigOpen] = useState(false);
  const [newOption, setNewOption] = useState({ value: "", color: "#3B82F6" });
  const [topicPromptDraft, setTopicPromptDraft] = useState(TOPIC_LIBRARY_PROMPT_FALLBACK);
  const [topicPrompt, setTopicPrompt] = useState(TOPIC_LIBRARY_PROMPT_FALLBACK);
  const [topicModels, setTopicModels] = useState<string[]>(TOPIC_LIBRARY_DEFAULT_MODELS);
  const [draggingTopicId, setDraggingTopicId] = useState<string | null>(null);
  const [dragOverTopicId, setDragOverTopicId] = useState<string | null>(null);
  const dragStartTopicsRef = React.useRef<any[] | null>(null);
  const dragDroppedRef = React.useRef(false);

  const fetchTopics = async () => {
    if (!activeAccountId) return;
    try {
      const data: any = await apiGet(`/api/v1/projects/${activeAccountId}/topic-library`, "demo-key");
      setTopics(data.items || []);
    } catch (e) {
      console.error(e);
    }
  };

  const applyUpdatedTopic = (updated: any) => {
    if (!updated?.id) return;
    setTopics(prev => prev.map(item => item.id === updated.id ? updated : item));
    setCopyDrawer(prev => (prev && prev.id === updated.id) ? updated : prev);
    setAiDrawer(prev => (prev && prev.id === updated.id) ? updated : prev);
  };

  const moveTopicItems = (items: any[], activeId: string, overId: string) => {
    const activeIndex = items.findIndex((item) => item.id === activeId);
    const overIndex = items.findIndex((item) => item.id === overId);
    if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) return items;
    const next = [...items];
    const [moved] = next.splice(activeIndex, 1);
    next.splice(overIndex, 0, moved);
    return next;
  };

  const resetTopicDragState = () => {
    setDraggingTopicId(null);
    setDragOverTopicId(null);
    dragStartTopicsRef.current = null;
    dragDroppedRef.current = false;
  };

  const fetchOptions = async (field: string) => {
    if (!activeAccountId) return;
    try {
      const data: any = await apiGet(`/api/v1/projects/${activeAccountId}/topic-options?field=${field}`, "demo-key");
      setOptions(prev => ({ ...prev, [field]: data.items || [] }));
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchTopics();
    fetchOptions('judgment_result');
    fetchOptions('source');
  }, [activeAccountId]);

  useEffect(() => {
    if (!activeAccountId) return;
    const savedPrompt = readTopicLibraryConfig(activeAccountId, "prompt") || TOPIC_LIBRARY_PROMPT_FALLBACK;
    const savedModelsRaw = readTopicLibraryConfig(activeAccountId, "models");
    let savedModels = [...TOPIC_LIBRARY_DEFAULT_MODELS];
    if (savedModelsRaw) {
      try {
        const parsed = JSON.parse(savedModelsRaw);
        savedModels = normalizeTopicModels(parsed);
      } catch (e) {
        // ignore invalid persisted config
      }
    }
    setTopicPrompt(savedPrompt);
    setTopicPromptDraft(savedPrompt);
    setTopicModels(savedModels);
  }, [activeAccountId]);

  const identifyPlatform = (url: string) => {
    if (!url) return "无匹配类别";
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes("douyin.com")) return "抖音";
    if (lowerUrl.includes("bilibili.com")) return "B站";
    if (lowerUrl.includes("xiaohongshu.com")) return "小红书";
    if (lowerUrl.includes("zhihu.com")) return "知乎";
    return "无匹配类别";
  };

  const handleAddRecord = async () => {
    try {
      await apiPost(`/api/v1/projects/${activeAccountId}/topic-library`, { name: "新建选题" }, "demo-key");
      fetchTopics();
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateRecord = async (id: string, field: string, value: string) => {
    try {
      const payload: any = { [field]: value };
      if (field === 'ref_link') {
        payload.ref_platform = identifyPlatform(value);
      }
      
      const updated: any = await apiPut(`/api/v1/projects/${activeAccountId}/topic-library/${id}`, payload, "demo-key");
      applyUpdatedTopic(updated);
    } catch (e) {
      console.error(e);
    }
  };

  const handleBatchUpdateRecord = async (id: string, payload: Record<string, any>) => {
    try {
      const updated: any = await apiPut(`/api/v1/projects/${activeAccountId}/topic-library/${id}`, payload, "demo-key");
      applyUpdatedTopic(updated);
      return updated;
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  const handleDeleteRecord = async (id: string) => {
    if (!confirm("确认删除该选题？")) return;
    try {
      await apiDelete(`/api/v1/projects/${activeAccountId}/topic-library/${id}`, "demo-key");
      fetchTopics();
    } catch (e) {
      console.error(e);
    }
  };

  const persistTopicLibraryOrder = async (nextTopics: any[], fallbackTopics: any[]) => {
    setTopics(nextTopics);
    try {
      const data: any = await apiPost(`/api/v1/projects/${activeAccountId}/topic-library/reorder`, {
        orderedIds: nextTopics.map((item) => item.id)
      }, "demo-key");
      setTopics(data.items || nextTopics);
    } catch (e: any) {
      console.error(e);
      setTopics(fallbackTopics);
      alert(`排序保存失败：${e?.message || "未知错误"}`);
    }
  };

  const handleTopicDragStart = (event: React.DragEvent, topicId: string) => {
    dragStartTopicsRef.current = topics;
    dragDroppedRef.current = false;
    setDraggingTopicId(topicId);
    setDragOverTopicId(topicId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", topicId);
  };

  const handleTopicDragEnter = (topicId: string) => {
    if (!draggingTopicId || draggingTopicId === topicId) return;
    setDragOverTopicId(topicId);
    setTopics((prev) => moveTopicItems(prev, draggingTopicId, topicId));
  };

  const handleTopicDrop = async (topicId: string) => {
    if (!draggingTopicId) return;
    dragDroppedRef.current = true;
    const fallbackTopics = dragStartTopicsRef.current || topics;
    const nextTopics = moveTopicItems(topics, draggingTopicId, topicId);
    await persistTopicLibraryOrder(nextTopics, fallbackTopics);
    resetTopicDragState();
  };

  const handleTopicDragEnd = () => {
    if (!dragDroppedRef.current && dragStartTopicsRef.current) {
      setTopics(dragStartTopicsRef.current);
    }
    resetTopicDragState();
  };

  const handleAddOption = async (field: string) => {
    if (!newOption.value.trim()) return;
    try {
      await apiPost(`/api/v1/projects/${activeAccountId}/topic-options`, { field, value: newOption.value, color: newOption.color }, "demo-key");
      fetchOptions(field);
      setNewOption({ value: "", color: "#3B82F6" });
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateOption = async (field: string, id: string, value: string, color: string) => {
    try {
      await apiPut(`/api/v1/projects/${activeAccountId}/topic-options/${id}`, { value, color }, "demo-key");
      fetchOptions(field);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteOption = async (field: string, id: string) => {
    try {
      await apiDelete(`/api/v1/projects/${activeAccountId}/topic-options/${id}`, "demo-key");
      fetchOptions(field);
    } catch (e) {
      console.error(e);
    }
  };

  const saveTopicAnalysisPrompt = () => {
    const next = topicPromptDraft.trim() || TOPIC_LIBRARY_PROMPT_FALLBACK;
    setTopicPrompt(next);
    writeTopicLibraryConfig(activeAccountId, "prompt", next);
    setAnalysisConfigOpen(false);
  };

  const persistTopicModels = (nextModels: string[]) => {
    const normalized = normalizeTopicModels(nextModels);
    setTopicModels(normalized);
    writeTopicLibraryConfig(activeAccountId, "models", JSON.stringify(normalized));
  };

  const updateTopicAnalysisJob = (topicId: string, updater: (prev: TopicAnalysisJobState | undefined) => TopicAnalysisJobState) => {
    setTopicAnalysisJobs(prev => ({
      ...prev,
      [topicId]: updater(prev[topicId])
    }));
  };

  const startTopicAnalysis = async (topic: any) => {
    if (!topic?.id) return;
    const storedResults = buildStoredAnalysisResults(topic, topicModels);
    const nextRefContent = String(topic.ref_content || "").trim() || "无";

    updateTopicAnalysisJob(topic.id, (prev) => ({
      analyzing: true,
      results: prev?.results?.length ? prev.results : storedResults
    }));

    try {
      if (!String(topic.ref_content || "").trim()) {
        if (typeof handleBatchUpdateRecord === "function") {
          await handleBatchUpdateRecord(topic.id, { ref_content: nextRefContent });
        } else {
          await handleUpdateRecord(topic.id, "ref_content", nextRefContent);
        }
      }

      let data: any;
      try {
        data = await apiPost(`/api/v1/projects/${activeAccountId}/topic-library/analyze`, {
          systemInstruction: topicPrompt,
          models: topicModels,
          topicName: topic.name,
          refContent: nextRefContent
        }, "demo-key");
      } catch (error: any) {
        const message = String(error?.message || "");
        if (!/缺少文案内容/.test(message)) {
          throw error;
        }
        data = await apiPost(`/api/v1/projects/${activeAccountId}/topic-library/analyze`, {
          systemInstruction: topicPrompt,
          models: topicModels,
          topicName: topic.name,
          refContent: "无"
        }, "demo-key");
      }

      if (!data?.results) {
        throw new Error("分析失败");
      }

      const nextResults = (data.results || []).map((entry: TopicAiResultEntry, index: number) => ({
        ...entry,
        model: entry?.model || topicModels[index]
      }));

      updateTopicAnalysisJob(topic.id, () => ({
        analyzing: false,
        results: nextResults
      }));

      const payload = {
        ai_analysis_1: stringifyTopicAnalysisResult(nextResults[0]),
        ai_analysis_2: stringifyTopicAnalysisResult(nextResults[1]),
        ai_analysis_3: stringifyTopicAnalysisResult(nextResults[2])
      };

      if (typeof handleBatchUpdateRecord === "function") {
        await handleBatchUpdateRecord(topic.id, payload);
      } else {
        await handleUpdateRecord(topic.id, 'ai_analysis_1', payload.ai_analysis_1);
        await handleUpdateRecord(topic.id, 'ai_analysis_2', payload.ai_analysis_2);
        await handleUpdateRecord(topic.id, 'ai_analysis_3', payload.ai_analysis_3);
      }
    } catch (e: any) {
      updateTopicAnalysisJob(topic.id, (prev) => ({
        analyzing: false,
        results: prev?.results?.length ? prev.results : storedResults
      }));
      alert("分析异常: " + (e?.message || "未知错误"));
    }
  };

  const persistAgreeModel = async (topicId: string, agreedModel: string) => {
    const topic = topics.find((item) => item.id === topicId);
    if (!topic) return;
    const storedResults = buildStoredAnalysisResults(topic, topicModels);
    const nextResults = topicModels.map((model, index) => {
      const entry = storedResults[index] || storedResults.find((it) => it.model === model) || { model, result: "", error: null };
      return { ...entry, model, agreed: entry.model === agreedModel ? !entry.agreed : false } as TopicAiResultEntry;
    });
    updateTopicAnalysisJob(topicId, () => ({
      analyzing: false,
      results: nextResults
    }));
    const payload = {
      ai_analysis_1: stringifyTopicAnalysisResult(nextResults[0]),
      ai_analysis_2: stringifyTopicAnalysisResult(nextResults[1]),
      ai_analysis_3: stringifyTopicAnalysisResult(nextResults[2])
    };
    if (typeof handleBatchUpdateRecord === "function") {
      await handleBatchUpdateRecord(topicId, payload);
    } else {
      await handleUpdateRecord(topicId, 'ai_analysis_1', payload.ai_analysis_1);
      await handleUpdateRecord(topicId, 'ai_analysis_2', payload.ai_analysis_2);
      await handleUpdateRecord(topicId, 'ai_analysis_3', payload.ai_analysis_3);
    }
  };

  return (
    <div>
      <div className="page-header flex justify-between items-start mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">选题库</h2>
          </div>
          <p className="text-muted-foreground text-xs">以多维表格形式管理选题，支持参考文案提取与多模型 AI 分析。</p>
        </div>
        <Button size="sm" className="topic-library-add-btn topic-primary-btn" onClick={handleAddRecord}>
          <Plus size={14} className="mr-1.5" /> 新增选题
        </Button>
      </div>

      <div className="card topic-library-card">
        <Table containerClassName="topic-library-table-scroll" className="topic-library-table">
          <TableHeader>
            <TableRow>
              <TableHead className="topic-library-drag-head sticky-drag-col" style={{ width: 34 }} />
              <TableHead className="sticky-col-left" style={{ width: 180 }}>选题名称</TableHead>
              <TableHead style={{ width: 92 }}>
                <div className="topic-library-head-inline">
                  人工判断结果
                  <Button variant="ghost" size="icon" className="topic-library-head-settings" onClick={() => setOptionModal('judgment_result')}><Settings size={13} /></Button>
                </div>
              </TableHead>
              <TableHead style={{ width: 132 }}>人工判断原因</TableHead>
              <TableHead style={{ width: 82 }}>
                <div className="topic-library-head-inline">
                  来源
                  <Button variant="ghost" size="icon" className="topic-library-head-settings" onClick={() => setOptionModal('source')}><Settings size={13} /></Button>
                </div>
              </TableHead>
              <TableHead style={{ width: 112 }}>录入时间</TableHead>
              <TableHead style={{ width: 156 }}>参考链接</TableHead>
              <TableHead style={{ width: 72 }}>匹配平台</TableHead>
              <TableHead style={{ width: 72 }}>参考文案</TableHead>
              <TableHead style={{ width: 80 }}>
                <div className="topic-library-head-inline">
                  AI分析
                  <Button variant="ghost" size="icon" className="topic-library-head-settings" onClick={() => setAnalysisConfigOpen(true)}><Settings size={13} /></Button>
                </div>
              </TableHead>
              <TableHead className="sticky-col-right" style={{ width: 132, textAlign: 'center' }}>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topics.map(topic => (
              <TableRow
                key={topic.id}
                className={`${draggingTopicId === topic.id ? "topic-library-row-dragging" : ""} ${dragOverTopicId === topic.id ? "topic-library-row-drop-target" : ""}`.trim()}
                onDragOver={(event) => event.preventDefault()}
                onDragEnter={() => handleTopicDragEnter(topic.id)}
                onDrop={() => handleTopicDrop(topic.id)}
              >
                {(() => {
                  const hasVisibleStoredAnalysis = buildStoredAnalysisResults(topic, topicModels).length > 0;
                  const hasEnteredProduction = productionTopicIds.includes(topic.id);
                  return (
                    <>
                      <TableCell className="topic-library-drag-cell sticky-drag-col">
                        <button
                          type="button"
                          draggable
                          className={`topic-library-drag-handle ${draggingTopicId === topic.id ? "is-dragging" : ""}`}
                          aria-label={`拖动排序：${topic.name || "未命名选题"}`}
                          title="拖动排序"
                          onDragStart={(event) => handleTopicDragStart(event, topic.id)}
                          onDragEnd={handleTopicDragEnd}
                        >
                          {Array.from({ length: 6 }).map((_, index) => (
                            <span key={index} className="topic-library-drag-dot" />
                          ))}
                        </button>
                      </TableCell>
                      <TableCell className="sticky-col-left">
                        <ExpandableTextCell
                          className="topic-library-text-cell topic-library-text-preview-2line"
                          value={topic.name || ""}
                          onChange={(val: string) => handleUpdateRecord(topic.id, 'name', val)}
                          placeholder="输入选题名称..."
                        />
                      </TableCell>
                      <TableCell>
                        <CompactTagSelect
                          value={topic.judgment_result || ""}
                          options={options.judgment_result}
                          placeholder="请选择"
                          onChange={(val: string) => handleUpdateRecord(topic.id, 'judgment_result', val)}
                        />
                      </TableCell>
                      <TableCell>
                        <ExpandableTextCell
                          className="topic-library-text-cell topic-library-text-preview-2line"
                          value={topic.judgment_reason || ""}
                          onChange={(val: string) => handleUpdateRecord(topic.id, 'judgment_reason', val)}
                          placeholder="输入原因..."
                        />
                      </TableCell>
                      <TableCell>
                        <CompactTagSelect
                          value={topic.source || ""}
                          options={options.source}
                          placeholder="请选择"
                          onChange={(val: string) => handleUpdateRecord(topic.id, 'source', val)}
                        />
                      </TableCell>
                      <TableCell className="topic-library-meta-cell">
                        {formatDateTime(topic.created_at)}
                      </TableCell>
                      <TableCell>
                        <ExpandableTextCell
                          className="topic-library-text-cell topic-library-link-cell topic-library-text-preview-1line"
                          style={{ color: 'var(--primary)' }}
                          value={topic.ref_link || ""}
                          displayValue={formatLinkPreview(topic.ref_link || "", "输入链接...")}
                          onChange={(val: string) => handleUpdateRecord(topic.id, 'ref_link', val)}
                          placeholder="输入链接..."
                          multiline={false}
                          isLink
                        />
                      </TableCell>
                      <TableCell className="topic-library-meta-cell">
                        {topic.ref_platform || "无匹配类别"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`topic-library-action ${topic.ref_content ? "topic-library-action-view-copy" : "topic-library-action-extract"}`}
                          onClick={() => setCopyDrawer(topic)}
                        >
                          {topic.ref_content ? "查看/修改" : "点击提取"}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`topic-library-action ${topicAnalysisJobs[topic.id]?.analyzing ? "topic-library-action-start-analysis" : (hasVisibleStoredAnalysis ? "topic-library-action-view-analysis" : "topic-library-action-start-analysis")}`}
                          onClick={() => setAiDrawer(topic)}
                        >
                          {topicAnalysisJobs[topic.id]?.analyzing ? "分析中" : (hasVisibleStoredAnalysis ? "查看分析" : "开始分析")}
                        </Button>
                      </TableCell>
                      <TableCell className="sticky-col-right text-center">
                        <div className="topic-library-row-actions">
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`topic-library-action topic-library-production-btn ${hasEnteredProduction ? "topic-library-production-btn-entered" : "topic-library-action-view-analysis"}`}
                            onClick={() => onEnterProduction?.(topic)}
                          >
                            {hasEnteredProduction ? "查看内容生产" : "进入内容生产"}
                          </Button>
                          <Button variant="ghost" size="icon" className="topic-library-delete-btn" onClick={() => handleDeleteRecord(topic.id)}>
                            <Trash2 size={14} className="text-muted-foreground" />
                          </Button>
                        </div>
                      </TableCell>
                    </>
                  );
                })()}
              </TableRow>
            ))}
            {topics.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
                  暂无数据，点击右上角新增选题
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Option Manager Modal */}
      <Dialog open={!!optionModal} onOpenChange={(open) => !open && setOptionModal(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>管理选项: {optionModal === 'judgment_result' ? '人工判断结果' : '来源'}</DialogTitle>
            <DialogDescription>
              添加、编辑或删除选项，更改会实时保存。
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="h-[300px] pr-4">
            <div className="flex flex-col gap-2">
              {optionModal && options[optionModal as 'judgment_result' | 'source'].map(o => (
                <div key={o.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                  <div className="flex items-center gap-2 flex-1">
                    <input type="color" value={o.color || "#ccc"} onChange={e => handleUpdateOption(optionModal, o.id, o.value, e.target.value)} className="w-6 h-6 p-0 border-none rounded cursor-pointer" />
                    <EditableInput className="flex-1 bg-transparent border-none p-1 text-sm" value={o.value} onChange={(val: string) => handleUpdateOption(optionModal, o.id, val, o.color)} />
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => handleDeleteOption(optionModal, o.id)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="flex gap-2 items-center">
            <input 
              type="color" 
              value={newOption.color} 
              onChange={e => setNewOption({ ...newOption, color: e.target.value })}
              className="w-10 h-10 p-0 border-none rounded cursor-pointer"
            />
            <Input 
              placeholder="新选项名称..." 
              value={newOption.value}
              onChange={e => setNewOption({ ...newOption, value: e.target.value })}
              className="flex-1"
            />
            <Button onClick={() => optionModal && handleAddOption(optionModal)}>添加</Button>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setOptionModal(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={analysisConfigOpen} onOpenChange={setAnalysisConfigOpen}>
        <DialogContent className="sm:max-w-[1180px]">
          <DialogHeader>
            <DialogTitle>AI 分析提示词配置</DialogTitle>
            <DialogDescription>
              保存后会长期作为选题库 AI 分析默认提示词使用，除非你再次手动修改。
            </DialogDescription>
          </DialogHeader>
          <textarea
            className="input-field topic-analysis-config-textarea resize-y p-4 text-sm leading-relaxed"
            value={topicPromptDraft}
            onChange={(e) => setTopicPromptDraft(e.target.value)}
            placeholder="请输入 AI 分析默认提示词"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setTopicPromptDraft(topicPrompt);
              setAnalysisConfigOpen(false);
            }}>取消</Button>
            <Button className="topic-primary-btn" onClick={saveTopicAnalysisPrompt}>保存配置</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Copy Content Drawer */}
      <TopicCopyDrawer 
        topic={copyDrawer} 
        onClose={() => setCopyDrawer(null)} 
        onUpdate={handleUpdateRecord}
        activeAccountId={activeAccountId}
      />

      {/* AI Analysis Drawer */}
      <TopicAiDrawer 
        topic={aiDrawer} 
        onClose={() => setAiDrawer(null)} 
        analysisState={aiDrawer?.id ? topicAnalysisJobs[aiDrawer.id] : undefined}
        onAnalyze={startTopicAnalysis}
        onToggleAgree={persistAgreeModel}
        systemInstruction={topicPrompt}
        models={topicModels}
        onModelsChange={persistTopicModels}
      />
    </div>
  );
}

function TopicCopyDrawer({ topic, onClose, onUpdate, activeAccountId }: any) {
  const [extracting, setExtracting] = useState(false);
  const [content, setContent] = useState("");

  useEffect(() => {
    if (topic) setContent(topic.ref_content || "");
  }, [topic]);

  const handleExtract = async () => {
    if (!topic?.ref_link) {
      alert("请先填写参考链接");
      return;
    }
    setExtracting(true);
    try {
      const data: any = await apiPost(`/api/v1/projects/${activeAccountId}/topic-library/extract`, { link: topic.ref_link, platform: topic.ref_platform }, "demo-key");
      const transcriptContent = typeof data?.content === "string" ? data.content.trim() : "";
      const debugText = buildExtractDebugText(data?.extract_debug);
      const isTitleDescFallback = data?.extract_fallback?.source === "title_desc_fallback";
      const fallbackContent = typeof data?.fallback_content === "string" && data.fallback_content.trim()
        ? data.fallback_content.trim()
        : (isTitleDescFallback ? transcriptContent : "");

      if (transcriptContent && !isTitleDescFallback) {
        setContent(transcriptContent);
        onUpdate(topic.id, 'ref_content', transcriptContent);
      } else if (fallbackContent) {
        const useFallback = window.confirm(
          `这次没提取到视频口播文案，当前拿到的是标题/正文简介，不会自动覆盖。\n\n${debugText ? `${debugText}\n\n` : ""}点击“确定”可暂时填入参考文案；点击“取消”保留当前内容。`
        );
        if (useFallback) {
          setContent(fallbackContent);
          onUpdate(topic.id, 'ref_content', fallbackContent);
        }
      } else {
        alert(`提取失败：没有拿到可用的视频文案${debugText ? `\n\n${debugText}` : ""}`);
      }
    } catch (e: any) {
      alert("提取异常: " + e.message);
    } finally {
      setExtracting(false);
    }
  };

  const handleSave = () => {
    if (topic) {
      onUpdate(topic.id, 'ref_content', content);
    }
    onClose();
  };

  return (
    <Sheet open={!!topic} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="topic-copy-drawer sm:max-w-[960px] w-[72vw]">
        <SheetHeader className="mb-6">
          <SheetTitle>参考文案内容</SheetTitle>
          <SheetDescription>
            你可以自动提取视频/图文的文案，或者手动粘贴修改。
          </SheetDescription>
        </SheetHeader>
        
        <div className="topic-copy-body">
          <div className="topic-copy-toolbar">
            <Input readOnly value={topic?.ref_link || "未填写链接"} className="bg-muted text-muted-foreground flex-1" />
            <Button type="button" className="topic-copy-extract-btn topic-primary-btn" onClick={handleExtract} disabled={extracting}>
              {extracting ? <Loader2 size={16} className="spin mr-2" /> : <FileText size={16} className="mr-2" />}
              {extracting ? "提取中..." : "提取"}
            </Button>
          </div>
          
          <textarea 
            className="input-field topic-copy-textarea resize-none p-4 text-sm leading-relaxed" 
            placeholder="文案内容..." 
            value={content}
            onChange={e => setContent(e.target.value)}
          />

          <div className="topic-copy-footer">
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="button" className="topic-primary-btn" onClick={handleSave}>保存文案</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TopicAiDrawer({ topic, onClose, analysisState, onAnalyze, onToggleAgree, systemInstruction, models, onModelsChange }: any) {
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const normalizedRefContent = String(topic?.ref_content || "").trim() || "无";

  const buildPromptPreview = () => {
    return [
      "请基于以下信息进行内容拆解分析：",
      "",
      "分析提示词：",
      systemInstruction || "未填写",
      "",
      "选题名称：",
      topic?.name || "未填写",
      "",
      "参考文案内容：",
      normalizedRefContent
    ].join("\n");
  };

  if (!topic) return null;
  const analyzing = Boolean(analysisState?.analyzing);
  const storedResults = buildStoredAnalysisResults(topic, models);
  const results = analysisState?.results?.length ? analysisState.results : storedResults;
  const resultGridColumns = models.length === 1 ? "minmax(0, 1fr)" : `repeat(${models.length}, minmax(0, 1fr))`;

  return (
    <Sheet open={!!topic} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-[1200px] w-[90vw] overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle className="flex justify-between items-center">
            <span>AI 多模型内容拆解</span>
          </SheetTitle>
          <SheetDescription>
            并行调用多款大模型进行深度分析，找出爆款背后的核心逻辑。
          </SheetDescription>
        </SheetHeader>
        
        <div className="flex flex-col gap-6">
          <div className="p-4 bg-muted/30 rounded-lg flex flex-col gap-4">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="text-sm font-semibold block">对比模型矩阵</label>
                <Button type="button" variant="outline" size="sm" onClick={() => setPromptDialogOpen(true)}>
                  查看全部提示词
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                {models.map((m, i) => (
                  <div key={`${i}-${m}`} className="flex items-center gap-2">
                    <div className="w-16 text-xs font-medium text-muted-foreground">模型 {i + 1}</div>
                    <Select
                      value={m}
                      onValueChange={(val) => {
                        const newM = [...models];
                        newM[i] = val;
                        onModelsChange(newM);
                      }}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="选择模型" />
                      </SelectTrigger>
                      <SelectContent>
                        {MODEL_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {models.length > 1 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        onClick={() => onModelsChange(models.filter((_: string, index: number) => index !== i))}
                      >
                        <Trash2 size={15} />
                      </Button>
                    ) : null}
                  </div>
                ))}
                {models.length < 3 ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="self-start"
                    onClick={() => onModelsChange([...models, getNextTopicModel(models)])}
                  >
                    <Plus size={14} className="mr-1.5" />
                    添加模型
                  </Button>
                ) : null}
              </div>
            </div>

            <Button onClick={() => onAnalyze(topic)} disabled={analyzing} className="w-full mt-2 topic-primary-btn">
              {analyzing ? <Loader2 size={16} className="spin mr-2" /> : <Sparkles size={16} className="mr-2" />}
              {analyzing ? "当前选题分析进行中，可切去别的选题继续分析" : "一键下发指令，开始分析"}
            </Button>
          </div>

          <div className="grid gap-4 min-h-[400px]" style={{ gridTemplateColumns: resultGridColumns }}>
            {models.map((model, i) => {
              const res = results[i] || results.find(r => r.model === model);
              const hasVisibleContent = Boolean(res?.error || res?.result);
              const isAgreed = Boolean(res?.agreed);
              return (
                <div
                  key={`${i}-${model}`}
                  className="flex-1 bg-card border border-border rounded-lg flex flex-col overflow-hidden"
                  style={isAgreed ? { background: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.25)' } : undefined}
                >
                  <div className="bg-muted p-3 border-b border-border font-semibold text-sm flex justify-between items-center">
                    <span>{model}</span>
                    {analyzing ? <Badge variant="secondary">分析中</Badge> : null}
                    {res?.error ? <Badge variant="destructive">Error</Badge> : null}
                    {!analyzing && !res?.error && res?.result ? (
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isAgreed}
                          onChange={() => onToggleAgree?.(topic.id, model)}
                        />
                        <span style={isAgreed ? { color: '#15803d', fontWeight: 700 } : { color: 'var(--text-muted)' }}>认同</span>
                      </label>
                    ) : null}
                  </div>
                  <ScrollArea className="flex-1 p-4">
                    {!hasVisibleContent && analyzing ? (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 pt-20">
                        <Loader2 size={24} className="spin" />
                        <span className="text-sm">等待 {model} 响应...</span>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {analyzing ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 size={14} className="spin" />
                            <span>本轮分析进行中，先展示当前已保存结果</span>
                          </div>
                        ) : null}
                        <div className="text-sm whitespace-pre-wrap leading-relaxed">
                          {res?.error ? <span className="text-destructive">{res.error}</span> : res?.result || <span className="text-muted-foreground italic">暂无分析结果</span>}
                        </div>
                      </div>
                    )}
                  </ScrollArea>
                </div>
              );
            })}
          </div>
        </div>
      </SheetContent>

      <Dialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen}>
        <DialogContent className="sm:max-w-[860px]">
          <DialogHeader>
            <DialogTitle>完整分析提示词</DialogTitle>
            <DialogDescription>
              这里展示的是当前将要发送给模型的核心分析内容。
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] rounded-md border border-border bg-muted/20 p-4">
            <pre className="whitespace-pre-wrap break-words text-sm leading-6">{buildPromptPreview()}</pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}

// Logs UI has been moved to the standalone Generation Logs page under System.
