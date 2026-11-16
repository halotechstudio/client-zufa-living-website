// The layout: Layout L1 (drawing AR-001) drawn north-up from the site data, and a Blender-rendered 3D view that
// lifts out of the drawing. The 3D frames are full-resolution stills shown one at a time (never blended), played on a
// clock rather than on scroll, so the move is sharp and quick and the page scroll is never held up.
import { SITE, PLOTS } from './site-data.js';

const NS = 'http://www.w3.org/2000/svg';
const CAT = { quarter: 'Quarter-acre', half: 'Half-acre', signature: 'Signature estate', bespoke: 'Bespoke' };
const FILL = { quarter: '#ddd4c6', half: '#d3c6b2', signature: '#ab9476', bespoke: '#ddd4c6' };
const fmt = n => Math.round(n).toLocaleString('en-IN');
// brochure prices: standard plots at their published figure, bespoke at Rs 5,000 per sq.yd rounded down to the lakh
export const price = p => p.cat === 'quarter' ? 'Rs 60 lakh' : p.cat === 'half' ? 'Rs 1.20 crore' : p.cat === 'signature' ? 'Rs 2.10 crore'
  : `Rs ${Math.floor(p.sqyd * 5000 / 1e5)} lakh`;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const lerp = (a, b, t) => a + (b - a) * t;
const D1 = [-0.171, 0.985];                          // the approach road: straight south from the gate (web x east, z south)
const ROAD = 270;

function cardHTML(p, dark) {
  return `<div class="kick">Plot ${p.id} &middot; ${CAT[p.cat]}</div><b>${fmt(p.sqyd)} sq.yd</b><span>${fmt(p.sqyd * 9)} sq.ft${p.cat === 'signature' ? ' &middot; the Signature Estate' : ''}</span><strong>${price(p)}</strong>` +
    `<a href="#visit" data-enquire="${p.id}">Enquire about plot ${p.id}</a>`;
}

/* ------------------------------------------------------------------ the drawn plan */
export class Plan {
  constructor(el, card, onEnquire) {
    this.el = el; this.card = card; this.onEnquire = onEnquire; this.pinned = null;
    const xs = SITE.outline.map(p => p[0]), zs = SITE.outline.map(p => p[1]);
    const [gx, gz] = SITE.gate, end = [gx + D1[0] * ROAD, gz + D1[1] * ROAD];
    const x0 = Math.min(...xs, end[0]) - 14, x1 = Math.max(...xs) + 64, z0 = Math.min(...zs) - 14, z1 = end[1] + 4;
    this.vb = [x0, z0, x1 - x0, z1 - z0];
    el.style.setProperty('--ar', (this.vb[2] / this.vb[3]).toFixed(4));
    const pts = a => a.map(p => p.map(v => v.toFixed(2)).join(',')).join(' ');
    let s = `<svg viewBox="${this.vb.map(v => v.toFixed(1)).join(' ')}" preserveAspectRatio="xMidYMid meet">`;
    s += `<path class="draw" d="M${gx},${gz} L${end[0].toFixed(1)},${end[1].toFixed(1)}" fill="none" stroke="rgba(28,26,23,.26)" stroke-width="11" stroke-linecap="butt"/>`;
    s += `<polygon class="draw" points="${pts(SITE.outline)}" fill="rgba(28,26,23,.05)" stroke="#1c1a17" stroke-width="1.5" stroke-linejoin="round"/>`;
    for (const p of PLOTS) {
      const d = Math.hypot(p.c[0] - gx, p.c[1] - gz);
      s += `<polygon class="pl fillin" data-id="${p.id}" style="--dl:${(0.25 + d / 900).toFixed(2)}s" points="${pts(p.poly)}" fill="${FILL[p.cat]}" stroke="#1c1a17" stroke-width=".55" stroke-linejoin="round"/>`;
    }
    s += `<polygon class="fillin" style="--dl:.5s" points="${pts(SITE.club)}" fill="#8a6a42" stroke="#1c1a17" stroke-width=".7"/>`;
    for (const p of PLOTS) {
      const big = p.cat === 'half' || p.cat === 'signature';
      s += `<text class="pt fillin" style="--dl:.9s" x="${p.c[0].toFixed(1)}" y="${(p.c[1] + 2.3).toFixed(1)}" text-anchor="middle" font-size="${big ? 6.6 : 5.8}" fill="${p.cat === 'signature' ? '#f7f3ec' : '#1c1a17'}" opacity=".78">${p.id}</text>`;
    }
    s += `<circle class="fillin" style="--dl:.2s" cx="${gx}" cy="${gz}" r="6.5" fill="#8a6a42" stroke="#eee8df" stroke-width="2"/>`;
    const nx = x1 - 26, nz = z0 + 18;
    s += `<g class="fillin" style="--dl:1s"><text x="${nx}" y="${nz}" text-anchor="middle" font-family="PJ" font-weight="600" font-size="9.5" fill="#1c1a17">N</text>` +
      `<path d="M${nx},${nz + 34} V${nz + 6} M${nx - 4.5},${nz + 12} L${nx},${nz + 5} L${nx + 4.5},${nz + 12}" fill="none" stroke="#1c1a17" stroke-width="1.1"/></g>`;
    el.innerHTML = s + '</svg>';
    this.svg = el.querySelector('svg');
    for (const d of el.querySelectorAll('.draw')) d.style.setProperty('--len', Math.ceil(d.getTotalLength ? d.getTotalLength() : 2000));
    this.byId = Object.fromEntries(PLOTS.map(p => [p.id, p]));

    el.addEventListener('pointerover', e => { const t = e.target.closest('.pl'); if (t && !this.pinned) this.show(+t.dataset.id); });
    el.addEventListener('pointerout', e => { if (e.target.closest('.pl') && !this.pinned) this.show(null); });
    el.addEventListener('click', e => { const t = e.target.closest('.pl'); if (!t) return; const id = +t.dataset.id; this.pinned = this.pinned === id ? null : id; this.show(this.pinned || id); if (!this.pinned) this.show(null); });
    card.addEventListener('click', e => { const a = e.target.closest('[data-enquire]'); if (a) { e.preventDefault(); onEnquire(+a.dataset.enquire); } });
    document.addEventListener('pointerdown', e => { if (this.pinned && !e.target.closest('.pl') && !e.target.closest('[data-plotcard]')) { this.pinned = null; this.show(null); } });
  }
  // screen position of a web-space point
  toScreen(x, z) { const m = this.svg.getScreenCTM(), p = this.svg.createSVGPoint(); p.x = x; p.y = z; const q = p.matrixTransform(m); return [q.x, q.y]; }
  show(id) {
    this.el.querySelectorAll('.pl.is-hl').forEach(n => n.classList.remove('is-hl'));
    if (!id) { this.card.hidden = true; return; }
    const p = this.byId[id]; this.el.querySelector(`.pl[data-id="${id}"]`)?.classList.add('is-hl');
    const [sx, sy] = this.toScreen(p.c[0], Math.min(...p.poly.map(q => q[1])));
    const box = this.card.parentElement.getBoundingClientRect();
    this.card.innerHTML = cardHTML(p); this.card.hidden = false;
    this.card.style.left = `${clamp(sx - box.left, 120, box.width - 120)}px`; this.card.style.top = `${Math.max(sy - box.top, 150)}px`;
  }
  filter(cat) {
    this.el.classList.toggle('is-filtered', !!cat);
    for (const n of this.el.querySelectorAll('.pl')) n.classList.toggle('is-cat', !!cat && this.byId[+n.dataset.id].cat === cat);
  }
}

/* ------------------------------------------------------------------ the 3D view */
export class View3D {
  constructor(root, plan, { base = 'assets/layout3d/', onOpen, onClose, onEnquire, onProgress } = {}) {
    Object.assign(this, { root, plan, base, onOpen, onClose, onEnquire, onProgress });
    this.cv = root.querySelector('[data-v3d-img]'); this.ctx = this.cv.getContext('2d', { alpha: true });
    this.hl = root.querySelector('[data-v3d-hl]'); this.hctx = this.hl.getContext('2d');
    this.card = root.querySelector('[data-v3d-card]');
    this.tilt = []; this.orbit = []; this.state = 'closed'; this.angle = 0; this.vel = 0; this.hover = -1; this.pin = -1;
    addEventListener('resize', () => { if (this.state !== 'closed') { this.size(); this.draw(); } });
    root.querySelector('[data-v3d-close]').addEventListener('click', () => this.close());
    root.querySelectorAll('[data-turn]').forEach(b => b.addEventListener('click', () => this.turnBy(+b.dataset.turn * 6)));
    addEventListener('keydown', e => { if (this.state !== 'live') return; if (e.key === 'Escape') this.close(); if (e.key === 'ArrowLeft') this.turnBy(-3); if (e.key === 'ArrowRight') this.turnBy(3); });
    this.card.addEventListener('click', e => { const a = e.target.closest('[data-enquire]'); if (a) { e.preventDefault(); const id = +a.dataset.enquire; this.close(true).then(() => onEnquire(id)); } });
    this._pointer();
  }

  async load() {
    if (this.loading) return this.loading;
    const img = src => new Promise(ok => { const i = new Image(); i.decoding = 'async'; i.onload = () => (i.decode ? i.decode().catch(() => {}) : Promise.resolve()).then(() => ok(i)); i.onerror = () => ok(null); i.src = src; });
    this.loading = (async () => {
      this.meta = await (await fetch(this.base + 'layout3d.json')).json();
      const { tilt, orbit } = this.meta; let n = 0; const total = tilt + 6;
      const tick = () => this.onProgress && this.onProgress(Math.min(1, ++n / total));
      // the tilt first (needed to open), then the first orbit frames, then the rest of the turn in the background
      this.tilt = await Promise.all(Array.from({ length: tilt }, (_, i) => img(`${this.base}tilt/t${String(i).padStart(2, '0')}.webp`).then(r => (tick(), r))));
      const order = [...Array(orbit).keys()].sort((a, b) => Math.min(a, orbit - a) - Math.min(b, orbit - b));
      this.orbit = new Array(orbit);
      const first = order.slice(0, 6), rest = order.slice(6);
      await Promise.all(first.map(i => img(`${this.base}orbit/o${String(i).padStart(2, '0')}.webp`).then(r => { this.orbit[i] = r; tick(); })));
      (async () => { for (let k = 0; k < rest.length; k += 4) await Promise.all(rest.slice(k, k + 4).map(i => img(`${this.base}orbit/o${String(i).padStart(2, '0')}.webp`).then(r => { this.orbit[i] = r; if (this.state === 'live') this.draw(); }))); })();
      return true;
    })();
    return this.loading;
  }

  size() {
    const dpr = Math.min(devicePixelRatio || 1, 2), w = innerWidth, h = innerHeight;
    for (const c of [this.cv, this.hl]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    this.dpr = dpr;
    const W = this.meta.w, H = this.meta.h, portrait = w < h;
    let s = Math.max(w / W, h / H); if (portrait) s = Math.min(s, 2.1 * w / W);
    this.R1 = { x: (w - W * s) / 2, y: (h - H * s) / 2, w: W * s, h: H * s };
    // where the drawn plan's ground sits on screen: frame 0 is centred on meta.center (Blender x, y) and shows w0 metres across
    const [cx, cy] = this.meta.center, w0 = this.meta.w0, h0 = w0 * H / W;
    const [ax, ay] = this.plan.toScreen(cx - w0 / 2, -cy - h0 / 2), [bx, by] = this.plan.toScreen(cx + w0 / 2, -cy + h0 / 2);
    this.R0 = { x: ax, y: ay, w: bx - ax, h: by - ay };
  }

  frameImg() {
    if (this.mode === 'tilt') return this.tilt[this.ti];
    const n = this.orbit.length, i = ((Math.round(this.angle) % n) + n) % n;
    if (this.orbit[i]) return this.orbit[i];
    for (let r = 1; r < n; r++) for (const j of [(i + r) % n, (i - r + n) % n]) if (this.orbit[j]) return this.orbit[j];
    return this.tilt[this.tilt.length - 1];
  }
  get oi() { const n = this.orbit.length; return ((Math.round(this.angle) % n) + n) % n; }

  draw() {
    const c = this.ctx, d = this.dpr, R = this.rect || this.R1, im = this.frameImg();
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, this.cv.width, this.cv.height);
    if (!im) return;
    c.globalAlpha = this.alpha ?? 1;
    c.drawImage(im, R.x * d, R.y * d, R.w * d, R.h * d);
    c.globalAlpha = 1;
    this.drawHL();
  }
  drawHL() {
    const c = this.hctx, d = this.dpr; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, this.hl.width, this.hl.height);
    const id = this.pin >= 0 ? this.pin : this.hover;
    if (this.state !== 'live' || id < 0 || !this.meta.proj.length) return;
    const poly = this.meta.proj[this.oi]?.[id]; if (!poly) return;
    const R = this.R1; c.beginPath();
    for (let k = 0; k < poly.length; k += 2) { const x = (R.x + poly[k] * R.w) * d, y = (R.y + poly[k + 1] * R.h) * d; k ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.closePath(); c.fillStyle = 'rgba(201,169,121,.38)'; c.fill(); c.lineWidth = 1.6 * d; c.strokeStyle = 'rgba(247,243,236,.95)'; c.stroke();
  }

  run(dur, step) {
    return new Promise(ok => { const t0 = performance.now(); const f = now => { const t = clamp((now - t0) / dur); step(t); this.draw(); if (t < 1) requestAnimationFrame(f); else ok(); }; requestAnimationFrame(f); });
  }

  async open() {
    if (this.state !== 'closed') return; await this.load();
    this.state = 'opening'; this.mode = 'tilt'; this.ti = 0; this.angle = 0; this.pin = this.hover = -1; this.card.hidden = true;
    this.root.classList.add('is-open'); this.root.setAttribute('aria-hidden', 'false'); this.onOpen && this.onOpen();
    this.size(); const N = this.tilt.length;
    // 1. the rendered top view appears exactly over the drawing
    this.rect = this.R0; this.alpha = 0;
    await this.run(420, t => { const e = ease(t); this.alpha = e; this.root.style.setProperty('--bg', (e * 1).toFixed(3)); });
    // 2. the plan lifts into the aerial: frames on a clock, framing grows to fill the screen
    await this.run(1250, t => { const e = ease(t); this.ti = Math.min(N - 1, Math.round(e * (N - 1)));
      this.rect = { x: lerp(this.R0.x, this.R1.x, e), y: lerp(this.R0.y, this.R1.y, e), w: lerp(this.R0.w, this.R1.w, e), h: lerp(this.R0.h, this.R1.h, e) }; });
    this.rect = null; this.mode = 'orbit'; this.state = 'live'; this.root.classList.add('is-live'); this.draw();
  }

  async close(fast) {
    if (this.state !== 'live') return; this.state = 'closing'; this.root.classList.remove('is-live'); this.card.hidden = true; this.pin = this.hover = -1; this.drawHL();
    if (fast) {
      await this.run(450, t => { this.alpha = 1 - t; this.root.style.setProperty('--bg', ((1 - t) * 1).toFixed(3)); });
    } else {
      // turn back to the start of the orbit, then lower the site onto the drawing
      const n = this.orbit.length, a0 = this.angle, back = Math.round(a0 / n) * n;
      if (Math.abs(a0 - back) > .5) await this.run(Math.min(700, Math.abs(a0 - back) * 22), t => { this.angle = lerp(a0, back, ease(t)); });
      this.mode = 'tilt'; this.size(); const N = this.tilt.length;
      await this.run(1050, t => { const e = 1 - ease(t); this.ti = Math.min(N - 1, Math.round(e * (N - 1)));
        this.rect = { x: lerp(this.R0.x, this.R1.x, e), y: lerp(this.R0.y, this.R1.y, e), w: lerp(this.R0.w, this.R1.w, e), h: lerp(this.R0.h, this.R1.h, e) }; });
      await this.run(380, t => { this.alpha = 1 - t; this.root.style.setProperty('--bg', ((1 - t) * 1).toFixed(3)); });
    }
    this.root.classList.remove('is-open'); this.root.setAttribute('aria-hidden', 'true'); this.state = 'closed'; this.rect = null; this.alpha = 1;
    this.onClose && this.onClose();
  }

  turnBy(frames) {
    if (this.state !== 'live') return; const a0 = this.angle, a1 = Math.round(a0) + frames; this.vel = 0;
    cancelAnimationFrame(this._spin);
    const t0 = performance.now(), dur = 520 + Math.abs(frames) * 25;
    const f = now => { const t = clamp((now - t0) / dur); this.angle = lerp(a0, a1, ease(t)); this.draw(); this.placeCard(); if (t < 1) this._spin = requestAnimationFrame(f); };
    this._spin = requestAnimationFrame(f);
  }

  pick(x, y) {
    const R = this.R1, u = (x - R.x) / R.w, v = (y - R.y) / R.h, polys = this.meta.proj[this.oi]; if (!polys) return -1;
    for (let i = 0; i < polys.length; i++) {
      const p = polys[i]; let inside = false;
      for (let k = 0, j = p.length - 2; k < p.length; j = k, k += 2) { const xi = p[k], yi = p[k + 1], xj = p[j], yj = p[j + 1]; if (((yi > v) !== (yj > v)) && (u < (xj - xi) * (v - yi) / (yj - yi) + xi)) inside = !inside; }
      if (inside) return i;
    }
    return -1;
  }
  placeCard() {
    const id = this.pin >= 0 ? this.pin : this.hover;
    if (id < 0 || this.state !== 'live') { this.card.hidden = true; return; }
    const poly = this.meta.proj[this.oi]?.[id]; if (!poly) return;
    let top = 1, cx = 0; for (let k = 0; k < poly.length; k += 2) { cx += poly[k]; top = Math.min(top, poly[k + 1]); } cx /= poly.length / 2;
    const R = this.R1, p = PLOTS[id];
    this.card.innerHTML = cardHTML(p, true); this.card.hidden = false;
    this.card.style.left = `${clamp(R.x + cx * R.w, 130, innerWidth - 130)}px`; this.card.style.top = `${clamp(R.y + top * R.h, 190, innerHeight - 20)}px`;
  }

  _pointer() {
    const el = this.cv; let down = null, lastX = 0, lastT = 0, moved = 0;
    const per = () => (this.orbit.length || 72) / (Math.min(innerWidth, 1400) * 1.25);   // frames per pixel: a full turn ~ 1.25 screen widths
    el.addEventListener('pointerdown', e => { if (this.state !== 'live') return; down = e.clientX; lastX = e.clientX; lastT = performance.now(); moved = 0; this.vel = 0; cancelAnimationFrame(this._spin); el.setPointerCapture(e.pointerId); this.root.classList.add('is-drag'); });
    el.addEventListener('pointermove', e => {
      if (this.state !== 'live') return;
      if (down !== null) {
        const dx = e.clientX - lastX, now = performance.now(); moved += Math.abs(dx);
        this.angle -= dx * per(); this.vel = -dx * per() / Math.max(1, now - lastT) * 16; lastX = e.clientX; lastT = now;
        this.draw(); this.placeCard(); return;
      }
      if (e.pointerType !== 'mouse') return;
      const h = this.pick(e.clientX, e.clientY); if (h !== this.hover) { this.hover = h; this.drawHL(); this.placeCard(); }
    });
    const up = e => {
      if (down === null) return; down = null; this.root.classList.remove('is-drag');
      if (moved < 6) { const h = this.pick(e.clientX, e.clientY); this.pin = h === this.pin ? -1 : h; this.hover = -1; this.drawHL(); this.placeCard(); return; }
      // a short glide after release, then settle exactly on a frame
      const glide = () => { this.vel *= .9; this.angle += this.vel; this.draw(); this.placeCard();
        if (Math.abs(this.vel) > .05) this._spin = requestAnimationFrame(glide); else { this.angle = Math.round(this.angle); this.draw(); this.placeCard(); } };
      this._spin = requestAnimationFrame(glide);
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => { if (this.state !== 'live') return; e.preventDefault(); this.angle += (e.deltaY + e.deltaX) * .02; this.draw(); this.placeCard(); clearTimeout(this._ws); this._ws = setTimeout(() => { this.angle = Math.round(this.angle); this.draw(); this.placeCard(); }, 120); }, { passive: false });
  }
}
