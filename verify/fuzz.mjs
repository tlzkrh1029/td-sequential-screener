// Randomised differential test of the two ports (see verify/diff.mjs): synthetic daily series and random settings.
//
// The real data reaches only some paths of the script. Here the prices lie on a coarse grid, so equal closes and exact
// ties against low[2], close8, the previous counted close or wick, and the TDST levels are common; trending regimes
// give long setups (raw 18, 22, 27), deferrals and 13xN; some series have gaps of a few days to a few hundred days, a
// bar with high below its open or close, or end inside the bucket in progress. About half of the tickers also carry
// 1M bars (m, as scripts/fetch-tv.mjs stores TradingView's own): the monthly aggregate of the daily bars with some
// values changed, some months only in m or only in the daily bars, sometimes the month in progress; about half carry
// 1W bars (w) made the same way from the weekly aggregate. The last closed day depends on the seed (a month end, a
// Sunday or a day inside a month or week). Every input of the script is drawn at random for each setting (the script's
// defaults and the variants of verify/variants are always included).
// Both CLIs run on a synthetic data folder for every setting and their dumps are compared byte for byte.
//
// Usage: node verify/fuzz.mjs [--seed <n>] [--tickers <n>] [--settings <n>] [--work <dir>] [--tfs <tf,tf>]
//   defaults: seed 1, 120 tickers, 40 random settings (plus the default and the variants), work /tmp/td-fuzz
// Exit code 0 when every setting gives identical dumps, 1 otherwise, 2 on an error.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, compareDirs, report, runBoth } from './diff.mjs';

const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const SEED = Number(arg('seed', 1)), NT = Number(arg('tickers', 120)), NS = Number(arg('settings', 40));
const WORK = path.resolve(arg('work', path.join(os.tmpdir(), 'td-fuzz')));
const TFS = arg('tfs', null)?.split(',') ?? null;
const DAY = 86400000;
const dayOf = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY;
const isoOf = (d) => new Date(d * DAY).toISOString().slice(0, 10);
const LAST_CLOSED = dayOf(['2026-10-31', '2026-10-14', '2026-12-31', '2027-01-03', '2026-02-28', '2026-06-01'][SEED % 6]);

// mulberry32
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(SEED);
const int = (a, b) => a + Math.floor(R() * (b - a + 1));
const pick = (xs) => xs[Math.floor(R() * xs.length)];
const chance = (p) => R() < p;

// One synthetic daily series {d0, o, h, l, c} (null on days without a bar).
function series() {
  const tick = pick([0.25, 0.5, 1]);
  const long = chance(0.35);
  const n = long ? int(800, 3200) : int(20, 700);
  const endGap = chance(0.3) ? int(0, 40) : 0; // the data may stop before the last closed day
  const d0 = LAST_CLOSED - endGap - n + 1;
  const o = [], h = [], l = [], c = [];
  let p = tick * int(400, 4000), regime = 0, drift = 0;
  let gap = 0;
  for (let i = 0; i < n; i++) {
    if (gap > 0) { gap--; o.push(null); h.push(null); l.push(null); c.push(null); continue; }
    if (i > 0 && chance(0.004)) gap = chance(0.15) ? int(100, 600) : int(1, 12);
    if (regime-- <= 0) { regime = int(3, 45); drift = pick([-3, -2, -1, -1, 0, 0, 1, 1, 2, 3]); }
    const open = chance(0.7) ? p : p + tick * int(-2, 2);
    let close = open + tick * (drift + int(-2, 2) * (chance(0.5) ? 1 : 0) + (chance(0.03) ? int(-15, 15) : 0));
    if (close < tick * 20) close = tick * 20 + tick * int(0, 5);
    const wickUp = chance(0.2) ? 0 : tick * (chance(0.05) ? int(5, 30) : int(0, 3));
    const wickDn = chance(0.2) ? 0 : tick * (chance(0.05) ? int(5, 30) : int(0, 3));
    let hi = Math.max(open, close) + wickUp, lo = Math.max(tick, Math.min(open, close) - wickDn);
    if (chance(0.003)) hi = Math.min(open, close); // TradingView has a few bars with high below open/close
    o.push(open); h.push(hi); l.push(lo); c.push(close);
    p = close;
  }
  // the series must start and end with a bar, like the fetched files
  while (c.length && c.at(-1) === null) { o.pop(); h.pop(); l.pop(); c.pop(); }
  const out = { d0, o, h, l, c };
  if (chance(0.5)) out.m = native(out, tick, monthStart, monthEnd);
  if (chance(0.5)) out.w = native(out, tick, weekStart, (ws) => ws + 6);
  return out;
}

const monthStart = (d) => { const t = new Date(d * DAY); return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1) / DAY; };
const monthEnd = (ms) => { const t = new Date(ms * DAY); return Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1) / DAY - 1; };
const weekStart = (d) => Math.floor((d + 3) / 7) * 7 - 3; // the Monday of the week of d (unix day 4 is a Monday)

// 1M bars (or 1W bars) for a daily series: its monthly (weekly) aggregate over the closed months (weeks), with
// changes. startOf(d) = the first day of the month (Monday of the week) of day d, endOf(s) = its last day.
function native(daily, tick, startOf, endOf) {
  const groups = new Map();
  for (let i = 0; i < daily.c.length; i++) {
    if (daily.c[i] === null) continue;
    const ms = startOf(daily.d0 + i);
    const g = groups.get(ms);
    if (!g) groups.set(ms, [daily.o[i], daily.h[i], daily.l[i], daily.c[i]]);
    else { g[1] = Math.max(g[1], daily.h[i]); g[2] = Math.min(g[2], daily.l[i]); g[3] = daily.c[i]; }
  }
  const inProgress = chance(0.2); // keep the month / week in progress (the fetcher drops it; the ports must ignore it)
  // a month / week without daily bars (inside a gap or before the first daily bar) that has a native bar
  if (chance(0.15)) {
    const ms = startOf(daily.d0 - int(1, 60));
    if (!groups.has(ms)) groups.set(ms, [daily.o[0], daily.h[0] + tick, daily.l[0], daily.c[0]]);
  }
  const m = { d: [], o: [], h: [], l: [], c: [] };
  for (const [ms, v] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    if (endOf(ms) > LAST_CLOSED && !inProgress) continue;
    if (chance(0.03)) continue; // a month / week with daily bars but no native bar
    const w = v.slice();
    if (chance(0.08)) w[1] += tick * int(1, 20);
    if (chance(0.08)) w[2] = Math.max(tick, w[2] - tick * int(1, 20));
    if (chance(0.05)) w[3] += tick * int(-3, 3);
    if (chance(0.05)) w[0] += tick * int(-3, 3);
    m.d.push(ms); m.o.push(w[0]); m.h.push(w[1]); m.l.push(w[2]); m.c.push(w[3]);
  }
  return m;
}

function setting() {
  const b = (p = 0.5) => chance(p);
  const lo = pick([0, 25, 50, 75, 100, 100, 150]), hi = Math.max(lo, pick([100, 150, 200, 200, 300, 1000]));
  return {
    enableSeq: b(0.85), enableCombo: b(0.85), enableAggSeq: b(0.5), enableAggCombo: b(0.85),
    seqFinal: pick(['Close', 'Open or Close', 'Wick']), seqQ138: b(0.7), seqQ85: b(0.4), seqTicks: chance(0.7) ? 0 : int(1, 3),
    comboFinal: pick(['Close', 'Open or Close', 'Wick']), comboRelaxed: b(0.6), comboTicks: chance(0.7) ? 0 : int(1, 3), showRefresh: b(0.7),
    aggQ138: b(0.7), aggQ85: b(0.4), aggComboRelaxed: b(0.6),
    originPolicy: pick(['Independent', 'Keep active', 'Recycle range', 'Newest']), rejectSmaller: b(0.3),
    recycleMin: lo, recycleMax: hi, cancelOpposite: b(0.7), cancelTDST: b(0.4), restart22: b(0.4),
    maxOrigins: chance(0.5) ? int(1, 3) : int(4, 16),
    showSetups: b(0.8), setupNineOnly: b(0.5), wrapSetup: b(0.6), showCounts: b(0.6), newestCountsOnly: b(0.5),
    showBackfill: b(0.5), showDeferred: b(0.7), showCancelMarks: b(0.6), prefix: b(0.5), labelLimit: int(50, 480),
    mintick: pick([0.25, 0.5, 1, 0.01]),
  };
}

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  const data = path.join(WORK, 'data'), vdir = path.join(WORK, 'settings');
  mkdirSync(data, { recursive: true });
  mkdirSync(vdir, { recursive: true });
  const ids = [];
  for (let i = 0; i < NT; i++) {
    const id = `FUZZ:S${SEED}T${String(i).padStart(3, '0')}USD`;
    writeFileSync(path.join(data, id.replace(/[^A-Za-z0-9.]+/g, '_') + '.json'), JSON.stringify({ id, ...series() }));
    ids.push(id);
  }
  writeFileSync(path.join(data, '_status.json'), JSON.stringify({ lastClosedDay: isoOf(LAST_CLOSED) }));
  const settings = [['default', {}]];
  for (const f of readdirSync(path.join(ROOT, 'verify', 'variants')).filter((x) => x.endsWith('.json')).sort()) {
    settings.push([f.slice(0, -5), JSON.parse(readFileSync(path.join(ROOT, 'verify', 'variants', f), 'utf8'))]);
  }
  for (let k = 0; k < NS; k++) settings.push([`random${String(k).padStart(2, '0')}`, setting()]);

  const bad = [];
  let files = 0, labels = 0;
  for (const [name, options] of settings) {
    const file = path.join(vdir, `${name}.json`);
    writeFileSync(file, JSON.stringify(options));
    const res = await runBoth({ name: `run-${name}`, variant: file, tickers: ids, tfs: TFS }, { work: WORK, data, jobs: os.cpus().length });
    const cmp = compareDirs(res.jsDir, res.pyDir);
    files += cmp.files;
    labels += Object.values(cmp.stats.labels).reduce((x, y) => x + y, 0);
    if (cmp.mismatched.length) {
      bad.push(name);
      report(`${name} ${JSON.stringify(options)}`, cmp, { show: 3, context: 3 });
    } else {
      rmSync(path.join(WORK, `run-${name}`), { recursive: true, force: true });
    }
  }
  console.log(`fuzz seed ${SEED} (last closed day ${isoOf(LAST_CLOSED)}): ${settings.length} settings x ${NT} tickers, ${files} files, ${labels} labels; ` +
    (bad.length ? `MISMATCHES in ${bad.length} settings: ${bad.join(' ')} (dumps kept in ${WORK})` : 'all identical'));
  process.exitCode = bad.length ? 1 : 0;
}

main().catch((err) => { console.error(`fuzz: ${err.stack || err.message}`); process.exit(2); });
