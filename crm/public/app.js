// ZUFA CRM dashboard. Plain JS, no build step. Every bit of lead data goes in through textContent (never innerHTML).

/* ---------- tiny helpers ---------- */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const $ = (s, r = document) => r.querySelector(s);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET', credentials: 'same-origin',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && path !== '/api/login') { state.me = null; render(); throw new Error('Please log in'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

let toastT;
function toast(msg, bad = false) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false; t.classList.toggle('is-bad', bad);
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), bad ? 6000 : 3000);
}

const state = { me: null, filters: { q: '', status: '', campaign: '', assigned: '', range: 'all', from: '', to: '' }, rows: [], total: 0, counts: {}, offset: 0 };
const PAGE = 100;
try { Object.assign(state.filters, JSON.parse(localStorage.getItem('zcrm-filters') || '{}')); } catch {}

const tz = () => state.me?.timezone || 'Asia/Kolkata';
const fmtTime = iso => {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const opts = { timeZone: tz(), day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleString('en-IN', opts);
};
const ago = iso => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`; if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtTime(iso);
};
const statusName = k => (state.me.statuses.find(s => s[0] === k) || [k, k])[1];
const statusPill = k => h('span', { class: 'pill', style: `--c: var(--s-${k})` }, statusName(k));
const digits = p => String(p || '').replace(/\D/g, '');
const waNumber = p => { const d = digits(p); return d.length === 10 ? '91' + d : d.replace(/^0+/, ''); };
const platformName = p => ({ fb: 'Facebook', ig: 'Instagram', an: 'Audience Network', ms: 'Messenger' }[p] || p || '');
const srcLabel = r => r.source === 'website' ? 'Web' : r.source === 'manual' ? 'Manual' : (r.platform === 'ig' ? 'IG' : r.platform === 'fb' ? 'FB' : 'Meta');

/* ---------- routing ---------- */
const route = () => { const m = location.hash.match(/^#\/(\w+)(?:\/(\d+))?/); return { page: m?.[1] || 'leads', id: m?.[2] ? +m[2] : null }; };
addEventListener('hashchange', () => render());

async function boot() {
  try { state.me = await api('/api/me'); } catch { state.me = null; }
  render();
}

function render() {
  const app = $('#app');
  if (!state.me) { app.replaceChildren(loginView()); $('#pw')?.focus(); return; }
  const r = route();
  if (!r.id) { $('.drawer')?.remove(); $('.scrim')?.remove(); }
  const isAdmin = state.me.user.role === 'admin';
  app.replaceChildren(
    h('header', { class: 'top' }, h('div', { class: 'top__in' },
      h('a', { href: '#/leads', class: 'wm', style: 'text-decoration:none' }, 'ZUFA', h('em', {}, 'Leads')),
      h('nav', { class: 'nav' },
        h('a', { href: '#/leads', 'aria-current': r.page === 'leads' ? 'page' : null }, 'Leads'),
        isAdmin && h('a', { href: '#/settings', 'aria-current': r.page === 'settings' ? 'page' : null }, 'Settings')),
      h('div', { class: 'top__me' }, h('span', {}, state.me.user.name),
        h('button', { class: 'btn', onclick: async () => { await api('/api/logout', { method: 'POST', body: {} }).catch(() => {}); state.me = null; render(); } }, 'Log out')))),
    h('main', { id: 'main' }));
  if (r.page === 'settings' && isAdmin) settingsView($('#main'));
  else { leadsView($('#main')); if (r.id) openLead(r.id); }
}

/* ---------- login ---------- */
function loginView() {
  const err = h('p', { class: 'err' });
  const form = h('form', { onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    const btn = $('button', form); btn.disabled = true;
    try {
      await api('/api/login', { method: 'POST', body: { name: form.name.value, password: form.pw.value } });
      state.me = await api('/api/me'); render();
    } catch (x) { err.textContent = x.message; btn.disabled = false; }
  } },
    h('div', { class: 'wm' }, 'ZUFA', h('small', {}, 'Living'), h('em', {}, 'Leads')),
    h('label', { class: 'fld' }, 'Name', h('input', { class: 'inp', name: 'name', value: localStorage.getItem('zcrm-name') || 'admin', autocomplete: 'username', required: true, onchange: e => { try { localStorage.setItem('zcrm-name', e.target.value); } catch {} } })),
    h('label', { class: 'fld' }, 'Password', h('input', { class: 'inp', id: 'pw', name: 'pw', type: 'password', autocomplete: 'current-password', required: true })),
    err,
    h('button', { class: 'btn btn--primary', type: 'submit' }, 'Log in'));
  return h('div', { class: 'login' }, form);
}

/* ---------- leads list ---------- */
function rangeBounds(f) {
  const day = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d.toISOString(); };
  if (f.range === 'today') return { from: day(0) };
  if (f.range === '7') return { from: day(6) };
  if (f.range === '30') return { from: day(29) };
  if (f.range === 'custom') {
    const b = {};
    if (f.from) b.from = new Date(f.from + 'T00:00').toISOString();
    if (f.to) { const t = new Date(f.to + 'T00:00'); t.setDate(t.getDate() + 1); b.to = t.toISOString(); }
    return b;
  }
  return {};
}
function query(extra = {}) {
  const f = state.filters, p = new URLSearchParams();
  for (const k of ['q', 'status', 'campaign', 'assigned']) if (f[k]) p.set(k, f[k]);
  for (const [k, v] of Object.entries(rangeBounds(f))) p.set(k, v);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}
function saveFilters() { try { localStorage.setItem('zcrm-filters', JSON.stringify(state.filters)); } catch {} }

async function loadLeads(append = false) {
  if (!append) state.offset = 0;
  const data = await api('/api/leads?' + query({ limit: PAGE, offset: state.offset }));
  state.rows = append ? state.rows.concat(data.rows) : data.rows;
  state.total = data.total; state.counts = data.counts;
  drawTabs(); drawTable();
}

function leadsView(main) {
  const f = state.filters, me = state.me;
  let searchT;
  const set = (k, v) => { f[k] = v; saveFilters(); loadLeads().catch(e => toast(e.message, true)); };
  const dates = h('div', { class: 'dates' },
    h('select', { class: 'inp', 'aria-label': 'Date range', onchange: e => { f.range = e.target.value; drawDates(); if (e.target.value !== 'custom') set('range', e.target.value); } },
      [['all', 'Any date'], ['today', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['custom', 'Between dates…']].map(([v, t]) => h('option', { value: v, selected: f.range === v }, t))),
    h('input', { class: 'inp', type: 'date', 'aria-label': 'From date', value: f.from, onchange: e => set('from', e.target.value), 'data-custom': '' }),
    h('input', { class: 'inp', type: 'date', 'aria-label': 'To date', value: f.to, onchange: e => set('to', e.target.value), 'data-custom': '' }));
  const drawDates = () => dates.querySelectorAll('[data-custom]').forEach(i => (i.hidden = f.range !== 'custom'));
  drawDates();

  main.append(
    h('div', { class: 'head' },
      h('div', {}, h('h1', {}, 'Leads'), h('div', { class: 'sub', id: 'summary' }, '')),
      h('div', { class: 'acts' },
        me.metaConnected && h('button', { class: 'btn', onclick: e => syncNow(e.currentTarget, 7) }, 'Check Meta for new leads'),
        h('a', { class: 'btn', id: 'csv', href: '#', onclick: e => { e.currentTarget.href = '/api/leads.csv?' + query(); } , download: '' }, 'Export CSV'),
        h('button', { class: 'btn btn--primary', onclick: addLeadModal }, '+ Add lead'))),
    h('div', { class: 'filters' },
      h('input', { class: 'inp search', type: 'search', placeholder: 'Search name, phone, email, campaign…', value: f.q, 'aria-label': 'Search',
        oninput: e => { clearTimeout(searchT); searchT = setTimeout(() => set('q', e.target.value.trim()), 250); } }),
      h('select', { class: 'inp', 'aria-label': 'Campaign', onchange: e => set('campaign', e.target.value) },
        h('option', { value: '' }, 'All campaigns'),
        me.campaigns.map(c => h('option', { value: c.c, selected: f.campaign === c.c }, `${c.c === 'meta' ? 'Meta (no campaign name)' : c.c} (${c.n})`))),
      h('select', { class: 'inp', 'aria-label': 'Assigned to', onchange: e => set('assigned', e.target.value) },
        [['', 'Anyone'], ['me', 'Assigned to me'], ['none', 'Not assigned'], ...me.users.filter(u => u.active).map(u => [String(u.id), u.name])]
          .map(([v, t]) => h('option', { value: v, selected: f.assigned === v }, t))),
      dates,
      h('button', { class: 'btn btn--ghost', onclick: () => { Object.assign(f, { q: '', status: '', campaign: '', assigned: '', range: 'all', from: '', to: '' }); saveFilters(); render(); } }, 'Clear')),
    h('div', { class: 'tabs', id: 'tabs', role: 'group', 'aria-label': 'Status' }),
    h('div', { class: 'card', id: 'list' }, h('div', { class: 'empty' }, 'Loading…')));
  loadLeads().catch(e => toast(e.message, true));
  // Safety net for missed webhooks: if the last check with Meta is over an hour old, do one quietly now.
  if (me.syncDue && !state.autoSynced) {
    state.autoSynced = true;
    api('/api/sync', { method: 'POST', body: { days: 3 } })
      .then(r => { if (r.added) { toast(`${r.added} new lead${r.added === 1 ? '' : 's'} fetched from Meta`); loadLeads(); } })
      .catch(() => {});
  }
}

function drawTabs() {
  const tabs = $('#tabs'); if (!tabs) return;
  const all = Object.values(state.counts).reduce((a, b) => a + b, 0);
  const tab = (key, label, n) => h('button', { class: 'tab', 'aria-pressed': String(state.filters.status === key),
    onclick: () => { state.filters.status = key; saveFilters(); loadLeads(); } }, key && h('span', { class: 'pill', style: `--c: var(--s-${key})` }), label, h('b', {}, n || 0));
  tabs.replaceChildren(tab('', 'All', all), ...state.me.statuses.map(([k, l]) => tab(k, l, state.counts[k])));
  const fresh = state.counts.new || 0;
  $('#summary').textContent = `${state.total} lead${state.total === 1 ? '' : 's'} shown${fresh ? ` · ${fresh} new waiting for a call` : ''}`;
}

function drawTable() {
  const list = $('#list'); if (!list) return;
  if (!state.rows.length) {
    list.replaceChildren(h('div', { class: 'empty' }, state.total === 0 && !Object.values(state.counts).length
      ? 'No leads yet. They appear here the moment someone fills a Meta lead form or the website enquiry form.'
      : 'No leads match these filters.'));
    return;
  }
  const open = route().id;
  const tbody = h('tbody', {}, state.rows.map(r => h('tr', { tabindex: 0, class: r.id === open ? 'is-open' : '', 'data-id': r.id,
    onclick: () => (location.hash = `#/leads/${r.id}`), onkeydown: e => { if (e.key === 'Enter') location.hash = `#/leads/${r.id}`; } },
    h('td', { class: 'who' }, h('b', {}, r.full_name || '(no name yet)', h('span', { class: 'src' }, srcLabel(r))), h('span', { class: 'num' }, r.phone || r.email || ''),
      r.fetch_error && h('div', { class: 'warn' }, 'Details pending from Meta')),
    h('td', { class: 'c-int' }, r.interest || h('span', { class: 'meta' }, '—')),
    h('td', { class: 'c-camp meta' }, r.campaign_name || r.form_name || ''),
    h('td', { class: 'c-status' }, statusPill(r.status)),
    h('td', { class: 'c-as meta' }, r.assigned_name || 'Unassigned'),
    h('td', { class: 'c-time meta num', title: fmtTime(r.created_time) }, ago(r.created_time)))));
  list.replaceChildren(h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, ['Lead', 'Interested in', 'Campaign / form', 'Status', 'Assigned', 'Received'].map(t => h('th', {}, t)))), tbody),
    state.rows.length < state.total ? h('div', { class: 'more' }, h('button', { class: 'btn', onclick: () => { state.offset += PAGE; loadLeads(true); } }, `Show more (${state.total - state.rows.length} left)`)) : '');
}

async function syncNow(btn, days) {
  btn.disabled = true; const old = btn.textContent; btn.textContent = 'Checking…';
  try { const r = await api('/api/sync', { method: 'POST', body: { days } }); toast(r.message); await refreshMe(); if (route().page === 'leads') await loadLeads(); }
  catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; btn.textContent = old; }
}
async function refreshMe() { state.me = await api('/api/me'); }

/* ---------- add lead ---------- */
function addLeadModal() {
  const close = () => wrap.remove();
  const form = h('form', { onsubmit: async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form)); d.assign_to_me = form.mine.checked;
    try { const { id } = await api('/api/leads', { method: 'POST', body: d }); close(); toast('Lead added'); await refreshMe(); location.hash = `#/leads/${id}`; render(); }
    catch (x) { toast(x.message, true); }
  } },
    h('h2', {}, 'Add a lead'),
    h('p', { class: 'hint', style: 'margin:0' }, 'For walk-ins, phone calls and referrals. Meta and website leads arrive by themselves.'),
    h('label', { class: 'fld' }, 'Name', h('input', { class: 'inp', name: 'name', autocomplete: 'off' })),
    h('div', { class: 'row2' },
      h('label', { class: 'fld' }, 'Phone', h('input', { class: 'inp', name: 'phone', type: 'tel', autocomplete: 'off' })),
      h('label', { class: 'fld' }, 'Email', h('input', { class: 'inp', name: 'email', type: 'email', autocomplete: 'off' }))),
    h('div', { class: 'row2' },
      h('label', { class: 'fld' }, 'Interested in', h('input', { class: 'inp', name: 'interest', placeholder: 'e.g. Half-acre estate' })),
      h('label', { class: 'fld' }, 'Source', h('input', { class: 'inp', name: 'campaign', placeholder: 'e.g. Referral, Walk-in' }))),
    h('label', { class: 'fld' }, 'Note', h('textarea', { class: 'inp', name: 'message' })),
    h('label', { style: 'display:flex;gap:8px;align-items:center;font-size:14px' }, h('input', { type: 'checkbox', name: 'mine', checked: true }), 'Assign to me'),
    h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn btn--primary' }, 'Add lead')));
  const wrap = h('div', { class: 'modal', onclick: e => { if (e.target === wrap) close(); }, onkeydown: e => { if (e.key === 'Escape') close(); } }, form);
  document.body.append(wrap); form.name.focus();
}

/* ---------- lead detail drawer ---------- */
async function openLead(id) {
  let lead;
  try { lead = await api(`/api/leads/${id}`); } catch (e) { toast(e.message, true); return; }
  document.querySelectorAll('.tbl tr.is-open').forEach(r => r.classList.remove('is-open'));
  document.querySelector(`.tbl tr[data-id="${id}"]`)?.classList.add('is-open');
  drawDrawer(lead);
}
function closeDrawer() { $('.drawer')?.remove(); $('.scrim')?.remove(); if (route().id) history.replaceState(null, '', '#/leads'); document.querySelectorAll('.tbl tr.is-open').forEach(r => r.classList.remove('is-open')); }
addEventListener('keydown', e => { if (e.key === 'Escape' && $('.drawer') && !$('.modal')) closeDrawer(); });

async function patch(lead, body, msg) {
  try { const l = await api(`/api/leads/${lead.id}`, { method: 'PATCH', body }); drawDrawer(l); if (msg) toast(msg); loadLeads().catch(() => {}); }
  catch (e) { toast(e.message, true); }
}

function drawDrawer(lead) {
  const me = state.me;
  const wa = waNumber(lead.phone);
  const firstName = (lead.full_name || '').split(' ')[0];
  const waText = `Hello ${firstName}, this is ${me.user.name} from ZUFA Living. Thank you for your interest in our farm estates on Chevella Road. When would be a good time to talk, or to visit the site?`;
  const kv = pairs => h('dl', { class: 'kv' }, pairs.filter(([, v]) => v).map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  const note = h('textarea', { class: 'inp', placeholder: 'Add a note: what they said, budget, best time to call…' });

  const body = h('div', { class: 'drawer__body' },
    h('div', { class: 'contact' },
      lead.phone && h('a', { class: 'btn btn--primary', href: `tel:+${waNumber(lead.phone)}` }, 'Call'),
      wa && h('a', { class: 'btn btn--wa', href: `https://wa.me/${wa}?text=${encodeURIComponent(waText)}`, target: '_blank', rel: 'noopener' }, 'WhatsApp'),
      lead.email && h('a', { class: 'btn', href: `mailto:${lead.email}?subject=${encodeURIComponent('ZUFA Living')}` }, 'Email')),
    lead.fetch_error && h('div', { class: 'sec warn' }, `Meta has not sent this lead's details yet (${lead.fetch_error}). Press “Check Meta for new leads” on the Leads page once the connection is fixed.`),
    h('section', { class: 'sec' }, h('h3', {}, 'Stage'),
      h('div', { class: 'pipe' }, me.statuses.map(([k, l]) => h('button', { 'aria-pressed': String(lead.status === k), style: `--c: var(--s-${k})`,
        onclick: () => lead.status !== k && patch(lead, { status: k }, `Moved to ${l}`) }, l)))),
    h('section', { class: 'sec' },
      h('div', { class: 'row2' },
        h('label', { class: 'fld' }, 'Assigned to', h('select', { class: 'inp', onchange: e => patch(lead, { assigned_to: e.target.value || null }, 'Assignment saved') },
          h('option', { value: '' }, 'Nobody'), me.users.filter(u => u.active || u.id === lead.assigned_to).map(u => h('option', { value: u.id, selected: u.id === lead.assigned_to }, u.name)))),
        h('label', { class: 'fld' }, 'Next follow-up', h('input', { class: 'inp', type: 'date', value: lead.next_follow_up || '', onchange: e => patch(lead, { next_follow_up: e.target.value }, 'Follow-up saved') })))),
    h('section', { class: 'sec' }, h('h3', {}, 'Their answers'),
      lead.answers.length ? kv(lead.answers.map(a => [a.q, a.a])) : h('p', { class: 'meta', style: 'margin:0' }, 'No answers stored.')),
    h('section', { class: 'sec' }, h('h3', {}, 'Where they came from'),
      kv([['Source', lead.source === 'meta' ? `Meta lead ad${lead.platform ? ' · ' + platformName(lead.platform) : ''}${lead.is_organic ? ' (organic)' : ''}` : lead.source === 'website' ? 'Website enquiry form' : 'Added by hand'],
        ['Campaign', lead.campaign_name || (lead.campaign_id && `ID ${lead.campaign_id}`)], ['Ad set', lead.adset_name || (lead.adset_id && `ID ${lead.adset_id}`)],
        ['Ad', lead.ad_name || (lead.ad_id && `ID ${lead.ad_id}`)], ['Form', lead.form_name || (lead.form_id && `ID ${lead.form_id}`)],
        ['Submitted', fmtTime(lead.created_time)], ['Meta lead ID', lead.leadgen_id]])),
    h('section', { class: 'sec' }, h('h3', {}, 'Notes & history'),
      h('form', { class: 'note-form', onsubmit: e => { e.preventDefault(); if (note.value.trim()) patch(lead, { note: note.value }, 'Note added'); } },
        note, h('button', { class: 'btn btn--primary' }, 'Add note')),
      h('ul', { class: 'feed', style: 'margin-top:14px' }, lead.activity.map(a => h('li', { class: `k-${a.kind}` },
        h('div', { class: 'body' }, a.body), h('div', { class: 'meta' }, `${a.user_name || 'System'} · ${fmtTime(a.created_at)}`))))),
    me.user.role === 'admin' && h('div', {}, h('button', { class: 'btn btn--ghost btn--danger', onclick: async () => {
      if (!confirm(`Delete ${lead.full_name || 'this lead'} for good? This cannot be undone.`)) return;
      try { await api(`/api/leads/${lead.id}`, { method: 'DELETE', body: {} }); closeDrawer(); toast('Lead deleted'); await refreshMe(); loadLeads(); } catch (e) { toast(e.message, true); }
    } }, 'Delete lead')));

  const drawer = h('aside', { class: 'drawer', role: 'dialog', 'aria-label': `Lead: ${lead.full_name || ''}` },
    h('div', { class: 'drawer__head' },
      h('div', {}, h('h2', {}, lead.full_name || '(no name yet)'),
        h('div', { class: 'meta num' }, [lead.phone, lead.email, lead.city].filter(Boolean).join(' · '))),
      h('button', { class: 'btn btn--ghost x', 'aria-label': 'Close', onclick: closeDrawer }, '✕')),
    body);
  const scrollTop = $('.drawer')?.scrollTop || 0;
  $('.drawer')?.remove(); $('.scrim')?.remove();
  document.body.append(h('div', { class: 'scrim', onclick: closeDrawer }), drawer);
  drawer.scrollTop = scrollTop;
}

/* ---------- settings (admin) ---------- */
async function settingsView(main) {
  main.append(h('div', { class: 'head' }, h('div', {}, h('h1', {}, 'Settings'), h('div', { class: 'sub' }, 'Meta connection, team and activity'))), h('div', { id: 'set' }, h('p', { class: 'meta' }, 'Checking the Meta connection…')));
  let s;
  try { s = await api('/api/settings'); } catch (e) { $('#set').replaceChildren(h('p', { class: 'warn' }, e.message)); return; }
  const c = s.meta.configured;
  const tick = (ok, text, extra) => h('li', {}, h('span', { class: ok ? 'y' : 'n' }, ok ? '✓' : '✗'), h('span', {}, text, extra && h('div', { class: 'meta' }, extra)));
  const hook = location.origin + '/webhook';
  const copyBox = v => h('div', { class: 'copy' }, h('input', { class: 'inp', readOnly: true, value: v, onfocus: e => e.target.select() }),
    h('button', { class: 'btn', onclick: () => navigator.clipboard.writeText(v).then(() => toast('Copied')) }, 'Copy'));
  const days = h('select', { class: 'inp', 'aria-label': 'How far back' }, [[2, 'Last 2 days'], [7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days (Meta keeps 90)']].map(([v, t]) => h('option', { value: v, selected: v === 7 }, t)));

  const metaCard = h('section', { class: 'sec' }, h('h3', {}, 'Meta lead ads'),
    h('ul', { class: 'check' },
      tick(c.appId, 'App ID (META_APP_ID)'), tick(c.appSecret, 'App secret (META_APP_SECRET)', 'Used to check that webhooks really come from Meta'),
      tick(c.verifyToken, 'Verify token (META_VERIFY_TOKEN)'), tick(c.pageId, 'Page ID (META_PAGE_ID)'), tick(c.pageToken, 'Page access token (META_PAGE_ACCESS_TOKEN)'),
      c.pageToken && c.pageId && tick(!!s.meta.page, s.meta.page ? `Token works for the Page “${s.meta.page}”` : 'Token does not work', s.meta.pageError),
      c.pageToken && c.pageId && tick(!!s.meta.subscribed, s.meta.subscribed ? 'Page sends new leads to this app' : 'Page is not yet sending leads to this app', s.meta.subscribeError),
      tick(!!s.lastWebhook, s.lastWebhook ? `Last webhook from Meta: ${fmtTime(s.lastWebhook)}` : 'No lead webhook received yet')),
    h('p', { class: 'hint' }, 'Missing values go in the .env file (or the host’s Environment settings), then restart the CRM.'),
    h('div', { style: 'margin-top:14px;display:grid;gap:6px' }, h('div', { class: 'meta' }, 'Callback URL to paste into Meta → Webhooks → Page:'), copyBox(hook)),
    h('div', { class: 'inline', style: 'margin-top:14px' },
      c.pageToken && c.pageId && !s.meta.subscribed && h('button', { class: 'btn btn--primary', onclick: async e => {
        e.currentTarget.disabled = true;
        try { await api('/api/subscribe', { method: 'POST', body: {} }); toast('Page subscribed'); render(); } catch (x) { toast(x.message, true); e.currentTarget.disabled = false; }
      } }, 'Connect Page to this app'),
      c.pageToken && c.pageId && [days, h('button', { class: 'btn', onclick: e => syncNow(e.currentTarget, +days.value) }, 'Fetch leads from Meta now')]),
    h('p', { class: 'hint' }, `Graph API ${s.graphVersion}. ${s.lastSync ? `Last check: ${fmtTime(s.lastSync)}.` : ''} ${s.cron ? 'A daily scheduled check, plus a check whenever someone opens the dashboard (at most hourly), catch any webhook that was missed.' : 'CRON_SECRET is not set, so the daily scheduled check is off; the dashboard still checks when opened.'}`));

  const name = h('input', { class: 'inp', placeholder: 'Name', autocomplete: 'off' });
  const pw = h('input', { class: 'inp', placeholder: 'Password (8+ characters)', type: 'password', autocomplete: 'new-password' });
  const teamCard = h('section', { class: 'sec' }, h('h3', {}, 'Sales team'),
    h('ul', { class: 'team' }, state.me.users.map(u => h('li', {},
      h('span', {}, u.name, u.role === 'admin' ? ' (admin)' : '', !u.active ? h('span', { class: 'meta' }, ' — switched off') : ''),
      u.role !== 'admin' && [
        h('button', { class: 'btn', onclick: async () => {
          const p = prompt(`New password for ${u.name} (8+ characters):`); if (!p) return;
          try { await api(`/api/users/${u.id}`, { method: 'PATCH', body: { password: p } }); toast('Password changed'); } catch (e) { toast(e.message, true); }
        } }, 'New password'),
        h('button', { class: 'btn', onclick: async () => {
          try { await api(`/api/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }); await refreshMe(); render(); } catch (e) { toast(e.message, true); }
        } }, u.active ? 'Switch off' : 'Switch on')]))),
    h('form', { class: 'inline', onsubmit: async e => {
      e.preventDefault();
      try { await api('/api/users', { method: 'POST', body: { name: name.value, password: pw.value } }); toast(`${name.value} can now log in`); await refreshMe(); render(); }
      catch (x) { toast(x.message, true); }
    } }, name, pw, h('button', { class: 'btn btn--primary' }, 'Add person')),
    h('p', { class: 'hint' }, 'Each salesperson logs in with their own name and password. Switching someone off logs them out at once; their leads stay.'));

  const webCard = h('section', { class: 'sec' }, h('h3', {}, 'Website enquiry form'),
    h('p', { style: 'margin:0 0 8px;font-size:14px' }, 'Enquiries from these websites are accepted:'),
    s.siteOrigins.length ? h('ul', { class: 'check' }, s.siteOrigins.map(o => h('li', {}, h('span', { class: 'y' }, '✓'), o))) : h('p', { class: 'warn' }, 'None yet. Set SITE_ORIGINS.'),
    h('div', { style: 'margin-top:12px;display:grid;gap:6px' }, h('div', { class: 'meta' }, 'The site’s js/main.js → CONFIG.crm should be:'), copyBox(location.origin)));

  const logCard = h('section', { class: 'sec' }, h('h3', {}, 'Recent activity'),
    s.events.length ? h('div', { class: 'log' }, s.events.map(ev => h('div', { class: ev.ok ? '' : 'bad' }, h('span', { class: 'meta num' }, fmtTime(ev.at)), h('span', {}, ev.detail))))
      : h('p', { class: 'meta', style: 'margin:0' }, 'Nothing yet.'));

  $('#set').replaceChildren(h('div', { class: 'grid2' }, h('div', { style: 'display:grid;gap:16px' }, metaCard, webCard), h('div', { style: 'display:grid;gap:16px' }, teamCard, logCard)));
}

boot();
