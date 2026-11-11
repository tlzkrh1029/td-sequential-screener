// The engine outside the page, for the checks that put prices to it: the confirmed bars of a coin and timeframe from
// the repository's data and bars.js, and "what would the engine print on the next bar if it were this bar" (runTD on
// the confirmed bars plus that bar).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export async function makeEngine(repoDir) {
  const REPO = path.resolve(repoDir), mod = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);
  const BARS = await mod('dashboard/bars.js'), TD = await mod('dashboard/td-engine.js'), VIEW = await mod('dashboard/td-view.js');
  const status = JSON.parse(readFileSync(path.join(REPO, 'data/daily/_status.json'), 'utf8')), LAST = BARS.dayOfIso(status.lastClosedDay);
  const OPT = { ...TD.V6_DEFAULTS }, dailies = new Map(), barsCache = new Map();
  const daily = (usd) => { if (!dailies.has(usd)) dailies.set(usd, JSON.parse(readFileSync(path.join(REPO, 'data/daily', BARS.fileIdOf(usd) + '.json'), 'utf8'))); return dailies.get(usd); };
  const barsOf = (usd, tf) => { const k = usd + '|' + tf; if (!barsCache.has(k)) barsCache.set(k, BARS.buildBars(daily(usd), tf, LAST)); return barsCache.get(k); };
  const add = (a, n, v) => { const out = new Float64Array(n + 1); out.set(a.subarray(0, n)); out[n] = v; return out; };
  // the labels the engine puts on the bar after the confirmed ones, if that bar is `bar` = { o, h, l, c }
  function printed(usd, tf, bar) {
    const bars = barsOf(usd, tf), n = bars.n;
    if (!(bar.h >= bar.l && bar.h >= bar.o && bar.h >= bar.c && bar.l <= bar.o && bar.l <= bar.c)) throw new Error(`not a bar: ${JSON.stringify(bar)}`);
    const res = TD.runTD({ o: add(bars.o, n, bar.o), h: add(bars.h, n, bar.h), l: add(bars.l, n, bar.l), c: add(bars.c, n, bar.c) }, OPT), out = [];
    for (const L of res.labels) {
      if (L.bar !== n) continue;
      if (L.kind === 'S') out.push({ kind: 'S', d: L.dir, f: null, raw: L.raw, text: L.text, origins: [] });
      else if (L.kind === 'C') out.push({ kind: 'C', d: L.dir, f: L.family, raw: null, text: L.text, origins: L.origins.map((b) => bars.start[b]) });
      else if (L.kind === 'I') out.push({ kind: 'I', d: L.dir, f: L.family, raw: null, text: L.text, origins: [bars.start[L.origin]] });
    }
    return out;
  }
  // want: { is13, d, f, o (origin day), rep (a repeated 9) }
  const has = (labels, want) => labels.some((L) => L.d === want.d && (want.is13 ? L.kind === 'C' && L.f === want.f && L.origins.includes(want.o) : L.kind === 'S' && L.text.startsWith('9') && (want.rep == null || (want.rep ? L.raw >= 18 : L.raw === 9))));
  return { REPO, BARS, TD, VIEW, LAST, OPT, daily, barsOf, printed, has, lastClosedDay: status.lastClosedDay };
}
