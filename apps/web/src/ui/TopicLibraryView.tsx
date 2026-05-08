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
          >
            {current.value}
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
            >
              {item.value}
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
  isLink = false
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
      <span>{value || placeholder}</span>
    </button>
  );
}

export function TopicLibraryView({ activeAccountId }: { activeAccountId: string }) {
  const [topics, setTopics] = useState<any[]>([]);
  const [options, setOptions] = useState<{ judgment_result: any[], source: any[] }>({ judgment_result: [], source: [] });
  const [optionModal, setOptionModal] = useState<string | null>(null);
  const [copyDrawer, setCopyDrawer] = useState<any | null>(null);
  const [aiDrawer, setAiDrawer] = useState<any | null>(null);
  const [newOption, setNewOption] = useState({ value: "", color: "#3B82F6" });

  const fetchTopics = async () => {
    if (!activeAccountId) return;
    try {
      const data: any = await apiGet(`/api/v1/projects/${activeAccountId}/topic-library`, "demo-key");
      setTopics(data.items || []);
    } catch (e) {
      console.error(e);
    }
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
      fetchTopics();
      setCopyDrawer(prev => (prev && prev.id === id) ? updated : prev);
      setAiDrawer(prev => (prev && prev.id === id) ? updated : prev);
    } catch (e) {
      console.error(e);
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

  const formatDate = (isoStr: string) => {
    if (!isoStr) return "";
    const str = isoStr.endsWith('Z') ? isoStr : isoStr.replace(' ', 'T') + 'Z';
    const d = new Date(str);
    return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  return (
    <div>
      <div className="page-header flex justify-between items-start mb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">选题库</h2>
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
              <TableHead className="sticky-col-left" style={{ width: 180 }}>选题名称</TableHead>
              <TableHead style={{ width: 110 }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  人工判断结果
                  <Button variant="ghost" size="icon" className="w-6 h-6 ml-1" onClick={() => setOptionModal('judgment_result')}><Settings size={14} /></Button>
                </div>
              </TableHead>
              <TableHead style={{ width: 150 }}>人工判断原因</TableHead>
              <TableHead style={{ width: 96 }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  来源
                  <Button variant="ghost" size="icon" className="w-6 h-6 ml-1" onClick={() => setOptionModal('source')}><Settings size={14} /></Button>
                </div>
              </TableHead>
              <TableHead style={{ width: 124 }}>录入时间</TableHead>
              <TableHead style={{ width: 180 }}>参考链接</TableHead>
              <TableHead style={{ width: 88 }}>链接平台</TableHead>
              <TableHead style={{ width: 94 }}>参考文案</TableHead>
              <TableHead style={{ width: 94 }}>AI分析</TableHead>
              <TableHead className="sticky-col-right" style={{ width: 58, textAlign: 'center' }}>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topics.map(topic => (
              <TableRow key={topic.id}>
                <TableCell className="sticky-col-left">
                  <ExpandableTextCell
                    className="topic-library-text-cell"
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
                    className="topic-library-text-cell"
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
                <TableCell className="text-muted-foreground text-xs">
                  {formatDate(topic.created_at)}
                </TableCell>
                <TableCell>
                  <ExpandableTextCell
                    className="topic-library-text-cell topic-library-link-cell"
                    style={{ color: 'var(--primary)' }}
                    value={topic.ref_link || ""} 
                    onChange={(val: string) => handleUpdateRecord(topic.id, 'ref_link', val)} 
                    placeholder="输入链接..."
                    multiline={false}
                    isLink
                  />
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {topic.ref_platform || "无匹配类别"}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" className="topic-library-action" onClick={() => setCopyDrawer(topic)}>
                    {topic.ref_content ? "查看/修改" : "点击提取"}
                  </Button>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" className="topic-library-action" onClick={() => setAiDrawer(topic)}>
                    {topic.ai_analysis_1 || topic.ai_analysis_2 || topic.ai_analysis_3 ? "查看分析" : "开始分析"}
                  </Button>
                </TableCell>
                <TableCell className="sticky-col-right text-center">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDeleteRecord(topic.id)}>
                    <Trash2 size={14} className="text-muted-foreground" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {topics.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
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
        onUpdate={handleUpdateRecord}
        activeAccountId={activeAccountId}
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
      if (data?.content) {
        setContent(data.content);
        onUpdate(topic.id, 'ref_content', data.content);
      } else {
        alert("提取失败");
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

function TopicAiDrawer({ topic, onClose, onUpdate, activeAccountId }: any) {
  const [analyzing, setAnalyzing] = useState(false);
  const [systemInstruction, setSystemInstruction] = useState("你是一个资深自媒体内容分析师，请对提供的文案进行深度拆解分析。");
  const [models, setModels] = useState(["gpt-5.5", "claude-opus-4-6", "gpts-gemini-3.1-pro-preview"]);
  
  const [results, setResults] = useState<{ model: string, result: string, error: string | null }[]>([]);

  const parseStoredResult = (model: string, value: string | null | undefined) => {
    if (!value) return null;
    const text = String(value);
    if (/^API Error:/i.test(text) || /balance is insufficient/i.test(text) || /^Error:/i.test(text)) {
      return { model, result: "", error: text };
    }
    return { model, result: text, error: null };
  };

  useEffect(() => {
    if (topic) {
      const res = [
        parseStoredResult(models[0], topic.ai_analysis_1),
        parseStoredResult(models[1], topic.ai_analysis_2),
        parseStoredResult(models[2], topic.ai_analysis_3)
      ].filter(Boolean) as { model: string, result: string, error: string | null }[];
      setResults(res);
    }
  }, [topic, models]);

  if (!topic) return null;

  const handleAnalyze = async () => {
    if (!topic.ref_content) {
      alert("请先提取或填写参考文案内容");
      return;
    }
    setAnalyzing(true);
    setResults([]);
    try {
      const data: any = await apiPost(`/api/v1/projects/${activeAccountId}/topic-library/analyze`, {
        systemInstruction,
        models,
        content: topic.ref_content
      }, "demo-key");
      
      if (data?.results) {
        setResults(data.results);
        onUpdate(topic.id, 'ai_analysis_1', data.results[0]?.result || "");
        onUpdate(topic.id, 'ai_analysis_2', data.results[1]?.result || "");
        onUpdate(topic.id, 'ai_analysis_3', data.results[2]?.result || "");
      } else {
        alert("分析失败");
      }
    } catch (e: any) {
      alert("分析异常: " + e.message);
    } finally {
      setAnalyzing(false);
    }
  };

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
              <label className="text-sm font-semibold mb-2 block">System Instruction (人设与指令)</label>
              <textarea 
                className="input-field min-h-[80px] resize-y p-3 text-sm" 
                value={systemInstruction}
                onChange={e => setSystemInstruction(e.target.value)}
              />
            </div>
            
            <div>
              <label className="text-sm font-semibold mb-2 block">对比模型矩阵</label>
              <div className="flex gap-2">
                {models.map((m, i) => (
                  <Select
                    key={`${i}-${m}`}
                    value={m}
                    onValueChange={(val) => {
                      const newM = [...models];
                      newM[i] = val;
                      setModels(newM);
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
                ))}
              </div>
            </div>

            <Button onClick={handleAnalyze} disabled={analyzing} className="w-full mt-2 topic-primary-btn">
              {analyzing ? <Loader2 size={16} className="spin mr-2" /> : <Sparkles size={16} className="mr-2" />}
              {analyzing ? "AI 集群正在疯狂分析中..." : "一键下发指令，开始分析"}
            </Button>
          </div>

          <div className="flex gap-4 min-h-[400px]">
            {models.map((model, i) => {
              const res = results.find(r => r.model === model);
              return (
                <div key={model} className="flex-1 bg-card border border-border rounded-lg flex flex-col overflow-hidden">
                  <div className="bg-muted p-3 border-b border-border font-semibold text-sm flex justify-between items-center">
                    <span>{model}</span>
                    {res?.error ? <Badge variant="destructive">Error</Badge> : null}
                    {!res?.error && res?.result ? <Badge variant="default" className="bg-primary/10 text-primary hover:bg-primary/20">Success</Badge> : null}
                  </div>
                  <ScrollArea className="flex-1 p-4">
                    {analyzing ? (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 pt-20">
                        <Loader2 size={24} className="spin" />
                        <span className="text-sm">等待 {model} 响应...</span>
                      </div>
                    ) : (
                      <div className="text-sm whitespace-pre-wrap leading-relaxed">
                        {res?.error ? <span className="text-destructive">{res.error}</span> : res?.result || <span className="text-muted-foreground italic">暂无分析结果</span>}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              );
            })}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
