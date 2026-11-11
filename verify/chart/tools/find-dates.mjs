// Days in the history on which the next-bar conditions of BTC and ETH are of many kinds, for the "as of" runs:
//   node find-dates.mjs <repoDir> [days back, default 1500]
// Per day and coin: the triggers that one move can meet, how many are 9s, repeated 9s, met now, within 3%, have an
// "unless", a close level apart from the price, or are pinned beyond +-30%.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = path.resolve(process.argv[2]), back = Number(process.argv[3] || 1500);
const mod = (rel) => import(pathToFileURL(path.join(repo, rel)).href);
const BARS = await mod('dashboard/bars.js'), TD = await mod('dashboard/td-engine.js'), VIEW = await mod('dashboard/td-view.js');
const status = JSON.parse(readFileSync(path.join(repo, 'data/daily/_status.json'), 'utf8')), LAST = BARS.dayOfIso(status.lastClosedDay);
const rows = [];
for (const usd of ['CRYPTO:BTCUSD', 'CRYPTO:ETHUSD']) {
  const d = JSON.parse(readFileSync(path.join(repo, 'data/daily', BARS.fileIdOf(usd) + '.json'), 'utf8'));
  for (let D = LAST - back; D <= LAST; D += 1) {
    const i = D - d.d0; if (i < 400 || d.c[i] == null) continue;
    const daily = { ...d, w: d.w && { ...d.w }, m: d.m && { ...d.m } };
    const row = { usd, D, n: 0, s9: 0, s9r: 0, now: 0, near: 0, unless: 0, q: 0, far: 0 };
    for (const tf of BARS.TFS) {
      const bars = BARS.buildBars(daily, tf, D); if (!bars.n) continue;
      const res = TD.runTD(bars, {}), base = VIEW.baseBar(bars.partial, d.c[i]);
      for (const t of TD.nextBarTriggers(bars, res, {})) {
        const f = VIEW.fire(TD.evalTrigger, t, base); if (!f) continue;
        row.n++; if (t.k === 'S9') row.s9++; if (t.k === 'S9r') row.s9r++; if (f.now) row.now++; else if (Math.abs(f.pct) <= 0.03) row.near++;
        if (t.unless) row.unless++; if (!f.now && f.q !== f.p && f.qpct !== 0) row.q++; if (Math.abs(f.pct) > 0.3) row.far++;
      }
    }
    rows.push(row);
  }
}
const byDay = new Map(); for (const r of rows) { const a = byDay.get(r.D) || { D: r.D, n: 0, s9: 0, s9r: 0, now: 0, near: 0, unless: 0, q: 0, far: 0 }; for (const k of Object.keys(a)) if (k !== 'D') a[k] += r[k]; byDay.set(r.D, a); }
const score = (a) => (a.s9 ? 3 : 0) + (a.s9r ? 4 : 0) + (a.now ? 3 : 0) + (a.near ? 2 : 0) + (a.unless ? 4 : 0) + (a.q ? 1 : 0) + Math.min(a.n, 30) / 10;
const top = [...byDay.values()].sort((a, b) => score(b) - score(a)).slice(0, 25);
for (const a of top) console.log(BARS.isoOfDay(a.D), JSON.stringify(a), score(a).toFixed(1));
const max = (k) => [...byDay.values()].sort((a, b) => b[k] - a[k])[0];
for (const k of ['n', 's9', 's9r', 'now', 'near', 'unless', 'q', 'far']) { const a = max(k); console.log('most', k, BARS.isoOfDay(a.D), JSON.stringify(a)); }
