// End-to-end check without touching Meta: a fake Graph API + the real CRM server, driven over HTTP.
// Run: npm test   (from the crm folder)
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const CRM_DIR = fileURLToPath(new URL('..', import.meta.url));
const APP_SECRET = 'test-app-secret', TOKEN = 'EAAtestpagetoken', PAGE = '111222333', APP = '999888777';
const SITE = 'https://zufa.example';

/* ---- fake Graph API ---- */
const LEADS = {
  '5001': { id: '5001', created_time: '2026-11-16T09:30:00+0000', form_id: 'F1', ad_id: 'A1', ad_name: 'Weekend estate — video', adset_id: 'S1', adset_name: 'Hyderabad 30-55',
    campaign_id: 'C1', campaign_name: 'ZUFA Nov leads', platform: 'ig', is_organic: false,
    field_data: [{ name: 'full_name', values: ['Ravi Kumar'] }, { name: 'phone_number', values: ['+919876543210'] }, { name: 'email', values: ['ravi@example.com'] },
      { name: 'which_plot_size_are_you_interested_in?', values: ['Half-acre (₹1.20 Cr)'] }, { name: 'when_would_you_like_to_visit?', values: ['This weekend'] }] },
  '5002': { id: '5002', created_time: '2026-11-17T04:00:00+0000', form_id: 'F1', ad_id: 'A1', campaign_name: 'ZUFA Nov leads', platform: 'fb', is_organic: false,
    field_data: [{ name: 'first_name', values: ['Anita'] }, { name: 'last_name', values: ['Rao'] }, { name: 'phone_number', values: ['9988776655'] }] },
};
let failLead = '5002';          // the first fetch of this lead fails, to test the "details pending" path
const graphCalls = [];
const graph = createServer((req, res) => {
  const u = new URL(req.url, 'http://g');
  graphCalls.push(`${req.method} ${u.pathname}`);
  const j = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (u.searchParams.get('access_token') !== TOKEN) return j(400, { error: { message: 'Invalid OAuth access token', code: 190 } });
  const proof = createHmac('sha256', APP_SECRET).update(TOKEN).digest('hex');
  if (u.searchParams.get('appsecret_proof') && u.searchParams.get('appsecret_proof') !== proof) return j(400, { error: { message: 'bad proof', code: 100 } });
  const p = u.pathname.replace(/^\/v26\.0\//, '');
  if (req.method === 'POST' && p === `${PAGE}/subscribed_apps`) return j(200, { success: true });
  if (p === `${PAGE}/subscribed_apps`) return j(200, { data: [{ id: APP, name: 'ZUFA CRM', subscribed_fields: ['leadgen'] }] });
  if (p === PAGE) return j(200, { id: PAGE, name: 'ZUFA Living' });
  if (p === `${PAGE}/leadgen_forms`) return j(200, { data: [{ id: 'F1', name: 'Site visit form', status: 'ACTIVE' }] });
  if (p === 'F1') return j(200, { id: 'F1', name: 'Site visit form' });
  if (p === 'F1/leads') {
    assert.match(u.searchParams.get('filtering'), /time_created/);
    return j(200, { data: Object.values(LEADS) });
  }
  if (LEADS[p]) {
    if (p === failLead) { failLead = null; return j(500, { error: { message: 'Temporary Meta outage', code: 2 } }); }
    return j(200, LEADS[p]);
  }
  j(404, { error: { message: `Unknown path ${p}`, code: 803 } });
});
await new Promise(r => graph.listen(0, r));
const GRAPH = `http://127.0.0.1:${graph.address().port}`;

/* ---- start the CRM ---- */
const dataDir = mkdtempSync(join(tmpdir(), 'zcrm-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const crm = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
  cwd: CRM_DIR, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ENV_FILE: join(dataDir, 'none.env'), PORT: String(PORT), DATA_DIR: dataDir, ADMIN_PASSWORD: 'admin-pass-123',
    META_APP_ID: APP, META_APP_SECRET: APP_SECRET, META_VERIFY_TOKEN: 'zufa-verify', META_PAGE_ID: PAGE, META_PAGE_ACCESS_TOKEN: TOKEN,
    GRAPH_API_BASE: GRAPH, SITE_ORIGINS: SITE, SYNC_INTERVAL_MINUTES: '0' },
});
let log = ''; crm.stdout.on('data', d => (log += d)); crm.stderr.on('data', d => (log += d));
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50 && !log.includes('running on'); i++) await new Promise(r => setTimeout(r, 100));

let passed = 0;
const step = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '\n', e); console.log(log); cleanup(1); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
let cookie = '';
const call = async (path, opts = {}) => {
  const res = await fetch(BASE + path, { method: opts.method || 'GET', headers: { ...(cookie ? { cookie } : {}), ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...opts.headers }, body: opts.body ? JSON.stringify(opts.body) : opts.raw });
  return { status: res.status, headers: res.headers, text: await res.text() };
};
const json = r => JSON.parse(r.text);
const sign = body => 'sha256=' + createHmac('sha256', APP_SECRET).update(body).digest('hex');
const webhookBody = id => JSON.stringify({ object: 'page', entry: [{ id: PAGE, time: 1763285400, changes: [{ field: 'leadgen', value: { leadgen_id: id, page_id: PAGE, form_id: 'F1', adgroup_id: 'A1', ad_id: 'A1', created_time: 1763285400 } }] }] });
function cleanup(code = 0) { crm.kill(); graph.close(); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} process.exit(code); }

console.log('ZUFA CRM end-to-end test');
await step('webhook verification handshake (right and wrong token)', async () => {
  let r = await call('/webhook?hub.mode=subscribe&hub.verify_token=zufa-verify&hub.challenge=12345');
  assert.equal(r.status, 200); assert.equal(r.text, '12345');
  r = await call('/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345');
  assert.equal(r.status, 403);
});
await step('webhook with a missing or forged signature is rejected', async () => {
  const b = webhookBody('5001');
  assert.equal((await call('/webhook', { method: 'POST', raw: b, headers: { 'Content-Type': 'application/json' } })).status, 401);
  assert.equal((await call('/webhook', { method: 'POST', raw: b, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + 'a'.repeat(64) } })).status, 401);
});
await step('dashboard API needs a login; wrong password refused', async () => {
  assert.equal((await call('/api/leads')).status, 401);
  assert.equal((await call('/api/login', { method: 'POST', body: { name: 'admin', password: 'nope' } })).status, 401);
  const r = await call('/api/login', { method: 'POST', body: { name: 'admin', password: 'admin-pass-123' } });
  assert.equal(r.status, 200); cookie = r.headers.get('set-cookie').split(';')[0];
});
await step('signed webhook → lead fetched from Graph API and stored with names and answers', async () => {
  const b = webhookBody('5001');
  const r = await call('/webhook', { method: 'POST', raw: b, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(b) } });
  assert.equal(r.status, 200);
  await wait(400);
  const list = json(await call('/api/leads'));
  assert.equal(list.total, 1);
  const l = json(await call(`/api/leads/${list.rows[0].id}`));
  assert.equal(l.full_name, 'Ravi Kumar'); assert.equal(l.phone, '+919876543210'); assert.equal(l.email, 'ravi@example.com');
  assert.equal(l.interest, 'Half-acre (₹1.20 Cr)'); assert.equal(l.campaign_name, 'ZUFA Nov leads'); assert.equal(l.form_name, 'Site visit form');
  assert.equal(l.platform, 'ig'); assert.equal(l.status, 'new'); assert.equal(l.created_time, '2026-11-16T09:30:00.000Z');
  assert.ok(l.answers.some(a => a.q === 'When would you like to visit?' && a.a === 'This weekend'));
});
await step('the same webhook again does not create a duplicate', async () => {
  const b = webhookBody('5001');
  await call('/webhook', { method: 'POST', raw: b, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(b) } });
  await wait(300);
  assert.equal(json(await call('/api/leads')).total, 1);
});
await step('Graph API failure keeps a placeholder; sync fills it in later', async () => {
  const b = webhookBody('5002');
  await call('/webhook', { method: 'POST', raw: b, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(b) } });
  await wait(400);
  let list = json(await call('/api/leads'));
  assert.equal(list.total, 2);
  const ph = list.rows.find(r => r.fetch_error);
  assert.ok(ph, 'placeholder row with fetch_error');
  const s = json(await call('/api/sync', { method: 'POST', body: { days: 7 } }));
  assert.equal(s.forms, 1); assert.equal(s.added, 0);
  const l = json(await call(`/api/leads/${ph.id}`));
  assert.equal(l.full_name, 'Anita Rao'); assert.equal(l.fetch_error, null);
  assert.equal(json(await call('/api/leads')).total, 2);
});
await step('status pipeline, assignment, follow-up and notes', async () => {
  const id = json(await call('/api/leads?q=Ravi')).rows[0].id;
  let r = await call('/api/users', { method: 'POST', body: { name: 'Suresh', password: 'sales-pass-1' } });
  assert.equal(r.status, 200);
  const me = json(await call('/api/me'));
  const suresh = me.users.find(u => u.name === 'Suresh');
  r = await call(`/api/leads/${id}`, { method: 'PATCH', body: { status: 'visit_booked', assigned_to: suresh.id, next_follow_up: '2026-11-22', note: 'Coming Saturday 11am with family' } });
  const l = json(r);
  assert.equal(l.status, 'visit_booked'); assert.equal(l.assigned_name, 'Suresh'); assert.equal(l.next_follow_up, '2026-11-22');
  assert.ok(l.activity.some(a => a.kind === 'note' && a.body.includes('Saturday')));
  assert.ok(l.activity.some(a => a.body === 'Status: New → Site visit booked'));
  assert.equal((await call(`/api/leads/${id}`, { method: 'PATCH', body: { status: 'bogus' } })).status, 400);
});
await step('filters: status, campaign, assignee, search, dates', async () => {
  assert.equal(json(await call('/api/leads?status=visit_booked')).total, 1);
  assert.equal(json(await call('/api/leads?status=new')).total, 1);
  assert.equal(json(await call('/api/leads?campaign=' + encodeURIComponent('ZUFA Nov leads'))).total, 2);
  assert.equal(json(await call('/api/leads?assigned=none')).total, 1);
  assert.equal(json(await call('/api/leads?q=9988')).total, 1);
  assert.equal(json(await call('/api/leads?from=2026-11-17T00:00:00.000Z')).total, 1);
  const counts = json(await call('/api/leads?status=new')).counts;
  assert.deepEqual(counts, { new: 1, visit_booked: 1 });
});
await step('website enquiry form: allowed origin only, honeypot, stored as a lead', async () => {
  let r = await call('/api/website-lead', { method: 'OPTIONS', headers: { Origin: SITE, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), SITE);
  r = await call('/api/website-lead', { method: 'POST', body: { name: 'X', phone: '9999999999' }, headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
  r = await call('/api/website-lead', { method: 'POST', body: { name: 'Bot', phone: '9999999999', website: 'spam.com' }, headers: { Origin: SITE } });
  assert.equal(r.status, 200);
  r = await call('/api/website-lead', { method: 'POST', body: { name: 'Meera Shah', phone: '+91 90000 11111', interest: 'Quarter-acre estate', plot: '12' }, headers: { Origin: SITE } });
  assert.equal(r.status, 200);
  const list = json(await call('/api/leads?q=Meera'));
  assert.equal(list.total, 1); assert.equal(list.rows[0].source, 'website');
  assert.equal(json(await call('/api/leads?q=Bot')).total, 0);
});
await step('CSV export', async () => {
  const r = await call('/api/leads.csv');
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/csv/);
  const lines = r.text.replace(/^﻿/, '').split('\r\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^Received,Name,Phone/);
  assert.ok(r.text.includes('+919876543210') && !r.text.includes("'+91"), 'phone numbers kept as-is');
});
await step('settings: Meta connection check and Page subscription', async () => {
  const s = json(await call('/api/settings'));
  assert.equal(s.meta.page, 'ZUFA Living'); assert.equal(s.meta.subscribed, true);
  assert.equal((await call('/api/subscribe', { method: 'POST', body: {} })).status, 200);
});
await step('salespeople cannot open admin settings', async () => {
  const admin = cookie;
  const r = await call('/api/login', { method: 'POST', body: { name: 'Suresh', password: 'sales-pass-1' } });
  cookie = r.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/settings')).status, 403);
  assert.equal(json(await call('/api/leads?assigned=me')).total, 1);
  cookie = admin;
});
await step('writes without JSON content type are refused (cross-site form protection)', async () => {
  const r = await call('/api/sync', { method: 'POST', raw: 'days=7', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(r.status, 415);
});

console.log(`\n${passed} checks passed. Graph API calls made: ${graphCalls.length}`);
cleanup(0);
