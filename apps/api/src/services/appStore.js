import { nanoid } from "nanoid";
import { db } from "../db.js";

const topics = new Map(); // topic_id -> {id, project_id, ...}
const drafts = new Map(); // draft_id -> {id, topic_id, ...}
const generationLogs = []; // append only

export function createProject({ user_id, name, platform }) {
  const id = `p_${nanoid(8)}`;
  db.prepare("INSERT INTO projects (id, user_id, name, platform) VALUES (?, ?, ?, ?)").run(id, user_id, name, platform);
  
  // Create an empty customer profile
  db.prepare(`
    INSERT INTO customer_profiles (project_id) VALUES (?)
  `).run(id);

  return getProject(id);
}

export function listProjects(user_id) {
  return db.prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC").all(user_id);
}

export function getProject(id) {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) || null;
}

export function getCustomerProfile(project_id) {
  return db.prepare("SELECT * FROM customer_profiles WHERE project_id = ?").get(project_id) || null;
}

export function updateCustomerProfile(project_id, updates) {
  const fields = Object.keys(updates);
  if (fields.length === 0) return getCustomerProfile(project_id);

  const setClause = fields.map(f => `${f} = ?`).join(", ");
  const values = fields.map(f => updates[f]);
  values.push(project_id);

  db.prepare(`UPDATE customer_profiles SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?`).run(...values);
  return getCustomerProfile(project_id);
}

export function addChatMessage(project_id, role, content, latency_ms = null, total_tokens = null) {
  const id = `msg_${nanoid(12)}`;
  db.prepare("INSERT INTO chat_messages (id, project_id, role, content, latency_ms, total_tokens) VALUES (?, ?, ?, ?, ?, ?)").run(id, project_id, role, content, latency_ms, total_tokens);
  return getChatMessage(id);
}

export function getChatMessage(id) {
  return db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(id) || null;
}

export function deleteChatMessage(id, project_id) {
  const result = db.prepare("DELETE FROM chat_messages WHERE id = ? AND project_id = ?").run(id, project_id);
  return result.changes > 0;
}

export function listChatMessages(project_id) {
  return db.prepare("SELECT * FROM chat_messages WHERE project_id = ? ORDER BY created_at ASC").all(project_id);
}

export function saveAccountProfile(project_id, positioning_json) {
  // legacy mock
  return { project_id, positioning_json, updated_at: new Date().toISOString() };
}

export function getAccountProfile(project_id) {
  // legacy mock
  return null;
}

export function createTopic(project_id, data) {
  const id = `t_${nanoid(8)}`;
  const topic = { id, project_id, status: "todo", created_at: new Date().toISOString(), ...data };
  topics.set(id, topic);
  return topic;
}

export function listTopics(project_id) {
  return [...topics.values()].filter((t) => t.project_id === project_id);
}

export function updateTopic(id, patch) {
  const existing = topics.get(id);
  if (!existing) return null;
  const next = { ...existing, ...patch, updated_at: new Date().toISOString() };
  topics.set(id, next);
  return next;
}

export function createDraft(topic_id) {
  const id = `d_${nanoid(8)}`;
  const draft = {
    id,
    topic_id,
    title_candidates: null,
    hook_candidates: null,
    body_blocks: null,
    citations: [],
    cover: null,
    updated_at: new Date().toISOString()
  };
  drafts.set(id, draft);
  return draft;
}

export function getDraft(id) {
  return drafts.get(id) || null;
}

export function saveDraft(id, patch) {
  const existing = drafts.get(id);
  if (!existing) return null;
  const next = { ...existing, ...patch, updated_at: new Date().toISOString() };
  drafts.set(id, next);
  return next;
}

export function addGenerationLog(log) {
  generationLogs.push({ ...log, created_at: new Date().toISOString() });
}

export function listGenerationLogs({ user_id, project_id, limit = 50 }) {
  return generationLogs
    .filter((l) => (user_id ? l.user_id === user_id : true) && (project_id ? l.project_id === project_id : true))
    .slice(-limit)
    .reverse();
}

