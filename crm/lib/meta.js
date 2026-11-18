// Talking to Meta: verifying webhooks and reading leads from the Graph API.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config, metaReady } from './config.js';
import { db, logEvent, kvSet } from './db.js';
import { saveMetaLead } from './leads.js';

const FULL_FIELDS = 'id,created_time,field_data,form_id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,platform,is_organic,custom_disclaimer_responses';
const BASIC_FIELDS = 'id,created_time,field_data,form_id,ad_id,adset_id,campaign_id,platform,is_organic';

/** Meta signs every webhook with the App Secret: header "X-Hub-Signature-256: sha256=<hex>". */
export function validSignature(rawBody, header) {
  if (!config.appSecret || !header?.startsWith('sha256=')) return false;
  const want = Buffer.from(createHmac('sha256', config.appSecret).update(rawBody).digest('hex'));
  const got = Buffer.from(header.slice(7));
  return want.length === got.length && timingSafeEqual(want, got);
}

class GraphError extends Error {
  constructor(err, status) { super(err?.message || `Graph API HTTP ${status}`); this.code = err?.code; this.status = status; }
}

async function graph(path, params = {}) {
  const url = path.startsWith('http') ? new URL(path) : new URL(`${config.graphBase}/${config.graphVersion}/${path.replace(/^\//, '')}`);
  if (!path.startsWith('http')) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    url.searchParams.set('access_token', config.pageToken);
    if (config.appSecret) url.searchParams.set('appsecret_proof', createHmac('sha256', config.appSecret).update(config.pageToken).digest('hex'));
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new GraphError(json.error, res.status);
  return json;
}

// Ad / campaign names need ads permissions. If Meta refuses them, fall back to the basic fields so the lead still arrives.
let namesAllowed = true;
async function graphLeadFields(path, params) {
  if (namesAllowed) {
    try { return await graph(path, { ...params, fields: FULL_FIELDS }); }
    catch (e) {
      if (![100, 10, 200, 270, 294].includes(e.code)) throw e;
      namesAllowed = false;
      logEvent('error', false, `Ad/campaign names not readable (${e.message}). Saving leads without them; give the token ads_read or ads_management to get names.`);
    }
  }
  return graph(path, { ...params, fields: BASIC_FIELDS });
}

async function formName(formId) {
  if (!formId) return null;
  const cached = db.prepare('SELECT name FROM forms WHERE form_id = ?').get(formId);
  if (cached) return cached.name;
  try {
    const f = await graph(formId, { fields: 'name' });
    db.prepare('INSERT OR REPLACE INTO forms (form_id, name) VALUES (?, ?)').run(formId, f.name || null);
    return f.name || null;
  } catch { return null; }
}

/** Fetch one lead by its leadgen id and save it. Returns { lead, created }. */
export async function fetchAndSaveLead(leadgenId, hint = {}) {
  const lead = await graphLeadFields(leadgenId, {});
  lead.form_name = await formName(lead.form_id || hint.form_id);
  return saveMetaLead({ ...lead, page_id: hint.page_id || config.pageId, form_id: lead.form_id || hint.form_id, ad_id: lead.ad_id || hint.ad_id });
}

/** Handle the body of a POST /webhook (already signature-checked). */
export async function handleWebhook(body) {
  if (body?.object !== 'page') return;
  for (const entry of body.entry || []) {
    for (const ch of entry.changes || []) {
      if (ch.field !== 'leadgen' || !ch.value?.leadgen_id) continue;
      const v = ch.value;
      try {
        if (!metaReady()) throw new Error('META_PAGE_ACCESS_TOKEN / META_PAGE_ID are not set');
        const { created } = await fetchAndSaveLead(String(v.leadgen_id), { page_id: v.page_id, form_id: v.form_id, ad_id: v.ad_id });
        logEvent('webhook', true, `Lead ${v.leadgen_id} ${created ? 'saved' : 'already known'}`);
      } catch (e) {
        // Keep a placeholder so the lead isn't lost; the next sync fills in the details.
        saveMetaLead({ id: String(v.leadgen_id), created_time: v.created_time ? new Date(v.created_time * 1000).toISOString() : new Date().toISOString(),
          form_id: v.form_id, ad_id: v.ad_id, page_id: v.page_id, field_data: [] }, e.message);
        logEvent('webhook', false, `Lead ${v.leadgen_id}: could not fetch details — ${e.message}`);
      }
    }
  }
  kvSet('last_webhook_at', new Date().toISOString());
}

/** Backfill: read every lead form on the Page and pull leads from the last `days` days. */
export async function syncRecent(days = 7) {
  if (!metaReady()) throw new Error('Meta is not connected yet (META_PAGE_ID and META_PAGE_ACCESS_TOKEN are empty).');
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  let forms = [], next = null;
  do {
    const page = next ? await graph(next) : await graph(`${config.pageId}/leadgen_forms`, { fields: 'id,name,status', limit: '100' });
    forms.push(...(page.data || [])); next = page.paging?.next;
  } while (next);
  for (const f of forms) db.prepare('INSERT OR REPLACE INTO forms (form_id, name) VALUES (?, ?)').run(f.id, f.name || null);

  let seen = 0, added = 0;
  // Also retry placeholders whose details failed earlier.
  for (const r of db.prepare("SELECT leadgen_id FROM leads WHERE fetch_error IS NOT NULL AND leadgen_id IS NOT NULL").all()) {
    try { await fetchAndSaveLead(r.leadgen_id); } catch {}
  }
  for (const f of forms) {
    let page = await graphLeadFields(`${f.id}/leads`, { limit: '100', filtering: [{ field: 'time_created', operator: 'GREATER_THAN', value: since }] });
    for (;;) {
      for (const lead of page.data || []) {
        seen++;
        const { created } = saveMetaLead({ ...lead, form_id: lead.form_id || f.id, form_name: f.name, page_id: config.pageId });
        if (created) added++;
      }
      if (!page.paging?.next) break;
      page = await graph(page.paging.next);
    }
  }
  const msg = `Checked ${forms.length} form(s), ${seen} lead(s) from the last ${days} day(s); ${added} new.`;
  logEvent('sync', true, msg);
  kvSet('last_sync_at', new Date().toISOString());
  return { forms: forms.length, seen, added, message: msg };
}

/** For the Settings page: is the token valid, which Page is it for, is the app subscribed? */
export async function connectionStatus() {
  const out = { configured: { appId: !!config.appId, appSecret: !!config.appSecret, verifyToken: !!config.verifyToken, pageId: !!config.pageId, pageToken: !!config.pageToken } };
  if (!metaReady()) return out;
  try { const p = await graph(config.pageId, { fields: 'id,name' }); out.page = p.name; }
  catch (e) { out.pageError = e.message; }
  try { const s = await graph(`${config.pageId}/subscribed_apps`, {}); out.subscribed = (s.data || []).some(a => String(a.id) === String(config.appId) && (a.subscribed_fields || []).includes('leadgen')); }
  catch (e) { out.subscribeError = e.message; }
  return out;
}

/** Subscribe the Page to this app's leadgen webhooks (same as the README's manual step). */
export async function subscribePage() {
  if (!metaReady()) throw new Error('Meta is not connected yet.');
  const url = new URL(`${config.graphBase}/${config.graphVersion}/${config.pageId}/subscribed_apps`);
  url.searchParams.set('subscribed_fields', 'leadgen');
  url.searchParams.set('access_token', config.pageToken);
  const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(20000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new GraphError(json.error, res.status);
  return json;
}
