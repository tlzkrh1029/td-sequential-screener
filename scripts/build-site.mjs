// Build the TD Sequential screener site from data/daily (written by scripts/fetch-tv.mjs).
//
// Every coin in data/universe.json is listed; its USD ticker comes from data/tickers.json. For each coin and each of
// the 20 timeframes the bars are rebuilt from the daily OHLC (dashboard/bars.js) and TD Research v6 is counted on
// the confirmed bars (dashboard/td-engine.js, the same code the page runs), with the indicator's default inputs.
// The screener needs only each coin's summary per timeframe, which goes into the page. The coin page needs the daily
// OHLC, which goes into d/<n>.json files of --chunk coins each (fetched when a coin is opened; the page recounts
// that coin in the browser with the same engine). The breadth board's counts go into b.json.
//
// Output (default dist/site): index.html, b.json, d/0.json, d/1.json, ...
// Usage: node scripts/build-site.mjs [outDir] [--daily-dir data/daily] [--chunk 3] [--fragment]
//   --chunk     coins per daily file (default 3, so the site stays under the artifact viewer's 256-file limit)
//   --fragment  writes index.html without the document around it
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { TFS, buildBars } from '../dashboard/bars.js';
import * as TD from '../dashboard/td-engine.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const DAILY_DIR = opt('--daily-dir', path.join('data', 'daily'));
const CHUNK = Number(opt('--chunk', 3));
const FRAGMENT = args.includes('--fragment');
const OUT = args.find((a) => !a.startsWith('--')) || path.join('dist', 'site');
if (!(CHUNK >= 1)) throw new Error('--chunk must be a positive number');
const RECENT = 12;          // labels kept in the summary: on the last RECENT + 1 confirmed bars (DeMARK's 12-bar window)
const DAY = 86400000;
const iso = (d) => new Date(d * DAY).toISOString().slice(0, 10);

const universe = JSON.parse(await readFile(path.join('data', 'universe.json'), 'utf8'));
const tickers = JSON.parse(await readFile(path.join('data', 'tickers.json'), 'utf8'));
const status = JSON.parse(await readFile(path.join(DAILY_DIR, '_status.json'), 'utf8'));
const template = await readFile(path.join('dashboard', 'screener.html'), 'utf8');
const barsSrc = await readFile(path.join('dashboard', 'bars.js'), 'utf8');
const engineSrc = await readFile(path.join('dashboard', 'td-engine.js'), 'utf8');
const lastClosedDay = Date.parse(`${status.lastClosedDay}T00:00:00Z`) / DAY;
const OPTIONS = { ...TD.V6_DEFAULTS };
const fileOf = (id) => path.join(DAILY_DIR, id.replace(/[^A-Za-z0-9.]+/g, '_') + '.json');
async function load(id) {
  try { return JSON.parse(await readFile(fileOf(id), 'utf8')); } catch { return null; }
}

// One coin, one timeframe: the summary the screener table needs.
//   n: confirmed bars; ls/le: start and end day of the last confirmed bar; ps/pl: start day of the bar still in
//   progress and the last day it holds so far (null when every bar is closed); br/sr: raw buy/sell Setup counts;
//   ru: per family/direction slot (family * 2 + (sell ? 1 : 0)) the number of active runs and their highest count;
//   rl: labels on the last RECENT + 1 bars as [barsAgo, kind, dir, family, text]; l9: the newest Setup 9 label
//   [barsAgo, dir, text, raw]; l13: the newest completion label [barsAgo, dir, family, text]; tg: next-bar triggers.
function summarize(bars, res) {
  const n = bars.n, s = res.state;
  const ru = new Array(16).fill(0);
  for (const r of s.runs) { const slot = r.family * 2 + (r.direction === 1 ? 1 : 0); ru[slot * 2]++; ru[slot * 2 + 1] = Math.max(ru[slot * 2 + 1], r.n); }
  const rl = [];
  let l9 = null, l13 = null;
  for (let i = res.labels.length - 1; i >= 0; i--) {
    const L = res.labels[i], ago = n - 1 - L.bar;
    if (ago <= RECENT && L.kind !== 'X') rl.push([ago, L.kind, L.dir, L.family ?? null, L.text]);
    if (!l9 && L.kind === 'S' && L.text.startsWith('9')) l9 = [ago, L.dir, L.text, L.raw];
    if (!l13 && L.kind === 'C') l13 = [ago, L.dir, L.family, L.text];
    if (ago > RECENT && l9 && l13) break;
  }
  rl.reverse();
  const out = { n, ls: n ? bars.start[n - 1] : null, le: n ? bars.end[n - 1] : null, ps: bars.partial?.start ?? null, pl: bars.partial?.last ?? null,
    br: s.buyRaw, sr: s.sellRaw, ru, rl, l9, l13 };
  if (typeof TD.nextBarTriggers === 'function') out.tg = TD.nextBarTriggers(bars, res, OPTIONS);
  return out;
}

// Breadth: per timeframe and bar start day, how many coins had a confirmed bar there, and how many of them got a
// new Setup 9 (raw 9), a repeated 9 (raw 18, 27, ...) or a completion 13 per family, on each side.
// Row: [startDay, coins, buy9, sell9, buy9rep, sell9rep, buy13 S, buy13 AS, buy13 C, buy13 AC, sell13 S, sell13 AS, sell13 C, sell13 AC]
const breadth = Object.fromEntries(TFS.map((tf) => [tf, new Map()]));
function addBreadth(tf, bars, res) {
  const m = breadth[tf];
  const row = (day) => { let r = m.get(day); if (!r) { r = new Array(14).fill(0); r[0] = day; m.set(day, r); } return r; };
  for (let i = 0; i < bars.n; i++) row(bars.start[i])[1]++;
  for (const L of res.labels) {
    const r = row(bars.start[L.bar]), sell = L.dir === 1 ? 1 : 0;
    if (L.kind === 'S' && L.text.startsWith('9')) r[L.raw === 9 ? 2 + sell : 4 + sell]++;
    else if (L.kind === 'C') r[6 + sell * 4 + L.family]++;
  }
}

// Spot checks for the owner: on the largest coins, the newest 9 and 13 of a few timeframes, to compare with the
// TradingView chart by hand. [sym, usd, tf, barStartDay, kind, dir, family, text]
const CHECK_COINS = 10, CHECK_TFS = ['1D', '1W', '2W', '1M'];
const checks = [];
function addChecks(coin, tf, bars, res) {
  for (const kind of ['C', 'S']) {
    for (let i = res.labels.length - 1; i >= 0; i--) {
      const L = res.labels[i];
      if (L.kind === kind && (kind === 'C' || L.text.startsWith('9'))) { checks.push([coin.s, coin.usd, tf, bars.start[L.bar], kind, L.dir, L.family ?? null, L.text]); break; }
    }
  }
}

const byTicker = new Map(tickers.coins.map((t) => [t.sym, t]));
const coins = [];
const checkSyms = new Set([...universe.coins].sort((a, b) => (b.mcap || 0) - (a.mcap || 0)).slice(0, CHECK_COINS).map((u) => u.sym));
let labels = 0, runs = 0;
const t0 = Date.now();
for (const u of universe.coins) {
  const t = byTicker.get(u.sym) || {};
  const daily = t.usd ? await load(t.usd) : null;
  const coin = { r: 0, s: u.sym, n: u.name, k: u.ko || null, x: u.ex || '', mc: Math.round(u.mcap || 0), usd: t.usd || null, tv: t.tvName || null };
  if (daily) {
    let a = 0; while (a < daily.c.length && daily.c[a] == null) a++;
    coin.li = daily.d0 + a; coin.lb = daily.d0 + daily.c.length - 1;
    coin.t = TFS.map((tf) => {
      const bars = buildBars(daily, tf, lastClosedDay);
      if (!bars.n) return null;
      const res = TD.runTD(bars, OPTIONS);
      labels += res.labels.length; runs++;
      addBreadth(tf, bars, res);
      if (checkSyms.has(u.sym) && CHECK_TFS.includes(tf)) addChecks(coin, tf, bars, res);
      return summarize(bars, res);
    });
  }
  coins.push({ coin, daily: daily && { d0: daily.d0, o: daily.o, h: daily.h, l: daily.l, c: daily.c } });
}
console.log(`counted ${runs} coin-timeframes (${labels} labels) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// daily files follow the universe order, so a coin's file stays put from one daily build to the next
coins.forEach((c, i) => { c.coin.ch = Math.floor(i / CHUNK); });
const byChunk = coins.slice();
coins.sort((a, b) => b.coin.mc - a.coin.mc);
coins.forEach((c, i) => { c.coin.r = i + 1; });

const layout = createHash('sha1').update(JSON.stringify([CHUNK, byChunk.map((c) => [c.coin.ch, c.coin.usd, c.daily?.d0 ?? null])])).digest('hex');
const build = `${status.fetchedAt.replace(/\D/g, '').slice(0, 14)}-${layout.slice(0, 8)}`;
await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, 'd'), { recursive: true });
const nChunks = Math.ceil(byChunk.length / CHUNK);
for (let ch = 0; ch < nChunks; ch++) {
  const daily = {};
  for (const c of byChunk.slice(ch * CHUNK, (ch + 1) * CHUNK)) if (c.daily) daily[c.coin.usd] = c.daily;
  await writeFile(path.join(OUT, 'd', `${ch}.json`), JSON.stringify({ build, daily }));
}
const series = Object.fromEntries(TFS.map((tf) => [tf, [...breadth[tf].values()].sort((a, b) => a[0] - b[0])]));
await writeFile(path.join(OUT, 'b.json'), JSON.stringify({ build, cols: ['day', 'coins', 'b9', 's9', 'b9r', 's9r', 'b13S', 'b13AS', 'b13C', 'b13AC', 's13S', 's13AS', 's13C', 's13AC'], series }));

let verify = null;
try { verify = JSON.parse(await readFile(path.join('verify', 'out', 'summary.json'), 'utf8')); } catch {}
const data = JSON.stringify({
  build, fetchedAt: status.fetchedAt, lastClosedDay: status.lastClosedDay, lastClosedDayN: lastClosedDay,
  universeAt: universe.fetchedAt, repo: process.env.GITHUB_REPOSITORY || null, chunk: CHUNK, tfs: TFS, options: OPTIONS,
  fetch: { total: status.total, ok: status.ok, failed: status.failed?.length ?? 0, revised: status.revised?.length ?? 0 },
  verify, checks, coins: coins.map((c) => c.coin),
});

for (const marker of ['/*__DATA__*/null', '/*__BARS__*/', '/*__ENGINE__*/']) if (!template.includes(marker)) throw new Error(`template is missing ${marker}`);
// Each module becomes `const NAME = (() => { ...; return { exports } })();` inside the page, so the two modules keep
// their own scopes; '<' in the data is escaped so no name in it can close the inline script.
function inlineModule(name, src) {
  const exported = [...src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  if (!exported.length) throw new Error(`${name}: no exports found`);
  if (/^import\s/m.test(src)) throw new Error(`${name}: imports cannot be inlined`);
  return `const ${name} = (() => {\n${src.replace(/^export\s+/gm, '')}\nreturn { ${exported.join(', ')} };\n})();`;
}
const body = template.replace('/*__BARS__*/', () => inlineModule('BARS', barsSrc)).replace('/*__ENGINE__*/', () => inlineModule('TD', engineSrc))
  .replace('/*__DATA__*/null', () => data.replace(/</g, '\\u003c'));
const cut = body.indexOf('<header');
if (cut < 0) throw new Error('template has no <header>');
const page = `<!DOCTYPE html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
  `<meta name="robots" content="noindex, nofollow">\n${body.slice(0, cut)}</head>\n<body>\n${body.slice(cut)}\n</body>\n</html>\n`;
await writeFile(path.join(OUT, 'index.html'), FRAGMENT ? body : page);
console.log(`wrote ${OUT}/index.html (${Math.round(page.length / 1024)} KB), b.json and ${(await readdir(path.join(OUT, 'd'))).length} daily files; ` +
  `${coins.filter((c) => !c.daily).length} coins without TradingView data; built ${iso(lastClosedDay)} closes`);
