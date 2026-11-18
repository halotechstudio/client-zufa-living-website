// Saving and querying leads.
import { all, one, run, STATUS_KEYS } from './db.js';

const isoTime = t => {
  if (!t) return new Date().toISOString();
  if (typeof t === 'number') return new Date(t * 1000).toISOString();
  const d = new Date(String(t).replace(/([+-]\d\d)(\d\d)$/, '$1:$2')); // Meta sends "+0000"
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
};
const pretty = k => k.replace(/_/g, ' ').replace(/\?$/, '').replace(/^\w/, c => c.toUpperCase()) + (k.endsWith('?') ? '?' : '');
const INTEREST = /plot|size|budget|interest|acre|villa|looking|requirement|estate/i;

/** Turn Meta's field_data [{name, values}] into contact fields plus a readable answer list. */
export function parseFieldData(fieldData = []) {
  const out = { answers: [] };
  let first = '', last = '';
  for (const f of fieldData) {
    const key = String(f.name || ''); const val = (f.values || []).join(', ');
    const k = key.toLowerCase();
    if (k === 'full_name' || k === 'name') out.full_name = val;
    else if (k === 'first_name') first = val;
    else if (k === 'last_name') last = val;
    else if (k === 'phone_number' || k === 'phone' || k === 'mobile_number') out.phone = val;
    else if (k === 'email' || k === 'work_email') out.email = val;
    else if (k === 'city') out.city = val;
    else if (!out.interest && INTEREST.test(k)) out.interest = val;
    out.answers.push({ q: pretty(key), a: val });
  }
  if (!out.full_name && (first || last)) out.full_name = `${first} ${last}`.trim();
  return out;
}

const system = (leadId, body) => run("INSERT INTO activity (lead_id, kind, body) VALUES ($1, 'system', $2)", [leadId, body]);

/** Insert or complete a Meta lead. De-duplicated by leadgen id. */
export async function saveMetaLead(lead, fetchError = null) {
  const p = parseFieldData(lead.field_data);
  const row = {
    leadgen_id: String(lead.id), full_name: p.full_name ?? null, phone: p.phone ?? null, email: p.email ?? null, city: p.city ?? null,
    interest: p.interest ?? null, answers: JSON.stringify(p.answers),
    form_id: lead.form_id ?? null, form_name: lead.form_name ?? null,
    ad_id: lead.ad_id ?? null, ad_name: lead.ad_name ?? null, adset_id: lead.adset_id ?? null, adset_name: lead.adset_name ?? null,
    campaign_id: lead.campaign_id ?? null, campaign_name: lead.campaign_name ?? null,
    platform: lead.platform ?? null, is_organic: lead.is_organic == null ? null : !!lead.is_organic, page_id: lead.page_id ?? null,
    created_time: isoTime(lead.created_time), fetch_error: fetchError, raw: fetchError ? null : JSON.stringify(lead),
  };
  const existing = await one('SELECT id, fetch_error FROM leads WHERE leadgen_id = $1', [row.leadgen_id]);
  if (existing) {
    if (existing.fetch_error && !fetchError) {   // placeholder from a failed webhook: fill it in now
      await run(`UPDATE leads SET full_name=:full_name, phone=:phone, email=:email, city=:city, interest=:interest, answers=:answers,
        form_id=:form_id, form_name=COALESCE(:form_name, form_name), ad_id=:ad_id, ad_name=:ad_name, adset_id=:adset_id, adset_name=:adset_name,
        campaign_id=:campaign_id, campaign_name=:campaign_name, platform=:platform, is_organic=:is_organic, created_time=:created_time,
        fetch_error=NULL, raw=:raw, updated_at=now() WHERE id=:id`, { ...row, id: existing.id });
      await system(existing.id, 'Lead details received from Meta');
    }
    return { id: existing.id, created: false };
  }
  // ON CONFLICT: two webhook deliveries for the same lead can arrive at the same moment on different instances.
  const ins = await one(`INSERT INTO leads (leadgen_id, source, full_name, phone, email, city, interest, answers, form_id, form_name, ad_id, ad_name,
    adset_id, adset_name, campaign_id, campaign_name, platform, is_organic, page_id, created_time, fetch_error, raw)
    VALUES (:leadgen_id, 'meta', :full_name, :phone, :email, :city, :interest, :answers, :form_id, :form_name, :ad_id, :ad_name,
    :adset_id, :adset_name, :campaign_id, :campaign_name, :platform, :is_organic, :page_id, :created_time, :fetch_error, :raw)
    ON CONFLICT (leadgen_id) DO NOTHING RETURNING id`, row);
  if (!ins) return { id: (await one('SELECT id FROM leads WHERE leadgen_id = $1', [row.leadgen_id])).id, created: false };
  const where = row.platform === 'ig' ? 'Instagram' : row.platform === 'fb' ? 'Facebook' : 'Meta';
  await system(ins.id, `New lead from ${where}${row.form_name ? ` (form “${row.form_name}”)` : ''}${fetchError ? ' — details pending' : ''}`);
  return { id: ins.id, created: true };
}

const clean = (v, n = 300) => (v == null ? '' : String(v)).trim().slice(0, n);

/** A lead typed in by the team, or sent by the website's enquiry form. */
export async function saveOtherLead(src, d, userId = null) {
  const answers = [];
  if (d.interest) answers.push({ q: 'Interested in', a: clean(d.interest) });
  if (d.plot) answers.push({ q: 'Plot no.', a: clean(d.plot, 40) });
  if (d.message) answers.push({ q: 'Message', a: clean(d.message, 2000) });
  if (d.page) answers.push({ q: 'Sent from page', a: clean(d.page, 300) });
  const r = await one(`INSERT INTO leads (source, full_name, phone, email, city, interest, answers, campaign_name, created_time, assigned_to)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9) RETURNING id`, [src, clean(d.name, 120) || null, clean(d.phone, 40) || null,
    clean(d.email, 200) || null, clean(d.city, 80) || null, clean(d.interest, 200) || null, JSON.stringify(answers),
    src === 'website' ? 'Website' : (clean(d.campaign, 120) || 'Walk-in / referral'), userId]);
  await system(r.id, src === 'website' ? 'New enquiry from the website' : 'Lead added by hand');
  return r.id;
}

/** Filters shared by the list and the CSV export. Column names are prefixed with "l." (the leads table alias). */
function where(q, user) {
  const w = [], p = {};
  if (q.q) { w.push("(l.full_name ILIKE :q OR l.phone ILIKE :q OR l.email ILIKE :q OR l.campaign_name ILIKE :q OR l.ad_name ILIKE :q OR l.form_name ILIKE :q OR l.interest ILIKE :q)"); p.q = `%${q.q}%`; }
  if (q.status && STATUS_KEYS.includes(q.status)) { w.push('l.status = :status'); p.status = q.status; }
  if (q.campaign) { w.push('COALESCE(l.campaign_name, l.form_name, l.source) = :campaign'); p.campaign = q.campaign; }
  if (q.source) { w.push('l.source = :source'); p.source = q.source; }
  if (q.assigned === 'none') w.push('l.assigned_to IS NULL');
  else if (q.assigned === 'me') { w.push('l.assigned_to = :me'); p.me = user.id; }
  else if (q.assigned && /^\d+$/.test(q.assigned)) { w.push('l.assigned_to = :as'); p.as = +q.assigned; }
  if (q.from && !isNaN(new Date(q.from))) { w.push('l.created_time >= :from'); p.from = new Date(q.from).toISOString(); }
  if (q.to && !isNaN(new Date(q.to))) { w.push('l.created_time < :to'); p.to = new Date(q.to).toISOString(); }
  return { sql: w.length ? 'WHERE ' + w.join(' AND ') : '', p };
}

const LIST_COLS = `l.id, l.source, l.full_name, l.phone, l.email, l.city, l.interest, l.form_name, l.ad_name, l.adset_name, l.campaign_name,
  l.platform, l.created_time, l.status, l.assigned_to, u.name AS assigned_name, l.next_follow_up, l.fetch_error`;
const FROM = 'FROM leads l LEFT JOIN users u ON u.id = l.assigned_to';

export async function listLeads(q, user) {
  const { sql, p } = where(q, user);
  const limit = Math.min(+q.limit || 100, 500), offset = Math.max(+q.offset || 0, 0);
  const rows = await all(`SELECT ${LIST_COLS} ${FROM} ${sql} ORDER BY l.created_time DESC, l.id DESC LIMIT ${limit} OFFSET ${offset}`, p);
  const total = (await one(`SELECT COUNT(*)::int n FROM leads l ${sql}`, p)).n;
  // Counts per status for the tabs, with every filter except status itself.
  const { sql: s2, p: p2 } = where({ ...q, status: '' }, user);
  const counts = Object.fromEntries((await all(`SELECT l.status, COUNT(*)::int n FROM leads l ${s2} GROUP BY l.status`, p2)).map(r => [r.status, r.n]));
  return { rows, total, counts };
}

export async function exportRows(q, user) {
  const { sql, p } = where(q, user);
  return all(`SELECT l.*, u.name AS assigned_name ${FROM} ${sql} ORDER BY l.created_time DESC, l.id DESC`, p);
}

export const campaigns = () =>
  all("SELECT COALESCE(campaign_name, form_name, source) c, COUNT(*)::int n FROM leads GROUP BY 1 ORDER BY MAX(created_time) DESC", []);

export async function getLead(id) {
  const lead = await one(`SELECT l.*, u.name AS assigned_name ${FROM} WHERE l.id = $1`, [id]);
  if (!lead) return null;
  delete lead.raw;
  lead.answers = JSON.parse(lead.answers || '[]');
  lead.activity = await all(`SELECT a.id, a.kind, a.body, a.created_at, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.lead_id = $1 ORDER BY a.created_at DESC, a.id DESC`, [id]);
  return lead;
}

const add = (leadId, userId, kind, body) => run('INSERT INTO activity (lead_id, user_id, kind, body) VALUES ($1, $2, $3, $4)', [leadId, userId, kind, body]);

export async function updateLead(id, d, user, statusLabel) {
  const lead = await one('SELECT * FROM leads WHERE id = $1', [id]);
  if (!lead) return false;
  if (d.status !== undefined && d.status !== lead.status) {
    if (!STATUS_KEYS.includes(d.status)) throw Object.assign(new Error('Unknown status'), { code: 400 });
    await run('UPDATE leads SET status = $1 WHERE id = $2', [d.status, id]);
    await add(id, user.id, 'status', `Status: ${statusLabel(lead.status)} → ${statusLabel(d.status)}`);
  }
  if (d.assigned_to !== undefined) {
    const to = d.assigned_to ? +d.assigned_to : null;
    if (to !== lead.assigned_to) {
      const u = to ? await one('SELECT name FROM users WHERE id = $1', [to]) : null;
      if (to && !u) throw Object.assign(new Error('Unknown team member'), { code: 400 });
      await run('UPDATE leads SET assigned_to = $1 WHERE id = $2', [to, id]);
      await add(id, user.id, 'assign', u ? `Assigned to ${u.name}` : 'Unassigned');
    }
  }
  if (d.next_follow_up !== undefined) {
    const v = d.next_follow_up ? clean(d.next_follow_up, 30) : null;
    if (v !== lead.next_follow_up) { await run('UPDATE leads SET next_follow_up = $1 WHERE id = $2', [v, id]); await add(id, user.id, 'system', v ? `Follow-up set for ${v}` : 'Follow-up cleared'); }
  }
  for (const k of ['full_name', 'phone', 'email', 'city', 'interest']) {
    if (d[k] !== undefined && clean(d[k]) !== (lead[k] || '')) await run(`UPDATE leads SET ${k} = $1 WHERE id = $2`, [clean(d[k]) || null, id]);
  }
  if (d.note && clean(d.note, 5000)) await add(id, user.id, 'note', clean(d.note, 5000));
  await run('UPDATE leads SET updated_at = now() WHERE id = $1', [id]);
  return true;
}

export const deleteLead = async id => (await run('DELETE FROM leads WHERE id = $1', [id])).count > 0;

export function toCsv(rows, statusLabel, tz) {
  const fmt = t => t ? new Date(t).toLocaleString('en-IN', { timeZone: tz, hour12: false }) : '';
  const cols = [['Received', r => fmt(r.created_time)], ['Name', 'full_name'], ['Phone', 'phone'], ['Email', 'email'], ['City', 'city'],
    ['Interested in', 'interest'], ['Status', r => statusLabel(r.status)], ['Assigned to', 'assigned_name'], ['Next follow-up', 'next_follow_up'],
    ['Source', 'source'], ['Platform', 'platform'], ['Campaign', 'campaign_name'], ['Ad set', 'adset_name'], ['Ad', 'ad_name'], ['Form', 'form_name'],
    ['All answers', r => JSON.parse(r.answers || '[]').map(x => `${x.q}: ${x.a}`).join(' | ')], ['Meta lead ID', 'leadgen_id'], ['Campaign ID', 'campaign_id'], ['Ad ID', 'ad_id'], ['Form ID', 'form_id']];
  const esc = v => { v = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(v) && !/^\+?[\d\s-]+$/.test(v)) v = "'" + v; /* block spreadsheet formulas, keep phone numbers */ return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const lines = [cols.map(c => c[0]).join(',')];
  for (const r of rows) lines.push(cols.map(([, f]) => esc(typeof f === 'function' ? f(r) : r[f])).join(','));
  return '﻿' + lines.join('\r\n');
}
