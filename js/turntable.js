// The real site, turning slowly: the Blender orbit frames of Layout L1 played on a clock (not on scroll), with a
// soft blend between neighbouring frames so the turn reads as one continuous movement. Pauses when off screen.
export class Turntable {
  constructor(el, { base = 'assets/layout3d/', secondsPerTurn = 40 } = {}) {
    this.el = el; this.base = base; this.spt = secondsPerTurn;
    this.cv = document.createElement('canvas'); el.prepend(this.cv); this.ctx = this.cv.getContext('2d');
    this.frames = []; this.pos = 0; this.on = false; this.t = 0; this.push = 0;
    new IntersectionObserver(es => { this.on = es[0].isIntersecting; if (this.on) { this.load(); this.t = performance.now(); this.loop(); } }, { rootMargin: '30% 0px' }).observe(el);
    addEventListener('resize', () => this.size());
    el.addEventListener('pointermove', e => { const r = el.getBoundingClientRect(); this.push = ((e.clientX - r.left) / r.width - .5) * 2; });
    el.addEventListener('pointerleave', () => { this.push = 0; });
  }
  async load() {
    if (this.loading) return; this.loading = true;
    const meta = await (await fetch(this.base + 'layout3d.json')).json(); this.n = meta.orbit; this.W = meta.w; this.H = meta.h;
    this.frames = new Array(this.n); this.size();
    const get = i => new Promise(ok => { const im = new Image(); im.decoding = 'async'; im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => { this.frames[i] = im; this.el.classList.add('is-live'); ok(); }); im.onerror = ok; im.src = `${this.base}orbit/o${String(i).padStart(2, '0')}.webp`; });
    for (let k = 0; k < this.n; k += 6) await Promise.all(Array.from({ length: Math.min(6, this.n - k) }, (_, j) => get(k + j)));
  }
  size() { const d = Math.min(devicePixelRatio || 1, 2), r = this.el.getBoundingClientRect(); this.cv.width = Math.round(r.width * d); this.cv.height = Math.round(r.height * d); }
  frame(i) { const n = this.n; i = ((i % n) + n) % n; if (this.frames[i]) return this.frames[i]; for (let k = 1; k < n; k++) { const f = this.frames[(i - k + n) % n]; if (f) return f; } return null; }
  loop() {
    if (!this.on) return;
    requestAnimationFrame(() => this.loop());
    const now = performance.now(), dt = Math.min(.1, (now - this.t) / 1000); this.t = now;
    if (!this.n) return;
    this.pos += dt * this.n / this.spt * (1 + this.push * 2.5);              // the pointer can lean the turn either way
    const i = Math.floor(this.pos), f = this.pos - i, a = this.frame(i), b = this.frame(i + 1); if (!a) return;
    const c = this.ctx, W = this.cv.width, H = this.cv.height, s = Math.max(W / this.W, H / this.H) * 1.04;
    const dw = this.W * s, dh = this.H * s, dx = (W - dw) / 2, dy = (H - dh) * .62;
    c.globalAlpha = 1; c.drawImage(a, dx, dy, dw, dh);
    if (b && b !== a && f > .02) { c.globalAlpha = f; c.drawImage(b, dx, dy, dw, dh); }
  }
}
