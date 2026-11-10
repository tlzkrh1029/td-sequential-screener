// Next-bar triggers (dashboard/td-engine.js nextBarTriggers / evalTrigger) and runTD's onBar hook. Run: node --test test/
//
// Besides hand-derived cases, a counterfactual check: from the state after the last confirmed bar, hypothetical next
// bars placed on, and one float step around, every threshold of the triggers are appended and the engine is run on
// them; the triggers must say exactly which 9 and 13 labels it creates (compareBar of verify/triggers-check.mjs, which
// applies the same comparison to every bar of the real history).
import test from 'node:test';
import assert from 'node:assert/strict';
import { evalTrigger, nextBarTriggers, resolveOptions, runTD } from '../dashboard/td-engine.js';
import { checkSeries, compareBar, malformed, newCounts } from '../verify/triggers-check.mjs';

// ---------- helpers (as in test/engine.test.mjs) ----------
function series(closes, overrides = {}) {
  const s = { o: [], h: [], l: [], c: [] };
  closes.forEach((x, i) => {
    const v = { o: x, h: x + 0.5, l: x - 0.5, c: x, ...(overrides[i] || {}) };
    s.o.push(v.o); s.h.push(v.h); s.l.push(v.l); s.c.push(v.c);
  });
  s.start = closes.map((_, i) => 1000 + i); // bar start days
  s.n = closes.length;
  return s;
}
const range = (a, b, f) => Array.from({ length: b - a + 1 }, (_, k) => f(a + k));
const head = (s, n) => ({ o: s.o.slice(0, n), h: s.h.slice(0, n), l: s.l.slice(0, n), c: s.c.slice(0, n), start: s.start.slice(0, n), n });
const HEAD = range(0, 5, (b) => 100 + b);
const DROP1 = range(6, 17, (b) => 96 - b);
const DECLINE = [...HEAD, ...range(6, 40, (b) => 96 - b)];
const TWO = [...HEAD, ...DROP1, 120, ...range(19, 33, (b) => 138 - b), 130, 70];
const THREE = [...HEAD, ...DROP1, 120, ...range(19, 40, (b) => 138 - b), 150, ...range(42, 56, (b) => 191 - b), 160, 60];
const CANCEL = [...HEAD, ...DROP1, 85, ...range(19, 26, (b) => 67 + b)];
const CANCEL_OV = { 26: { l: 70 } };
const triggersAt = (s, n, opt = {}) => { const p = head(s, n); return nextBarTriggers(p, runTD(p, opt), opt); };
const T = (k, d, f, o, all, any = null, unless = null) => ({ k, d, f, o, all, any, unless });

// ---------- onBar ----------
test('onBar: the state after every bar, as runTD would return it on that prefix; the result is unchanged', () => {
  for (const [closes, ov, opt] of [[DECLINE, {}, {}], [THREE, {}, { showCounts: true, showBackfill: true }], [CANCEL, CANCEL_OV, { showCancelMarks: true }], [TWO, {}, { cancelTDST: true, maxOrigins: 1 }]]) {
    const s = series(closes, ov);
    const states = [];
    const res = runTD(s, opt, { onBar: (t, state) => states.push([t, state]) });
    assert.deepEqual(res, runTD(s, opt));
    assert.deepEqual(states.map(([t]) => t), range(0, s.n - 1, (t) => t));
    for (const [t, state] of states) assert.deepEqual(state, runTD(head(s, t + 1), opt).state, `bar ${t}`);
  }
});

// ---------- hand-derived triggers ----------
test('Setup 9 and repeated 9: close below close[4] of the next bar', () => {
  // DECLINE: raw 8 after bar 13; the next bar's close[4] is bar 10's close 86
  assert.deepEqual(triggersAt(series(DECLINE), 14), [T('S9', -1, null, null, [['c', '<', 86]])]);
  // raw 26 after bar 31 (bar b has raw b - 5): raw 27 is a repeated 9, close[4] = bar 28's close 68
  assert.deepEqual(triggersAt(series(DECLINE), 32), [T('S9r', -1, null, null, [['c', '<', 68]])]);
  // without wrapSetup raw 27 shows 27, not 9; without showSetups no setup label at all
  assert.deepEqual(triggersAt(series(DECLINE), 32, { wrapSetup: false }), []);
  assert.deepEqual(triggersAt(series(DECLINE), 14, { showSetups: false }), []);
  // sell side: CANCEL rises from bar 18, sell raw 8 after bar 25, close[4] = bar 22's close 89
  assert.deepEqual(triggersAt(series(CANCEL, CANCEL_OV), 26)[0], T('S9', 1, null, null, [['c', '>', 89]]));
  // fewer than 5 bars before the next one: nothing can happen on it (line 310)
  assert.deepEqual(triggersAt(series(DECLINE), 4), []);
});

test('Sequential 13: Open or Close at low[2], 13 vs 8 at close8; the other finals and the qualifier off', () => {
  // DECLINE: the Sequential run of bar 14 is at 12 after bar 25; low[2] of bar 26 = 71.5, close8 (bar 21) = 75
  const at26 = (opt) => triggersAt(series(DECLINE), 26, opt);
  assert.deepEqual(at26(), [T('C13', -1, 0, 1014, [['l', '<=', 75]], [[['c', '<=', 71.5]], [['o', '<=', 71.5]]])]);
  assert.deepEqual(at26({ seqFinal: 'Close' }), [T('C13', -1, 0, 1014, [['l', '<=', 75], ['c', '<=', 71.5]])]);
  assert.deepEqual(at26({ seqFinal: 'Wick' }), [T('C13', -1, 0, 1014, [['l', '<=', 75]], [[['c', '<=', 71.5]], [['l', '<=', 71.5]]])]);
  assert.deepEqual(at26({ seqQ138: false }), [T('C13', -1, 0, 1014, [], [[['c', '<=', 71.5]], [['o', '<=', 71.5]]])]);
  // tolerance: 2 ticks of 0.25 on the final comparison only (not on 13 vs 8)
  assert.deepEqual(at26({ seqTicks: 2, mintick: 0.25 }), [T('C13', -1, 0, 1014, [['l', '<=', 75]], [[['c', '<=', 72]], [['o', '<=', 72]]])]);
  // Aggressive Sequential: its low against low[2], and 13 vs 8
  const agg = at26({ enableAggSeq: true }).filter((x) => x.f === 1);
  assert.deepEqual(agg, [T('C13', -1, 1, 1014, [['l', '<=', 71.5]])]);
});

test('Combo and Aggressive Combo 13: progression against the last counted close / wick', () => {
  // DECLINE after bar 17: both Combo runs of bar 14 at 12; last counted close 79, last counted low 78.5
  assert.deepEqual(triggersAt(series(DECLINE), 18), [
    T('C13', -1, 2, 1014, [], [[['c', '<=', 79]], [['l', '<=', 79]]]), // comboFinal Wick: the close or the low
    T('C13', -1, 3, 1014, [['l', '<=', 78.5]]),
  ]);
  assert.deepEqual(triggersAt(series(DECLINE), 18, { comboFinal: 'Close' })[0], T('C13', -1, 2, 1014, [['c', '<=', 79]]));
  // strict counts (not relaxed): also value <= low[2] (79.5), wick <= low[1] (78.5; strict < for Aggressive Combo) and
  // value < close[1] (79). Combo: (close < 79 and low <= 78.5) or low <= 78.5, which is low <= 78.5
  assert.deepEqual(triggersAt(series(DECLINE), 18, { comboRelaxed: false, aggComboRelaxed: false }), [
    T('C13', -1, 2, 1014, [['l', '<=', 78.5]]),
    T('C13', -1, 3, 1014, [['l', '<', 78.5]]),
  ]);
  // two origins of each family complete together (TWO, bar 35): newest origin first, as in the label's origins
  assert.deepEqual(triggersAt(series(TWO), 35).map((x) => [x.f, x.o, x.all, x.any]), [
    [2, 1030, [], [[['c', '<=', 105]], [['l', '<=', 105]]]], [2, 1014, [], [[['c', '<=', 79]], [['l', '<=', 79]]]],
    [3, 1030, [['l', '<=', 104.5]], null], [3, 1014, [['l', '<=', 78.5]], null],
  ]);
});

test('unless: the opposite Setup 9, TDST, a new Setup 9 that replaces runs, capacity, raw 22', () => {
  // CANCEL after bar 25: the buy Combo runs at 12 would complete on a low <= 79, unless the bar is the sell Setup 9
  const tg = triggersAt(series(CANCEL, CANCEL_OV), 26);
  assert.deepEqual(tg.slice(1), [
    T('C13', -1, 2, 1014, [], [[['c', '<=', 79]], [['l', '<=', 79]]], [[['c', '>', 89]]]),
    T('C13', -1, 3, 1014, [['l', '<=', 78.5]], null, [[['c', '>', 89]]]),
  ]);
  const bar26 = { o: 93, h: 93.5, l: 70, c: 93 }; // the actual bar: sell 9 -> no 13
  assert.deepEqual(tg.map((x) => evalTrigger(x, bar26)), [true, false, false]);
  assert.deepEqual(tg.map((x) => evalTrigger(x, { ...bar26, c: 89 })), [false, true, true]); // close 89: no sell 9
  assert.deepEqual(triggersAt(series(CANCEL, CANCEL_OV), 26, { cancelOpposite: false }).slice(1).map((x) => x.unless), [null, null]);
  // TDST (cancelTDST): the buy runs of bar 14 have TDST 105; after bar 17 close[1] = 79 <= 105, so no break is possible
  assert.deepEqual(triggersAt(series(DECLINE), 18, { cancelTDST: true }).map((x) => x.unless), [null, null]);
  // a new buy Setup 9 on the next bar replaces the run under Newest (THREE after bar 29: origin 14's Combo runs at 12,
  // buy raw 8; the bar completes them on a low <= 79 / 78.5 unless its close < close[4] = 112 starts origin 30)
  const three = series(THREE);
  const n29 = triggersAt(three, 30, { originPolicy: 'Newest' }).filter((x) => x.k === 'C13' && x.f >= 2);
  assert.deepEqual(n29.map((x) => [x.f, x.o, x.unless]), [[2, 1014, [[['c', '<', 112]]]], [3, 1014, [[['c', '<', 112]]]]]);
  // Independent (default): no removal below capacity; at capacity 1 the oldest (the only) run goes
  assert.deepEqual(triggersAt(three, 30).filter((x) => x.k === 'C13' && x.f >= 2).map((x) => x.unless), [null, null]);
  assert.deepEqual(triggersAt(three, 30, { maxOrigins: 1 }).filter((x) => x.k === 'C13' && x.f >= 2).map((x) => x.unless), [[[['c', '<', 112]]], [[['c', '<', 112]]]]);
  // Keep active never replaces an active run
  assert.deepEqual(triggersAt(three, 30, { originPolicy: 'Keep active' }).filter((x) => x.k === 'C13' && x.f >= 2).map((x) => x.unless), [null, null]);
});

test('evalTrigger: all, any, unless; a bar as {o, h, l, c} or [o, h, l, c]; hl = high - low', () => {
  const t = T('C13', -1, 0, 1, [['l', '<=', 10]], [[['c', '<=', 8]], [['o', '<=', 8]]], [[['c', '>', 9], ['h', '>=', 12]]]);
  assert.equal(evalTrigger(t, { o: 9, h: 11, l: 7, c: 8 }), true);
  assert.equal(evalTrigger(t, [8, 11, 7, 9]), true); // open or close
  assert.equal(evalTrigger(t, [9, 11, 7, 9]), false); // neither
  assert.equal(evalTrigger(t, [8, 12, 7, 9.5]), false); // unless: close > 9 and high >= 12
  assert.equal(evalTrigger(t, [8, 12, 10.5, 8]), false); // low above 10
  assert.equal(evalTrigger(T('C13', 1, 3, 1, [['hl', '>=', 2]]), [1, 3, 1, 2]), true);
  assert.equal(evalTrigger(T('C13', 1, 3, 1, [['hl', '>', 2]]), [1, 3, 1, 2]), false);
  assert.equal(malformed([t]), null);
  assert.match(malformed([{ ...t, all: [['l', '<=', NaN]] }]), /all/);
  assert.match(malformed([{ ...t, any: [[['c', '<=', 8]]] }]), /any/); // a single group belongs in all
});

// ---------- every bar of the hand-made series, with many settings ----------
const SETTINGS = [
  {}, { cancelOpposite: false }, { cancelTDST: true }, { originPolicy: 'Newest' }, { originPolicy: 'Keep active' },
  { originPolicy: 'Recycle range' }, { originPolicy: 'Recycle range', recycleMin: 35, recycleMax: 36 }, { rejectSmaller: true },
  { maxOrigins: 1 }, { maxOrigins: 1, cancelTDST: true }, { restart22: true, enableAggSeq: true }, { seqFinal: 'Close', comboFinal: 'Close' },
  { seqFinal: 'Wick', comboFinal: 'Open or Close', comboRelaxed: false, aggComboRelaxed: false }, { seqQ138: false, aggQ138: false, seqQ85: true, aggQ85: true, enableAggSeq: true },
  { seqTicks: 2, comboTicks: 3, mintick: 0.25 }, { wrapSetup: false, setupNineOnly: false }, { showSetups: false }, { showRefresh: false, prefix: true },
  { enableSeq: false, enableCombo: false }, { originPolicy: 'Newest', rejectSmaller: true, cancelTDST: true },
];

test('every bar of the hand-made series: triggers from bar t-1 agree with the labels of bar t', () => {
  for (const [closes, ov] of [[DECLINE, {}], [TWO, {}], [THREE, {}], [CANCEL, CANCEL_OV]]) {
    for (const opt of SETTINGS) {
      const found = checkSeries(series(closes, ov), opt);
      assert.deepEqual(found, [], `${JSON.stringify(opt)}: ${JSON.stringify(found[0])}`);
    }
  }
});

// ---------- counterfactual next bars on random series ----------
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
const F64 = new Float64Array(1), U64 = new BigUint64Array(F64.buffer);
const nextUp = (x) => { if (x === 0) return Number.MIN_VALUE; F64[0] = x; U64[0] += x > 0 ? 1n : -1n; return F64[0]; };
const nextDown = (x) => -nextUp(-x);

// trending prices on a coarse grid, so setups run long, runs stall at 12, and ties are common
function randomSeries(R, n) {
  const int = (a, b) => a + Math.floor(R() * (b - a + 1));
  const tick = [0.25, 0.5, 1][int(0, 2)];
  const s = { o: [], h: [], l: [], c: [] };
  let p = tick * int(200, 400), drift = 0, regime = 0;
  for (let i = 0; i < n; i++) {
    if (regime-- <= 0) { regime = int(3, 30); drift = [-3, -2, -1, 0, 1, 2, 3][int(0, 6)]; }
    const o = R() < 0.7 ? p : p + tick * int(-2, 2);
    const c = Math.max(tick * 20, o + tick * (drift + int(-2, 2) * (R() < 0.5 ? 1 : 0) + (R() < 0.04 ? int(-12, 12) : 0)));
    let h = Math.max(o, c) + (R() < 0.2 ? 0 : tick * (R() < 0.08 ? int(4, 25) : int(0, 3)));
    const l = Math.max(tick, Math.min(o, c) - (R() < 0.2 ? 0 : tick * (R() < 0.08 ? int(4, 25) : int(0, 3))));
    if (R() < 0.01) h = Math.min(o, c); // a few bars with the high below the open or close, as TradingView has
    s.o.push(o); s.h.push(h); s.l.push(l); s.c.push(c);
    p = c;
  }
  s.start = Array.from({ length: n }, (_, i) => 5000 + i);
  s.n = n;
  return s;
}

// waves: legs in one direction with noise, then short sharp moves against it, so a run stalls at 12 while the next
// setup of its direction forms (the shape of TWO and THREE), which reaches the same-bar removals and the setup range
function waves(R, n) {
  const int = (a, b) => a + Math.floor(R() * (b - a + 1));
  const tick = [0.25, 0.5, 1][int(0, 2)];
  const s = { o: [], h: [], l: [], c: [] };
  let p = tick * int(400, 800), dir = R() < 0.5 ? -1 : 1;
  while (s.c.length < n) {
    if (R() < 0.15) dir = -dir;
    for (const [d, len, a, b] of [[dir, int(9, 24), 1, 3], [-dir, int(2, 7), 2, 12]]) {
      for (let k = 0; k < len && s.c.length < n; k++) {
        const o = R() < 0.75 ? p : p + tick * int(-2, 2);
        const c = Math.max(tick * 20, o + d * tick * int(a, b) + (R() < 0.3 ? tick * int(-2, 2) : 0));
        const h = Math.max(o, c) + (R() < 0.25 ? 0 : tick * (R() < 0.1 ? int(4, 30) : int(0, 3)));
        const l = Math.max(tick, Math.min(o, c) - (R() < 0.25 ? 0 : tick * (R() < 0.1 ? int(4, 30) : int(0, 3))));
        s.o.push(o); s.h.push(h); s.l.push(l); s.c.push(c);
        p = c;
      }
    }
  }
  s.start = Array.from({ length: n }, (_, i) => 5000 + i);
  s.n = n;
  return s;
}

function randomSetting(R) {
  const b = (p = 0.5) => R() < p, pick = (xs) => xs[Math.floor(R() * xs.length)], int = (a, c) => a + Math.floor(R() * (c - a + 1));
  const lo = pick([0, 25, 50, 75, 100]), hi = Math.max(lo, pick([60, 100, 150, 200, 400]));
  return {
    enableSeq: b(0.85), enableCombo: b(0.85), enableAggSeq: b(0.5), enableAggCombo: b(0.85),
    seqFinal: pick(['Close', 'Open or Close', 'Wick']), seqQ138: b(0.7), seqQ85: b(0.3), seqTicks: b(0.7) ? 0 : int(1, 3),
    comboFinal: pick(['Close', 'Open or Close', 'Wick']), comboRelaxed: b(0.5), comboTicks: b(0.7) ? 0 : int(1, 3), showRefresh: b(0.7),
    aggQ138: b(0.7), aggQ85: b(0.3), aggComboRelaxed: b(0.5),
    originPolicy: pick(['Independent', 'Keep active', 'Recycle range', 'Newest']), rejectSmaller: b(0.4),
    recycleMin: lo, recycleMax: hi, cancelOpposite: b(0.7), cancelTDST: b(0.5), restart22: b(0.4), maxOrigins: b(0.6) ? int(1, 3) : int(4, 16),
    showSetups: b(0.85), setupNineOnly: b(0.5), wrapSetup: b(0.7), prefix: b(0.3), mintick: pick([0.25, 0.5, 0.01]),
  };
}

// hypothetical next bars: open, high, low, close on the thresholds of the triggers, one float step beside them, a
// grid step beside them, or near the last close; half of them made consistent (high = max, low = min)
function candidates(R, tg, last, count) {
  const vals = { o: [], h: [], l: [], c: [], hl: [] };
  const walk = (g) => { for (const [src, , v] of g) vals[src].push(v); };
  for (const x of tg) { walk(x.all); for (const g of x.any || []) walk(g); for (const g of x.unless || []) walk(g); }
  const any = [...vals.o, ...vals.h, ...vals.l, ...vals.c];
  const near = (v) => { const r = R(); return r < 0.4 ? v : r < 0.6 ? nextUp(v) : r < 0.8 ? nextDown(v) : v + (R() < 0.5 ? -1 : 1) * [0.25, 0.5, 1][Math.floor(R() * 3)]; };
  const price = (src) => {
    const r = R();
    if (r < 0.55 && vals[src].length) return near(vals[src][Math.floor(R() * vals[src].length)]);
    if (r < 0.8 && any.length) return near(any[Math.floor(R() * any.length)]);
    return last + (Math.floor(R() * 41) - 20) * 0.5;
  };
  const out = [];
  for (let k = 0; k < count; k++) {
    let o = price('o'), h = price('h'), l = price('l'), c = price('c');
    if (vals.hl.length && R() < 0.3) h = near(l + vals.hl[Math.floor(R() * vals.hl.length)]);
    if (R() < 0.5) { const hi = Math.max(o, h, l, c), lo = Math.min(o, h, l, c); h = hi; l = lo; }
    out.push({ o, h, l, c });
  }
  return out;
}

// settings that reach the rarer removals: the setup range under Recycle range and rejectSmaller, capacity with TDST
const TARGETED = [
  { originPolicy: 'Recycle range', recycleMin: 50, recycleMax: 150 }, { originPolicy: 'Recycle range', recycleMin: 0, recycleMax: 100, rejectSmaller: true },
  { originPolicy: 'Recycle range', recycleMin: 100, recycleMax: 100 }, { originPolicy: 'Recycle range', recycleMin: 80, recycleMax: 1000, cancelTDST: true },
  { originPolicy: 'Newest', rejectSmaller: true }, { maxOrigins: 1, rejectSmaller: true }, { maxOrigins: 2, cancelTDST: true },
  { maxOrigins: 1, cancelTDST: true, rejectSmaller: true, cancelOpposite: false }, { restart22: true, originPolicy: 'Keep active', enableAggSeq: true },
];

test('counterfactual: on random series and settings, the triggers decide exactly which 9s and 13s a next bar makes', () => {
  const R = rng(20261101);
  const totals = { bars: 0, holding: 0, blocked: 0, range: 0, rangeHeld: 0, labels: 0 };
  const settings = [{}, ...SETTINGS.slice(1), ...TARGETED, ...Array.from({ length: 30 }, () => randomSetting(R))];
  for (const [k, opt] of settings.entries()) {
    const P = resolveOptions(opt);
    for (let rep = 0; rep < 4; rep++) {
      const s = rep < 2 ? randomSeries(R, 80 + Math.floor(R() * 60)) : waves(R, 120 + Math.floor(R() * 80));
      const states = [];
      runTD(s, opt, { onBar: (t, state) => states.push(state) });
      for (let n = 6; n < s.n; n++) {
        const state = states[n - 1];
        const p = head(s, n);
        const tg = nextBarTriggers(p, { state }, opt);
        const rare = tg.some((x) => x.unless);
        if (!rare && R() > (tg.length ? 0.35 : 0.03)) continue;
        const rf = tg.map((x) => x.k === 'C13' && state.runs.some((r) => r.family === x.f && r.direction === x.d && s.start[r.originBar] === x.o && r.refresh));
        assert.equal(malformed(tg), null);
        for (const bar of candidates(R, tg, s.c[n - 1], rare ? 30 : 12)) {
          const q = { o: [...p.o, bar.o], h: [...p.h, bar.h], l: [...p.l, bar.l], c: [...p.c, bar.c], start: [...p.start, 5000 + n], n: n + 1 };
          const res = runTD(q, opt);
          const labs = res.labels.slice(state.labelCount).filter((L) => L.kind === 'S' || L.kind === 'C');
          const found = compareBar(P, tg, rf, labs, bar, [res.state.buyRaw, res.state.sellRaw], q.start);
          assert.deepEqual(found, [], `setting ${k} ${JSON.stringify(opt)}, bar ${n} ${JSON.stringify(bar)}\n${JSON.stringify(tg)}`);
          totals.bars++;
          totals.labels += labs.length;
          for (const x of tg) {
            if (evalTrigger(x, bar)) totals.holding++;
            else if (x.unless && evalTrigger({ ...x, unless: null }, bar)) totals.blocked++;
            if (JSON.stringify(x).includes('"hl"')) {
              totals.range++;
              if (x.unless.some((g) => g.some((c) => c[0] === 'hl') && evalTrigger({ ...x, all: g, any: null, unless: null }, bar))) totals.rangeHeld++;
            }
          }
        }
      }
    }
  }
  // the check must have reached the rare paths: removals on the bar itself, and the setup-range conditions
  assert.ok(totals.bars > 20000 && totals.holding > 5000 && totals.labels > 5000, JSON.stringify(totals));
  assert.ok(totals.blocked > 200 && totals.range > 100 && totals.rangeHeld > 5, JSON.stringify(totals));
});
