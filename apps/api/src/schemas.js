import { z } from "zod";

export const LoginSchema = z.object({
  invite_code: z.string().min(1),
  passcode: z.string().min(1)
});

export const CreateProjectSchema = z.object({
  name: z.string().min(1),
  platform: z.enum(["xiaohongshu"]).default("xiaohongshu")
});

export const AccountProfileGenerateSchema = z.object({
  domain: z.string().optional(),
  creator_background: z.string().optional(),
  audience: z.any().optional(),
  goals: z.array(z.string()).optional(),
  tone: z.array(z.string()).optional(),
  safety: z.any().optional()
});

export const TopicsGenerateSchema = z.object({
  keywords: z.array(z.string()).default([]),
  goal: z.string().optional(),
  format: z.enum(["图文", "短视频", "多平台分发"]).optional(),
  count: z.number().int().min(1).max(50).default(10)
});

export const TopicPatchSchema = z.object({
  status: z.enum(["todo", "doing", "published", "reviewed"]).optional()
});

export const DraftSaveSchema = z.object({
  title_candidates: z.any().optional(),
  hook_candidates: z.any().optional(),
  body_blocks: z.any().optional(),
  citations: z.any().optional(),
  cover: z.any().optional()
});

export const RagSearchSchema = z.object({
  project_id: z.string().min(1),
  query: z.string().min(1),
  top_k: z.number().int().min(1).max(20).default(5)
});

export const BodyGenerateSchema = z.object({
  outline: z.any().optional(),
  evidence: z.array(z.string()).default([]),
  rag: z
    .object({
      enabled: z.boolean().default(false),
      project_id: z.string().optional(),
      query: z.string().optional(),
      top_k: z.number().int().min(1).max(20).default(5),
      force_citations: z.number().int().min(0).max(10).default(0)
    })
    .optional(),
  override_config_yaml: z.string().optional()
});

export const CoverRenderSchema = z.object({
  template_id: z.string().min(1),
  size: z.any().optional(),
  texts: z.object({ title: z.string().optional(), subtitle: z.string().optional(), tags: z.array(z.string()).optional() }).optional(),
  style: z.any().optional()
});
