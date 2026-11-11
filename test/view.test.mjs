// dashboard/td-view.js: the price at which the bar in progress gets a 9 or a 13. Run: node --test test/
//
// The hand-made cases are derived by hand. The sweep takes every next-bar trigger of the real data, appends the bar
// that fire() says makes the label appear to the confirmed bars and recounts with the engine: the label must be there,
// and it must not be there when the bar closes one floating-point step nearer to the current price. It also puts the
// LEVEL a page writes for a trigger (fire().pc and qc: "조건가 60,492.4 초과") to the engine: a bar that closes exactly
// at a strict level gets no label, a bar one price tick beyond it gets the label.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TFS, buildBars, dayOfIso, fileIdOf } from '../dashboard/bars.js';
import * as TD from '../dashboard/td-engine.js';
import { nextAfter, baseBar, extendBar, fire, withFire, barsTo9, sideState } from '../dashboard/td-view.js';

const ev = TD.evalTrigger;

test('nextAfter steps to the adjacent double', () => {
  assert.equal(nextAfter(1, 1), 1 + Number.EPSILON);
  assert.equal(nextAfter(1, -1), 1 - Number.EPSILON / 2);
  assert.ok(nextAfter(4.0913e-6, -1) < 4.0913e-6 && nextAfter(nextAfter(4.0913e-6, -1), 1) === 4.0913e-6);
});

test('a buy 13 that needs the low at one level and the close or open at another (PEPE 1D, 2026-11-09)', () => {
  // Sequential final 13 "Open or Close" with the 13 vs 8 qualifier: low <= close of count 8, and close or open <= low[2]
  const t = { k: 'C13', d: -1, f: 0, o: 20698, all: [['l', '<=', 4.0913e-6]], any: [[['c', '<=', 4.7832e-6]], [['o', '<=', 4.7832e-6]]], unless: null };
  const base = baseBar(null, 5.1214e-6); // 1D: no closed day in the bar yet, it opens at the last close
  assert.equal(base.assumed, true);
  const f = fire(ev, t, base);
  assert.equal(f.now, false);
  assert.equal(f.p, 4.0913e-6);                     // the low has to reach count 8's close
  assert.equal(f.q, 4.7832e-6);                     // and the close may come back up to low[2]
  assert.ok(Math.abs(f.pct - (4.0913 / 5.1214 - 1)) < 1e-12 && Math.abs(f.qpct - (4.7832 / 5.1214 - 1)) < 1e-12);
  assert.equal(f.dir, -1);
  // which comparison decides: the low at count 8's close, then the close at low[2]; both levels themselves count
  assert.deepEqual(f.pc, { src: 'l', op: '<=', v: 4.0913e-6, strict: false });
  assert.deepEqual(f.qc, { src: 'c', op: '<=', v: 4.7832e-6, strict: false });
  // a bar in progress that already touched the low level only needs the close
  const touched = fire(ev, t, baseBar([5.0e-6, 5.2e-6, 4.05e-6, 5.1e-6], 5.1e-6));
  assert.equal(touched.p, 4.7832e-6);
  assert.equal(touched.q, 4.7832e-6);
  assert.deepEqual(touched.pc, { src: 'c', op: '<=', v: 4.7832e-6, strict: false });
  assert.equal(touched.qc, touched.pc);
  // one that opened below low[2] and touched the low level fires as it is
  assert.deepEqual(fire(ev, t, baseBar([4.7e-6, 4.9e-6, 4.0e-6, 4.85e-6], 4.85e-6)), { now: true, p: 4.85e-6, pct: 0, q: 4.85e-6, qpct: 0, dir: 0, pc: null, qc: null });
  // the bar may close where it is now once the low has been there: no close level to name
  const back = fire(ev, { ...t, any: [[['c', '<=', 5.2e-6]], [['o', '<=', 5.2e-6]]] }, base);
  assert.equal(back.q, 5.1214e-6);
  assert.equal(back.qpct, 0);
  assert.equal(back.qc, null);
});

test('a strict comparison fires one step beyond its threshold, and one that already holds fires now', () => {
  const buy9 = { k: 'S9', d: -1, f: null, o: null, all: [['c', '<', 100]], any: null, unless: null };
  const f = fire(ev, buy9, baseBar(null, 104));
  assert.equal(f.p, nextAfter(100, -1));
  assert.equal(f.q, f.p);
  assert.equal(ev(buy9, extendBar(baseBar(null, 104), 100)), false);
  // the level a text has to name is 100, with "미만": a close at 100 does not do it, a close at 99.99 does
  assert.deepEqual(f.pc, { src: 'c', op: '<', v: 100, strict: true });
  assert.equal(f.qc, f.pc);
  assert.equal(ev(buy9, extendBar(baseBar(null, 104), f.pc.v)), false);
  assert.equal(ev(buy9, extendBar(baseBar(null, 104), 99.99)), true);
  assert.equal(fire(ev, buy9, baseBar(null, 99)).now, true);
  const sell9 = { k: 'S9', d: 1, f: null, o: null, all: [['c', '>', 100]], any: null, unless: null };
  const g = fire(ev, sell9, baseBar([98, 99, 97, 98.5], 98.5));
  assert.equal(g.p, nextAfter(100, 1));
  assert.deepEqual(g.pc, { src: 'c', op: '>', v: 100, strict: true });
  // a level that counts itself, on the way up
  assert.deepEqual(fire(ev, { ...sell9, all: [['c', '>=', 100]] }, baseBar(null, 98.5)).pc, { src: 'c', op: '>=', v: 100, strict: false });
  // a 13 whose low has to go beyond a level and whose close has to stay beyond another one (strict at both)
  const two = fire(ev, { k: 'C13', d: -1, f: 0, o: 1, all: [['l', '<', 90]], any: [[['c', '<', 95]]], unless: null }, baseBar(null, 100));
  assert.equal(two.p, nextAfter(90, -1));
  assert.equal(two.q, nextAfter(95, -1));
  assert.deepEqual(two.pc, { src: 'l', op: '<', v: 90, strict: true });
  assert.deepEqual(two.qc, { src: 'c', op: '<', v: 95, strict: true });
});

test('a cancelling condition moves or removes the price', () => {
  // sell 13 needs the high at 110, but a close above 108 would complete an opposite... (made-up numbers): the bar
  // must touch 110 and close back at 108 or lower
  const t = { k: 'C13', d: 1, f: 2, o: 1, all: [['h', '>=', 110]], any: null, unless: [[['c', '>', 108]]] };
  const f = fire(ev, t, baseBar(null, 100));
  assert.equal(f, null); // going straight to 110 and closing there is cancelled, and no nearer close reaches 110
  // with the high already made, any close up to 108 works: it fires now
  assert.equal(fire(ev, t, baseBar([100, 111, 99, 104], 104)).now, true);
  // an empty unless group always cancels
  assert.equal(fire(ev, { ...t, unless: [[]] }, baseBar([100, 111, 99, 104], 104)), null);
});

test('barsTo9 and sideState', () => {
  assert.equal(barsTo9(0), null);
  assert.equal(barsTo9(8), 1);
  assert.equal(barsTo9(3), 6);
  assert.equal(barsTo9(9), 9);
  assert.equal(barsTo9(17), 1);
  assert.equal(barsTo9(12, false), null);
  const T = { n: 100, br: 0, sr: 7, ru: [1, 12, 0, 0, 0, 0, 0, 0, 2, 8, 0, 0, 1, 10, 0, 0],
    rl: [[12, 'I', -1, 0, '+13'], [3, 'S', 1, null, '9', 18], [2, 'S', -1, null, '9*', 9], [0, 'C', -1, 3, '13x2']],
    tg: [{ k: 'C13', d: -1, f: 0, o: 5, all: [['l', '<=', 90]], any: null, unless: null }, { k: 'C13', d: -1, f: 3, o: 6, all: [['l', '<=', 95]], any: null, unless: null }],
    po: null };
  const buy = sideState(ev, T, -1, 100, TD.V6_DEFAULTS), sell = sideState(ev, T, 1, 100, TD.V6_DEFAULTS);
  assert.deepEqual(buy.runs, [{ f: 0, count: 1, hi: 12 }, { f: 2, count: 2, hi: 8 }, { f: 3, count: 1, hi: 10 }]);
  assert.deepEqual(buy.labels.map((l) => [l.ago, l.kind, l.f, l.text, l.rep]), [[12, 'I', 0, '+13', false], [2, 'S', null, '9*', false], [0, 'C', 3, '13x2', false]]);
  assert.equal(buy.next13.f, 3);
  assert.equal(buy.next13.fire.p, 95);
  assert.equal(buy.next9, null);
  assert.equal(sell.raw, 7);
  assert.equal(sell.to9, 2);
  assert.deepEqual(sell.labels.map((l) => [l.text, l.rep]), [['9', true]]);
  assert.equal(sell.trigs.length, 0);
});

// ---------- sweep over the real data: fire() against the engine ----------
const DAILY = new URL('../data/daily/', import.meta.url);
const status = JSON.parse(readFileSync(new URL('_status.json', DAILY), 'utf8'));
const LAST = dayOfIso(status.lastClosedDay);

// is the label of trigger x on the last bar of res (bars = the confirmed bars the trigger was computed from)?
function labelThere(x, res, bars) {
  const n = bars.n;
  return res.labels.some((L) => {
    if (L.bar !== n || L.dir !== x.d) return false;
    if (x.k === 'C13') return L.kind === 'C' && L.family === x.f && L.origins.some((o) => bars.start[o] === x.o);
    if (L.kind !== 'S') return false;
    return x.k === 'S9' ? L.raw === 9 : L.raw > 9 && L.raw % 9 === 0;
  });
}
function recountWith(bars, bar, options) {
  const add = (a, v) => { const out = new Float64Array(bars.n + 1); out.set(a.subarray(0, bars.n)); out[bars.n] = v; return out; };
  return TD.runTD({ o: add(bars.o, bar.o), h: add(bars.h, bar.h), l: add(bars.l, bar.l), c: add(bars.c, bar.c) }, options);
}
// the price step of a ticker: the smallest step seen in its recent closes (as the pages estimate syminfo.mintick)
function tickOf(d) {
  let dec = 0;
  for (let i = d.c.length - 1, k = 0; i >= 0 && k < 400; i--) {
    const v = d.c[i]; if (v == null) continue; k++;
    const s = String(v), m = /e-(\d+)$/.exec(s), frac = (s.split('e')[0].split('.')[1] || '').length;
    dec = Math.max(dec, m ? Number(m[1]) + frac : frac);
  }
  return Math.pow(10, -Math.min(dec, 12));
}
// last: the last closed day the bars are built for (an earlier day than the data's gives the triggers of that day)
function sweep(files, options, last = LAST, stat = { triggers: 0, fires: 0, now: 0, none: 0, withQ: 0, strict: 0, strictQ: 0, levels: 0, bad: [] }) {
  for (const file of files) {
    const d = JSON.parse(readFileSync(new URL(file, DAILY), 'utf8'));
    let z = Math.min(d.c.length - 1, last - d.d0); while (z >= 0 && d.c[z] == null) z--;
    if (z < 0) continue;
    const tick = tickOf(d), beyond = (v, dir) => Number((v + dir * tick).toPrecision(15));
    for (const tf of TFS) {
      const bars = buildBars(d, tf, last);
      if (bars.n < 6) continue;
      const res = TD.runTD(bars, options);
      const base = baseBar(bars.partial, d.c[z]);
      for (const x of withFire(ev, TD.nextBarTriggers(bars, res, options), base)) {
        stat.triggers++;
        const where = `${file} ${tf} ${x.k} d${x.d} f${x.f}${last === LAST ? '' : ' as of day ' + last}`;
        const f = x.fire;
        if (!f) {
          stat.none++;
          // no single move fires it: closing where it is does not either
          if (labelThere(x, recountWith(bars, base, options), bars)) stat.bad.push(`${where}: fire is null but the label appears now`);
          continue;
        }
        stat.fires++;
        if (f.now) {
          stat.now++;
          if (!labelThere(x, recountWith(bars, base, options), bars)) stat.bad.push(`${where}: now, but the engine has no label`);
          if (f.pc !== null || f.qc !== null) stat.bad.push(`${where}: now, with a deciding comparison`);
          continue;
        }
        // the level a page writes: p itself, or for a strict comparison the double before p; a threshold of the trigger
        const pc = f.pc, levelOk = (c, at) => !!c && (c.strict ? nextAfter(c.v, f.dir) === at : c.v === at) && c.op === (f.dir < 0 ? (c.strict ? '<' : '<=') : (c.strict ? '>' : '>='));
        if (!levelOk(pc, f.p)) stat.bad.push(`${where}: pc ${JSON.stringify(pc)} is not the level of p ${f.p}`);
        else {
          stat.levels++;
          const inTrigger = [x.t.all || [], ...(x.t.any || []), ...(x.t.unless || [])].some((g) => g.some((c) => c[0] === pc.src && (c[0] === 'hl' ? base.l + c[2] === pc.v || base.h - c[2] === pc.v : c[2] === pc.v)));
          if (!inTrigger) stat.bad.push(`${where}: the level ${pc.v} (${pc.src}) is no threshold of the trigger`);
          if (pc.strict) {
            stat.strict++;
            // a bar that goes to the written level and closes exactly there gets no label; one tick beyond gets it
            if (labelThere(x, recountWith(bars, extendBar(base, pc.v), options), bars)) stat.bad.push(`${where}: strict level ${pc.v}, but a bar closing exactly there gets the label`);
            const b1 = beyond(pc.v, f.dir);
            if (!labelThere(x, recountWith(bars, extendBar(base, b1), options), bars)) stat.bad.push(`${where}: strict level ${pc.v}, but a bar closing one tick beyond it (${b1}) gets no label`);
          } else if (!labelThere(x, recountWith(bars, extendBar(base, pc.v), options), bars)) stat.bad.push(`${where}: level ${pc.v} counts itself, but a bar closing there gets no label`);
        }
        if (f.q === f.p ? f.qc !== f.pc : f.qpct === 0 ? f.qc !== null : !levelOk(f.qc, f.q)) stat.bad.push(`${where}: qc ${JSON.stringify(f.qc)} is not the level of q ${f.q} (p ${f.p})`);
        else if (f.q !== f.p && f.qc && f.qc.strict) {
          stat.strictQ++;
          // after the bar has reached p: a close exactly at the written close level gets no label, one tick beyond gets it
          if (labelThere(x, recountWith(bars, extendBar(base, f.qc.v, f.p), options), bars)) stat.bad.push(`${where}: strict close level ${f.qc.v}, but a close exactly there gets the label`);
          const b1 = beyond(f.qc.v, f.dir);
          if ((f.dir < 0 ? b1 >= f.p : b1 <= f.p) && !labelThere(x, recountWith(bars, extendBar(base, b1, f.p), options), bars)) stat.bad.push(`${where}: strict close level ${f.qc.v}, but a close one tick beyond it (${b1}) gets no label`);
        }
        if (!labelThere(x, recountWith(bars, extendBar(base, f.p), options), bars)) stat.bad.push(`${where}: no label at p ${f.p}`);
        const nearer = nextAfter(f.p, -f.dir);
        if (labelThere(x, recountWith(bars, extendBar(base, nearer), options), bars)) stat.bad.push(`${where}: label one step nearer than p ${f.p}`);
        // a grid of closes between the current one and p: none may fire
        for (let k = 1; k < 24; k++) {
          const v = base.c * Math.pow(f.p / base.c, k / 24);
          if (ev(x.t, extendBar(base, v))) { stat.bad.push(`${where}: fires at ${v}, nearer than p ${f.p}`); break; }
        }
        if (f.q !== f.p) {
          stat.withQ++;
          if (!labelThere(x, recountWith(bars, extendBar(base, f.q, f.p), options), bars)) stat.bad.push(`${where}: no label at q ${f.q} after reaching p ${f.p}`);
          const nq = nextAfter(f.q, -f.dir);
          if ((f.dir < 0 ? nq <= base.c : nq >= base.c) && labelThere(x, recountWith(bars, extendBar(base, nq, f.p), options), bars)) stat.bad.push(`${where}: label one step nearer than q ${f.q}`);
        }
      }
    }
  }
  return stat;
}

test('every next-bar trigger of the real data: the engine puts the label at fire().p and not one step nearer', () => {
  const files = readdirSync(DAILY).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
  const stat = sweep(files, TD.V6_DEFAULTS);
  assert.deepEqual(stat.bad.slice(0, 5), []);
  assert.ok(stat.triggers > 1000 && stat.fires > 500, JSON.stringify(stat));
  // every waiting 9 is a strict comparison (the close has to be beyond the close of four bars before)
  assert.ok(stat.strict > 0 && stat.levels === stat.fires - stat.now, JSON.stringify(stat));
  console.log(`  default inputs: ${stat.triggers} triggers on ${files.length} tickers, ${stat.fires} can fire (${stat.now} now, ${stat.withQ} with a separate close level), ${stat.none} cannot by one move; ${stat.strict} strict levels (${stat.strictQ} strict close levels): no label at the level, a label one tick beyond`);
});

test('the same with the other setting variants on the subset tickers', () => {
  const subset = JSON.parse(readFileSync(new URL('../verify/subset.json', import.meta.url), 'utf8')).tickers.map((id) => fileIdOf(id) + '.json');
  for (const name of ['corrected', 'display', 'keep', 'recycle']) {
    const variant = JSON.parse(readFileSync(new URL(`../verify/variants/${name}.json`, import.meta.url), 'utf8'));
    const stat = sweep(subset, { ...TD.V6_DEFAULTS, ...variant });
    assert.deepEqual(stat.bad.slice(0, 5), [], name);
    assert.ok(stat.triggers > 50, `${name}: ${JSON.stringify(stat)}`);
    assert.equal(stat.levels, stat.fires - stat.now, name);
    console.log(`  ${name}: ${stat.triggers} triggers, ${stat.fires} can fire (${stat.now} now, ${stat.withQ} with a separate close level), ${stat.none} cannot by one move; ${stat.strict} strict levels (${stat.strictQ} strict close levels)`);
  }
});

test('a strict level on earlier days too: no label for a close exactly at the written level, a label one tick beyond', () => {
  // the newest day alone has few 9s that still wait; the subset tickers as of 20 earlier days give many more
  const subset = JSON.parse(readFileSync(new URL('../verify/subset.json', import.meta.url), 'utf8')).tickers.map((id) => fileIdOf(id) + '.json');
  const stat = { triggers: 0, fires: 0, now: 0, none: 0, withQ: 0, strict: 0, strictQ: 0, levels: 0, bad: [] };
  for (let k = 1; k <= 20; k++) sweep(subset, TD.V6_DEFAULTS, LAST - k * 9, stat);
  assert.deepEqual(stat.bad.slice(0, 5), []);
  assert.equal(stat.levels, stat.fires - stat.now);
  assert.ok(stat.strict > 100, JSON.stringify(stat));
  console.log(`  default inputs, ${subset.length} tickers as of 20 earlier days: ${stat.triggers} triggers, ${stat.fires} can fire (${stat.now} now); ${stat.strict} strict levels (${stat.strictQ} strict close levels): no label at the level, a label one tick beyond`);
});
