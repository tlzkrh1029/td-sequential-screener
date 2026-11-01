// Canonical dump of the TD engine, for diffing it against the independent port (byte-identical files expected).
//
// For every requested ticker and timeframe: daily bars from <data>/<FILE_ID>.json -> dashboard/bars.js buildBars
// (confirmed bars only, lastClosedDay from <data>/_status.json) -> dashboard/td-engine.js runTD, written to
// <out>/<FILE_ID>__<TF>.tsv (FILE_ID = ticker id with every run of characters outside [A-Za-z0-9.] replaced by "_"):
//   B\t<n>\t<sha1>        n confirmed bars; sha1 (lowercase hex) of "<startDay>,<firstDataDay>,<lastDataDay>\n" over
//                         them in order (unix day integers; for a month timeframe built from TradingView's 1M bars,
//                         the data days are the first days of the months of its first and last 1M bar, for a week
//                         timeframe built from its 1W bars the Mondays of its first and last 1W bar)
//   L\t<barStartISO>\t<kind>\t<dir>\t<family>\t<text>\t<extra>
//                         one line per label, in the order the script creates them (labels its labelLimit FIFO
//                         deletes later included). family "-" for S. extra: S raw setup count; I and X origin bar
//                         start (ISO); C origin bar starts (ISO) in completionTips order, comma-separated
//   E\t<buyRaw>\t<sellRaw>\t<runs>
//                         state after the last confirmed bar; runs = active runs sorted by (family, dir, originBar),
//                         "<family>,<dir>,<originBarStartISO>,<n>" joined by ";" (empty when none)
//
// Usage: node scripts/td-dump.mjs --out <dir> [--variant <json>] [--tickers <id,id,...>] [--tfs <tf,tf,...>] [--data <dir>]
//   --variant  JSON object of script inputs by Pine variable name (plus mintick); defaults = the script's
//   --tickers  default: every coin's usd ticker in this repository's data/tickers.json
//   --tfs      default: all 20 timeframes
//   --data     default: this repository's data/daily
// A ticker without a data file is reported and makes the run exit with code 1 (its files are not written). A data file
// without TradingView's 1M bars (m) or 1W bars (w) is reported too: its month or week timeframes are then rebuilt from
// the daily bars. The whole data file goes to buildBars, so m and w reach it as stored.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TFS, buildBars, dayOfIso, fileIdOf, isoOfDay } from '../dashboard/bars.js';
import { resolveOptions, runTD } from '../dashboard/td-engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const known = new Set(['out', 'variant', 'tickers', 'tfs', 'data']);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m || !known.has(m[1])) throw new Error(`unknown argument ${argv[i]}`);
    const value = m[2] ?? argv[++i];
    if (value === undefined) throw new Error(`--${m[1]} needs a value`);
    args[m[1]] = value;
  }
  if (!args.out) throw new Error('--out <dir> is required');
  return args;
}

const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

// The .tsv text of one ticker/timeframe.
export function dumpText(bars, result) {
  const iso = (b) => isoOfDay(bars.start[b]);
  const hash = createHash('sha1');
  for (let i = 0; i < bars.n; i++) hash.update(`${bars.start[i]},${bars.first[i]},${bars.last[i]}\n`);
  const lines = [`B\t${bars.n}\t${hash.digest('hex')}`];
  for (const L of result.labels) {
    const extra = L.kind === 'S' ? String(L.raw) : L.kind === 'C' ? L.origins.map(iso).join(',') : iso(L.origin);
    lines.push(`L\t${iso(L.bar)}\t${L.kind}\t${L.dir}\t${L.family === null ? '-' : L.family}\t${L.text}\t${extra}`);
  }
  const runs = result.state.runs.slice()
    .sort((a, b) => a.family - b.family || a.direction - b.direction || a.originBar - b.originBar)
    .map((r) => `${r.family},${r.direction},${iso(r.originBar)},${r.n}`).join(';');
  lines.push(`E\t${result.state.buyRaw}\t${result.state.sellRaw}\t${runs}`);
  return lines.join('\n') + '\n';
}

async function main() {
  const t0 = performance.now();
  const args = parseArgs(process.argv.slice(2));
  const dataDir = args.data ? path.resolve(args.data) : path.join(ROOT, 'data', 'daily');
  const options = args.variant ? JSON.parse(readFileSync(args.variant, 'utf8')) : {};
  if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new Error('--variant must hold a JSON object');
  resolveOptions(options); // fail on a bad variant before any work
  const tfs = args.tfs ? list(args.tfs) : [...TFS];
  for (const tf of tfs) if (!TFS.includes(tf)) throw new Error(`unknown timeframe ${tf} (expected one of ${TFS.join(' ')})`);
  const tickers = args.tickers ? list(args.tickers)
    : JSON.parse(readFileSync(path.join(ROOT, 'data', 'tickers.json'), 'utf8')).coins.map((c) => c.usd).filter(Boolean);
  const status = JSON.parse(readFileSync(path.join(dataDir, '_status.json'), 'utf8'));
  const lastClosedDay = dayOfIso(status.lastClosedDay);
  mkdirSync(args.out, { recursive: true });

  let files = 0, labels = 0, barsTotal = 0, tBars = 0, tEngine = 0;
  const missing = [], noMonthly = [], noWeekly = [];
  for (const id of tickers) {
    const fileId = fileIdOf(id);
    let daily;
    try {
      daily = JSON.parse(readFileSync(path.join(dataDir, fileId + '.json'), 'utf8'));
    } catch (err) {
      missing.push(`${id}: ${err.code === 'ENOENT' ? 'no data file' : err.message}`);
      continue;
    }
    if (daily.id !== undefined && daily.id !== id) throw new Error(`${fileId}.json holds ${daily.id}, expected ${id}`);
    if (daily.m == null && tfs.some((tf) => tf.endsWith('M'))) noMonthly.push(id);
    if (daily.w == null && tfs.some((tf) => tf.endsWith('W'))) noWeekly.push(id);
    for (const tf of tfs) {
      const a = performance.now();
      const bars = buildBars(daily, tf, lastClosedDay);
      const b = performance.now();
      const result = runTD(bars, options);
      tBars += b - a;
      tEngine += performance.now() - b;
      writeFileSync(path.join(args.out, `${fileId}__${tf}.tsv`), dumpText(bars, result));
      files++;
      labels += result.labels.length;
      barsTotal += bars.n;
    }
  }
  const s = (ms) => (ms / 1000).toFixed(2) + 's';
  console.log(`td-dump: ${tickers.length - missing.length} tickers x ${tfs.length} timeframes = ${files} files, ${barsTotal} confirmed bars, ${labels} labels, last closed day ${status.lastClosedDay}`);
  console.log(`td-dump: total ${s(performance.now() - t0)} (bars ${s(tBars)}, engine ${s(tEngine)}) -> ${args.out}`);
  if (noMonthly.length) {
    console.error(`td-dump: ${noMonthly.length} tickers without TradingView 1M bars, month timeframes rebuilt from 1D: ${noMonthly.slice(0, 10).join(' ')}${noMonthly.length > 10 ? ' ...' : ''}`);
  }
  if (noWeekly.length) {
    console.error(`td-dump: ${noWeekly.length} tickers without TradingView 1W bars, week timeframes rebuilt from 1D: ${noWeekly.slice(0, 10).join(' ')}${noWeekly.length > 10 ? ' ...' : ''}`);
  }
  if (missing.length) {
    console.error(`td-dump: ${missing.length} tickers without usable data:\n  ${missing.join('\n  ')}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`td-dump: ${err.message}`);
    process.exit(1);
  });
}
