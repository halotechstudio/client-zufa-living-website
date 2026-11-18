import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(join(config.dataDir, 'crm.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'sales',          -- 'admin' | 'sales'
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  leadgen_id TEXT UNIQUE,                       -- Meta lead id (NULL for website/manual leads)
  source TEXT NOT NULL DEFAULT 'meta',          -- 'meta' | 'website' | 'manual'
  full_name TEXT, phone TEXT, email TEXT, city TEXT,
  interest TEXT,                                -- plot size / budget answer, if the form asked
  answers TEXT NOT NULL DEFAULT '[]',           -- JSON [{q, a}] of every form answer
  form_id TEXT, form_name TEXT,
  ad_id TEXT, ad_name TEXT, adset_id TEXT, adset_name TEXT,
  campaign_id TEXT, campaign_name TEXT,
  platform TEXT, is_organic INTEGER, page_id TEXT,
  created_time TEXT NOT NULL,                   -- ISO UTC, when the person submitted
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status TEXT NOT NULL DEFAULT 'new',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  next_follow_up TEXT,
  fetch_error TEXT,                             -- set when Meta details could not be fetched yet
  raw TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS leads_created ON leads(created_time);
CREATE INDEX IF NOT EXISTS leads_status ON leads(status);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,                           -- 'note' | 'status' | 'assign' | 'system'
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS activity_lead ON activity(lead_id);
CREATE TABLE IF NOT EXISTS forms (form_id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  kind TEXT NOT NULL,                           -- 'webhook' | 'sync' | 'error'
  ok INTEGER NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
`);

export const STATUSES = [
  ['new', 'New'],
  ['contacted', 'Contacted'],
  ['visit_booked', 'Site visit booked'],
  ['negotiation', 'Negotiation'],
  ['won', 'Won'],
  ['lost', 'Lost'],
];
export const STATUS_KEYS = STATUSES.map(s => s[0]);

export function logEvent(kind, ok, detail) {
  db.prepare('INSERT INTO events (kind, ok, detail) VALUES (?, ?, ?)').run(kind, ok ? 1 : 0, String(detail ?? '').slice(0, 2000));
  db.prepare("DELETE FROM events WHERE id < (SELECT MAX(id) - 500 FROM events)").run();
}

export const kvGet = k => db.prepare('SELECT v FROM kv WHERE k = ?').get(k)?.v ?? null;
export const kvSet = (k, v) => db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v));
