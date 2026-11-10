// Differential test of the two independent ports of TD Research v6 (kidze_td_research_v6.pine):
//   JavaScript, production   dashboard/bars.js + dashboard/td-engine.js, CLI scripts/td-dump.mjs
//   Python, reference        verify/ref/bars_ref.py + verify/ref/td_ref.py, CLI verify/ref/td_ref.py
// Both CLIs write the canonical dump, one <FILE_ID>__<TF>.tsv per ticker and timeframe:
//   B\t<n>\t<sha1>   the confirmed bars (count, and the SHA-1 of their bucket start / first / last data day)
//   L\t...           one line per label the script creates, in label.new order
//   E\t...           the state after the last confirmed bar
// and the two files must be byte-identical. This script runs both CLIs into a work folder (or takes two folders),
// compares every file byte for byte and groups the files that differ by the first part that differs:
//   bars     the B line: another bar count or bar set
//   labels   the L lines: a label added, missing, moved or with other text / extra
//   state    only the E line: raw setup counts or active runs after the last bar
//   format   the same B, L and E lines but other bytes (line ends, trailing text)
//   missing  a file that only one port wrote
// For the first files of each kind it prints the first differing line with context from both sides.
//
// Usage
//   node verify/diff.mjs                      the full suite: the script's default inputs on every usd ticker of
//                                             data/tickers.json, then every verify/variants/*.json on the tickers of
//                                             verify/subset.json, all 20 timeframes; writes verify/out/summary.json
//   node verify/diff.mjs --run keep,display   only these runs of the suite ("default" or a variant's file name);
//                                             --tfs <tf,tf> limits any run to these timeframes
//   node verify/diff.mjs --variant <name|file> [--tickers <id,id> | --subset] [--tfs <tf,tf>]
//                                             one ad-hoc run (variant "default" = no variant file)
//   node verify/diff.mjs --compare <dirA> <dirB>
//                                             compare two dump folders (A = JavaScript side, B = Python side)
// Options
//   --work <dir>     run folders <work>/<run>/js and <work>/<run>/py (default /tmp/td-diff), emptied before a run
//   --data <dir>     daily data folder for both CLIs (default data/daily)
//   --show <n>       mismatching files printed in detail per kind and run (default 3)
//   --context <n>    lines of context around the first differing line (default 3)
//   --jobs <n>       worker processes of the Python CLI (default: the CPU count)
// Writes <work>/summary.json (and verify/out/summary.json after a full suite on data/daily). Exit code 0 when no run
// has a mismatched file, 1 when one has, 2 on a usage error or when a CLI fails.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VARIANTS_DIR = path.join(ROOT, 'verify', 'variants');
const SUBSET_FILE = path.join(ROOT, 'verify', 'subset.json');
const SUMMARY_FILE = path.join(ROOT, 'verify', 'out', 'summary.json');
const KINDS = ['bars', 'labels', 'state', 'format', 'missing'];

export class UsageError extends Error {}

function parseArgs(argv) {
  const flags = new Set(['subset']);
  const known = new Set(['run', 'variant', 'tickers', 'tfs', 'compare', 'work', 'data', 'show', 'context', 'jobs', 'subset']);
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m || !known.has(m[1])) throw new UsageError(`unknown argument ${argv[i]}`);
    if (flags.has(m[1])) { a[m[1]] = true; continue; }
    if (m[1] === 'compare') {
      const dirs = m[2] !== undefined ? m[2].split(',') : [argv[++i], argv[++i]];
      if (dirs.length !== 2 || dirs.some((d) => !d)) throw new UsageError('--compare needs two folders');
      a.compare = dirs;
      continue;
    }
    const v = m[2] ?? argv[++i];
    if (v === undefined) throw new UsageError(`--${m[1]} needs a value`);
    a[m[1]] = v;
  }
  for (const k of ['show', 'context', 'jobs']) {
    if (a[k] !== undefined && !(Number.isInteger(Number(a[k])) && Number(a[k]) >= 0)) throw new UsageError(`--${k} needs a whole number`);
  }
  if (a.compare && (a.run || a.variant || a.tickers || a.tfs || a.subset)) throw new UsageError('--compare runs nothing; drop the run options');
  if (a.run && (a.variant || a.tickers || a.subset)) throw new UsageError('--run picks suite runs; use --variant/--tickers for an ad-hoc run');
  if (a.tickers && a.subset) throw new UsageError('--tickers and --subset exclude each other');
  return a;
}

const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
const fileIdOf = (id) => id.replace(/[^A-Za-z0-9.]+/g, '_');

function variantFile(nameOrFile) {
  if (nameOrFile === 'default') return null;
  const byName = path.join(VARIANTS_DIR, `${nameOrFile}.json`);
  if (!nameOrFile.includes('/') && !nameOrFile.endsWith('.json') && existsSync(byName)) return byName;
  if (existsSync(nameOrFile)) return path.resolve(nameOrFile);
  throw new UsageError(`no variant ${nameOrFile} (neither ${path.relative(ROOT, byName)} nor a file)`);
}

// Tickers of verify/subset.json that have a data file (a coin can leave the universe).
function subsetTickers(dataDir) {
  const all = JSON.parse(readFileSync(SUBSET_FILE, 'utf8')).tickers;
  const have = all.filter((id) => existsSync(path.join(dataDir, fileIdOf(id) + '.json')));
  if (have.length < all.length) console.warn(`diff: subset tickers without a data file, skipped: ${all.filter((id) => !have.includes(id)).join(' ')}`);
  return have;
}

function suite(dataDir) {
  const runs = [{ name: 'default', variant: null, tickers: null }];
  const names = existsSync(VARIANTS_DIR) ? readdirSync(VARIANTS_DIR).filter((f) => f.endsWith('.json')).sort() : [];
  const subset = names.length ? subsetTickers(dataDir) : [];
  for (const f of names) runs.push({ name: f.slice(0, -5), variant: path.join(VARIANTS_DIR, f), tickers: subset });
  return runs;
}

function exec(cmd, args, label) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { err += b; });
    child.on('error', (e) => resolve({ label, code: -1, out, err: err + e.message, seconds: 0 }));
    child.on('close', (code) => resolve({ label, code, out, err, seconds: (performance.now() - t0) / 1000 }));
  });
}

// Runs both CLIs at the same time into <work>/<run.name>/js and /py.
//   run  {name, variant: file or null, tickers: [id] or null (= every usd ticker), tfs: [tf] or null (= all 20)}
//   opt  {work, data, jobs}
export async function runBoth(run, opt) {
  const base = path.join(opt.work, run.name);
  const jsDir = path.join(base, 'js'), pyDir = path.join(base, 'py');
  rmSync(base, { recursive: true, force: true });
  mkdirSync(jsDir, { recursive: true });
  mkdirSync(pyDir, { recursive: true });
  const common = ['--data', opt.data];
  if (run.variant) common.push('--variant', run.variant);
  if (run.tickers) common.push('--tickers', run.tickers.join(','));
  if (run.tfs) common.push('--tfs', run.tfs.join(','));
  const [js, py] = await Promise.all([
    exec(process.execPath, [path.join(ROOT, 'scripts', 'td-dump.mjs'), '--out', jsDir, ...common], 'js'),
    // -I: isolated mode (the script puts its own folder on sys.path for bars_ref)
    exec('python3', ['-I', path.join(ROOT, 'verify', 'ref', 'td_ref.py'), '--out', pyDir, '--jobs', String(opt.jobs ?? os.cpus().length), ...common], 'py'),
  ]);
  for (const r of [js, py]) {
    if (r.code !== 0) {
      throw new Error(`${r.label} CLI failed (exit ${r.code}) on run ${run.name}:\n${(r.err || r.out).trim().split('\n').slice(-15).join('\n')}`);
    }
  }
  return { jsDir, pyDir, seconds: { js: +js.seconds.toFixed(1), py: +py.seconds.toFixed(1) }, out: { js: js.out.trim(), py: py.out.trim() } };
}

const linesOf = (buf) => buf.toString('utf8').split('\n');
const lineCount = (A) => (A.length && A[A.length - 1] === '' ? A.length - 1 : A.length);

// The first part of the dump that differs, every part that differs, and the first differing line.
function classify(a, b) {
  const A = linesOf(a), B = linesOf(b);
  const la = A.filter((x) => x.startsWith('L\t')), lb = B.filter((x) => x.startsWith('L\t'));
  const ea = A.filter((x) => x.startsWith('E\t')), eb = B.filter((x) => x.startsWith('E\t'));
  const kinds = [];
  if (A[0] !== B[0]) kinds.push('bars');
  if (la.length !== lb.length || la.some((x, i) => x !== lb[i])) kinds.push('labels');
  if (ea.length !== eb.length || ea.some((x, i) => x !== eb[i])) kinds.push('state');
  if (!kinds.length) kinds.push('format');
  let first = 0;
  while (first < A.length && first < B.length && A[first] === B[first]) first++;
  return { kind: kinds[0], kinds, first, A, B, labels: [la.length, lb.length] };
}

// Labels as a multiset difference, to say what one side has and the other has not.
function labelDelta(A, B) {
  const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const ca = count(A.filter((x) => x.startsWith('L\t'))), cb = count(B.filter((x) => x.startsWith('L\t')));
  const onlyA = [], onlyB = [];
  for (const [x, n] of ca) for (let k = 0; k < n - (cb.get(x) || 0); k++) onlyA.push(x);
  for (const [x, n] of cb) for (let k = 0; k < n - (ca.get(x) || 0); k++) onlyB.push(x);
  return { onlyA, onlyB };
}

// Compares every .tsv of two dump folders. Also counts, on the A side, the confirmed bars and the labels by kind.
export function compareDirs(dirA, dirB) {
  const tsv = (d) => new Set(readdirSync(d).filter((f) => f.endsWith('.tsv')));
  const fa = tsv(dirA), fb = tsv(dirB);
  const all = [...new Set([...fa, ...fb])].sort();
  const mismatched = [];
  const stats = { bars: 0, labels: { S: 0, I: 0, X: 0, C: 0 } };
  let same = 0;
  for (const f of all) {
    if (!fa.has(f) || !fb.has(f)) {
      mismatched.push({ file: f, kind: 'missing', kinds: ['missing'], side: fa.has(f) ? 'only js' : 'only py' });
      continue;
    }
    const a = readFileSync(path.join(dirA, f)), b = readFileSync(path.join(dirB, f));
    const text = a.toString('utf8');
    stats.bars += Number(text.slice(2, text.indexOf('\t', 2)));
    for (const m of text.matchAll(/^L\t[^\t]*\t([SIXC])\t/gm)) stats.labels[m[1]]++;
    if (a.equals(b)) { same++; continue; }
    mismatched.push({ file: f, ...classify(a, b) });
  }
  return { files: all.length, same, mismatched, stats };
}

const tfOf = (file) => file.slice(file.lastIndexOf('__') + 2, -4);
const tickerOf = (file) => file.slice(0, file.lastIndexOf('__'));
const show = (s) => (s === undefined ? '<end of file>' : s === '' ? '<empty line>' : s);

// Prints the mismatches of one run grouped by kind; returns the counts for the summary.
export function report(name, cmp, opt) {
  const byKind = Object.fromEntries(KINDS.map((k) => [k, cmp.mismatched.filter((m) => m.kind === k)]));
  const head = `run ${name}: ${cmp.files} files, ${cmp.mismatched.length} mismatched`;
  console.log(cmp.mismatched.length ? `\n${head}` : head);
  for (const k of KINDS) {
    const ms = byKind[k];
    if (!ms.length) continue;
    const tfs = {};
    for (const m of ms) tfs[tfOf(m.file)] = (tfs[tfOf(m.file)] || 0) + 1;
    const tickers = new Set(ms.map((m) => tickerOf(m.file)));
    console.log(`  ${k}: ${ms.length} files, ${tickers.size} tickers; by timeframe ${Object.entries(tfs).map(([t, n]) => `${t} ${n}`).join(', ')}`);
    for (const m of ms.slice(0, opt.show)) {
      if (k === 'missing') { console.log(`    ${m.file} (${m.side})`); continue; }
      const also = m.kinds.length > 1 ? `, also ${m.kinds.slice(1).join(' and ')}` : '';
      console.log(`    ${m.file}: first difference at line ${m.first + 1} (js ${lineCount(m.A)} lines, py ${lineCount(m.B)}; labels js ${m.labels[0]}, py ${m.labels[1]}${also})`);
      for (let i = Math.max(0, m.first - opt.context); i < m.first; i++) console.log(`         ${String(i + 1).padStart(5)}  ${m.A[i]}`);
      if (k === 'format') {
        const ta = m.A.join('\n'), tb = m.B.join('\n');
        let at = 0;
        while (at < ta.length && at < tb.length && ta[at] === tb[at]) at++;
        const win = (t) => JSON.stringify(t.slice(Math.max(0, at - 20), at + 20));
        console.log(`      first differing character at offset ${at} (js ${ta.length}, py ${tb.length} characters)\n      js ${win(ta)}\n      py ${win(tb)}`);
      } else {
        for (let i = m.first; i <= m.first + opt.context; i++) {
          if (i < lineCount(m.A) || i === m.first) console.log(`      js ${String(i + 1).padStart(5)}  ${show(i < lineCount(m.A) ? m.A[i] : undefined)}`);
          if (i < lineCount(m.B) || i === m.first) console.log(`      py ${String(i + 1).padStart(5)}  ${show(i < lineCount(m.B) ? m.B[i] : undefined)}`);
        }
      }
      if (k === 'labels') {
        const { onlyA, onlyB } = labelDelta(m.A, m.B);
        const cut = (xs) => xs.slice(0, 4).join(' | ').replace(/\t/g, ' ') + (xs.length > 4 ? ` | ... (${xs.length})` : '');
        if (onlyA.length) console.log(`      labels only in js (${onlyA.length}): ${cut(onlyA)}`);
        if (onlyB.length) console.log(`      labels only in py (${onlyB.length}): ${cut(onlyB)}`);
        if (!onlyA.length && !onlyB.length) console.log('      same labels on both sides, in another order');
      }
    }
    if (ms.length > opt.show) console.log(`    ... ${ms.length - opt.show} more: ${ms.slice(opt.show, opt.show + 12).map((m) => m.file).join(' ')}${ms.length > opt.show + 12 ? ' ...' : ''}`);
  }
  return {
    files: cmp.files,
    mismatchedFiles: cmp.mismatched.length,
    kinds: Object.fromEntries(KINDS.map((k) => [k, byKind[k].length]).filter(([, n]) => n > 0)),
    confirmedBars: cmp.stats.bars,
    labels: cmp.stats.labels,
    mismatchedExamples: cmp.mismatched.slice(0, 50).map((m) => m.file),
  };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const opt = {
    work: path.resolve(a.work || path.join(os.tmpdir(), 'td-diff')),
    data: path.resolve(a.data || path.join(ROOT, 'data', 'daily')),
    show: a.show !== undefined ? Number(a.show) : 3,
    context: a.context !== undefined ? Number(a.context) : 3,
    jobs: a.jobs !== undefined ? Math.max(1, Number(a.jobs)) : Math.max(1, os.cpus().length),
  };
  mkdirSync(opt.work, { recursive: true });
  const summary = { generatedAt: new Date().toISOString(), runs: [] };
  let fullSuite = false;

  if (a.compare) {
    const [dA, dB] = a.compare.map((d) => path.resolve(d));
    summary.runs.push({ name: 'compare', js: dA, py: dB, ...report('compare', compareDirs(dA, dB), opt) });
  } else {
    let runs;
    if (a.variant || a.tickers || a.subset) {
      const v = a.variant ? variantFile(a.variant) : null;
      runs = [{ name: `adhoc-${v ? path.basename(v, '.json') : 'default'}`, variant: v, tickers: a.tickers ? list(a.tickers) : a.subset ? subsetTickers(opt.data) : null }];
    } else {
      runs = suite(opt.data);
      if (a.run) {
        const want = list(a.run);
        const unknown = want.filter((n) => !runs.some((r) => r.name === n));
        if (unknown.length) throw new UsageError(`unknown run ${unknown.join(', ')} (suite: ${runs.map((r) => r.name).join(', ')})`);
        runs = runs.filter((r) => want.includes(r.name));
      } else fullSuite = !a.tfs && opt.data === path.join(ROOT, 'data', 'daily');
    }
    const tfs = a.tfs ? list(a.tfs) : null;
    const status = JSON.parse(readFileSync(path.join(opt.data, '_status.json'), 'utf8'));
    summary.data = { fetchedAt: status.fetchedAt, lastClosedDay: status.lastClosedDay };
    for (const run of runs) {
      run.tfs = tfs;
      const res = await runBoth(run, opt);
      const rep = report(run.name, compareDirs(res.jsDir, res.pyDir), opt);
      summary.runs.push({
        name: run.name,
        variant: run.variant ? path.relative(ROOT, run.variant) : null,
        options: run.variant ? JSON.parse(readFileSync(run.variant, 'utf8')) : {},
        tickers: run.tickers ? run.tickers.length : 'all',
        tfs: tfs || 'all',
        seconds: res.seconds,
        ...rep,
      });
    }
  }

  writeFileSync(path.join(opt.work, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  const bad = summary.runs.filter((r) => r.mismatchedFiles > 0);
  if (fullSuite) {
    summary.ok = bad.length === 0;
    mkdirSync(path.dirname(SUMMARY_FILE), { recursive: true });
    writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 1) + '\n');
  }
  console.log('\nrun                files   mismatched   confirmed bars   labels');
  for (const r of summary.runs) {
    const nl = Object.values(r.labels).reduce((x, y) => x + y, 0);
    console.log(`${r.name.padEnd(16)} ${String(r.files).padStart(7)}   ${String(r.mismatchedFiles).padStart(10)}   ${String(r.confirmedBars).padStart(14)}   ${String(nl).padStart(7)}`);
  }
  console.log(bad.length ? `diff: ${bad.length} of ${summary.runs.length} runs have mismatches` : `diff: all ${summary.runs.length} runs identical`);
  if (fullSuite) console.log(`diff: wrote ${path.relative(ROOT, SUMMARY_FILE)}`);
  process.exitCode = bad.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`diff: ${err.message}`);
    process.exit(2);
  });
}
