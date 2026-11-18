// Postgres storage. On Vercel: Neon (DATABASE_URL, added through the Vercel Marketplace).
// Locally, with no DATABASE_URL: PGlite, a real Postgres that runs inside Node and keeps its files in DATA_DIR.
import { config } from './config.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'sales',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_name ON users (lower(name))`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY,
    leadgen_id TEXT UNIQUE,
    source TEXT NOT NULL DEFAULT 'meta',
    full_name TEXT, phone TEXT, email TEXT, city TEXT,
    interest TEXT,
    answers TEXT NOT NULL DEFAULT '[]',
    form_id TEXT, form_name TEXT,
    ad_id TEXT, ad_name TEXT, adset_id TEXT, adset_name TEXT,
    campaign_id TEXT, campaign_name TEXT,
    platform TEXT, is_organic BOOLEAN, page_id TEXT,
    created_time TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'new',
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    next_follow_up TEXT,
    fetch_error TEXT,
    raw TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS leads_created ON leads (created_time DESC)`,
  `CREATE INDEX IF NOT EXISTS leads_status ON leads (status)`,
  `CREATE TABLE IF NOT EXISTS activity (
    id SERIAL PRIMARY KEY,
    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS activity_lead ON activity (lead_id)`,
  `CREATE TABLE IF NOT EXISTS forms (form_id TEXT PRIMARY KEY, name TEXT)`,
  `CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind TEXT NOT NULL,
    ok BOOLEAN NOT NULL,
    detail TEXT)`,
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`,
  // Rate limiting that works across serverless instances: one row per attempt.
  `CREATE TABLE IF NOT EXISTS hits (key TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS hits_key ON hits (key, at)`,
];

let driver;
async function connect() {
  if (config.databaseUrl) {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(config.databaseUrl, { fullResults: true });
    return async (text, params) => { const r = await sql.query(text, params); return { rows: r.rows, count: r.rowCount ?? 0 }; };
  }
  const name = '@electric-sql/pglite'; // kept out of the Vercel bundle: only used locally
  let PGlite;
  try { ({ PGlite } = await import(name)); }
  catch { throw new Error('No DATABASE_URL set. For a local database run "npm install" in the crm folder first.'); }
  const { mkdirSync } = await import('node:fs');
  const dir = config.dataDir === ':memory:' ? undefined : (mkdirSync(config.dataDir, { recursive: true }), `${config.dataDir}/pglite`);
  const pg = new PGlite(dir);
  return async (text, params) => { const r = await pg.query(text, params); return { rows: r.rows, count: r.affectedRows ?? 0 }; };
}

// Write SQL with :named parameters; they become $1, $2… for Postgres. ("::" casts are left alone.)
function positional(sql, obj) {
  const names = [], vals = [];
  const text = sql.replace(/(?<![:\w]):([a-z_][a-z0-9_]*)/gi, (_, n) => {
    let i = names.indexOf(n);
    if (i < 0) { names.push(n); vals.push(obj[n] === undefined ? null : obj[n]); i = names.length - 1; }
    return '$' + (i + 1);
  });
  return [text, vals];
}

let ready;
async function exec(sql, params) {
  if (!ready) ready = (async () => { driver = await connect(); for (const s of SCHEMA) await driver(s, []); })().catch(e => { ready = null; throw e; });
  await ready;
  const [text, vals] = Array.isArray(params) || params === undefined ? [sql, params || []] : positional(sql, params);
  return driver(text, vals);
}

/** All rows. params: an array for $1… or an object for :named. */
export const all = async (sql, params) => (await exec(sql, params)).rows;
/** First row or null. */
export const one = async (sql, params) => (await exec(sql, params)).rows[0] ?? null;
/** For writes: { rows, count }. */
export const run = (sql, params) => exec(sql, params);

export const STATUSES = [
  ['new', 'New'],
  ['contacted', 'Contacted'],
  ['visit_booked', 'Site visit booked'],
  ['negotiation', 'Negotiation'],
  ['won', 'Won'],
  ['lost', 'Lost'],
];
export const STATUS_KEYS = STATUSES.map(s => s[0]);

export async function logEvent(kind, ok, detail) {
  await run('INSERT INTO events (kind, ok, detail) VALUES ($1, $2, $3)', [kind, !!ok, String(detail ?? '').slice(0, 2000)]);
  await run('DELETE FROM events WHERE id < (SELECT MAX(id) - 500 FROM events)', []);
}

export const kvGet = async k => (await one('SELECT v FROM kv WHERE k = $1', [k]))?.v ?? null;
export const kvSet = (k, v) => run('INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = excluded.v', [k, String(v)]);

/** Simple rate limit shared by all instances: true if `key` has had fewer than `max` hits in the last `minutes`. Records this hit. */
export async function allowHit(key, max, minutes) {
  const { n } = await one(`SELECT COUNT(*)::int n FROM hits WHERE key = $1 AND at > now() - make_interval(mins => $2::int)`, [key, minutes]);
  if (n >= max) return false;
  await run('INSERT INTO hits (key) VALUES ($1)', [key]);
  if (Math.random() < 0.05) await run(`DELETE FROM hits WHERE at < now() - interval '1 day'`, []);
  return true;
}
export const countHits = async (key, minutes) => (await one(`SELECT COUNT(*)::int n FROM hits WHERE key = $1 AND at > now() - make_interval(mins => $2::int)`, [key, minutes])).n;
export const addHit = key => run('INSERT INTO hits (key) VALUES ($1)', [key]);
