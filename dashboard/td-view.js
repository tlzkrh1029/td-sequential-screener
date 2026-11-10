// View helpers shared by the pages: how far the bar in progress is from the prices at which the TD engine would put
// a 9 or a 13 on it. Plain ES module, no DOM, no imports; the engine's evalTrigger is passed in, so this file reads
// nothing but the next-bar triggers of dashboard/td-engine.js (nextBarTriggers) and never recounts anything itself.

const F64 = new Float64Array(1), U64 = new BigUint64Array(F64.buffer);
// the double next to x in direction dir (-1 down, 1 up); x is a positive finite price or price difference
export function nextAfter(x, dir) {
  if (!Number.isFinite(x) || dir === 0) return x;
  if (x === 0) return dir > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  F64[0] = x;
  U64[0] += (x > 0) === (dir > 0) ? 1n : -1n;
  return F64[0];
}

// The bar a next-bar trigger is tested on, as far as it is known: the bar in progress so far (po = [o, h, l, c] or
// {o, h, l, c}), or, when no closed day is in it yet (as on 1D), a bar that opens at the last close. `assumed` marks
// the second case: the open is then a guess, which only matters to conditions on the open ("Open or Close").
export function baseBar(po, lastClose) {
  if (po != null) {
    const b = Array.isArray(po) ? { o: po[0], h: po[1], l: po[2], c: po[3] } : po;
    return { o: b.o, h: b.h, l: b.l, c: b.c, assumed: false };
  }
  return { o: lastClose, h: lastClose, l: lastClose, c: lastClose, assumed: true };
}

// The bar if price went straight from where it is to p and the bar closed there (reach, when given, is a price the
// bar touched on the way before coming back to p).
export function extendBar(base, p, reach = p) {
  return { o: base.o, h: Math.max(base.h, p, reach), l: Math.min(base.l, p, reach), c: p };
}

// Every close at which the truth of a condition can change when the bar is extended to it: the thresholds on the
// close, the low and the high, and for a range condition (hl, only with non-default origin options) the closes that
// make the range that wide; each with the doubles next to it, for the strict comparisons.
function breakpoints(trigger, base) {
  const out = new Set();
  const add = (v) => { if (v > 0 && Number.isFinite(v)) { out.add(v); out.add(nextAfter(v, -1)); out.add(nextAfter(v, 1)); } };
  const groups = [trigger.all || [], ...(trigger.any || []), ...(trigger.unless || [])];
  for (const g of groups) {
    for (const [src, , v] of g) {
      if (src === 'c' || src === 'l' || src === 'h') add(v);
      else if (src === 'hl') { add(base.l + v); add(base.h - v); }
    }
  }
  return out;
}

// Where the bar in progress stands against one next-bar trigger.
//   fire(evalTrigger, trigger, base) -> null when no single move of the price makes the label appear, else
//   { now, p, pct, q, qpct, dir }
//     now   the label appears if the bar closes where it is now
//     p     the close nearest to the current one at which the label appears when the price goes straight there and
//           the bar closes there. For a 13 this is how far the low (buy) or the high (sell) has to reach.
//     pct   p / current close - 1
//     q     once the bar has reached p: the close nearest to the current one at which the label still appears. A 13
//           that needs the low at one level and the close at another has q at the close level; otherwise q = p.
//     qpct  q / current close - 1
//     dir   -1 the price has to fall to p, 1 it has to rise, 0 the label appears as things are
// evalTrigger is TD.evalTrigger; base is baseBar(...). Everything is exact in floating point: the label appears at p
// and at q, and at no close nearer to the current one (test/view.test.mjs checks this against the engine itself).
export function fire(evalTrigger, trigger, base) {
  const c0 = base.c;
  if (!(c0 > 0)) return null;
  const now = evalTrigger(trigger, { o: base.o, h: base.h, l: base.l, c: base.c });
  if (now) return { now: true, p: c0, pct: 0, q: c0, qpct: 0, dir: 0 };
  const cand = breakpoints(trigger, base);
  let p = null;
  for (const v of cand) {
    if (p !== null && Math.abs(v - c0) >= Math.abs(p - c0)) continue;
    if (evalTrigger(trigger, extendBar(base, v))) p = v;
  }
  if (p === null) return null;
  // the close may come back towards the current one after the bar has touched p
  let q = p;
  const lo = Math.min(c0, p), hi = Math.max(c0, p);
  for (const v of [...cand, c0]) {
    if (v < lo || v > hi || Math.abs(v - c0) >= Math.abs(q - c0)) continue;
    if (evalTrigger(trigger, extendBar(base, v, p))) q = v;
  }
  return { now: false, p, pct: p / c0 - 1, q, qpct: q / c0 - 1, dir: p < c0 ? -1 : 1 };
}

// The triggers of one timeframe with where the bar stands against each: [{ t, k, d, f, o, fire }], fire as above
// (null when the label cannot appear by one move). tg = TD.nextBarTriggers(...) or the build summary's tg.
export function withFire(evalTrigger, tg, base) {
  return (tg || []).map((t) => ({ t, k: t.k, d: t.d, f: t.f, o: t.o, fire: fire(evalTrigger, t, base) }));
}

// Bars until the next display 9 of a setup that is running, if every bar keeps it running (1 = the next bar can show
// it); null when no setup is running. With wrapSetup the 9 repeats every 9 bars (raw 18, 27, ...); without it only
// raw 9 is a 9.
export function barsTo9(raw, wrapSetup = true) {
  if (!(raw > 0)) return null;
  if (raw < 9) return 9 - raw;
  return wrapSetup ? 9 - (raw % 9) : null;
}

// One side (dir -1 buy, 1 sell) of one timeframe from the build summary T (scripts/build-site.mjs summarize) for the
// overview screens:
//   { raw, to9, runs: [{ f, count, hi }], labels: [{ ago, kind, f, text, raw, rep }], trigs: [{ t, k, d, f, o, fire }],
//     next13, next9 }
//     raw / to9  the running setup count of the side and barsTo9 of it
//     runs       the active countdowns per family: how many origins, and the highest count among them
//     labels     the labels of the side on the last 13 bars: 9s (rep = a repeated 9), deferred 13s (+13) and 13s
//     trigs      the side's next-bar triggers with fire(...)
//     next13     of the 13 triggers that can fire, the one nearest to the current price (now first), or null
//     next9      the same for the 9 triggers
// lastClose is the coin's newest daily close (the summary's lc); options are the indicator inputs (for wrapSetup).
export function sideState(evalTrigger, T, dir, lastClose, options = {}) {
  const sell = dir === 1;
  const raw = sell ? T.sr : T.br;
  const runs = [];
  for (let f = 0; f < 4; f++) {
    const s = (f * 2 + (sell ? 1 : 0)) * 2;
    if (T.ru[s] > 0) runs.push({ f, count: T.ru[s], hi: T.ru[s + 1] });
  }
  const labels = [];
  for (const L of T.rl) {
    if (L[2] !== dir) continue;
    if (L[1] === 'S') { if (L[4].startsWith('9')) labels.push({ ago: L[0], kind: 'S', f: null, text: L[4], raw: L[5], rep: L[5] >= 18 }); }
    else if (L[1] === 'C' || L[1] === 'I') labels.push({ ago: L[0], kind: L[1], f: L[3], text: L[4], raw: null, rep: false });
  }
  const base = baseBar(T.po, lastClose);
  const trigs = withFire(evalTrigger, (T.tg || []).filter((t) => t.d === dir), base);
  const nearest = (pick) => {
    let best = null;
    for (const x of trigs) if (pick(x) && x.fire && (!best || Math.abs(x.fire.pct) < Math.abs(best.fire.pct))) best = x;
    return best;
  };
  return { raw, to9: barsTo9(raw, options.wrapSetup !== false), runs, labels, trigs,
    next13: nearest((x) => x.k === 'C13'), next9: nearest((x) => x.k !== 'C13') };
}
