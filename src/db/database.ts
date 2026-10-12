import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fb_post_id TEXT UNIQUE,
  url TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('hashtag','fanpage','manual')),
  author_id TEXT,
  author_name TEXT,
  author_url TEXT,
  text TEXT,
  posted_at TEXT,
  reactions INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  comments_fetched_count INTEGER NOT NULL DEFAULT -1,
  hidden INTEGER NOT NULL DEFAULT 0,
  ai_summary TEXT,
  ai_topic TEXT,
  ai_sentiment TEXT,
  ai_on_topic INTEGER,
  ai_score REAL,
  ai_reason TEXT,
  ai_scored_text_hash TEXT,
  first_seen_at TEXT NOT NULL,
  metrics_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  reactions INTEGER NOT NULL,
  comments INTEGER NOT NULL,
  shares INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_post ON metric_snapshots(post_id, captured_at);

CREATE TABLE IF NOT EXISTS comments (
  comment_id TEXT PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  profile_key TEXT NOT NULL,
  profile_name TEXT,
  profile_url TEXT,
  text TEXT,
  commented_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_profile ON comments(profile_key);

CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','ok','error')),
  detail TEXT
);
`;

/** Opens (and migrates) the SQLite database. Use ":memory:" for tests. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  // A crash mid-job leaves "running" rows behind; they can never finish.
  db.prepare("UPDATE job_runs SET status = 'error', detail = 'Bị dừng do khởi động lại' WHERE status = 'running'").run();
  return db;
}

/** Runs fn inside a transaction; rolls back on error. */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
