// Historical check of the next-bar triggers (dashboard/td-engine.js nextBarTriggers and evalTrigger).
//
// For every ticker x timeframe and every confirmed bar t >= 1, the triggers computed from the state after bar t-1
// (runTD's onBar hook) are evaluated on the actual bar t, after a JSON round trip (as the page receives them), and
// must agree exactly with the labels the engine created on bar t:
//   per direction              an S label with raw 9 iff some S9 holds; an S label showing a repeated 9 (raw 18, 27,
//                              ...) iff some S9r holds
//   per family and direction   a C label iff at least one C13 of that slot holds, and then
//                                its text = what the holding triggers imply: "13", "x<N>" when N > 1 hold, "r" when
//                                showRefresh, a Combo family and one of the holding runs has the refresh flag (from
//                                before, or set by bar t itself when its raw count reaches 18), the prefix option
//                                its origins = the holding triggers' origins (o), in their order
// Every trigger must also be well formed (kinds, sources, operators, finite values, unchanged by JSON).
// Runs (as verify/diff.mjs): the script's default inputs on every usd ticker of data/tickers.json, then every
// verify/variants/*.json on the tickers of verify/subset.json; all 20 timeframes.
//
// Usage: node verify/triggers-check.mjs [--run default,keep] [--tickers id,id] [--tfs 1D,2W] [--data dir] [--show n]
// Writes verify/out/triggers.json after the full suite on data/daily. Exit code 0 when every run agrees, 1 when one
// has a disagreement, 2 on an error.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TFS, buildBars, dayOfIso, fileIdOf, isoOfDay } from '../dashboard/bars.js';
import { FAMILY_SHORT, evalTrigger, nextBarTriggers, resolveOptions, runTD } from '../dashboard/td-engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'verify', 'out', 'triggers.json');
const KINDS = ['S9', 'S9r', 'C13'];
const SOURCES = ['o', 'h', 'l', 'c', 'hl'];
const OPS = ['<', '<=', '>', '>='];

// null when the triggers are well formed, else what is wrong
export function malformed(tg) {
  const cond = (c) => Array.isArray(c) && c.length === 3 && SOURCES.includes(c[0]) && OPS.includes(c[1]) && Number.isFinite(c[2]);
  const group = (g) => Array.isArray(g) && g.every(cond);
  for (const x of tg) {
    const keys = Object.keys(x).sort().join();
    if (keys !== 'all,any,d,f,k,o,unless') return `keys ${keys}`;
    if (!KINDS.includes(x.k) || (x.d !== -1 && x.d !== 1)) return `k ${x.k} d ${x.d}`;
    if (x.k === 'C13' ? !(Number.isInteger(x.f) && x.f >= 0 && x.f <= 3) || !(x.o === null || Number.isInteger(x.o)) : x.f !== null || x.o !== null) return `f ${x.f} o ${x.o}`;
    if (!group(x.all)) return `all ${JSON.stringify(x.all)}`;
    if (x.any !== null && !(Array.isArray(x.any) && x.any.length >= 2 && x.any.every(group))) return `any ${JSON.stringify(x.any)}`;
    if (x.unless !== null && !(Array.isArray(x.unless) && x.unless.length >= 1 && x.unless.every(group))) return `unless ${JSON.stringify(x.unless)}`;
  }
  return JSON.stringify(JSON.parse(JSON.stringify(tg))) === JSON.stringify(tg) ? null : 'changed by JSON';
}

// The disagreements on one bar between the triggers tg (with rf[i] = refresh flag of trigger i's run before the bar)
// and the labels labs the engine created on that bar {o, h, l, c}; raw = [buyRaw, sellRaw] after the bar; start = bar
// start days (label origins are bar indices). Returns [] when they agree. Also counts into `counts` when given.
export function compareBar(P, tg, rf, labs, bar, raw, start, counts = null) {
  const out = [];
  const holds = tg.map((x) => evalTrigger(x, bar));
  if (counts) {
    tg.forEach((x, i) => {
      counts.triggers[x.k]++;
      if (holds[i]) counts.holding[x.k]++;
      if (x.unless) {
        counts.withUnless++;
        // the label would have appeared but for an unless group: the same-bar removals were needed here
        if (!holds[i] && evalTrigger({ ...x, unless: null }, bar)) counts.blocked++;
      }
      if (JSON.stringify(x).includes('"hl"')) counts.withRange++;
    });
  }
  for (const d of [-1, 1]) {
    const s9 = labs.some((L) => L.kind === 'S' && L.dir === d && L.raw === 9);
    const s9r = labs.some((L) => L.kind === 'S' && L.dir === d && L.raw > 9 && L.text === '9');
    const g9 = tg.some((x, i) => x.k === 'S9' && x.d === d && holds[i]);
    const g9r = tg.some((x, i) => x.k === 'S9r' && x.d === d && holds[i]);
    if (counts) { counts.labels.S9 += s9; counts.labels.S9r += s9r; }
    if (s9 !== g9) out.push({ kind: 'S9', d, label: s9, trigger: g9 });
    if (s9r !== g9r) out.push({ kind: 'S9r', d, label: s9r, trigger: g9r });
  }
  for (let slot = 0; slot < 8; slot++) {
    const f = slot >> 1, d = slot % 2 ? 1 : -1;
    const lab = labs.filter((L) => L.kind === 'C' && L.family === f && L.dir === d);
    const hold = [];
    tg.forEach((x, i) => { if (x.k === 'C13' && x.f === f && x.d === d && holds[i]) hold.push(i); });
    if (counts) counts.labels.C += lab.length;
    if (lab.length > 1 || (lab.length === 1) !== (hold.length > 0)) {
      out.push({ kind: 'C13', f, d, label: lab.map((L) => L.text), trigger: hold.length });
      continue;
    }
    if (!lab.length) continue;
    const r = P.showRefresh && f >= 2 && hold.some((i) => rf[i] || raw[d === -1 ? 0 : 1] >= 18);
    const text = (P.prefix ? FAMILY_SHORT[f] + ' ' : '') + '13' + (r ? 'r' : '') + (hold.length > 1 ? 'x' + hold.length : '');
    if (lab[0].text !== text) out.push({ kind: 'C13 text', f, d, label: lab[0].text, trigger: text });
    const origins = lab[0].origins.map((b) => start[b]).join(), want = hold.map((i) => tg[i].o).join();
    if (origins !== want) out.push({ kind: 'C13 origins', f, d, label: origins, trigger: want });
  }
  return out;
}

// triggers / holding per kind; labels S9, S9r and C found on the bars; withUnless = triggers with unless groups,
// blocked = of those, the bars where all and any held but an unless group too; withRange = triggers using 'hl'
export const newCounts = () => ({
  bars: 0, triggers: { S9: 0, S9r: 0, C13: 0 }, holding: { S9: 0, S9r: 0, C13: 0 }, labels: { S9: 0, S9r: 0, C: 0 },
  withUnless: 0, blocked: 0, withRange: 0, malformed: 0, disagreements: 0, byKind: {},
});

// Checks every bar t >= 1 of one series (bars from dashboard/bars.js buildBars, or {o, h, l, c, start, n}).
// Returns the disagreements found [{t, ...}]; counts (newCounts()) is updated.
export function checkSeries(bars, options, counts = newCounts()) {
  const P = resolveOptions(options);
  const n = bars.n ?? bars.c.length;
  const rec = new Array(n);
  let prev = null;
  const view = { n: 0, o: bars.o, h: bars.h, l: bars.l, c: bars.c, start: bars.start };
  const res = runTD(bars, options, {
    onBar(t, state) {
      if (t >= 1) rec[t] = { ...prev, l1: state.labelCount, raw: [state.buyRaw, state.sellRaw] };
      if (t === n - 1) return;
      view.n = t + 1;
      const tg = nextBarTriggers(view, { state }, options);
      const rf = tg.map((x) => x.k === 'C13' && state.runs.some((r) => r.family === x.f && r.direction === x.d && bars.start[r.originBar] === x.o && r.refresh));
      const bad = malformed(tg);
      prev = { tg: tg.length ? JSON.parse(JSON.stringify(tg)) : tg, rf, l0: state.labelCount, bad };
    },
  });
  const found = [];
  for (let t = 1; t < n; t++) {
    const { tg, rf, l0, l1, raw, bad } = rec[t];
    counts.bars++;
    if (bad) { counts.malformed++; found.push({ t, kind: 'malformed', what: bad, tg }); }
    const bar = { o: bars.o[t], h: bars.h[t], l: bars.l[t], c: bars.c[t] };
    const labs = res.labels.slice(l0, l1).filter((L) => L.kind === 'S' || L.kind === 'C');
    for (const x of compareBar(P, tg, rf, labs, bar, raw, bars.start, counts)) found.push({ t, ...x, bar, tg });
  }
  counts.disagreements += found.length;
  for (const x of found) counts.byKind[x.kind] = (counts.byKind[x.kind] || 0) + 1;
  return found;
}

function parseArgs(argv) {
  const known = new Set(['run', 'tickers', 'tfs', 'data', 'show']);
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m || !known.has(m[1])) throw new Error(`unknown argument ${argv[i]}`);
    const v = m[2] ?? argv[++i];
    if (v === undefined) throw new Error(`--${m[1]} needs a value`);
    a[m[1]] = v;
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const dataDir = path.resolve(a.data || path.join(ROOT, 'data', 'daily'));
  const show = a.show !== undefined ? Number(a.show) : 5;
  const status = JSON.parse(readFileSync(path.join(dataDir, '_status.json'), 'utf8'));
  const lastClosedDay = dayOfIso(status.lastClosedDay);
  const all = JSON.parse(readFileSync(path.join(ROOT, 'data', 'tickers.json'), 'utf8')).coins.map((c) => c.usd).filter(Boolean);
  const subset = JSON.parse(readFileSync(path.join(ROOT, 'verify', 'subset.json'), 'utf8')).tickers;
  const vdir = path.join(ROOT, 'verify', 'variants');
  let runs = [{ name: 'default', variant: null, options: {}, tickers: all }];
  for (const f of readdirSync(vdir).filter((x) => x.endsWith('.json')).sort()) {
    runs.push({ name: f.slice(0, -5), variant: path.join('verify', 'variants', f), options: JSON.parse(readFileSync(path.join(vdir, f), 'utf8')), tickers: subset });
  }
  if (a.run) {
    const want = list(a.run);
    const unknown = want.filter((x) => !runs.some((r) => r.name === x));
    if (unknown.length) throw new Error(`unknown run ${unknown.join(', ')} (suite: ${runs.map((r) => r.name).join(', ')})`);
    runs = runs.filter((r) => want.includes(r.name));
  }
  if (a.tickers) for (const r of runs) r.tickers = list(a.tickers);
  const tfs = a.tfs ? list(a.tfs) : [...TFS];
  for (const tf of tfs) if (!TFS.includes(tf)) throw new Error(`unknown timeframe ${tf}`);
  const fullSuite = !a.run && !a.tickers && !a.tfs && dataDir === path.join(ROOT, 'data', 'daily');

  const summary = { generatedAt: new Date().toISOString(), data: { fetchedAt: status.fetchedAt, lastClosedDay: status.lastClosedDay }, runs: [] };
  const cache = new Map();
  const load = (id) => {
    if (!cache.has(id)) {
      const file = path.join(dataDir, fileIdOf(id) + '.json');
      cache.set(id, existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
    }
    return cache.get(id);
  };
  for (const run of runs) {
    const t0 = performance.now();
    resolveOptions(run.options);
    const counts = newCounts();
    const examples = [], missing = [];
    let series = 0;
    for (const id of run.tickers) {
      const daily = load(id);
      if (!daily) { missing.push(id); continue; }
      for (const tf of tfs) {
        const bars = buildBars(daily, tf, lastClosedDay);
        const found = checkSeries(bars, run.options, counts);
        series++;
        for (const x of found) {
          if (examples.length >= 50) break;
          examples.push({ ticker: id, tf, bar: isoOfDay(bars.start[x.t]), ...x, t: undefined });
        }
      }
    }
    const seconds = +((performance.now() - t0) / 1000).toFixed(1);
    summary.runs.push({ name: run.name, variant: run.variant, options: run.options, tickers: run.tickers.length - missing.length, missing, tfs: tfs.length, series, seconds, ...counts, examples });
    console.log(`run ${run.name}: ${series} series, ${counts.bars} bars, triggers S9 ${counts.triggers.S9} / S9r ${counts.triggers.S9r} / C13 ${counts.triggers.C13}` +
      ` (holding ${counts.holding.S9} / ${counts.holding.S9r} / ${counts.holding.C13}), labels S9 ${counts.labels.S9} / S9r ${counts.labels.S9r} / C ${counts.labels.C},` +
      ` unless ${counts.withUnless} (blocked ${counts.blocked}), hl ${counts.withRange},` +
      ` ${counts.disagreements} disagreements${counts.disagreements ? ' ' + JSON.stringify(counts.byKind) : ''}, ${seconds}s`);
    for (const x of examples.slice(0, show)) console.log(`  ${JSON.stringify(x)}`);
    if (missing.length) console.warn(`  tickers without a data file: ${missing.join(' ')}`);
  }
  const bad = summary.runs.filter((r) => r.disagreements > 0 || r.malformed > 0);
  summary.ok = bad.length === 0;
  if (fullSuite) {
    mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify(summary, null, 1) + '\n');
    console.log(`triggers-check: wrote ${path.relative(ROOT, OUT_FILE)}`);
  }
  console.log(bad.length ? `triggers-check: ${bad.length} of ${summary.runs.length} runs disagree` : `triggers-check: all ${summary.runs.length} runs agree`);
  process.exitCode = bad.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`triggers-check: ${err.stack || err.message}`);
    process.exit(2);
  });
}
