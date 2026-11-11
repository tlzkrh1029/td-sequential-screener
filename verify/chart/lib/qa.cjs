// Harness shared by the checks: a browser on the built page with the canvas recorder installed, the fonts served from a
// local copy (fetched once from the font hosts), console and request logs, and helpers that drive the page as a user
// does (clicks, wheel, drag, keys) and read back the probe together with what was painted.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');
const installRecorder = require('./recorder.js');

const QA_DIR = path.resolve(__dirname, '..');
const FONT_CACHE = process.env.QA_FONTCACHE || path.join(QA_DIR, 'fontcache');
const DAY = 86400000;
const iso = (d) => new Date(d * DAY).toISOString().slice(0, 10);
const dayOf = (s) => Date.parse(s + 'T00:00:00Z') / DAY;

let BROWSER = null;
async function browser() { if (!BROWSER) BROWSER = await chromium.launch(); return BROWSER; }
async function closeAll() { if (BROWSER) { await BROWSER.close(); BROWSER = null; } }

// A page of the site at `base` (http://127.0.0.1:port/). opts: width, height, dpr, touch, dark, hash, fonts ('cache' |
// 'block'), init (a function run before the page's scripts), onRoute (to delay or fail the data file).
async function open(base, opts = {}) {
  const o = { width: 1440, height: 900, dpr: 1, touch: false, dark: false, hash: '#chart-a-btc', fonts: 'cache', storage: null, wait: true, ...opts };
  const b = await browser();
  const context = await b.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: o.dpr, hasTouch: o.touch, isMobile: o.touch, colorScheme: o.dark ? 'dark' : 'light', locale: 'ko-KR', timezoneId: o.tz || 'Asia/Seoul' });
  await context.addInitScript(installRecorder);
  if (o.init) await context.addInitScript(o.init);
  const logs = [], requests = [];
  fs.mkdirSync(FONT_CACHE, { recursive: true });
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
    if (o.fonts === 'block') return route.abort();
    if (o.fontDelay) await new Promise((r) => setTimeout(r, o.fontDelay));
    const url = route.request().url(), f = path.join(FONT_CACHE, crypto.createHash('sha1').update(url).digest('hex'));
    try {
      if (fs.existsSync(f + '.json')) { const meta = JSON.parse(fs.readFileSync(f + '.json', 'utf8')); return await route.fulfill({ status: meta.status, headers: meta.headers, body: fs.readFileSync(f + '.body') }); }
      const resp = await route.fetch(), body = await resp.body();
      const headers = { 'content-type': resp.headers()['content-type'] || 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'max-age=86400' };
      if (resp.status() === 200) { fs.writeFileSync(f + '.body', body); fs.writeFileSync(f + '.json', JSON.stringify({ url, status: 200, headers })); }
      return await route.fulfill({ status: resp.status(), headers, body });
    } catch (e) { try { await route.abort(); } catch (e2) { /* the page is gone */ } }
  });
  if (o.onRoute) await context.route((url) => url.href.startsWith(base), o.onRoute);
  const page = await context.newPage();
  page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') logs.push(`console.${t}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + String(e && e.stack || e).slice(0, 400)));
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));
  page.on('requestfailed', (r) => { const u = r.url(); if (!/fonts\.(googleapis|gstatic)\.com/.test(u) || o.fonts !== 'block') logs.push(`requestfailed: ${u.slice(0, 160)} ${(r.failure() || {}).errorText || ''}`); });
  page.on('response', (r) => { if (r.status() >= 400) logs.push(`http ${r.status()}: ${r.url().slice(0, 160)}`); });
  if (o.storage) await context.addInitScript((s) => { try { if (!sessionStorage.getItem('__qa_seeded')) { localStorage.setItem('td-birdeye', s); sessionStorage.setItem('__qa_seeded', '1'); } } catch (e) { /* no storage */ } }, JSON.stringify(o.storage));
  await page.goto(base + o.hash, { waitUntil: 'load' });
  if (o.wait) await ready(page, null, o.settle !== false);
  return { context, page, logs, requests, base, opts: o };
}

// The view is up: the probe answers, every font the page and its canvases asked for has arrived, and the picture has
// been laid out with them. The last step is needed because the page lays its canvas text out with the widths it
// measured first: a font that arrives after the page's own "fonts ready" hook has run leaves the fallback font's
// widths in use (the font check shows how often). So the harness waits for the fonts and then makes the page refresh
// its text metrics the way its own theme hook does (the data-theme attribute is set to the theme in force, which
// changes no color). opts.settle === false leaves the page as it came up.
async function ready(page, slug, settle = true) {
  await page.waitForFunction((s) => { const r = document.querySelector('#stage-root'); const p = r && r.__probe && r.__probe(); return !!p && (!s || p.coin === s); }, slug || null, { timeout: 30000 });
  await page.evaluate(async (doSettle) => {
    const frames = (n) => new Promise((r) => { const step = () => (n-- > 0 ? requestAnimationFrame(step) : r()); step(); });
    const fontsIn = async () => { if (!document.fonts) return; for (let i = 0, calm = 0; i < 80 && calm < 3; i++) { await document.fonts.ready; await new Promise((r) => setTimeout(r, 20)); calm = document.fonts.status === 'loaded' ? calm + 1 : 0; } };
    await fontsIn(); await frames(2);
    if (doSettle) {
      const root = document.documentElement, dark = matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', root.getAttribute('data-theme') || (dark ? 'dark' : 'light'));
      await frames(2); await fontsIn();
      root.setAttribute('data-theme', root.getAttribute('data-theme'));
      await frames(2);
    }
    document.querySelector('#stage-root').__probe();
  }, settle);
}

// what the page says (probe) and what is painted (the frames of its canvases), read in one go
async function snap(page, want = {}) {
  return page.evaluate((w) => {
    const root = document.querySelector('#stage-root'), p = root && root.__probe ? root.__probe() : null;
    const q = (s) => document.querySelector(s), rect = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const cs = getComputedStyle(document.documentElement), theme = {};
    for (const k of ['fg', 'muted', 'faint', 'line', 'surface', 'sunken', 'accent', 'setup', 'setup-ink', 'bg']) theme[k] = cs.getPropertyValue('--' + k).trim().toLowerCase();
    const cB = q('.bec-chart canvas:not(.bec-over)'), cO = q('.bec-chart canvas.bec-over'), sB = q('.bec-strip canvas:not(.bec-over)'), sO = q('.bec-strip canvas.bec-over');
    const out = { probe: p, theme, S: JSON.parse(JSON.stringify(BE.vstate('chart-a', {}))), fam: BE.state.fam.slice(), coin: BE.state.coin, hash: location.hash,
      winText: q('.bec-win') ? q('.bec-win').textContent : null, nowHidden: q('.bec-now') ? q('.bec-now').hidden : null,
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio, sy: scrollY,
      rc: rect(cO), rs: rect(sO), fn: { cBase: cB ? __qa.frame(cB).n : -1, sBase: sB ? __qa.frame(sB).n : -1 }, frames: {} };
    out.frames.cBase = __qa.frame(cB);
    // is the chart's canvas there to be seen: shown, opaque, and nothing but its own transparent layer in front of it
    if (cB && cO && p) {
      const st = getComputedStyle(cB), r = cB.getBoundingClientRect(), pts = p.labels.filter((L) => L.shown === 'text').slice(0, 3).map((L) => [L.x + L.w / 2, L.y + L.h / 2]);
      let hidden = st.display === 'none' || st.visibility !== 'visible' || Number(st.opacity) < 1 || r.width < 10 || r.height < 10 ? `display ${st.display}, visibility ${st.visibility}, opacity ${st.opacity}, ${r.width}x${r.height}` : '';
      for (let e = cB.parentElement; e && !hidden; e = e.parentElement) { const s2 = getComputedStyle(e); if (s2.display === 'none' || s2.visibility === 'hidden' || Number(s2.opacity) < 1) hidden = `an element around it (${e.className || e.tagName}) has display ${s2.display}, visibility ${s2.visibility}, opacity ${s2.opacity}`; }
      const covered = [];
      for (const [x, y] of pts) { const cx = r.left + x, cy = r.top + y; if (cx < 1 || cy < 1 || cx > innerWidth - 2 || cy > innerHeight - 2) continue; /* only points inside the window can be asked about */ const stack = document.elementsFromPoint(cx, cy), i = stack.indexOf(cB); const front = (i < 0 ? stack : stack.slice(0, i)).filter((e) => e !== cO && e.id !== 'tip' && !e.closest('#tip')); if (i < 0 || front.length) covered.push(`at ${Math.round(x)},${Math.round(y)}: ${(front[0] && (front[0].className || front[0].tagName)) || 'the canvas is not there'}`); }
      out.seen = { hidden, covered };
    }
    if (w.over) out.frames.cOver = __qa.frame(cO);
    if (w.strip) { out.frames.sBase = __qa.frame(sB); out.frames.sOver = __qa.frame(sO); }
    if (w.sover) out.frames.sOver = __qa.frame(sO);
    if (w.nobase) delete out.frames.cBase;
    return out;
  }, want);
}

// ---------- driving the page ----------
const ctlButtons = (label) => `(() => { for (const c of document.querySelectorAll('#stage-root .bec-ctl .ctl')) { const s = c.querySelector(':scope > span'); if (s && s.textContent.trim() === ${JSON.stringify(label)}) return [...c.querySelectorAll('button')]; } return []; })()`;
// a real click on the button `text` of the segmented control `label` (기간, 가격 축, 9, +13, 방향, 다음 봉 조건, 임박 기준)
async function clickSeg(page, label, text) {
  const h = await page.evaluateHandle(`${ctlButtons(label)}.find((b) => b.textContent.trim() === ${JSON.stringify(text)}) || null`);
  const e = h.asElement(); if (!e) throw new Error(`no button "${text}" in control "${label}"`);
  await e.scrollIntoViewIfNeeded(); await e.click(); await h.dispose();
}
// Settings put straight into the view's saved state (the same object the controls write), then one real click on the
// pressed button of 가격 축, which lays everything out again. For sweeps over many states; the controls themselves are
// checked with real clicks in the controls check, which also shows both ways give the same picture.
async function setState(page, st) {
  await page.evaluate((s) => {
    const S = BE.vstate('chart-a', {});
    for (const k of ['off', 'nine', 'def', 'dir', 'cond', 'near', 'scale']) if (k in s) S[k] = Array.isArray(s[k]) ? s[k].slice() : s[k];
    if ('fam' in s) BE.state.fam = s.fam.slice().sort();
    for (const c of document.querySelectorAll('#stage-root .bec-ctl .ctl')) {
      const sp = c.querySelector(':scope > span'); if (!sp || sp.textContent.trim() !== '가격 축') continue;
      const b = [...c.querySelectorAll('button')].find((x) => x.dataset.v === String(S.scale)); b.click(); return;
    }
    throw new Error('no 가격 축 control');
  }, st);
}
const DEFAULT_STATE = { off: [], nine: 'on', def: 'off', dir: 'both', cond: 'on', near: 5, scale: 'auto', fam: [0, 2, 3] };
async function preset(page, text) { await clickSeg(page, '기간', text); }
// the strip: a real click at the place of `day` (the window goes there unless the click lands in the window box)
async function stripClick(page, day) {
  const g = await page.evaluate(() => { const p = document.querySelector('#stage-root').__probe(), r = document.querySelector('.bec-strip canvas.bec-over').getBoundingClientRect(); return { x: r.left, y: r.top, sc: p.stripScale, box: p.stripBox }; });
  const x = g.x + g.sc.x0 + (day - g.sc.first + 0.5) * g.sc.ppd;
  await page.mouse.click(x, g.y + 60);
}
// the window so that `day` is about in its middle. A click in the window box, or within a few pixels of its edges
// (where the strip takes hold of the edge), moves nothing: the strip is clicked far away first then.
async function centerOn(page, day) {
  const p = await page.evaluate(() => { const p = document.querySelector('#stage-root').__probe(); return { d0: p.d0, d1: p.d1, first: p.stripScale.first, ppd: p.stripScale.ppd, last: BE.LAST }; });
  const pad = Math.ceil(10 / p.ppd) + 1;
  if (day >= p.d0 - pad && day <= p.d1 + pad) {
    const far = day - p.first > p.last - day ? p.first : p.last;
    await stripClick(page, far);
    const q = await page.evaluate(() => { const p = document.querySelector('#stage-root').__probe(); return { d0: p.d0, d1: p.d1 }; });
    if (day >= q.d0 - pad && day <= q.d1 + pad) await stripClick(page, far === p.first ? p.last : p.first);
  }
  await stripClick(page, day);
}
// Ctrl + wheel over the chart at the day `day` (or the middle): deltaY < 0 zooms in
async function zoom(page, deltaY, frac = 0.5) {
  const r = await page.evaluate(() => { const p = document.querySelector('#stage-root').__probe(), r = document.querySelector('.bec-chart canvas.bec-over').getBoundingClientRect(); return { x: r.left, y: r.top, l: p.plot.l, r: p.plot.r }; });
  await page.mouse.move(r.x + r.l + (r.r - r.l) * frac, r.y + 200);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, deltaY); await page.keyboard.up('Control');
}
// a horizontal wheel over the chart: pans by whole days
async function panWheel(page, days) {
  const r = await page.evaluate(() => { const p = document.querySelector('#stage-root').__probe(), r = document.querySelector('.bec-chart canvas.bec-over').getBoundingClientRect(); return { x: r.left, y: r.top, l: p.plot.l, r: p.plot.r, ppd: p.ppd }; });
  await page.mouse.move(r.x + (r.l + r.r) / 2, r.y + 200);
  await page.mouse.wheel(days * r.ppd + (days > 0 ? 0.01 : -0.01), 0);
}
async function gotoCoin(page, slug) { await page.evaluate((s) => { location.hash = '#chart-a-' + s; }, slug); await ready(page, slug); }
async function mouseOff(page) { await page.mouse.move(2, 2); }

// the tooltip as the reader sees it: text of each block, and the numbers in it (text, superscript, color)
const TIP_JS = `(() => { const t = document.getElementById('tip'); if (!t || getComputedStyle(t).display === 'none') return null;
  const kids = [...t.children].map((e) => ({ cls: e.className, text: e.textContent.replace(/\\s+/g, ' ').trim() }));
  const rows = [...t.querySelectorAll('.row')].map((r) => { const n = r.querySelector('b.bec-n'), w = r.querySelector('b.bec-w'); const b = n || w; const sup = b ? b.querySelector('sup') : null;
    return { inSec: !!r.closest('.sec'), text: r.textContent.replace(/\\s+/g, ' ').trim(), num: b ? { text: b.firstChild ? b.firstChild.textContent : '', sup: sup ? sup.textContent : '', color: getComputedStyle(b).color, cls: b.className, wait: !!w } : null,
      rest: [...r.childNodes].filter((x) => x !== b).map((x) => x.textContent).join(' ').replace(/\\s+/g, ' ').trim() }; });
  const r = t.getBoundingClientRect();
  return { text: t.textContent.replace(/\\s+/g, ' ').trim(), kids, rows, box: { x: r.left, y: r.top, w: r.width, h: r.height } }; })()`;
const tip = (page) => page.evaluate(TIP_JS);

// ---------- pixels ----------
// What is really on the chart canvas where a number stands: the pixels of its box are read back and compared with the
// same number drawn here, off screen, from what the ENGINE says (text, timeframe, color) at the place and in the fonts
// the recorder saw. items: [{ ground {x,y,w,h}, text, sup, color, alpha, font, supFont, x, base, sx, sbase }].
// Returns per item { real, mine, both, iou }: ink pixels on the canvas, in the redrawing, in both, and their overlap.
async function pixelProof(page, items) {
  return page.evaluate((list) => {
    const cv = document.querySelector('.bec-chart canvas:not(.bec-over)'), dpr = window.devicePixelRatio || 1;
    const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)), S = hex(surface), out = [];
    // the numbers drawn anew on a canvas of the chart's own size (so that the browser draws both the same way) ...
    const off = document.createElement('canvas'); off.width = cv.width; off.height = cv.height;
    const o = off.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0);
    o.fillStyle = surface; o.fillRect(0, 0, cv.width / dpr, cv.height / dpr);
    for (const it of list) {
      // (the ground as the page lays it, so that the rounding under the text is the same)
      o.globalAlpha = it.ground.al == null ? 1 : it.ground.al; o.fillStyle = surface; o.fillRect(it.ground.x, it.ground.y, it.ground.w, it.ground.h);
      o.globalAlpha = it.alpha; o.fillStyle = it.color; o.textAlign = 'left'; o.textBaseline = 'alphabetic';
      o.font = it.font; o.fillText(it.text, it.x, it.base);
      o.font = it.supFont; o.fillText(it.sup, it.sx, it.sbase);
    }
    // ... and both read from copies (the page's own canvas is left as it is)
    const read = (src) => { const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0); return x; };
    const A = read(cv), B = read(off);
    for (const it of list) {
      const g = it.ground, x0 = Math.round(g.x * dpr), y0 = Math.round(g.y * dpr), W = Math.max(1, Math.round(g.w * dpr)), H = Math.max(1, Math.round(g.h * dpr));
      const real = A.getImageData(x0, y0, W, H).data, mine = B.getImageData(x0, y0, W, H).data;
      let a = 0, b = 0, both = 0;
      // a pixel is ink when it is nearer to the number's color (as strong as it is painted) than to the surface
      const C = hex(it.color).map((v, k) => S[k] + (v - S[k]) * it.alpha);
      // (1 ink, -1 surface, 0 for a pixel about half way, which counts for neither)
      const span = Math.abs(C[0] - S[0]) + Math.abs(C[1] - S[1]) + Math.abs(C[2] - S[2]);
      const isInk = (d, i) => { const di = Math.abs(d[i] - C[0]) + Math.abs(d[i + 1] - C[1]) + Math.abs(d[i + 2] - C[2]), ds = Math.abs(d[i] - S[0]) + Math.abs(d[i + 1] - S[1]) + Math.abs(d[i + 2] - S[2]); return di < ds - span * 0.12 ? 1 : ds < di - span * 0.12 ? -1 : 0; };
      for (let i = 0; i < real.length; i += 4) { const ia = isInk(real, i), ib = isInk(mine, i); if (ia === 0 || ib === 0) { if (ia === 1) a++; if (ib === 1) b++; if (ia === 1 || ib === 1) both++; continue; } if (ia === 1) a++; if (ib === 1) b++; if (ia === 1 && ib === 1) both++; }
      out.push({ real: a, mine: b, both, iou: a + b - both ? both / (a + b - both) : 1 });
    }
    return out;
  }, items);
}
// the items of pixelProof for the numbers verifyState matched: r.shownText = [probe label, engine label, painted number]
function proofItems(M, shownText, theme) {
  return shownText.map(([L, E, N]) => ({ ground: N.ground, text: E.text, sup: E.tf, color: M.colorOf(E, theme), alpha: N.alpha, font: N.t.font, supFont: N.s.font, x: N.t.x, base: N.t.y, sx: N.s.x, sbase: N.s.y }));
}

// ---------- results ----------
// A check collects counts and failures and prints its one line at the end.
class Check {
  constructor(name) { this.name = name; this.n = {}; this.fails = []; this.notes = []; this.t0 = Date.now(); }
  count(k, by = 1) { this.n[k] = (this.n[k] || 0) + by; }
  fail(msg, data) { if (this.fails.length < 400) this.fails.push(data === undefined ? String(msg) : `${msg} ${typeof data === 'string' ? data : JSON.stringify(data)}`); this.count('failures'); }
  ok(cond, msg, data) { this.count('assertions'); if (!cond) this.fail(msg, data); return !!cond; }
  note(msg) { this.notes.push(msg); }
  logs(ctx, where) { for (const l of ctx.logs) this.fail(`console/page problem${where ? ' (' + where + ')' : ''}:`, l); this.count('pages'); }
  finish(outDir) {
    const failed = this.fails.length > 0, totals = Object.entries(this.n).filter(([k]) => k !== 'failures').map(([k, v]) => `${k} ${v}`).join(', ');
    const line = `${failed ? 'FAIL' : 'PASS'} ${this.name}: ${totals}${failed ? `; ${this.n.failures} failures, first: ${this.fails[0].slice(0, 400)}` : ''} [${((Date.now() - this.t0) / 1000).toFixed(1)}s]`;
    if (outDir) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, this.name + '.json'), JSON.stringify({ name: this.name, pass: !failed, totals: this.n, notes: this.notes, fails: this.fails }, null, 1)); }
    console.log(line);
    for (const n of this.notes) console.log(`     note ${this.name}: ${n}`);
    return failed ? 1 : 0;
  }
}
function args() {
  const a = process.argv.slice(2), o = { base: 'http://127.0.0.1:8911/', out: path.join(QA_DIR, 'out'), expect: null, quick: false };
  for (let i = 0; i < a.length; i++) { if (a[i] === '--base') o.base = a[++i]; else if (a[i] === '--out') o.out = a[++i]; else if (a[i] === '--expect') o.expect = a[++i]; else if (a[i] === '--quick') o.quick = true; else if (a[i] === '--frag') o.frag = a[++i]; else if (a[i] === '--repo') o.repo = a[++i]; }
  if (!o.expect) o.expect = path.join(o.out, 'expect.json');
  if (!o.base.endsWith('/')) o.base += '/';
  return o;
}
// a small deterministic random source, so a run can be repeated
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

module.exports = { pixelProof, proofItems, QA_DIR, DAY, iso, dayOf, open, ready, snap, clickSeg, setState, DEFAULT_STATE, preset, stripClick, centerOn, zoom, panWheel, gotoCoin, mouseOff, tip, TIP_JS, Check, args, rng, closeAll, browser };
