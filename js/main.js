// ZUFA Living — one seamless scroll in the brochure's language. Motion is time based and short (reveals, the 3D lift);
// the only scroll-linked things are cheap transforms (image depth, the page tone), so the scroll itself stays smooth.
import { Plan, View3D } from './plan.js';
import { PLOTS } from './site-data.js';
import { Turntable } from './turntable.js';
import { Air } from './air.js';

const CONFIG = { email: 'zufaliving@gmail.com', phone: '+91 98850 33844' };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover:hover) and (pointer:fine)').matches;
const phone = () => innerWidth < 760;

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
scrollTo(0, 0);

/* ---------------- smooth scroll ---------------- */
let lenis = null;
if (!reduce && window.Lenis) {
  lenis = new window.Lenis({ lerp: 0.1, wheelMultiplier: 0.95, smoothWheel: true, syncTouch: false });
  const raf = t => { lenis.raf(t); requestAnimationFrame(raf); }; requestAnimationFrame(raf);
  lenis.on('scroll', frame);
} else addEventListener('scroll', frame, { passive: true });
const sy = () => (lenis ? lenis.scroll : scrollY);
function goTo(el, opts = {}) {
  if (typeof el === 'string') el = $(el); if (!el) return;
  if (lenis) lenis.scrollTo(el, { duration: 1.6, easing: t => 1 - Math.pow(1 - t, 4), ...opts }); else el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
}
$$('a[href^="#"]').forEach(a => a.addEventListener('click', e => { const h = a.getAttribute('href'); if (h.length < 2 || a.hasAttribute('data-enquire')) return; const t = $(h); if (!t) return; e.preventDefault(); goTo(t); }));

/* ---------------- page tone: stone and ink blend into each other at every turn of the page ---------------- */
const secs = $$('main > .sec').map(el => ({ el, ink: el.dataset.tone === 'ink' ? 1 : 0, top: 0, h: 0 }));
const STONE = [238, 232, 223], INK = [28, 26, 23];
const nav = $('[data-nav]'), navLinks = $$('.nav__links a');
function measure() { let y = 0; for (const s of secs) { s.top = s.el.offsetTop; s.h = s.el.offsetHeight; y = s.top + s.h; } }
function toneAt(y) {
  const Z = innerHeight * 0.3;                                      // the blend runs over ~30% of a screen around each edge
  let i = 0; while (i < secs.length - 1 && secs[i + 1].top <= y) i++;
  const s = secs[i]; let v = s.ink;
  const next = secs[i + 1], prev = secs[i - 1];
  if (next && next.ink !== s.ink) { const t = clamp((y - (next.top - Z / 2)) / Z); v = lerp(s.ink, next.ink, t * t * (3 - 2 * t)); }
  if (prev && prev.ink !== s.ink) { const t = clamp((y - (s.top - Z / 2)) / Z); v = lerp(prev.ink, s.ink, t * t * (3 - 2 * t)); }
  return v;
}
const rgbAt = v => STONE.map((c, k) => Math.round(lerp(c, INK[k], v))).join(',');

// the brochure's .fd fade settings move onto the photograph itself (a CSS mask), so it fades to transparent
document.querySelectorAll('.ph > .fd').forEach(fd => { const ph = fd.parentElement; for (const k of ['--d', '--s']) { const v = fd.style.getPropertyValue(k); if (v) ph.style.setProperty(k, v); } fd.remove(); });

/* ---------------- depth: images drift a little against the scroll ---------------- */
const phs = $$('[data-ph]'), visible = new Set();
const vio = new IntersectionObserver(es => es.forEach(e => e.isIntersecting ? visible.add(e.target) : visible.delete(e.target)), { rootMargin: '20% 0px' });
phs.forEach(p => vio.observe(p));

let air = null;
const hero = $('.hero'), heroMedia = $('[data-hero]'), heroCopy = $('.hero__copy');
let lastTone = -1, lastNav = '';
function frame() {
  const y = sy(), vh = innerHeight;
  // page tone at the centre of the screen; the nav reads the tone under itself
  const v = toneAt(y + vh * 0.5);
  if (Math.abs(v - lastTone) > 0.002) { document.documentElement.style.setProperty('--page', rgbAt(v)); lastTone = v; }
  // the nav takes the tone of the page right under it (no blend), and fades between tones in CSS
  let ni = 0; while (ni < secs.length - 1 && secs[ni + 1].top <= y + 34) ni++;
  const nt = secs[ni].ink ? 'ink' : 'stone';
  if (nt !== lastNav) { nav.dataset.t = nt; lastNav = nt; }
  nav.classList.toggle('is-scrolled', y > vh * 0.6);
  // hero: you drive in through the gate (the photograph comes toward you, the title lifts away)
  if (y < vh * 1.2) {
    const k = clamp(y / vh);
    heroMedia.style.transform = `translate3d(0,${(y * 0.22).toFixed(1)}px,0) scale(${(1 + k * 0.32).toFixed(4)})`; heroMedia.style.opacity = (1 - k * .55).toFixed(3);
    heroCopy.style.opacity = (1 - k * 1.6).toFixed(3); heroCopy.style.transform = `translate3d(0,${(-y * 0.12).toFixed(1)}px,0)`;
  }
  // every page settles back in depth as the next one rises over it: one continuous surface, no cuts
  if (!reduce && !document.body.classList.contains('is-3d')) for (const s of secs) {
    if (s.el === hero) continue;
    const bottom = s.top + s.h - y;                                   // layout position (unaffected by our own transform)
    const leave = bottom < vh && bottom > 0 ? Math.min(1, 1 - bottom / vh) : bottom <= 0 ? 1 : 0;
    if (leave === s.leave) continue; s.leave = leave;
    if (leave <= 0) { s.el.style.transform = ''; s.el.style.opacity = ''; continue; }
    const e = leave * leave * (3 - 2 * leave);
    s.el.style.transform = phone() ? `translate3d(0,${(e * vh * .08).toFixed(1)}px,0) scale(${(1 - e * .04).toFixed(4)})`
      : `perspective(1600px) translate3d(0,${(e * vh * .1).toFixed(1)}px,0) rotateX(${(e * 7).toFixed(2)}deg) scale(${(1 - e * .07).toFixed(4)})`;
    s.el.style.opacity = (1 - e * .9).toFixed(3);
  }
  air && air.scroll(y, v);
  if (!reduce) for (const p of visible) {
    const r = p.getBoundingClientRect(), k = (r.top + r.height / 2 - vh / 2) / vh;
    p.firstElementChild.style.setProperty('--py', `${(-k * r.height * 0.07).toFixed(1)}px`);
  }
  // nav: mark the chapter in view
  const mid = y + vh * 0.4; let on = null;
  for (const a of navLinks) { const t = $(a.getAttribute('href')); if (t && t.offsetTop <= mid) on = a; }
  navLinks.forEach(a => a.classList.toggle('is-on', a === on));
}

/* ---------------- reveals: short, crisp, once ---------------- */
$$('[data-lines]').forEach(h => {
  h.innerHTML = h.innerHTML.split(/<br\s*\/?>/i).map((l, i) => `<span class="ln"><span style="--dl:${(i * 0.09).toFixed(2)}s">${l.trim()}</span></span>`).join('');
});
const rio = new IntersectionObserver(es => {
  const ins = es.filter(e => e.isIntersecting).map(e => e.target).sort((a, b) => a.compareDocumentPosition(b) & 4 ? -1 : 1);
  ins.forEach((el, i) => {
    if (!el.matches('[data-lines]') && !el.style.getPropertyValue('--dl')) el.style.setProperty('--dl', `${Math.min(i * 0.07, 0.42).toFixed(2)}s`);
    el.classList.add('is-in'); rio.unobserve(el);
    if (el.matches('.stats > div')) countUp(el.querySelector('[data-count]'));
  });
}, { rootMargin: '0px 0px -9% 0px', threshold: 0.12 });
$$('[data-r], [data-lines], [data-ph], [data-map], [data-plan]').forEach(el => { if (!el.closest('.hero')) rio.observe(el); });

function countUp(el) {
  if (!el || reduce) return; const to = +el.dataset.count, suf = el.textContent.replace(/[\d,]/g, ''), t0 = performance.now(), dur = 1300;
  const f = now => { const t = clamp((now - t0) / dur), e = 1 - Math.pow(1 - t, 4); el.textContent = Math.round(to * e).toLocaleString('en-IN') + suf; if (t < 1) requestAnimationFrame(f); };
  requestAnimationFrame(f);
}

/* ---------------- 3D touch: cards lean toward the pointer; the hero breathes with the mouse ---------------- */
if (finePointer && !reduce) {
  $$('[data-tilt]').forEach(c => {
    c.addEventListener('pointermove', e => { const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      c.style.setProperty('--ry', `${(x * 7).toFixed(2)}deg`); c.style.setProperty('--rx', `${(-y * 6).toFixed(2)}deg`);
      c.firstElementChild.style.setProperty('--tx', `${(-x * 16).toFixed(1)}px`); c.firstElementChild.style.setProperty('--ty', `${(-y * 12).toFixed(1)}px`); });
    c.addEventListener('pointerleave', () => { ['--rx', '--ry'].forEach(k => c.style.setProperty(k, '0deg')); ['--tx', '--ty'].forEach(k => c.firstElementChild.style.setProperty(k, '0px')); });
  });
  const img = heroMedia.querySelector('img'); let mx = 0, my = 0, tx = 0, ty = 0;
  hero.addEventListener('pointermove', e => { tx = (e.clientX / innerWidth - .5) * -22; ty = (e.clientY / innerHeight - .5) * -14; });
  const drift = () => { mx += (tx - mx) * .06; my += (ty - my) * .06; img.style.setProperty('--mx', `${mx.toFixed(2)}px`); img.style.setProperty('--my', `${my.toFixed(2)}px`); if (sy() < innerHeight) heroCopy.style.translate = `${(-mx * .35).toFixed(2)}px 0`; requestAnimationFrame(drift); };
  drift();
}

/* ---------------- the layout and its 3D lift ---------------- */
const plan = new Plan($('[data-plan]'), $('[data-plotcard]'), enquire);
$$('[data-legend] [data-cat]').forEach(b => {
  b.addEventListener('mouseenter', () => plan.filter(b.dataset.cat)); b.addEventListener('mouseleave', () => { if (!b.classList.contains('is-on')) plan.filter(null); });
  b.addEventListener('click', () => { const on = !b.classList.contains('is-on'); $$('[data-legend] [data-cat]').forEach(x => x.classList.remove('is-on')); b.classList.toggle('is-on', on); plan.filter(on ? b.dataset.cat : null); });
});
const goBtn = $('[data-3d]');
const v3d = new View3D($('[data-v3d]'), plan, {
  onProgress: p => { goBtn.style.setProperty('--load', p.toFixed(3)); if (p >= 1) goBtn.disabled = false; },
  onOpen: () => { lenis?.stop(); document.body.classList.add('is-3d'); },
  onClose: () => { lenis?.start(); document.body.classList.remove('is-3d'); },
  onEnquire: enquire,
});
// start fetching the 3D frames while the reader is still a screen or two away
new IntersectionObserver((es, o) => { if (es.some(e => e.isIntersecting)) { v3d.load().catch(err => { console.error(err); goBtn.hidden = true; }); o.disconnect(); } }, { rootMargin: '160% 0px' }).observe($('#layout'));
goBtn.addEventListener('click', () => { plan.pinned = null; plan.show(null); goTo('#layout', { duration: .7 }); setTimeout(() => v3d.open(), lenis ? 380 : 0); });

/* ---------------- enquiry ---------------- */
const form = $('[data-form]');
function enquire(id) {
  plan.pinned = null; plan.show(null);
  const p = PLOTS.find(q => q.id === +id);
  if (p) { $('#f-plot').value = p.id; $('#f-interest').value = p.cat === 'half' ? 'Half-acre estate' : p.cat === 'signature' ? 'Signature Estate (Plot 47)' : p.cat === 'bespoke' ? 'Bespoke estate' : 'Quarter-acre estate'; }
  goTo('#visit', { duration: 2 });
  setTimeout(() => $('#f-name').focus({ preventScroll: true }), 2100);
}
form.addEventListener('submit', e => {
  e.preventDefault(); let ok = true;
  $$('[required]', form).forEach(i => { const bad = !i.value.trim() || (i.pattern && !new RegExp('^' + i.pattern + '$').test(i.value.trim())); i.closest('.field').classList.toggle('is-error', bad); if (bad) ok = false; });
  if (!ok) return;
  const d = Object.fromEntries(new FormData(form));
  const body = `Site visit request\n\nName: ${d.name}\nPhone: ${d.phone}\nInterested in: ${d.interest}\nPlot: ${d.plot || '-'}\n`;
  location.href = `mailto:${CONFIG.email}?subject=${encodeURIComponent('ZUFA Living — site visit request')}&body=${encodeURIComponent(body)}`;
  $('.form__ok', form).hidden = false;
});

/* ---------------- the sound of the land (synthesised: breeze through leaves, distant birds) ---------------- */
const Sound = {
  on: false,
  start() {
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = C.createGain(); this.master.gain.value = 0; this.master.connect(C.destination);
    const len = C.sampleRate * 4, buf = C.createBuffer(2, len, C.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); let a = 0; for (let i = 0; i < len; i++) { a = (a + .02 * (Math.random() * 2 - 1)) / 1.02; d[i] = a * 3.2; } }
    const src = C.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = C.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650;
    const sw = C.createGain(); sw.gain.value = .55; const lfo = C.createOscillator(); lfo.frequency.value = .08; const lg = C.createGain(); lg.gain.value = .25; lfo.connect(lg); lg.connect(sw.gain); lfo.start();
    src.connect(lp); lp.connect(sw); sw.connect(this.master); src.start();
    this.birds = C.createGain(); this.birds.gain.value = .7; this.birds.connect(this.master);
    const chirp = () => {
      if (this.on) {
        const t0 = C.currentTime, n = 2 + (Math.random() * 4 | 0), base = 2300 + Math.random() * 2200;
        const pan = C.createStereoPanner ? C.createStereoPanner() : null; if (pan) { pan.pan.value = Math.random() * 1.6 - .8; pan.connect(this.birds); }
        for (let i = 0; i < n; i++) {
          const o = C.createOscillator(), g = C.createGain(), t = t0 + i * (.09 + Math.random() * .05);
          o.frequency.setValueAtTime(base * (1 + Math.random() * .15), t); o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * .3), t + .05); o.frequency.exponentialRampToValueAtTime(base * .9, t + .1);
          g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.035, t + .015); g.gain.exponentialRampToValueAtTime(.0005, t + .11);
          o.connect(g); g.connect(pan || this.birds); o.start(t); o.stop(t + .13);
        }
      }
      setTimeout(chirp, 700 + Math.random() * 3200);
    };
    chirp();
  },
  toggle() { if (!this.ctx) this.start(); this.on = !this.on; this.ctx.resume(); this.master.gain.setTargetAtTime(this.on ? .7 : 0, this.ctx.currentTime, .5); return this.on; },
};
const snd = $('[data-sound]');
snd.addEventListener('click', () => { const on = Sound.toggle(); snd.setAttribute('aria-pressed', on); snd.setAttribute('aria-label', on ? 'Turn the sound of the land off' : 'Turn the sound of the land on'); });

/* ---------------- arrival ---------------- */
const big = $('.big');
['.big__z', '.big__l'].forEach((s, j) => { const el = $(s, big); el.innerHTML = [...el.textContent].map((c, i) => `<span class="ch" style="--dl:${(0.15 + j * .35 + i * .07).toFixed(2)}s">${c}</span>`).join(''); });
const loader = $('.loader'), line = $('.loader__line');
requestAnimationFrame(() => loader.classList.add('is-show'));
const heroImg = heroMedia.querySelector('img');
const ready = Promise.all([
  heroImg.complete ? Promise.resolve() : new Promise(r => { heroImg.onload = heroImg.onerror = r; }),
  document.fonts ? document.fonts.ready : Promise.resolve(),
  new Promise(r => setTimeout(r, 1100)),
]);
let p = 0; const pt = setInterval(() => { p = Math.min(.9, p + .08); line.style.setProperty('--p', p); }, 90);
ready.then(() => {
  clearInterval(pt); line.style.setProperty('--p', 1);
  setTimeout(() => {
    loader.classList.add('is-out'); document.body.classList.remove('is-loading'); document.body.classList.add('is-ready');
    $$('.hero [data-r]').forEach((el, i) => { el.style.setProperty('--dl', `${(0.55 + i * 0.25).toFixed(2)}s`); el.classList.add('is-in'); });
    measure(); frame();
    setTimeout(() => loader.remove(), 1300);
  }, 320);
});
addEventListener('resize', () => { measure(); frame(); });
addEventListener('load', () => { measure(); frame(); });
new ResizeObserver(() => { measure(); frame(); }).observe(document.body);
measure(); frame();
const tt = $('[data-orbit]') ? new Turntable($('[data-orbit]')) : null;
air = reduce ? null : new Air($('[data-air]'), { count: phone() ? 26 : 52 });
window.zufa = { lenis, plan, v3d, tt, air };
