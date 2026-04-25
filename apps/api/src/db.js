import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '..', 'database.sqlite');

export const db = new Database(dbPath, { verbose: console.log });

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
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      latency_ms INTEGER,
      total_tokens INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    -- Add new columns if they don't exist (using try-catch pattern in sqlite via altering is limited, so we do it safely if possible)
    -- In SQLite, we can just run ALTER TABLE, but it will throw if it exists. So we ignore errors or use pragma.
  `);

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

  db.exec(`
    -- Ensure a demo user exists
    INSERT OR IGNORE INTO users (id, username) VALUES ('demo_user_123', 'Demo User');
    
    -- Ensure project '1' and '2' exists for the frontend mock
    INSERT OR IGNORE INTO projects (id, user_id, name, platform) VALUES ('1', 'demo_user_123', '职场效能笔记', 'xiaohongshu');
    INSERT OR IGNORE INTO customer_profiles (project_id) VALUES ('1');
    
    INSERT OR IGNORE INTO projects (id, user_id, name, platform) VALUES ('2', 'demo_user_123', 'AI工具探索者', 'xiaohongshu');
    INSERT OR IGNORE INTO customer_profiles (project_id) VALUES ('2');
  `);
}

// Ensure the db is initialized
initDb();
