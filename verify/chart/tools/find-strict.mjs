// Days on which a 9 (or another condition with a strict comparison) is still waiting: the price has to pass a level
// that itself does not count ("미만" / "초과").   node find-strict.mjs <repoDir> [days back]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = path.resolve(process.argv[2]), back = Number(process.argv[3] || 800);
const mod = (rel) => import(pathToFileURL(path.join(repo, rel)).href);
const BARS = await mod('dashboard/bars.js'), TD = await mod('dashboard/td-engine.js'), VIEW = await mod('dashboard/td-view.js');
const status = JSON.parse(readFileSync(path.join(repo, 'data/daily/_status.json'), 'utf8')), LAST = BARS.dayOfIso(status.lastClosedDay);
const out = [];
for (const usd of ['CRYPTO:BTCUSD', 'CRYPTO:ETHUSD']) {
  const d = JSON.parse(readFileSync(path.join(repo, 'data/daily', BARS.fileIdOf(usd) + '.json'), 'utf8'));
  for (let D = LAST - back; D <= LAST; D++) {
    const i = D - d.d0; if (d.c[i] == null) continue;
    for (const tf of BARS.TFS) {
      const bars = BARS.buildBars(d, tf, D); if (!bars.n) continue;
      const res = TD.runTD(bars, {}), base = VIEW.baseBar(bars.partial, d.c[i]);
      for (const t of TD.nextBarTriggers(bars, res, {})) {
        const f = VIEW.fire(TD.evalTrigger, t, base); if (!f || f.now) continue;
        if (t.k !== 'C13') out.push({ day: BARS.isoOfDay(D), usd, tf, k: t.k, d: t.d, p: f.p, pct: f.pct, all: t.all });
      }
    }
  }
}
const byDay = {}; for (const o of out) (byDay[o.day] = byDay[o.day] || []).push(o);
const days = Object.entries(byDay).sort((a, b) => b[1].length - a[1].length).slice(0, 12);
for (const [day, list] of days) console.log(day, list.length, JSON.stringify(list.slice(0, 3)));
console.log('days with a waiting 9:', Object.keys(byDay).length, 'of', back);
