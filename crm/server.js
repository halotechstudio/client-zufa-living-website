// ZUFA CRM — one small web server, no dependencies. Start with: npm start
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, metaReady, ROOT } from './lib/config.js';
import { db, STATUSES, STATUS_KEYS, logEvent, kvGet } from './lib/db.js';
import { ensureAdmin, checkPassword, hashPassword, createSession, sessionUser, sessionCookie, endSession, loginAllowed, loginFailed } from './lib/auth.js';
import { listLeads, exportRows, getLead, updateLead, deleteLead, saveOtherLead, campaigns, toCsv } from './lib/leads.js';
import { validSignature, handleWebhook, syncRecent, connectionStatus, subscribePage } from './lib/meta.js';

ensureAdmin();
const statusLabel = k => (STATUSES.find(s => s[0] === k) || [k, k])[1];

/* ---------- helpers ---------- */
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function send(res, code, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { ...SEC, 'Cache-Control': 'no-store', ...(isObj ? { 'Content-Type': 'application/json; charset=utf-8' } : {}), ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
const fail = (res, code, msg) => send(res, code, { error: msg });

function readBody(req, max = 1e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > max) { reject(Object.assign(new Error('Too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const raw = await readBody(req);
  try { return raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch { throw Object.assign(new Error('Bad JSON'), { code: 400 }); }
}
const clientIp = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };

// Website enquiries: allow only the site's own origins, and at most 5 per IP per 10 minutes.
const webHits = new Map();
function corsHeaders(req) {
  const o = (req.headers.origin || '').replace(/\/$/, '');
  return config.siteOrigins.includes(o) ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' } : null;
}

/* ---------- routes ---------- */
async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;

  if (m === 'GET' && STATIC[path]) {
    const [file, type] = STATIC[path];
    return send(res, 200, await readFile(join(ROOT, 'public', file)), { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  }
  if (path === '/health') return send(res, 200, { ok: true });

  /* Meta webhook */
  if (path === '/webhook' && m === 'GET') {
    const q = url.searchParams;
    if (q.get('hub.mode') === 'subscribe' && config.verifyToken && q.get('hub.verify_token') === config.verifyToken) {
      logEvent('webhook', true, 'Meta verified the webhook address');
      return send(res, 200, q.get('hub.challenge') || '', { 'Content-Type': 'text/plain' });
    }
    logEvent('webhook', false, 'Webhook verification failed: the verify token did not match META_VERIFY_TOKEN');
    return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain' });
  }
  if (path === '/webhook' && m === 'POST') {
    const raw = await readBody(req);
    if (!validSignature(raw, req.headers['x-hub-signature-256'])) {
      logEvent('webhook', false, config.appSecret ? 'Rejected a webhook with a bad signature (check META_APP_SECRET)' : 'Rejected a webhook: META_APP_SECRET is not set');
      return send(res, 401, 'Bad signature', { 'Content-Type': 'text/plain' });
    }
    let body; try { body = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, 'Bad JSON', { 'Content-Type': 'text/plain' }); }
    send(res, 200, 'EVENT_RECEIVED', { 'Content-Type': 'text/plain' }); // answer Meta at once, then fetch the lead
    handleWebhook(body).catch(e => logEvent('error', false, `Webhook processing: ${e.message}`));
    return;
  }

  /* Website enquiry form (public) */
  if (path === '/api/website-lead') {
    const cors = corsHeaders(req);
    if (m === 'OPTIONS') return send(res, cors ? 204 : 403, '', cors || {});
    if (m !== 'POST') return fail(res, 405, 'Method not allowed');
    if (!cors) return fail(res, 403, 'This website is not allowed to send enquiries (add it to SITE_ORIGINS).');
    const ip = clientIp(req), now = Date.now();
    const hits = (webHits.get(ip) || []).filter(t => t > now - 10 * 60e3);
    if (hits.length >= 5) return send(res, 429, { error: 'Too many requests' }, cors);
    webHits.set(ip, [...hits, now]);
    const d = await readJson(req);
    if (d.website) return send(res, 200, { ok: true }, cors);       // honeypot field filled → a bot; pretend it worked
    if (!String(d.name || '').trim() || !/\d{8,}/.test(String(d.phone || '').replace(/\D/g, ''))) return send(res, 400, { error: 'Name and phone are required' }, cors);
    const id = saveOtherLead('website', d);
    logEvent('website', true, `Website enquiry #${id}`);
    return send(res, 200, { ok: true }, cors);
  }

  /* Login */
  if (path === '/api/login' && m === 'POST') {
    const ip = clientIp(req);
    if (!loginAllowed(ip)) return fail(res, 429, 'Too many attempts. Try again in 15 minutes.');
    const { name, password } = await readJson(req);
    const u = db.prepare('SELECT * FROM users WHERE name = ? AND active = 1').get(String(name || '').trim());
    if (!u || !checkPassword(String(password || ''), u.pass_hash)) { loginFailed(ip); return fail(res, 401, 'Wrong name or password'); }
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, createSession(u.id)) });
  }
  if (path === '/api/logout' && m === 'POST') { endSession(req); return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) }); }

  if (!path.startsWith('/api/')) return fail(res, 404, 'Not found');

  /* Everything below needs a logged-in user */
  const user = sessionUser(req);
  if (!user) return fail(res, 401, 'Please log in');
  // Writes must be JSON: browsers can't send that cross-site without permission, which blocks forged requests.
  if (m !== 'GET' && !(req.headers['content-type'] || '').startsWith('application/json')) return fail(res, 415, 'Send JSON');
  const admin = () => { if (user.role !== 'admin') throw Object.assign(new Error('Only the admin can do this'), { code: 403 }); };
  const q = Object.fromEntries(url.searchParams);

  if (path === '/api/me' && m === 'GET') {
    return send(res, 200, {
      user, statuses: STATUSES, metaConnected: metaReady(), timezone: config.timezone,
      users: db.prepare('SELECT id, name, role, active FROM users ORDER BY active DESC, name').all(),
      campaigns: campaigns(),
    });
  }
  if (path === '/api/leads' && m === 'GET') return send(res, 200, listLeads(q, user));
  if (path === '/api/leads.csv' && m === 'GET') {
    const csv = toCsv(exportRows(q, user), statusLabel, config.timezone);
    return send(res, 200, csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="zufa-leads-${new Date().toISOString().slice(0, 10)}.csv"` });
  }
  if (path === '/api/leads' && m === 'POST') {
    const d = await readJson(req);
    if (!String(d.name || '').trim() && !String(d.phone || '').trim()) return fail(res, 400, 'Enter at least a name or a phone number');
    return send(res, 200, { id: saveOtherLead('manual', d, d.assign_to_me ? user.id : null) });
  }
  let mm;
  if ((mm = path.match(/^\/api\/leads\/(\d+)$/))) {
    const id = +mm[1];
    if (m === 'GET') { const l = getLead(id); return l ? send(res, 200, l) : fail(res, 404, 'Lead not found'); }
    if (m === 'PATCH') {
      const d = await readJson(req);
      if (d.status && !STATUS_KEYS.includes(d.status)) return fail(res, 400, 'Unknown status');
      return updateLead(id, d, user, statusLabel) ? send(res, 200, getLead(id)) : fail(res, 404, 'Lead not found');
    }
    if (m === 'DELETE') { admin(); return deleteLead(id) ? send(res, 200, { ok: true }) : fail(res, 404, 'Lead not found'); }
  }

  /* Settings (admin) */
  if (path === '/api/settings' && m === 'GET') {
    admin();
    return send(res, 200, {
      meta: await connectionStatus(), graphVersion: config.graphVersion, siteOrigins: config.siteOrigins,
      lastWebhook: kvGet('last_webhook_at'), lastSync: kvGet('last_sync_at'),
      events: db.prepare('SELECT at, kind, ok, detail FROM events ORDER BY id DESC LIMIT 30').all(),
    });
  }
  if (path === '/api/sync' && m === 'POST') {
    const { days } = await readJson(req);
    try { return send(res, 200, await syncRecent(Math.min(Math.max(+days || 7, 1), 90))); }
    catch (e) { logEvent('sync', false, e.message); return fail(res, 502, e.message); }
  }
  if (path === '/api/subscribe' && m === 'POST') {
    admin();
    try { await subscribePage(); logEvent('sync', true, 'Page subscribed to leadgen webhooks'); return send(res, 200, { ok: true }); }
    catch (e) { return fail(res, 502, e.message); }
  }
  if (path === '/api/users' && m === 'POST') {
    admin();
    const { name, password } = await readJson(req);
    const n = String(name || '').trim();
    if (!n || n.length > 60) return fail(res, 400, 'Enter a name');
    if (String(password || '').length < 8) return fail(res, 400, 'Password must be at least 8 characters');
    try { db.prepare("INSERT INTO users (name, pass_hash, role) VALUES (?, ?, 'sales')").run(n, hashPassword(password)); }
    catch { return fail(res, 400, 'That name is already taken'); }
    return send(res, 200, { ok: true });
  }
  if ((mm = path.match(/^\/api\/users\/(\d+)$/)) && m === 'PATCH') {
    admin();
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(+mm[1]);
    if (!u) return fail(res, 404, 'Not found');
    if (u.name === 'admin') return fail(res, 400, 'The admin password is set by ADMIN_PASSWORD on the server');
    const { password, active } = await readJson(req);
    if (password !== undefined) {
      if (String(password).length < 8) return fail(res, 400, 'Password must be at least 8 characters');
      db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(password), u.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    }
    if (active !== undefined) {
      db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, u.id);
      if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    }
    return send(res, 200, { ok: true });
  }

  return fail(res, 404, 'Not found');
}

const server = createServer((req, res) => {
  route(req, res).catch(e => {
    if (!e.code || typeof e.code !== 'number') console.error(e);
    if (!res.headersSent) fail(res, typeof e.code === 'number' ? e.code : 500, typeof e.code === 'number' ? e.message : 'Something went wrong');
  });
});
server.listen(config.port, () => {
  console.log(`ZUFA CRM running on http://localhost:${config.port}`);
  console.log(metaReady() ? `Meta: connected to Page ${config.pageId} (Graph API ${config.graphVersion})` : 'Meta: not connected yet (fill in crm/.env)');
});

// Safety net: every so often, pull recent leads in case a webhook was missed.
if (config.syncIntervalMin > 0) {
  setInterval(() => { if (metaReady()) syncRecent(2).catch(e => logEvent('sync', false, `Automatic check failed: ${e.message}`)); }, config.syncIntervalMin * 60e3).unref();
}
