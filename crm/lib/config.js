import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Load crm/.env when it exists (local runs). On Vercel, the project's Environment Variables are used.
const envFile = process.env.ENV_FILE || join(ROOT, '.env');
if (existsSync(envFile)) {
  try { process.loadEnvFile(envFile); } catch (e) { console.error('Could not read .env:', e.message); }
}

const e = (k, d = '') => (process.env[k] ?? d).trim();
const dataDir = e('DATA_DIR', './data');

export const config = {
  port: +e('PORT', '3000') || 3000,
  // Neon through the Vercel Marketplace sets DATABASE_URL (older setups: POSTGRES_URL)
  databaseUrl: e('DATABASE_URL') || e('POSTGRES_URL'),
  dataDir: dataDir === ':memory:' ? dataDir : resolve(ROOT, dataDir),
  adminPassword: e('ADMIN_PASSWORD'),
  appId: e('META_APP_ID'),
  appSecret: e('META_APP_SECRET'),
  verifyToken: e('META_VERIFY_TOKEN'),
  pageId: e('META_PAGE_ID'),
  pageToken: e('META_PAGE_ACCESS_TOKEN'),
  graphVersion: e('GRAPH_API_VERSION', 'v26.0'),
  graphBase: e('GRAPH_API_BASE', 'https://graph.facebook.com').replace(/\/$/, ''),
  siteOrigins: e('SITE_ORIGINS').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean),
  timezone: e('TIMEZONE', 'Asia/Kolkata'),
  // Vercel sends "Authorization: Bearer <CRON_SECRET>" with every cron call
  cronSecret: e('CRON_SECRET'),
  // Catch-up check runs when someone opens the dashboard and the last check is older than this
  syncIntervalMin: +e('SYNC_INTERVAL_MINUTES', '60') || 0,
};

export const metaReady = () => !!(config.pageToken && config.pageId);
