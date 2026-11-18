import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Load crm/.env when it exists (locally). On a host, real environment variables win.
const envFile = process.env.ENV_FILE || join(ROOT, '.env');
if (existsSync(envFile)) {
  try { process.loadEnvFile(envFile); } catch (e) { console.error('Could not read .env:', e.message); }
}

const e = (k, d = '') => (process.env[k] ?? d).trim();

export const config = {
  port: +e('PORT', '3000') || 3000,
  dataDir: resolve(ROOT, e('DATA_DIR', './data')),
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
  syncIntervalMin: +e('SYNC_INTERVAL_MINUTES', '60') || 0,
};

export const metaReady = () => !!(config.pageToken && config.pageId);
