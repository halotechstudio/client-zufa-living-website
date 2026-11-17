// Air: a few motes of light drifting at different depths in front of the page — pollen by day (stone pages),
// fireflies by night (ink pages). They move with the scroll and lean away from the pointer, which gives the flat
// pages real depth. One small canvas, ~50 particles, paused when the tab is hidden.
export class Air {
  constructor(canvas, { count = 52 } = {}) {
    this.cv = canvas; this.c = canvas.getContext('2d'); this.night = 1; this.sy = 0; this.vy = 0; this.mx = 0; this.my = 0;
    const R = Math.random;
    this.p = Array.from({ length: count }, () => ({ x: R(), y: R(), z: .25 + R() * .75, ph: R() * 6.28, sp: .4 + R() * .8, r: .6 + R() * 1.6 }));
    addEventListener('resize', () => this.size()); this.size();
    addEventListener('pointermove', e => { this.mx = e.clientX / innerWidth - .5; this.my = e.clientY / innerHeight - .5; });
    this.t = performance.now(); const loop = () => { requestAnimationFrame(loop); if (!document.hidden) this.draw(); }; loop();
  }
  size() { const d = Math.min(devicePixelRatio || 1, 2); this.d = d; this.cv.width = innerWidth * d; this.cv.height = innerHeight * d; }
  scroll(y, night) { if (!isFinite(y)) return; this.vy = y - this.sy; this.sy = y; if (isFinite(night)) this.night = night; }
  draw() {
    const now = performance.now(), dt = Math.min(.05, (now - this.t) / 1000); this.t = now;
    const c = this.c, W = this.cv.width, H = this.cv.height, d = this.d, n = this.night;
    c.clearRect(0, 0, W, H);
    if (!W || !H || !innerHeight) return;
    const col = n > .5 ? '255,214,140' : '201,169,121';
    for (const p of this.p) {
      p.ph += dt * p.sp;
      p.y -= dt * .006 * p.sp + this.vy / innerHeight * p.z * .35;           // nearer motes travel further with the scroll
      p.x += Math.sin(p.ph * .7) * dt * .004;
      if (p.y < -.05) { p.y = 1.05; p.x = Math.random(); } if (p.y > 1.05) { p.y = -.05; p.x = Math.random(); }
      const x = (p.x - this.mx * .04 * p.z) * W, y = (p.y - this.my * .03 * p.z) * H;
      const glow = n > .5 ? .35 + .65 * Math.max(0, Math.sin(p.ph * 1.7)) : .55;  // fireflies pulse; pollen just drifts
      const r = p.r * p.z * d * (n > .5 ? 2.2 : 1.6), a = (n > .5 ? .55 : .42) * glow * p.z;
      if (!isFinite(x + y + r)) { p.x = Math.random(); p.y = Math.random(); continue; }
      const g = c.createRadialGradient(x, y, 0, x, y, r * 4); g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 4, 0, 6.283); c.fill();
    }
    this.vy *= .8;
  }
}
