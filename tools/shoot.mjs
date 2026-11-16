// Screenshot sections of the local site with headless Chrome (Chrome DevTools Protocol, no dependencies).
// Usage: node tools/shoot.mjs <outDir> <width>x<height> <selector|y>[,...] [url]
//   e.g. node tools/shoot.mjs shots 1440x900 top,#premise,#layout http://localhost:4317/
// Each target is scrolled to, animations are settled (reveals shown), then the viewport is captured to <outDir>/<n>.png.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [out = 'shots', size = '1440x900', targets = 'top', url = 'http://localhost:4317/'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const mobile = W < 760;
mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9300 + Math.floor(Math.random() * 500);
const prof = mkdtempSync(join(tmpdir(), 'zshot-'));
const ch = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((ok, fail) => { const i = ++id; pending.set(i, { ok, fail }); ws.send(JSON.stringify({ id: i, method, params })); });
try {
  let tabs;
  for (let k = 0; k < 50; k++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (tabs.length) break; } catch {} await sleep(200); }
  const page = tabs.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.fail(new Error(m.error.message)) : p.ok(m.result); } });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: mobile ? 2 : 1, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Page.navigate', { url });
  await sleep(4500);
  const logs = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__errs||[])', returnByValue: true });
  let n = 0;
  for (const t of targets.split(targets.includes('|') ? '|' : ',')) {   // steps: comma separated, or "|" when a js: step has commas
    // "js:<code>" runs code in the page (awaited) before the capture, e.g. js:document.querySelector('[data-3d]').click()
    if (t.startsWith('js:')) {
      const r = await send('Runtime.evaluate', { expression: `(async()=>{${t.slice(3)}})()`, awaitPromise: true, returnByValue: true });
      await sleep(200);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const f = join(out, `${String(++n).padStart(2, '0')}_js.png`); writeFileSync(f, Buffer.from(shot.data, 'base64')); console.log(f, r.exceptionDetails ? r.exceptionDetails.exception?.description : r.result?.value);
      continue;
    }
    const expr = `(async()=>{const s=document.getElementById('shot-css')||Object.assign(document.createElement('style'),{id:'shot-css'});s.textContent='*,*::before,*::after{transition-duration:0s!important;transition-delay:0s!important;animation-duration:0s!important}';document.head.append(s);
      document.querySelectorAll('[data-r],[data-lines],[data-ph],[data-map],[data-plan]').forEach(e=>e.classList.add('is-in'));
      const t=${JSON.stringify(t)}; const y = t==='top'?0: /^\\d+$/.test(t)? +t : (document.querySelector(t).getBoundingClientRect().top + (window.zufa&&zufa.lenis?zufa.lenis.scroll:scrollY));
      if(window.zufa&&zufa.lenis){zufa.lenis.scrollTo(y,{immediate:true,force:true})}else scrollTo(0,y);
      await new Promise(r=>setTimeout(r,700)); return y;})()`;
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    await sleep(300);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const f = join(out, `${String(++n).padStart(2, '0')}_${t.replace(/[^a-z0-9]/gi, '') || 'top'}.png`);
    writeFileSync(f, Buffer.from(shot.data, 'base64')); console.log(f, r.result && r.result.value);
  }
} catch (e) { console.error('shoot failed:', e.message); process.exitCode = 1; }
finally { try { ws && ws.close(); } catch {} ch.kill(); }
