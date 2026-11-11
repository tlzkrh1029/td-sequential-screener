// Expectations for the bird eye chart, computed OUTSIDE the page from the repository's own modules and data files.
//   node expect.mjs <repoDir> <outFile.json> [--coins BTC,ETH]
// For every coin and each of the 20 timeframes: the confirmed bars (dashboard/bars.js buildBars), the engine's labels
// (dashboard/td-engine.js runTD, default inputs), the day each 9 / 13 / +13 has to stand at on a daily chart (worked
// out here from the daily data, see anchorOf), the next-bar triggers (nextBarTriggers) with dashboard/td-view.js fire
// against the bar in progress (built here from the daily data), and the same distances found again by recounting the
// engine on "confirmed bars + one hypothetical bar" (no td-view.js involved).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoArg, outFile, ...rest] = process.argv.slice(2);
if (!repoArg || !outFile) { console.error('usage: node expect.mjs <repoDir> <outFile.json> [--coins BTC,ETH]'); process.exit(2); }
const REPO = path.resolve(repoArg);
const coinsArg = (rest.includes('--coins') ? rest[rest.indexOf('--coins') + 1] : 'BTC,ETH').split(',').map((s) => s.trim()).filter(Boolean);
const mod = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);
const BARS = await mod('dashboard/bars.js');
const TD = await mod('dashboard/td-engine.js');
const VIEW = await mod('dashboard/td-view.js');
const { TFS, buildBars, bucketFn, isoOfDay, dayOfIso, fileIdOf } = BARS;

const status = JSON.parse(readFileSync(path.join(REPO, 'data/daily/_status.json'), 'utf8'));
const LAST = dayOfIso(status.lastClosedDay);
const tickers = JSON.parse(readFileSync(path.join(REPO, 'data/tickers.json'), 'utf8'));
const OPT = { ...TD.V6_DEFAULTS };
const SCAN = rest.includes('--scan');   // the grid scan (slow): asked for by the conditions check only

// ---------- the day a label is written at ----------
// The last day inside its timeframe bar that has a daily candle.
//   day timeframe:            the bar is its calendar bucket [start, end]
//   week / month timeframe:   from the first day of its first 1W / 1M bar to the day before the next timeframe bar starts
// Three readings are computed, to see whether the data makes them differ at all:
//   task   [first[b], first[b+1] - 1]   (the next bar "starts" at the first day of its first 1W / 1M bar)
//   alt    [first[b], start[b+1] - 1]   (the next bar "starts" at its bucket's first calendar day)
//   bucket [start[b], end[b]]           (the bar's calendar bucket)
// For the last confirmed bar the next bar starts the day after its bucket ends.
function lastDayWithCandle(daily, a, b) {
  for (let d = Math.min(b, LAST); d >= a; d--) { const i = d - daily.d0; if (i >= 0 && i < daily.c.length && daily.c[i] != null) return d; }
  return null;
}
function spansOf(tf, bars, b) {
  const native = !tf.endsWith('D');
  if (!native) return { task: [bars.start[b], bars.end[b]], alt: [bars.start[b], bars.end[b]], bucket: [bars.start[b], bars.end[b]] };
  const nextFirst = b + 1 < bars.n ? bars.first[b + 1] : bars.end[b] + 1;
  const nextStart = b + 1 < bars.n ? bars.start[b + 1] : bars.end[b] + 1;
  return { task: [bars.first[b], nextFirst - 1], alt: [bars.first[b], nextStart - 1], bucket: [bars.start[b], bars.end[b]] };
}

// ---------- the bar in progress, from the daily data ----------
function barInProgress(daily, tf) {
  const [s, e] = bucketFn(tf)(LAST + 1, [0, 0]);
  let o = null, h = -Infinity, l = Infinity, c = null, first = null, last = null;
  for (let d = s; d <= Math.min(e, LAST); d++) {
    const i = d - daily.d0; if (i < 0 || i >= daily.c.length || daily.c[i] == null) continue;
    if (o === null) { o = daily.o[i]; first = d; }
    if (daily.h[i] > h) h = daily.h[i];
    if (daily.l[i] < l) l = daily.l[i];
    c = daily.c[i]; last = d;
  }
  return { start: s, end: e, bar: o === null ? null : { o, h, l, c, first, last } };
}

// ---------- recount: the confirmed bars plus one more bar, through the engine ----------
function recount(bars, bar) {
  const add = (a, v) => { const out = new Float64Array(bars.n + 1); out.set(a.subarray ? a.subarray(0, bars.n) : a.slice(0, bars.n)); out[bars.n] = v; return out; };
  return TD.runTD({ o: add(bars.o, bar.o), h: add(bars.h, bar.h), l: add(bars.l, bar.l), c: add(bars.c, bar.c) }, OPT);
}
// the labels the recount puts on the added bar, as keys: "S|dir" for a 9 (raw given), "C|dir|family|originDay,..."
function newLabels(bars, res) {
  const out = [];
  for (const L of res.labels) {
    if (L.bar !== bars.n) continue;
    if (L.kind === 'S' && L.text.startsWith('9')) out.push({ kind: 'S', d: L.dir, f: null, raw: L.raw, text: L.text, origins: [] });
    else if (L.kind === 'C') out.push({ kind: 'C', d: L.dir, f: L.family, raw: null, text: L.text, origins: L.origins.map((b) => bars.start[b]) });
    else if (L.kind === 'I') out.push({ kind: 'I', d: L.dir, f: L.family, raw: null, text: L.text, origins: [bars.start[L.origin]] });
  }
  return out;
}
const hasTrig = (labels, t) => labels.some((L) => L.d === t.d && (t.k === 'C13' ? L.kind === 'C' && L.f === t.f && L.origins.includes(t.o) : L.kind === 'S' && (t.k === 'S9' ? L.raw === 9 : L.raw >= 18)));
const straight = (base, p, reach = p) => ({ o: base.o, h: Math.max(base.h, p, reach), l: Math.min(base.l, p, reach), c: p });
// the same search as a reader would do by hand, with the engine as the judge: among the prices at which a condition can
// change (every number the trigger names, and the doubles next to them), the close nearest to the current one at which
// the engine prints the label when the bar goes straight there and closes there; then, the bar having touched that
// price, the close nearest to the current one at which it still prints it.
function fireByRecount(bars, base, t) {
  const c0 = base.c, vals = new Set();
  const add = (v) => { if (v > 0 && Number.isFinite(v)) { vals.add(v); vals.add(VIEW.nextAfter(v, -1)); vals.add(VIEW.nextAfter(v, 1)); } };
  for (const g of [t.all || [], ...(t.any || []), ...(t.unless || [])]) for (const [src, , v] of g) { if (src === 'hl') { add(base.l + v); add(base.h - v); } else add(v); }
  const there = (bar) => hasTrig(newLabels(bars, recount(bars, bar)), t);
  if (there({ o: base.o, h: base.h, l: base.l, c: base.c })) return { now: true, p: c0, q: c0 };
  let p = null;
  for (const v of [...vals].sort((a, b) => Math.abs(a - c0) - Math.abs(b - c0))) { if (there(straight(base, v))) { p = v; break; } }
  if (p === null) return null;
  let q = p;
  const lo = Math.min(c0, p), hi = Math.max(c0, p);
  for (const v of [...vals, c0].filter((v) => v >= lo && v <= hi).sort((a, b) => Math.abs(a - c0) - Math.abs(b - c0))) { if (there(straight(base, v, p))) { q = v; break; } }
  // The LEVEL a text has to name for p and for q, found with the engine alone: a number the trigger names at which the
  // engine prints the label (the level counts itself), or the number next to which it first prints it (a strict
  // comparison: the label appears only beyond the level). pl: of p; ql: of q, null when the bar may close where it is.
  const raw = new Set();
  for (const g of [t.all || [], ...(t.any || []), ...(t.unless || [])]) for (const [src, , v] of g) { if (src === 'hl') { raw.add(base.l + v); raw.add(base.h - v); } else raw.add(v); }
  const dir = p < c0 ? -1 : 1;
  const levelOf = (x) => { if (raw.has(x)) return { v: x, strict: false }; for (const r of raw) if (VIEW.nextAfter(r, dir) === x) return { v: r, strict: true }; return null; };
  return { now: false, p, q, dir, pl: levelOf(p), ql: q === p ? levelOf(p) : q === c0 ? null : levelOf(q) };
}
// a scan that knows nothing of the triggers: closes on a fine grid around the current price, the bar going straight to
// each; which 9s and 13s the engine prints, and the grid price nearest to the current one at which each first appears
function scanByRecount(bars, base) {
  const c0 = base.c, found = new Map(), FINE = 0.001, NEAR = 0.3, COARSE = 0.005, DOWN = 0.75, UP = 2.0;
  const key = (L) => (L.kind === 'S' ? `S|${L.d}|${L.raw === 9 ? 'S9' : 'S9r'}` : `C|${L.d}|${L.f}|${L.origins.slice().sort((a, b) => a - b).join(',')}`);
  const visit = (pct) => {
    const p = c0 * (1 + pct);
    for (const L of newLabels(bars, recount(bars, straight(base, p)))) {
      if (L.kind === 'I') continue;
      // one entry per origin of a 13 (a "13x2" names two conditions)
      const ks = L.kind === 'S' ? [key(L)] : L.origins.map((o) => `C|${L.d}|${L.f}|${o}`);
      for (const k of ks) { const was = found.get(k); if (!was || Math.abs(pct) < Math.abs(was.pct)) found.set(k, { pct, p }); }
    }
  };
  visit(0);
  const grid = [];
  for (let i = 1; i * FINE <= NEAR + 1e-12; i++) grid.push(i * FINE);
  for (let x = NEAR + COARSE; x <= UP + 1e-12; x += COARSE) grid.push(x);
  for (const x of grid) { visit(x); if (x <= DOWN + 1e-12) visit(-x); }
  return { fine: FINE, near: NEAR, coarse: COARSE, down: DOWN, up: UP, found: [...found].map(([k, v]) => ({ key: k, pct: v.pct, p: v.p })) };
}

const out = { repo: REPO, lastClosedDay: status.lastClosedDay, LAST, tfs: [...TFS], options: OPT, famColor: [OPT.seqColor, OPT.aggSeqColor, OPT.comboColor, OPT.aggComboColor], setupColor: OPT.setupColor, coins: {} };
const t00 = performance.now();
for (const sym of coinsArg) {
  const tk = tickers.coins.find((c) => c.sym.toLowerCase() === sym.toLowerCase());
  if (!tk || !tk.usd) throw new Error(`no USD ticker for ${sym}`);
  const daily = JSON.parse(readFileSync(path.join(REPO, 'data/daily', fileIdOf(tk.usd) + '.json'), 'utf8'));
  let a = 0; while (a < daily.c.length && daily.c[a] == null) a++;
  const first = daily.d0 + a;
  let z = Math.min(daily.c.length - 1, LAST - daily.d0); while (z >= 0 && daily.c[z] == null) z--;
  const lastClose = daily.c[z], lastBarDay = daily.d0 + z;
  let withBar = 0; for (let i = 0; i <= LAST - daily.d0 && i < daily.c.length; i++) if (daily.c[i] != null) withBar++;
  let dec = 0; for (const arr of [daily.o, daily.h, daily.l, daily.c]) for (const v of arr.slice(-400)) { if (v == null) continue; const s = String(v); const fr = s.includes('e-') ? Number(s.split('e-')[1]) + ((s.split('e')[0].split('.')[1] || '').length) : (s.split('.')[1] || '').length; if (fr > dec) dec = fr; }
  const coin = { sym: tk.sym, slug: tk.sym.toLowerCase(), usd: tk.usd, d0: daily.d0, days: LAST - daily.d0 + 1, first, withBar, lastClose, lastBarDay, tick: Math.pow(10, -dec), decimals: dec,
    daily: { o: daily.o, h: daily.h, l: daily.l, c: daily.c }, hasW: !!daily.w, hasM: !!daily.m, tfs: [], facts: {} };
  const facts = { labels: 0, byKind: { S: 0, C: 0, I: 0 }, late: 0, anchorNotBarsLast: 0, taskVsAlt: 0, taskVsBucket: 0, noCandleInBar: 0, other: 0, gone: 0, rep: 0 };
  TFS.forEach((tf, j) => {
    const bars = buildBars(daily, tf, LAST);
    const res = bars.n ? TD.runTD(bars, OPT) : null;
    const T = { tf, j, n: bars.n, start: [...bars.start], end: [...bars.end], first: [...bars.first], last: [...bars.last], labels: [], chartVisibleFrom: res ? res.chartVisibleFrom : 0, trigs: [], scan: null };
    if (res) {
      res.labels.forEach((L, k) => {
        const is9 = L.kind === 'S' && L.text.startsWith('9'), is13 = L.kind === 'C', isDef = L.kind === 'I' && L.text.startsWith('+');
        if (!is9 && !is13 && !isDef) { facts.other++; return; }
        const sp = spansOf(tf, bars, L.bar);
        const dTask = lastDayWithCandle(daily, sp.task[0], sp.task[1]), dAlt = lastDayWithCandle(daily, sp.alt[0], sp.alt[1]), dBucket = lastDayWithCandle(daily, sp.bucket[0], sp.bucket[1]);
        const item = { k, bar: L.bar, s: bars.start[L.bar], e: bars.end[L.bar], bfirst: bars.first[L.bar], blast: bars.last[L.bar], span: sp.task,
          day: dTask, dayAlt: dAlt, dayBucket: dBucket, dir: L.dir, kind: L.kind, f: is9 ? null : L.family, text: L.text, raw: is9 ? L.raw : null, rep: is9 && L.raw >= 18,
          gone: k < res.chartVisibleFrom, size: L.size,
          origins: is13 ? L.origins.map((b) => bars.start[b]) : isDef ? [bars.start[L.origin]] : [] };
        T.labels.push(item);
        facts.labels++; facts.byKind[L.kind]++;
        if (dTask === null) facts.noCandleInBar++;
        if (dTask !== bars.end[L.bar]) facts.late++;
        if (dTask !== bars.last[L.bar]) facts.anchorNotBarsLast++;
        if (dTask !== dAlt) facts.taskVsAlt++;
        if (dTask !== dBucket) facts.taskVsBucket++;
        if (item.gone) facts.gone++;
        if (item.rep) facts.rep++;
      });
      // next-bar triggers against the bar in progress
      const prog = barInProgress(daily, tf);
      const base = prog.bar ? { o: prog.bar.o, h: prog.bar.h, l: prog.bar.l, c: prog.bar.c, assumed: false } : { o: lastClose, h: lastClose, l: lastClose, c: lastClose, assumed: true };
      const viaBars = VIEW.baseBar(bars.partial, lastClose);
      T.progress = { start: prog.start, end: prog.end, first: prog.bar ? prog.bar.first : null, last: prog.bar ? prog.bar.last : null, base,
        sameAsBarsPartial: ['o', 'h', 'l', 'c', 'assumed'].every((x) => base[x] === viaBars[x]) };
      for (const t of TD.nextBarTriggers(bars, res, OPT)) {
        const fire = VIEW.fire(TD.evalTrigger, t, base);
        const mine = fireByRecount(bars, base, t);
        T.trigs.push({ k: t.k, d: t.d, f: t.f, o: t.o, all: t.all, any: t.any, unless: t.unless, fire, mine });
      }
      if (SCAN) T.scan = scanByRecount(bars, base);
      T.state = { buyRaw: res.state.buyRaw, sellRaw: res.state.sellRaw, runs12: res.state.runs.filter((r) => r.n === 12).length };
    }
    coin.tfs.push(T);
  });
  coin.facts = facts;
  out.coins[coin.slug] = coin;
}
out.ms = Math.round(performance.now() - t00);
writeFileSync(outFile, JSON.stringify(out));
for (const c of Object.values(out.coins)) console.log(`expect ${c.sym}: ${c.days} days from ${isoOfDay(c.d0)} (${c.withBar} with a daily bar), ${c.facts.labels} labels (9: ${c.facts.byKind.S}, 13: ${c.facts.byKind.C}, +13: ${c.facts.byKind.I}), ` +
  `${c.tfs.reduce((s, T) => s + T.trigs.length, 0)} next-bar triggers, tick ${c.tick}; anchor facts ${JSON.stringify(c.facts)}`);
console.log(`expect: written ${outFile} in ${out.ms} ms`);
