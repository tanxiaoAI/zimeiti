import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { dbPath } from './dataPaths.js';
import { migrateLegacyDataIfNeeded } from './migrateLegacyData.js';

migrateLegacyDataIfNeeded();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath, { verbose: console.log });

function normalizeTopicLibrarySortOrder() {
  const projects = db.prepare("SELECT DISTINCT project_id FROM topic_library").all();
  const updateOrder = db.prepare("UPDATE topic_library SET sort_order = ? WHERE id = ?");
  const tx = db.transaction(() => {
    for (const project of projects) {
      const rows = db.prepare(`
        SELECT id
        FROM topic_library
        WHERE project_id = ?
        ORDER BY
          CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END,
          sort_order ASC,
          created_at DESC
      `).all(project.project_id);

      rows.forEach((row, index) => {
        updateOrder.run(index, row.id);
      });
    }
  });
  tx();
}

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS customer_profiles (
      project_id TEXT PRIMARY KEY,
      skills TEXT,
      interests TEXT,
      time_budget TEXT,
      finance_budget TEXT,
      unique_resources TEXT,
      track_selection TEXT,
      monetization_method TEXT,
      expected_income TEXT,
      target_audience TEXT,
      core_pain_points TEXT,
      ultimate_desire TEXT,
      platform_preference TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    
    CREATE TABLE IF NOT EXISTS video_teardowns (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      url TEXT,
      title TEXT,
      content TEXT,
      date_published TEXT,
      cover_image TEXT,
      user_name TEXT,
      video_url TEXT,
      local_video_path TEXT,
      ai_analysis TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chat_type TEXT NOT NULL DEFAULT 'positioning',
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      latency_ms INTEGER,
      total_tokens INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS context_files (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      module_key TEXT NOT NULL,
      filename TEXT NOT NULL,
      content TEXT NOT NULL,
      size_bytes INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, module_key),
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS topic_library (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER,
      cp_topic_adjust_input TEXT,
      cp_topic_adjust_result TEXT,
      cp_outline_input TEXT,
      cp_outline_result TEXT,
      cp_draft_input TEXT,
      cp_draft_result TEXT,
      cp_value_review_input TEXT,
      cp_value_review_result TEXT,
      cp_final_optimize_input TEXT,
      cp_final_optimize_result TEXT,
      judgment_result TEXT,
      judgment_reason TEXT,
      source TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ref_link TEXT,
      ref_platform TEXT,
      ref_content TEXT,
      ai_analysis_1 TEXT,
      ai_analysis_2 TEXT,
      ai_analysis_3 TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS topic_options (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      field TEXT NOT NULL,
      value TEXT NOT NULL,
      color TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS generation_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      project_id TEXT,
      feature TEXT NOT NULL,
      provider TEXT,
      mode TEXT,
      request_id TEXT,
      request_json TEXT,
      response_json TEXT,
      status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    -- Add new columns if they don't exist (using try-catch pattern in sqlite via altering is limited, so we do it safely if possible)
    -- In SQLite, we can just run ALTER TABLE, but it will throw if it exists. So we ignore errors or use pragma.
  `);

  try {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN chat_type TEXT NOT NULL DEFAULT 'positioning';`);
  } catch (e) {
    // Column might already exist
  }

  try {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN latency_ms INTEGER;`);
  } catch (e) {
    // Column might already exist
  }

  try {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN total_tokens INTEGER;`);
  } catch (e) {
    // Column might already exist
  }

  try {
    db.exec(`ALTER TABLE topic_library ADD COLUMN sort_order INTEGER;`);
  } catch (e) {
    // Column might already exist
  }

  const topicLibraryExtraColumns = [
    "cp_topic_adjust_input TEXT",
    "cp_topic_adjust_result TEXT",
    "cp_outline_input TEXT",
    "cp_outline_result TEXT",
    "cp_draft_input TEXT",
    "cp_draft_result TEXT",
    "cp_value_review_input TEXT",
    "cp_value_review_result TEXT",
    "cp_final_optimize_input TEXT",
    "cp_final_optimize_result TEXT"
  ];

  for (const columnDef of topicLibraryExtraColumns) {
    try {
      db.exec(`ALTER TABLE topic_library ADD COLUMN ${columnDef};`);
    } catch (e) {
      // Column might already exist
    }
  }

  db.exec(`
    -- Ensure a demo user exists
    INSERT OR IGNORE INTO users (id, username) VALUES ('demo_user_123', 'Demo User');
    
    -- Ensure project '1' and '2' exists for the frontend mock
    INSERT OR IGNORE INTO projects (id, user_id, name, platform) VALUES ('1', 'demo_user_123', '谈笑AI', 'xiaohongshu');
    INSERT OR IGNORE INTO customer_profiles (project_id) VALUES ('1');
    
    INSERT OR IGNORE INTO projects (id, user_id, name, platform) VALUES ('2', 'demo_user_123', 'Amy', 'xiaohongshu');
    INSERT OR IGNORE INTO customer_profiles (project_id) VALUES ('2');
    UPDATE projects SET name = '谈笑AI' WHERE id = '1';
    UPDATE projects SET name = 'Amy' WHERE id = '2';

    -- Initialize default options for topic library
    INSERT OR IGNORE INTO topic_options (id, project_id, field, value, color) VALUES ('opt_j_1_1', '1', 'judgment_result', '优质', '#10B981');
    INSERT OR IGNORE INTO topic_options (id, project_id, field, value, color) VALUES ('opt_j_1_2', '1', 'judgment_result', '一般', '#F59E0B');
    INSERT OR IGNORE INTO topic_options (id, project_id, field, value, color) VALUES ('opt_j_1_3', '1', 'judgment_result', '放弃', '#EF4444');
    INSERT OR IGNORE INTO topic_options (id, project_id, field, value, color) VALUES ('opt_s_1_1', '1', 'source', '竞品', '#3B82F6');
    INSERT OR IGNORE INTO topic_options (id, project_id, field, value, color) VALUES ('opt_s_1_2', '1', 'source', '灵感', '#8B5CF6');
  `);

  normalizeTopicLibrarySortOrder();
}

// Ensure the db is initialized
initDb();
