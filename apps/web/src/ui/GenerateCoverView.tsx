import React, { useState } from 'react';
import { Image as ImageIcon, Upload, Loader2, Sparkles, AlertTriangle, ExternalLink } from 'lucide-react';
import { apiPost, apiGet } from './api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function GenerateCoverView({ activeAccountId }: { activeAccountId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setPreviewUrl(URL.createObjectURL(selectedFile));
      setResultImage(null);
      setError(null);
      setWarning(null);
    }
  };

  const pollResult = async (resultId: string) => {
    try {
      const res: any = await apiGet(`/api/v1/projects/${activeAccountId}/generate-cover/${resultId}`, "demo-key");
      
      if (res.status === 'success') {
        setResultImage(res.result_url);
        setGenerating(false);
      } else if (res.status === 'error') {
        setError(res.message || '生成失败');
        setGenerating(false);
      } else {
        // processing
        setTimeout(() => pollResult(resultId), 3000);
      }
    } catch (err: any) {
      setError('查询状态异常: ' + err.message);
      setGenerating(false);
    }
  };

  const handleGenerate = async () => {
    if (!file) {
      setError('请先上传一张基础图片');
      return;
    }
    if (!prompt.trim()) {
      setError('请填写提示词');
      return;
    }

    setGenerating(true);
    setError(null);
    setWarning(null);
    setResultImage(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('prompt', prompt);

      const API_BASE = import.meta.env.VITE_API_BASE || "";
      const url = `${API_BASE}/api/v1/projects/${activeAccountId}/generate-cover`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'X-API-Key': 'demo-key'
        },
        body: formData
      });

      const data = await res.json();
      
      if (data.code !== 0) {
        throw new Error(data.message || '提交失败');
      }

      if (data.data?.host_warning) {
        setWarning(data.data.host_warning);
      }

      const resultId = data.data?.result_id;
      if (resultId) {
        pollResult(resultId);
      } else {
        throw new Error('未返回任务 ID');
      }
      
    } catch (err: any) {
      setError('请求异常: ' + err.message);
      setGenerating(false);
    }
  };

  return (
    <div>
      <div className="page-header mb-6">
        <h2 className="text-2xl font-bold tracking-tight">生成封面</h2>
        <p className="text-muted-foreground">基于 nanobanana API (Gemini 3.1 Flash Image Preview) 的图片修改与重绘功能。</p>
      </div>

      <div className="flex gap-6 items-start">
        
        {/* 左侧控制区 */}
        <div className="card flex-1 flex flex-col gap-6">
          
          <div>
            <label className="block font-semibold mb-2 text-sm">基础图片 (原图)</label>
            <div 
              className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer bg-muted/30 hover:bg-muted/50 transition-colors relative"
              onClick={() => document.getElementById('cover-upload')?.click()}
            >
              {previewUrl ? (
                <img src={previewUrl} alt="preview" className="max-h-[200px] max-w-full object-contain rounded-md mx-auto" />
              ) : (
                <div className="text-muted-foreground flex flex-col items-center gap-2">
                  <Upload size={32} />
                  <span className="text-sm">点击上传图片</span>
                </div>
              )}
              <input 
                id="cover-upload" 
                type="file" 
                accept="image/*" 
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold mb-2 text-sm">修改提示词 (Prompt)</label>
            <Textarea 
              className="min-h-[120px] resize-y" 
              placeholder="例如：Combine two images, making Obama the main character of the poster, and replace the PLuribus text with GPT PROTO."
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
            />
          </div>

          {error && (
            <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm">
              {error}
            </div>
          )}

          {warning && (
            <div className="p-3 bg-amber-500/10 text-amber-600 rounded-md text-sm flex gap-2 items-start">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>{warning}</span>
            </div>
          )}

          <Button 
            className="w-full"
            size="lg"
            onClick={handleGenerate}
            disabled={generating || !file || !prompt.trim()}
          >
            {generating ? (
              <>
                <Loader2 size={18} className="spin mr-2" /> 生成中，请稍候...
              </>
            ) : (
              <>
                <Sparkles size={18} className="mr-2" /> 开始生成封面
              </>
            )}
          </Button>

        </div>

        {/* 右侧结果区 */}
        <div className="card flex-1 flex flex-col min-h-[400px]">
          <h3 className="text-lg font-semibold mb-4">生成结果</h3>
          
          <div className="flex-1 flex items-center justify-center bg-muted/30 border border-border rounded-lg overflow-hidden">
            {generating ? (
              <div className="text-muted-foreground flex flex-col items-center gap-3">
                <Loader2 size={32} className="spin text-primary" />
                <span className="text-sm">AI 正在处理图片，这可能需要几十秒...</span>
              </div>
            ) : resultImage ? (
              <img src={resultImage} alt="result" className="max-w-full max-h-full object-contain" />
            ) : (
              <div className="text-muted-foreground flex flex-col items-center gap-2">
                <ImageIcon size={48} className="opacity-20" />
                <span className="text-sm">等待生成...</span>
              </div>
            )}
          </div>
          
          {resultImage && (
            <div className="mt-4 text-center">
              <Button variant="outline" asChild>
                <a href={resultImage} target="_blank" rel="noreferrer">
                  在新标签页打开原图 <ExternalLink size={14} className="ml-2" />
                </a>
              </Button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
