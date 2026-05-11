import { nanoid } from "nanoid";
import { db } from "../db.js";

const topics = new Map(); // topic_id -> {id, project_id, ...}
const drafts = new Map(); // draft_id -> {id, topic_id, ...}

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

export function deleteProject(project_id, user_id) {
  const existing = db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(project_id, user_id);
  if (!existing) return false;
  const deletedTopicIds = new Set();

  const deleteProjectTx = db.transaction(() => {
    db.prepare("DELETE FROM customer_profiles WHERE project_id = ?").run(project_id);
    db.prepare("DELETE FROM video_teardowns WHERE project_id = ?").run(project_id);
    db.prepare("DELETE FROM chat_messages WHERE project_id = ?").run(project_id);
    db.prepare("DELETE FROM context_files WHERE project_id = ?").run(project_id);
    db.prepare("DELETE FROM topic_library WHERE project_id = ?").run(project_id);
    db.prepare("DELETE FROM topic_options WHERE project_id = ?").run(project_id);
    db.prepare("DELETE FROM topic_extract_jobs WHERE project_id = ?").run(project_id);
    db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").run(project_id, user_id);
  });

  deleteProjectTx();

  for (const [topicId, topic] of topics.entries()) {
    if (topic.project_id === project_id) {
      deletedTopicIds.add(topicId);
      topics.delete(topicId);
    }
  }

  for (const [draftId, draft] of drafts.entries()) {
    if (deletedTopicIds.has(draft.topic_id)) {
      drafts.delete(draftId);
    }
  }

  db.prepare("DELETE FROM generation_logs WHERE project_id = ?").run(project_id);

  return true;
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

export function addChatMessage(project_id, role, content, latency_ms = null, total_tokens = null, chat_type = "positioning") {
  const id = `msg_${nanoid(12)}`;
  db.prepare("INSERT INTO chat_messages (id, project_id, chat_type, role, content, latency_ms, total_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, project_id, chat_type, role, content, latency_ms, total_tokens);
  return getChatMessage(id);
}

export function getChatMessage(id) {
  return db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(id) || null;
}

export function deleteChatMessage(id, project_id, chat_type = "positioning") {
  const result = db.prepare("DELETE FROM chat_messages WHERE id = ? AND project_id = ? AND chat_type = ?").run(id, project_id, chat_type);
  return result.changes > 0;
}

export function listChatMessages(project_id, chat_type = "positioning") {
  return db.prepare("SELECT * FROM chat_messages WHERE project_id = ? AND chat_type = ? ORDER BY created_at ASC").all(project_id, chat_type);
}

export function saveContextFile(project_id, module_key, filename, content) {
  const existing = db
    .prepare("SELECT id FROM context_files WHERE project_id = ? AND module_key = ?")
    .get(project_id, module_key);

  const size_bytes = Buffer.byteLength(content || "", "utf8");

  if (existing) {
    db.prepare(`
      UPDATE context_files
      SET filename = ?, content = ?, size_bytes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE project_id = ? AND module_key = ?
    `).run(filename, content, size_bytes, project_id, module_key);

    return getContextFile(project_id, module_key);
  }

  const id = `ctx_${nanoid(10)}`;
  db.prepare(`
    INSERT INTO context_files (id, project_id, module_key, filename, content, size_bytes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, project_id, module_key, filename, content, size_bytes);

  return getContextFile(project_id, module_key);
}

export function getContextFile(project_id, module_key) {
  return (
    db.prepare(`
      SELECT id, project_id, module_key, filename, content, size_bytes, created_at, updated_at
      FROM context_files
      WHERE project_id = ? AND module_key = ?
    `).get(project_id, module_key) || null
  );
}

export function getContextFileMeta(project_id, module_key) {
  return (
    db.prepare(`
      SELECT id, project_id, module_key, filename, size_bytes, created_at, updated_at
      FROM context_files
      WHERE project_id = ? AND module_key = ?
    `).get(project_id, module_key) || null
  );
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

// --- Topic Library & Options ---

export function listTopicOptions(project_id, field) {
  return db.prepare("SELECT * FROM topic_options WHERE project_id = ? AND field = ? ORDER BY created_at ASC").all(project_id, field);
}

export function createTopicOption(project_id, data) {
  const id = `opt_${nanoid(8)}`;
  db.prepare(`
    INSERT INTO topic_options (id, project_id, field, value, color)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, project_id, data.field, data.value, data.color || null);
  return getTopicOption(id);
}

export function getTopicOption(id) {
  return db.prepare("SELECT * FROM topic_options WHERE id = ?").get(id) || null;
}

export function updateTopicOption(id, data) {
  db.prepare(`
    UPDATE topic_options SET value = ?, color = ? WHERE id = ?
  `).run(data.value, data.color || null, id);
  return getTopicOption(id);
}

export function deleteTopicOption(id) {
  const result = db.prepare("DELETE FROM topic_options WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listTopicLibrary(project_id) {
  return db.prepare(`
    SELECT *
    FROM topic_library
    WHERE project_id = ?
    ORDER BY
      COALESCE(sort_order, 2147483647) ASC,
      created_at DESC
  `).all(project_id);
}

export function createTopicLibraryItem(project_id, data) {
  const id = `tl_${nanoid(10)}`;
  const nextSortOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order FROM topic_library WHERE project_id = ?")
    .get(project_id)?.next_sort_order ?? 0;
  db.prepare(`
    INSERT INTO topic_library (
      id, project_id, name, sort_order, judgment_result, judgment_reason, source,
      ref_link, ref_platform, ref_content, ai_analysis_1, ai_analysis_2, ai_analysis_3
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, project_id, data.name, nextSortOrder, data.judgment_result || null, data.judgment_reason || null,
    data.source || null, data.ref_link || null, data.ref_platform || null,
    data.ref_content || null, data.ai_analysis_1 || null, data.ai_analysis_2 || null, data.ai_analysis_3 || null
  );
  return getTopicLibraryItem(id);
}

export function getTopicLibraryItem(id) {
  return db.prepare("SELECT * FROM topic_library WHERE id = ?").get(id) || null;
}

export function updateTopicLibraryItem(id, data) {
  const fields = Object.keys(data).filter(k => k !== 'id' && k !== 'project_id' && k !== 'created_at');
  if (fields.length === 0) return getTopicLibraryItem(id);
  
  const setClause = fields.map(f => `${f} = ?`).join(", ");
  const values = fields.map(f => data[f]);
  values.push(id);
  
  db.prepare(`UPDATE topic_library SET ${setClause} WHERE id = ?`).run(...values);
  return getTopicLibraryItem(id);
}

export function deleteTopicLibraryItem(id) {
  const result = db.prepare("DELETE FROM topic_library WHERE id = ?").run(id);
  return result.changes > 0;
}

export function reorderTopicLibraryItems(project_id, orderedIds) {
  const currentIds = listTopicLibrary(project_id).map((item) => item.id);
  if (currentIds.length !== orderedIds.length) {
    throw new Error("排序项目数量不一致");
  }

  const currentSet = new Set(currentIds);
  if (orderedIds.some((id) => !currentSet.has(id))) {
    throw new Error("存在不属于当前项目的选题");
  }

  const updateStmt = db.prepare("UPDATE topic_library SET sort_order = ? WHERE id = ? AND project_id = ?");
  const tx = db.transaction(() => {
    orderedIds.forEach((id, index) => {
      updateStmt.run(index, id, project_id);
    });
  });
  tx();
  return listTopicLibrary(project_id);
}

export function addGenerationLog(log) {
  const id = `glog_${nanoid(10)}`;
  db.prepare(`
    INSERT INTO generation_logs (
      id, user_id, project_id, feature, provider, mode, request_id, request_json, response_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    log.user_id || null,
    log.project_id || null,
    log.feature,
    log.provider || null,
    log.mode || null,
    log.request_id || null,
    JSON.stringify(log.request_json ?? null),
    JSON.stringify(log.response_json ?? null),
    log.status || "ok"
  );

  return db.prepare("SELECT * FROM generation_logs WHERE id = ?").get(id) || null;
}

export function listGenerationLogs({ user_id, project_id, feature, limit = 50 }) {
  const conditions = [];
  const values = [];

  if (user_id) {
    conditions.push("user_id = ?");
    values.push(user_id);
  }
  if (project_id) {
    conditions.push("project_id = ?");
    values.push(project_id);
  }
  if (feature) {
    conditions.push("feature = ?");
    values.push(feature);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT *
    FROM generation_logs
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...values, limit);

  return rows.map((row) => ({
    ...row,
    request_json: row.request_json ? JSON.parse(row.request_json) : null,
    response_json: row.response_json ? JSON.parse(row.response_json) : null
  }));
}

function parseTopicExtractJob(row) {
  if (!row) return null;
  return {
    ...row,
    result_json: row.result_json ? JSON.parse(row.result_json) : null,
    debug_json: row.debug_json ? JSON.parse(row.debug_json) : null
  };
}

export function createTopicExtractJob(project_id, data) {
  const id = `tex_${nanoid(10)}`;
  db.prepare(`
    INSERT INTO topic_extract_jobs (
      id, project_id, topic_id, link, platform, status, stage, progress_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    project_id,
    data.topic_id || null,
    data.link,
    data.platform || null,
    data.status || "pending",
    data.stage || "queued",
    data.progress_text || "任务已创建，等待开始"
  );
  return getTopicExtractJob(id);
}

export function getTopicExtractJob(id) {
  const row = db.prepare("SELECT * FROM topic_extract_jobs WHERE id = ?").get(id);
  return parseTopicExtractJob(row);
}

export function updateTopicExtractJob(id, data) {
  const fields = Object.keys(data).filter((key) => key !== "id" && data[key] !== undefined);
  if (fields.length === 0) return getTopicExtractJob(id);

  const setClause = fields.map((field) => {
    if (field === "result_json" || field === "debug_json") return `${field} = ?`;
    return `${field} = ?`;
  }).join(", ");
  const values = fields.map((field) => {
    if (field === "result_json" || field === "debug_json") {
      return data[field] == null ? null : JSON.stringify(data[field]);
    }
    return data[field];
  });
  values.push(id);

  db.prepare(`
    UPDATE topic_extract_jobs
    SET ${setClause}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(...values);

  return getTopicExtractJob(id);
}



export function addVideoTeardown(project_id, data) {
  const id = nanoid();
  const stmt = db.prepare(`
    INSERT INTO video_teardowns (id, project_id, url, title, content, date_published, cover_image, user_name, video_url, local_video_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, project_id, data.url || "", data.title || "", data.content || "", data.date_published || "", data.cover_image || "", data.user_name || "", data.video_url || "", data.local_video_path || "");
  return getVideoTeardown(id);
}

export function getVideoTeardown(id) {
  return db.prepare('SELECT * FROM video_teardowns WHERE id = ?').get(id);
}

export function listVideoTeardowns(project_id) {
  return db.prepare('SELECT * FROM video_teardowns WHERE project_id = ? ORDER BY created_at DESC').all(project_id);
}

export function updateVideoTeardown(id, updates) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return getVideoTeardown(id);
  values.push(id);
  db.prepare(`UPDATE video_teardowns SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getVideoTeardown(id);
}

export function deleteVideoTeardown(id, project_id) {
  const res = db.prepare('DELETE FROM video_teardowns WHERE id = ? AND project_id = ?').run(id, project_id);
  return res.changes > 0;
}
