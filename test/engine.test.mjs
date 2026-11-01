// TD Research v6 engine (dashboard/td-engine.js). Run: node --test test/
//
// The hand-made series are built so that every expected label can be derived by hand from the Pine source
// (kidze_td_research_v6.pine); the comments give the derivation. Prices are multiples of 0.5, so mirrored series
// (K - price) are exact and must give the same labels with the direction flipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBars, dayOfIso, isoOfDay } from '../dashboard/bars.js';
import { DEFAULT_MINTICK, V6_DEFAULTS, resolveOptions, runTD } from '../dashboard/td-engine.js';
import { dumpText } from '../scripts/td-dump.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- helpers ----------
// bars from closes: open = close, high = close + 0.5, low = close - 0.5, then per-bar overrides {index: {o, h, l, c}}
function series(closes, overrides = {}) {
  const s = { o: [], h: [], l: [], c: [] };
  closes.forEach((x, i) => {
    const v = { o: x, h: x + 0.5, l: x - 0.5, c: x, ...(overrides[i] || {}) };
    s.o.push(v.o); s.h.push(v.h); s.l.push(v.l); s.c.push(v.c);
  });
  return s;
}
const range = (a, b, f) => Array.from({ length: b - a + 1 }, (_, k) => f(a + k));
const slice = (s, n) => ({ o: s.o.slice(0, n), h: s.h.slice(0, n), l: s.l.slice(0, n), c: s.c.slice(0, n) });
const mirror = (s, K = 1000) => ({ o: s.o.map((x) => K - x), h: s.l.map((x) => K - x), l: s.h.map((x) => K - x), c: s.c.map((x) => K - x) });
// compact label form: "bar:kind family dir:text:extra" with dir b/s, extra = raw (S), origin (I/X) or origins (C)
const fmt = (L) => `${L.bar}:${L.kind}${L.family ?? ''}${L.dir === -1 ? 'b' : 's'}:${L.text}:${L.kind === 'S' ? L.raw : L.kind === 'C' ? L.origins.join('+') : L.origin}`;
const show = (res) => res.labels.map(fmt);
const flip = (str) => str.replace(/^(\d+:[SIXC]\d?)([bs])/, (m, a, d) => a + (d === 'b' ? 's' : 'b'));

// The five shapes below all start with six rising bars and a decline from bar 6 (close = 96 - bar), so the buy
// price flip happens at bar 6 (close[1] = 105 > close[5] = 101) and buy Setup 9 completes at bar 14.
const HEAD = range(0, 5, (b) => 100 + b);
const DROP1 = range(6, 17, (b) => 96 - b); // 90 .. 79
const DECLINE = [...HEAD, ...range(6, 40, (b) => 96 - b)]; // one long decline, 90 .. 56
// Two buy origins (bars 14 and 30) whose Combo runs stall at 12 and complete together at bar 35.
const TWO = [...HEAD, ...DROP1, 120, ...range(19, 33, (b) => 138 - b), 130, 70];
// Like TWO, but the second decline runs to raw 18 (r on the stalled first origin), then a third origin (bar 53) and a
// drop at bar 58 that completes the first and the third origin together.
const THREE = [...HEAD, ...DROP1, 120, ...range(19, 40, (b) => 138 - b), 150, ...range(42, 56, (b) => 191 - b), 160, 60];
// A buy origin at 14 with Combo runs at 12 from bar 17, then a rise to a sell Setup 9 at bar 26 whose long lower
// wick (low 70) would also complete the buy Combo 13s.
const CANCEL = [...HEAD, ...DROP1, 85, ...range(19, 26, (b) => 67 + b)];
const CANCEL_OV = { 26: { l: 70 } };

// ---------- golden case seen on the TradingView chart ----------
test('golden: CRYPTO:BTCUSD 2W, pink SELL 13x2 on the bar of 2024-12-16 with origins 2021-11-08 and 2024-01-29', () => {
  const daily = JSON.parse(readFileSync(path.join(ROOT, 'data', 'daily', 'CRYPTO_BTCUSD.json'), 'utf8'));
  const status = JSON.parse(readFileSync(path.join(ROOT, 'data', 'daily', '_status.json'), 'utf8'));
  const bars = buildBars(daily, '2W', dayOfIso(status.lastClosedDay));
  const { labels } = runTD(bars);
  const at = labels.filter((L) => isoOfDay(bars.start[L.bar]) === '2024-12-16' && L.kind === 'C');
  assert.equal(at.length, 1, `completion labels on 2024-12-16: ${JSON.stringify(at)}`);
  const L = at[0];
  assert.equal(L.text, '13x2');
  assert.equal(L.family, 3);
  assert.equal(L.dir, 1);
  assert.equal(L.size, 'large');
  assert.deepEqual(new Set(L.origins.map((b) => isoOfDay(bars.start[b]))), new Set(['2021-11-08', '2024-01-29']));
  // the two origins are actual sell Setup 9 bars
  for (const iso of ['2021-11-08', '2024-01-29']) {
    assert.ok(labels.some((S) => S.kind === 'S' && S.dir === 1 && S.raw === 9 && isoOfDay(bars.start[S.bar]) === iso), iso);
  }
});

// ---------- setups ----------
test('one long decline: 9* at raw 9, repeated display 9 at raw 18 and 27 are not origins, Combo 13 after the replay', () => {
  // Combo / Aggressive Combo: the replay at bar 14 counts bars 6..14 (1-9), then 10, 11, 12, 13 on bars 15-18.
  // Sequential counts from the Setup 9 bar itself: 1 on bar 14 .. 12 on bar 25, 13 on bar 26 (low 69.5 <= close8 75).
  assert.deepEqual(show(runTD(series(DECLINE))), [
    '14:Sb:9*:9', '18:C2b:13:14', '18:C3b:13:14', '23:Sb:9:18', '26:C0b:13:14', '32:Sb:9:27',
  ]);
  // state just after bar 23 (raw 18): still only the origin of bar 14; the anchors were not moved
  const s23 = runTD(series(DECLINE.slice(0, 24))).state;
  assert.equal(s23.buyRaw, 18);
  assert.deepEqual(s23.runs.map((r) => [r.family, r.originBar, r.n, r.refresh]), [[0, 14, 10, true]]);
  assert.deepEqual(s23.anchors.map((a) => a.originBar), [14, null, null, null, 14, null, 14, null]);
  assert.deepEqual(s23.counters, [0, 0, 0, 0]);
  // sizes: display 9 large, other setup numbers small
  const all = runTD(series(DECLINE.slice(0, 24)), { setupNineOnly: false }).labels.filter((L) => L.kind === 'S');
  assert.deepEqual(all.map((L) => L.text).join(','), '1,2,3,4,5,6,7,8,9*,1,2,3,4,5,6,7,8,9');
  assert.deepEqual([...new Set(all.map((L) => `${L.text.startsWith('9')}:${L.size}`))], ['false:small', 'true:large']);
  assert.deepEqual(runTD(series(DECLINE.slice(0, 24)), { wrapSetup: false }).labels.map(fmt), ['14:Sb:9*:9', '18:C2b:13:14', '18:C3b:13:14']);
});

test('perfection *: only on the actual raw 9, from the lows of setup bars 6-9', () => {
  // a low wick on setup bar 7 (bar 12): min(low8, low9) = 81.5 > min(low6, low7) = 70 -> plain 9
  assert.deepEqual(show(runTD(series(DECLINE.slice(0, 15), { 12: { l: 70 } }))), ['14:Sb:9:9']);
  // equality counts: min(low8, low9) = 81.5 against a setup bar 7 low of 81.5, but not 81.4
  assert.deepEqual(show(runTD(series(DECLINE.slice(0, 15), { 12: { l: 81.5 } }))), ['14:Sb:9*:9']);
  assert.deepEqual(show(runTD(series(DECLINE.slice(0, 15), { 12: { l: 81.4 } }))), ['14:Sb:9:9']);
  // sell side: max(high8, high9) >= max(high6, high7)
  assert.deepEqual(show(runTD(series(CANCEL, CANCEL_OV))).filter((x) => x.startsWith('26:S')), ['26:Ss:9*:9']);
  assert.deepEqual(show(runTD(series(CANCEL, { ...CANCEL_OV, 23: { h: 99 } }))).filter((x) => x.startsWith('26:S')), ['26:Ss:9:9']);
});

// ---------- Combo replay (lines 274-279) and line 382 ----------
test('Combo replay at Setup 9 over offsets 8..0, and the 9 bar is not counted twice', () => {
  // bar 9 closes above bar 8 (88.5 > 88), so close < close[1] fails there and the replay counts bars 6, 7, 8, 10-14
  const gap = DECLINE.slice();
  gap[9] = 88.5;
  // right after the replay: Combo n = 8 with the 9 bar processed; Sequential (not replayed) counted the 9 bar once
  const s14 = runTD(series(gap.slice(0, 15))).state;
  assert.deepEqual(s14.runs.map((r) => [r.family, r.originBar, r.setupStart, r.n, r.lastProcessed]), [[0, 14, 6, 1, 14], [2, 14, 6, 8, 14], [3, 14, 6, 8, 14]]);
  // retrospective numbers sit on the replayed bars, in replay order, Combo (family 2) before Aggressive Combo (3),
  // then the Setup label, then the main loop (Sequential's 1)
  assert.deepEqual(show(runTD(series(gap.slice(0, 16)), { showCounts: true, showBackfill: true })), [
    '6:I2b:1:14', '7:I2b:2:14', '8:I2b:3:14', '10:I2b:4:14', '11:I2b:5:14', '12:I2b:6:14', '13:I2b:7:14', '14:I2b:8:14',
    '6:I3b:1:14', '7:I3b:2:14', '8:I3b:3:14', '10:I3b:4:14', '11:I3b:5:14', '12:I3b:6:14', '13:I3b:7:14', '14:I3b:8:14',
    '14:Sb:9*:9', '14:I0b:1:14',
    '15:I3b:9:14', '15:I2b:9:14', '15:I0b:2:14', // main loop runs newest first
  ]);
  // without showBackfill only offset 0 is shown
  assert.deepEqual(show(runTD(series(gap.slice(0, 15)), { showCounts: true })), ['14:I2b:8:14', '14:I3b:8:14', '14:Sb:9*:9', '14:I0b:1:14']);
  // with 8 counted on bar 14, 13 falls on bar 19 (9 .. 13 on bars 15-19); a double count would give bar 18
  assert.deepEqual(show(runTD(series(gap))).filter((x) => x.includes(':C')), ['19:C2b:13:14', '19:C3b:13:14', '26:C0b:13:14']);
});

// ---------- cancellation (lines 339-344) ----------
test('an opposite actual Setup 9 cancels the runs before a same-bar 13', () => {
  // bar 26: sell Setup 9, and its low (70) is below the buy Combo runs' last counted close 79 / wick 78.5
  let r = runTD(series(CANCEL, CANCEL_OV));
  assert.deepEqual(show(r), ['14:Sb:9*:9', '26:Ss:9*:9']);
  assert.deepEqual(r.state.counters, [0, 0, 0, 3]);
  assert.deepEqual(r.state.anchors.map((a) => a.originBar), [null, 26, null, null, null, 26, null, 26]); // buy anchors cleared
  assert.deepEqual(r.state.runs.map((x) => [x.family, x.direction, x.originBar, x.n]), [[0, 1, 26, 1], [2, 1, 26, 9], [3, 1, 26, 9]]);
  // the marks come first (newest run first), then the Setup label
  assert.deepEqual(show(runTD(series(CANCEL, CANCEL_OV), { showCancelMarks: true })), [
    '14:Sb:9*:9', '26:X3b:x:14', '26:X2b:x:14', '26:X0b:x:14', '26:Ss:9*:9',
  ]);
  r = runTD(series(CANCEL, CANCEL_OV), { showCancelMarks: true });
  assert.ok(r.labels.filter((L) => L.kind === 'X').every((L) => L.size === 'tiny'));
  // without the cancellation both buy Combo families complete on that bar (Wick final for Combo)
  assert.deepEqual(show(runTD(series(CANCEL, CANCEL_OV), { cancelOpposite: false })), [
    '14:Sb:9*:9', '26:Ss:9*:9', '26:C2b:13:14', '26:C3b:13:14',
  ]);
});

// ---------- 13xN, r and deferrals ----------
test('13xN aggregates the same family and direction on one bar; each family keeps its own label', () => {
  // Sequential (origin 14) completes at 28; both Combo families of origins 14 and 30 stall at 12 and complete on bar 35
  const r = runTD(series(TWO));
  assert.deepEqual(show(r), ['14:Sb:9*:9', '28:C0b:13:14', '30:Sb:9*:9', '35:C2b:13x2:30+14', '35:C3b:13x2:30+14']);
  assert.ok(r.labels.filter((L) => L.kind === 'C').every((L) => L.size === 'large'));
  assert.deepEqual(r.state.runs.map((x) => [x.family, x.originBar, x.n]), [[0, 30, 5]]);
  // prefix
  assert.deepEqual(runTD(series(TWO), { prefix: true }).labels.filter((L) => L.kind === 'C').map((L) => L.text), ['S 13', 'C 13x2', 'AC* 13x2']);
});

test('r: a same-direction raw 18+ while the run is active; 13rx2 when at least one of the origins has it', () => {
  // origin 14 (Combo at 12 from bar 17, last counted close 79) stays active while the second decline reaches raw 18
  // (bar 39): its runs get r. Origin 30 completes at 34 (raw 13 then: no r). Origin 53 (chain of raw 12) and origin 14
  // complete together at bar 58.
  // Sequential origin 30: count 12 at bar 43; 13 qualifies on price at 44-56 but its low stays above close8 (101), so it
  // is deferred (+13) on each of those bars; shown only while origin 30 is the newest Sequential origin (until 53).
  const expected = [
    '14:Sb:9*:9', '28:C0b:13:14', '30:Sb:9*:9', '34:C2b:13:30', '34:C3b:13:30', '39:Sb:9:18',
    ...range(44, 52, (b) => `${b}:I0b:+13:30`),
    '53:Sb:9*:9', '58:C0b:13:30', '58:C2b:13rx2:53+14', '58:C3b:13rx2:53+14',
  ];
  const r = runTD(series(THREE));
  assert.deepEqual(show(r), expected);
  assert.ok(r.labels.filter((L) => L.kind === 'I').every((L) => L.size === 'tiny'));
  // newestCountsOnly off: the deferrals of origin 30 after origin 53 was adopted show too
  assert.deepEqual(show(runTD(series(THREE), { newestCountsOnly: false })),
    [...expected.slice(0, 16), ...range(53, 56, (b) => `${b}:I0b:+13:30`), ...expected.slice(16)]);
  // deferrals hidden
  assert.deepEqual(show(runTD(series(THREE), { showDeferred: false })), expected.filter((x) => !x.includes('+13')));
  // the annotation can be switched off; prefix goes first
  assert.deepEqual(runTD(series(THREE), { showRefresh: false }).labels.filter((L) => L.kind === 'C').map((L) => L.text), ['13', '13', '13', '13', '13x2', '13x2']);
  assert.deepEqual(runTD(series(THREE), { prefix: true }).labels.filter((L) => L.bar === 58).map((L) => L.text), ['S 13', 'C 13rx2', 'AC* 13rx2']);
  // a run that completed alone after raw 18 shows 13r
  const single = runTD(series([...THREE.slice(0, 41), 70]));
  assert.deepEqual(show(single).filter((x) => x.includes(':C')), ['28:C0b:13:14', '34:C2b:13:30', '34:C3b:13:30', '41:C2b:13r:14', '41:C3b:13r:14']);
});

// ---------- origins ----------
test('maxOrigins: at capacity the oldest active origin of that family/direction is removed', () => {
  const r = runTD(series(TWO), { maxOrigins: 1 });
  // at bar 30 the Sequential origin 14 had already completed (bar 28); both Combo runs of origin 14 are dropped
  assert.deepEqual(show(r), ['14:Sb:9*:9', '28:C0b:13:14', '30:Sb:9*:9', '35:C2b:13:30', '35:C3b:13:30']);
  assert.deepEqual(r.state.counters, [2, 0, 0, 0]);
});

test('origin policies, small-setup rejection', () => {
  const C35 = (res) => show(res).filter((x) => x.startsWith('35:'));
  // Newest: the new origin replaces the active one (counted as cancellations)
  let r = runTD(series(TWO), { originPolicy: 'Newest' });
  assert.deepEqual(C35(r), ['35:C2b:13:30', '35:C3b:13:30']);
  assert.deepEqual(r.state.counters, [0, 0, 0, 2]);
  // Keep active: origin 30 is not adopted by the Combo families (their origin 14 is active); Sequential has none active
  r = runTD(series(TWO), { originPolicy: 'Keep active' });
  assert.deepEqual(C35(r), ['35:C2b:13:14', '35:C3b:13:14']);
  assert.deepEqual(r.state.counters, [0, 0, 2, 0]);
  assert.deepEqual(r.state.anchors.map((a) => a.originBar), [30, null, null, null, 14, null, 14, null]);
  // Recycle range: new first-9 true range 117 - 107.5 = 9.5 vs origin 14's extended 105 - 78.5 = 26.5 -> 35.8 %
  r = runTD(series(TWO), { originPolicy: 'Recycle range' });
  assert.deepEqual(C35(r), ['35:C2b:13:14', '35:C3b:13:14']);
  assert.deepEqual(r.state.counters, [0, 0, 2, 0]);
  r = runTD(series(TWO), { originPolicy: 'Recycle range', recycleMin: 35, recycleMax: 36 });
  assert.deepEqual(C35(r), ['35:C2b:13:30', '35:C3b:13:30']);
  assert.deepEqual(r.state.counters, [0, 0, 0, 2]);
  // the adopted reference then keeps extending while that setup runs (to raw 12 on bar 33, true low 104.5)
  assert.deepEqual([r.state.anchors[4].originBar, r.state.anchors[4].hi, r.state.anchors[4].lo], [30, 117, 104.5]);
  // Reject a smaller new Setup 9: applies to every family, even after the Sequential 13
  r = runTD(series(TWO), { rejectSmaller: true });
  assert.deepEqual(show(r), ['14:Sb:9*:9', '28:C0b:13:14', '30:Sb:9*:9', '35:C2b:13:14', '35:C3b:13:14']);
  assert.deepEqual(r.state.counters, [0, 3, 0, 0]);
  assert.deepEqual(r.state.anchors.map((a) => [a.originBar, a.hi, a.lo]).filter((a, i) => i % 2 === 0), [[14, 105, 78.5], [null, null, null], [14, 105, 78.5], [14, 105, 78.5]]);
  assert.throws(() => runTD(series(TWO), { recycleMin: 150, recycleMax: 120 }), /Recycle minimum/);
});

test('TDST cancellation: a buy run is removed when the true low rises above its Setup 9 true high', () => {
  // origin 14: TDST = 105 (true high of the setup); bar 19 true low = min(118.5, 120) > 105
  const r = runTD(series(TWO), { cancelTDST: true, showCancelMarks: true });
  assert.deepEqual(show(r), ['14:Sb:9*:9', '19:X3b:x:14', '19:X2b:x:14', '19:X0b:x:14', '30:Sb:9*:9', '35:C2b:13:30', '35:C3b:13:30']);
  assert.deepEqual(r.state.counters, [0, 0, 0, 3]);
  assert.deepEqual(r.state.runs.map((x) => [x.family, x.originBar, x.tdst]), [[0, 30, 117]]);
});

test('raw 22 restart (Sequential families only) and the Aggressive Sequential family', () => {
  // raw 22 at bar 27: a new Sequential run counts from that bar (1 on 27 .. 13 on 39; close8 62 >= low 56.5)
  let r = runTD(series(DECLINE), { restart22: true });
  assert.deepEqual(show(r), ['14:Sb:9*:9', '18:C2b:13:14', '18:C3b:13:14', '23:Sb:9:18', '26:C0b:13:14', '32:Sb:9:27', '39:C0b:13:27']);
  assert.deepEqual(r.state.anchors[0], { chainStart: 6, hi: 105, lo: 55.5, tdst: 105, originBar: 27 });
  // Aggressive Sequential: lows instead of closes; completes with Sequential on bar 26, in slot order
  r = runTD(series(DECLINE), { enableAggSeq: true });
  assert.deepEqual(show(r).filter((x) => x.includes(':C')), ['18:C2b:13:14', '18:C3b:13:14', '26:C0b:13:14', '26:C1b:13:14']);
  // families off
  assert.deepEqual(show(runTD(series(DECLINE), { enableCombo: false, enableAggCombo: false })), ['14:Sb:9*:9', '23:Sb:9:18', '26:C0b:13:14', '32:Sb:9:27']);
  assert.deepEqual(show(runTD(series(DECLINE), { showSetups: false })), ['18:C2b:13:14', '18:C3b:13:14', '26:C0b:13:14']);
});

test('Sequential final 13: Open or Close, tolerance in ticks', () => {
  // bar 26 closes at 72 (low[2] = 71.5): the 13 waits for bar 27 ...
  const s = series(DECLINE, { 26: { o: 72, h: 72.5, l: 71.5, c: 72 } });
  assert.deepEqual(show(runTD(s)).filter((x) => x.includes(':C0')), ['27:C0b:13:14']);
  // ... unless 2 ticks of 0.25 are allowed (72 <= 71.5 + 0.5)
  assert.deepEqual(show(runTD(s, { seqTicks: 2, mintick: 0.25 })).filter((x) => x.includes(':C0')), ['26:C0b:13:14']);
  // Open or Close (default) accepts an open at or below low[2]; Close does not
  const so = series(DECLINE, { 26: { o: 71.5, h: 72.5, l: 71.5, c: 72 } });
  assert.deepEqual(show(runTD(so)).filter((x) => x.includes(':C0')), ['26:C0b:13:14']);
  assert.deepEqual(show(runTD(so, { seqFinal: 'Close' })).filter((x) => x.includes(':C0')), ['27:C0b:13:14']);
  assert.deepEqual(show(runTD(s, { seqFinal: 'Wick' })).filter((x) => x.includes(':C0')), ['26:C0b:13:14']);
});

// ---------- symmetry, FIFO, options, dump ----------
test('mirrored prices give the same labels with buy and sell swapped', () => {
  const cases = [[DECLINE, {}, {}], [TWO, {}, {}], [THREE, {}, {}], [CANCEL, CANCEL_OV, {}], [CANCEL, CANCEL_OV, { cancelOpposite: false, showCancelMarks: true }],
    [TWO, {}, { cancelTDST: true, showCancelMarks: true }], [TWO, {}, { rejectSmaller: true }], [DECLINE, {}, { restart22: true, enableAggSeq: true, showCounts: true, showBackfill: true }]];
  for (const [closes, ov, opt] of cases) {
    const s = series(closes, ov);
    assert.deepEqual(show(runTD(mirror(s), opt)), show(runTD(s, opt)).map(flip));
  }
});

test('chartVisibleFrom: the labelLimit FIFO keeps the newest labels on the chart', () => {
  const long = [...HEAD, ...range(6, 120, (b) => 200 - b)];
  const r = runTD(series(long), { setupNineOnly: false, labelLimit: 50 });
  assert.ok(r.labels.length > 50);
  assert.equal(r.chartVisibleFrom, r.labels.length - 50);
  assert.equal(r.state.labelCount, r.labels.length);
  assert.equal(runTD(series(long)).chartVisibleFrom, 0);
});

test('options: script defaults, unknown names and out-of-range values are refused', () => {
  assert.ok(Object.isFrozen(V6_DEFAULTS));
  assert.equal(V6_DEFAULTS.seqFinal, 'Open or Close');
  assert.equal(V6_DEFAULTS.comboFinal, 'Wick');
  assert.equal(V6_DEFAULTS.originPolicy, 'Independent');
  assert.equal(V6_DEFAULTS.maxOrigins, 8);
  assert.equal(V6_DEFAULTS.labelLimit, 400);
  assert.equal(V6_DEFAULTS.enableAggSeq, false);
  assert.equal(resolveOptions({}).mintick, DEFAULT_MINTICK);
  assert.equal(resolveOptions({ mintick: 1e-8 }).mintick, 1e-8);
  for (const bad of [{ foo: 1 }, { seqFinal: 'close' }, { maxOrigins: 0 }, { maxOrigins: 2.5 }, { labelLimit: 481 }, { enableSeq: 1 }, { mintick: 0 }, { recycleMin: -1 }]) {
    assert.throws(() => runTD(series(DECLINE), bad), /TD option/, JSON.stringify(bad));
  }
  // too few bars: nothing happens before bar_index 5 / before a 9 is possible
  assert.deepEqual(runTD(series([])).labels, []);
  assert.deepEqual(runTD(series(DECLINE.slice(0, 14))).labels, []);
});

test('dump format: zero bars, labels and end state', () => {
  const empty = buildBars({ d0: 20000, o: [], h: [], l: [], c: [] }, '1W', 20010);
  assert.equal(dumpText(empty, runTD(empty)), 'B\t0\tda39a3ee5e6b4b0d3255bfef95601890afd80709\nE\t0\t0\t\n');
  // the long decline as daily bars from 2025-01-01, 1D
  const s = series(DECLINE);
  const d0 = dayOfIso('2025-01-01');
  const bars = buildBars({ d0, ...s }, '1D', d0 + 30); // bars 0..30 confirmed
  const text = dumpText(bars, runTD(bars));
  const lines = text.split('\n');
  assert.equal(lines[0].split('\t')[1], '31');
  assert.deepEqual(lines.slice(1, -2), [
    'L\t2025-01-15\tS\t-1\t-\t9*\t9', 'L\t2025-01-19\tC\t-1\t2\t13\t2025-01-15', 'L\t2025-01-19\tC\t-1\t3\t13\t2025-01-15',
    'L\t2025-01-24\tS\t-1\t-\t9\t18', 'L\t2025-01-27\tC\t-1\t0\t13\t2025-01-15',
  ]);
  assert.equal(lines.at(-2), 'E\t25\t0\t');
  assert.equal(lines.at(-1), '');
});
