// A COPY of the repository's page sources and of the BTC and ETH data as they would have been on an earlier day:
//   node asof.mjs <repoDir> <outDir> <YYYY-MM-DD> [--coins BTC,ETH]
// The daily bars end at that day, TradingView's own 1W and 1M bars at the last week and month that had closed by
// then, and data/daily/_status.json names that day as the last closed day. run.sh on <outDir> then checks the page
// "as of" that day: other next-bar conditions (9s, conditions met now, conditions within the 임박 threshold), other
// numbers at the right edge. (TradingView's later revisions of old bars stay in: this is today's data cut off, which
// is all the checks need.)
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
const [repo, out, date, ...rest] = process.argv.slice(2);
if (!repo || !out || !/^\d{4}-\d\d-\d\d$/.test(date || '')) { console.error('usage: node asof.mjs <repoDir> <outDir> <YYYY-MM-DD> [--coins BTC,ETH]'); process.exit(2); }
const coins = (rest.includes('--coins') ? rest[rest.indexOf('--coins') + 1] : 'BTC,ETH').split(',');
if (existsSync(path.join(out, '.git'))) { console.error('refusing to write into a git checkout'); process.exit(2); }
const DAY = 86400000, D = Date.parse(date + 'T00:00:00Z') / DAY;
rmSync(out, { recursive: true, force: true }); mkdirSync(path.join(out, 'data/daily'), { recursive: true }); mkdirSync(path.join(out, 'verify/out'), { recursive: true });
for (const d of ['dashboard', 'scripts']) cpSync(path.join(repo, d), path.join(out, d), { recursive: true });
for (const f of ['package.json', 'data/universe.json', 'data/tickers.json', 'verify/out/summary.json']) if (existsSync(path.join(repo, f))) cpSync(path.join(repo, f), path.join(out, f));
const tickers = JSON.parse(readFileSync(path.join(repo, 'data/tickers.json'), 'utf8'));
const status = JSON.parse(readFileSync(path.join(repo, 'data/daily/_status.json'), 'utf8'));
for (const sym of coins) {
  const usd = tickers.coins.find((c) => c.sym === sym).usd, file = usd.replace(/[^A-Za-z0-9.]+/g, '_') + '.json';
  const d = JSON.parse(readFileSync(path.join(repo, 'data/daily', file), 'utf8')), n = D - d.d0 + 1;
  if (n < 30) throw new Error(`${sym} has no history by ${date}`);
  for (const k of ['o', 'h', 'l', 'c']) d[k] = d[k].slice(0, n);
  const cut = (own, closed) => { if (!own) return own; let m = 0; while (m < own.d.length && closed(own.d[m])) m++; const o = {}; for (const k of Object.keys(own)) o[k] = Array.isArray(own[k]) ? own[k].slice(0, m) : own[k]; return o; };
  d.w = cut(d.w, (s) => s + 6 <= D);
  d.m = cut(d.m, (s) => { const t = new Date(s * DAY); return Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1) / DAY - 1 <= D; });
  writeFileSync(path.join(out, 'data/daily', file), JSON.stringify(d));
}
writeFileSync(path.join(out, 'data/daily/_status.json'), JSON.stringify({ ...status, lastClosedDay: date }, null, 1));
console.log(`asof: ${coins.join(', ')} as of ${date} in ${out}`);
