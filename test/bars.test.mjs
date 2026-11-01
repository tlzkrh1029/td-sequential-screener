// Timeframe bucketing and bar building (dashboard/bars.js). Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { TFS, bucketFn, buildBars, dayOfIso, fileIdOf, isoOfDay, keyFn } from '../dashboard/bars.js';

const D = dayOfIso;
const bucket = (tf, iso) => { const [s, e] = bucketFn(tf)(D(iso), [0, 0]); return [isoOfDay(s), isoOfDay(e)]; };

test('TFS: the 20 timeframes of the WMA screener', () => {
  assert.deepEqual([...TFS], ['1D', '2D', '3D', '4D', '5D', '6D', '1W', '8D', '9D', '10D', '2W', '3W',
    '1M', '2M', '3M', '4M', '6M', '8M', '10M', '12M']);
});

test('bucketFn gives exactly the buckets of keyFn, day by day, 2000-2040', () => {
  const from = D('2000-01-01'), to = D('2040-12-31'), out = [0, 0];
  for (const tf of TFS) {
    const key = keyFn(tf), bounds = bucketFn(tf);
    let prevKey = key(from - 1), start = null;
    for (let d = from; d <= to; d++) {
      const k = key(d);
      if (k !== prevKey) {
        assert.ok(prevKey < k, `${tf}: keys must increase (${isoOfDay(d)})`);
        start = d;
      }
      bounds(d, out);
      if (start !== null) assert.equal(out[0], start, `${tf} ${isoOfDay(d)}: start`);
      assert.equal(key(out[0]), k, `${tf} ${isoOfDay(d)}: start day in the same bucket`);
      assert.equal(key(out[1]), k, `${tf} ${isoOfDay(d)}: end day in the same bucket`);
      assert.notEqual(key(out[0] - 1), k, `${tf} ${isoOfDay(d)}: day before start is another bucket`);
      assert.notEqual(key(out[1] + 1), k, `${tf} ${isoOfDay(d)}: day after end is another bucket`);
      prevKey = k;
    }
  }
});

test('1W: Monday to Sunday, across the year boundary', () => {
  assert.deepEqual(bucket('1W', '2025-01-01'), ['2024-12-30', '2025-01-05']); // Wednesday
  assert.deepEqual(bucket('1W', '2024-12-29'), ['2024-12-23', '2024-12-29']); // Sunday
  assert.deepEqual(bucket('1W', '2025-01-06'), ['2025-01-06', '2025-01-12']); // Monday
});

test('2W: days before the first Monday of a year finish the previous year\'s cycle', () => {
  // 2024 starts on a Monday; the 2024 cycle runs 53 weeks to 2025-01-05, so its last 2W bucket has one week
  assert.deepEqual(bucket('2W', '2024-01-01'), ['2024-01-01', '2024-01-14']);
  assert.deepEqual(bucket('2W', '2024-12-20'), ['2024-12-16', '2024-12-29']); // the golden-case bar
  assert.deepEqual(bucket('2W', '2025-01-03'), ['2024-12-30', '2025-01-05']);
  assert.deepEqual(bucket('2W', '2025-01-06'), ['2025-01-06', '2025-01-19']); // first Monday of 2025
  // 2026 starts on a Thursday: 2026-01-01..04 stay in the 2025 cycle (52 weeks, 26 full buckets)
  assert.deepEqual(bucket('2W', '2026-01-02'), ['2025-12-22', '2026-01-04']);
  assert.deepEqual(bucket('2W', '2026-01-05'), ['2026-01-05', '2026-01-18']);
});

test('3W: cycle restart at the first Monday, short last bucket', () => {
  // 2024 cycle: 53 weeks = 17 buckets of 3 weeks + one of 2 weeks
  assert.deepEqual(bucket('3W', '2024-12-23'), ['2024-12-23', '2025-01-05']);
  assert.deepEqual(bucket('3W', '2025-01-05'), ['2024-12-23', '2025-01-05']);
  assert.deepEqual(bucket('3W', '2025-01-06'), ['2025-01-06', '2025-01-26']);
});

test('nD restarts every January 1st; nM every January', () => {
  assert.deepEqual(bucket('4D', '2009-12-31'), ['2009-12-31', '2009-12-31']); // as on TradingView's 4D chart
  assert.deepEqual(bucket('4D', '2010-01-02'), ['2010-01-01', '2010-01-04']);
  assert.deepEqual(bucket('2D', '2009-10-05'), ['2009-10-04', '2009-10-05']); // BTC's first 2D bar starts before its first day
  assert.deepEqual(bucket('2M', '2024-12-31'), ['2024-11-01', '2024-12-31']);
  assert.deepEqual(bucket('2M', '2025-01-01'), ['2025-01-01', '2025-02-28']);
  assert.deepEqual(bucket('2M', '2024-02-29'), ['2024-01-01', '2024-02-29']);
  assert.deepEqual(bucket('8M', '2025-10-31'), ['2025-09-01', '2025-12-31']);
  assert.deepEqual(bucket('10M', '2025-11-01'), ['2025-11-01', '2025-12-31']);
  assert.deepEqual(bucket('12M', '2025-06-15'), ['2025-01-01', '2025-12-31']);
});

// daily series helper: {iso: [o, h, l, c]} -> {d0, o, h, l, c} with nulls on the days not given
function daily(fromIso, toIso, rows) {
  const d0 = D(fromIso), n = D(toIso) - d0 + 1, out = { d0, o: [], h: [], l: [], c: [] };
  for (let i = 0; i < n; i++) {
    const r = rows[isoOfDay(d0 + i)];
    out.o.push(r ? r[0] : null); out.h.push(r ? r[1] : null); out.l.push(r ? r[2] : null); out.c.push(r ? r[3] : null);
  }
  return out;
}
const isoBars = (b) => Array.from({ length: b.n }, (_, i) => [isoOfDay(b.start[i]), isoOfDay(b.end[i]), isoOfDay(b.first[i]), isoOfDay(b.last[i]), b.o[i], b.h[i], b.l[i], b.c[i]]);

test('buildBars: OHLC aggregation, gaps are skipped, a bucket without a daily bar is not a bar', () => {
  const rows = {};
  // 2024-12-26 .. 2025-01-05 every day, nothing 2025-01-06 .. 01-12, then 2025-01-15 and 01-17 only
  let k = 0;
  for (let d = D('2024-12-26'); d <= D('2025-01-05'); d++, k++) rows[isoOfDay(d)] = [10 + k, 20 + k, 5 + k, 11 + k];
  rows['2025-01-15'] = [50, 60, 40, 55];
  rows['2025-01-17'] = [56, 70, 45, 52];
  const data = daily('2024-12-26', '2025-01-17', rows);
  const last = D('2025-01-31'); // everything closed

  assert.deepEqual(isoBars(buildBars(data, '1W', last)), [
    ['2024-12-23', '2024-12-29', '2024-12-26', '2024-12-29', 10, 23, 5, 14],
    ['2024-12-30', '2025-01-05', '2024-12-30', '2025-01-05', 14, 30, 9, 21],
    // no bar for 2025-01-06 .. 01-12
    ['2025-01-13', '2025-01-19', '2025-01-15', '2025-01-17', 50, 70, 40, 52],
  ]);
  assert.deepEqual(isoBars(buildBars(data, '2W', last)), [
    ['2024-12-16', '2024-12-29', '2024-12-26', '2024-12-29', 10, 23, 5, 14],
    ['2024-12-30', '2025-01-05', '2024-12-30', '2025-01-05', 14, 30, 9, 21], // one-week bucket ending the 2024 cycle
    ['2025-01-06', '2025-01-19', '2025-01-15', '2025-01-17', 50, 70, 40, 52], // starts on its bucket's first day
  ]);
  assert.deepEqual(isoBars(buildBars(data, '1M', last)), [
    ['2024-12-01', '2024-12-31', '2024-12-26', '2024-12-31', 10, 25, 5, 16],
    ['2025-01-01', '2025-01-31', '2025-01-01', '2025-01-17', 16, 70, 11, 52],
  ]);
  const d1 = buildBars(data, '1D', last);
  assert.equal(d1.n, 11 + 2); // days without a daily bar are not bars
  assert.deepEqual(isoBars(d1).slice(-2).map((b) => b[0]), ['2025-01-15', '2025-01-17']);
});

test('buildBars: only confirmed bars go to the arrays; the bucket in progress is `partial`', () => {
  const rows = {};
  for (let d = D('2025-12-29'); d <= D('2026-01-07'); d++) rows[isoOfDay(d)] = [1, 2, 0.5, 1.5];
  const data = daily('2025-12-29', '2026-01-07', rows);
  // 1W bucket 2026-01-05 .. 01-11 still open on 2026-01-07
  let b = buildBars(data, '1W', D('2026-01-07'));
  assert.equal(b.n, 1);
  assert.equal(isoOfDay(b.start[0]), '2025-12-29');
  assert.deepEqual([isoOfDay(b.partial.start), isoOfDay(b.partial.end), isoOfDay(b.partial.first), isoOfDay(b.partial.last)],
    ['2026-01-05', '2026-01-11', '2026-01-05', '2026-01-07']);
  // a bucket whose last calendar day is the last closed day is confirmed
  b = buildBars(data, '1W', D('2026-01-04'));
  assert.equal(b.n, 1);
  assert.equal(b.partial, null); // data after lastClosedDay is ignored
  // 1M: December closed, January in progress
  b = buildBars(data, '1M', D('2026-01-07'));
  assert.deepEqual(isoBars(b).map((x) => x[0]), ['2025-12-01']);
  assert.equal(isoOfDay(b.partial.start), '2026-01-01');
  // nothing closed yet
  b = buildBars(data, '1M', D('2025-12-30'));
  assert.equal(b.n, 0);
  assert.equal(isoOfDay(b.partial.last), '2025-12-30');
  assert.throws(() => buildBars(data, '7D', D('2026-01-07')), /unknown timeframe/);
  assert.throws(() => buildBars(data, '1W', '2026-01-07'), /unix day/);
});

test('fileIdOf: runs of other characters become one underscore', () => {
  assert.equal(fileIdOf('CRYPTO:BTCUSD'), 'CRYPTO_BTCUSD');
  assert.equal(fileIdOf('CRYPTOCAP:BTC.D'), 'CRYPTOCAP_BTC.D');
  assert.equal(fileIdOf('A::B-C'), 'A_B_C');
});

// TradingView's own 1M bars (m): month timeframes are aggregated from them, everything else from the daily bars
test('buildBars: month timeframes come from TradingView\'s 1M bars when the file has them', () => {
  const rows = {};
  let k = 0;
  for (let d = D('2024-12-26'); d <= D('2025-03-10'); d++, k++) rows[isoOfDay(d)] = [10 + k, 20 + k, 5 + k, 11 + k];
  const data = daily('2024-12-26', '2025-03-10', rows); // day k from 2024-12-26: [10 + k, 20 + k, 5 + k, 11 + k]
  const last = D('2025-03-10'); // March in progress (k 65 .. 74)
  // like CRYPTO:HUNTUSD 2026-10: TradingView's January bar has other prices than the daily bars (they reach 56)
  data.m = {
    d: [D('2024-10-01'), D('2024-12-01'), D('2025-01-01'), D('2025-02-01')], // October has no daily bar at all
    o: [1, 10, 16.5, 47], h: [2, 25, 40, 75], l: [0.5, 5, 11, 42], c: [1.5, 16, 46.5, 74],
  };
  const isoB = (b) => isoBars(b).map((x) => x.join(' '));
  // 1M: the 1M bars themselves; first/last = their months' first days; March (in progress) still from the daily bars
  let b = buildBars(data, '1M', last);
  assert.deepEqual(isoB(b), [
    '2024-10-01 2024-10-31 2024-10-01 2024-10-01 1 2 0.5 1.5',
    '2024-12-01 2024-12-31 2024-12-01 2024-12-01 10 25 5 16',
    '2025-01-01 2025-01-31 2025-01-01 2025-01-01 16.5 40 11 46.5',
    '2025-02-01 2025-02-28 2025-02-01 2025-02-01 47 75 42 74',
  ]);
  assert.deepEqual([isoOfDay(b.partial.start), isoOfDay(b.partial.first), isoOfDay(b.partial.last), b.partial.o, b.partial.c], ['2025-03-01', '2025-03-01', '2025-03-10', 75, 85]);
  // 2M and 3M: aggregates of the 1M bars of each bucket; the bucket in progress is not a confirmed bar
  b = buildBars(data, '2M', last);
  assert.deepEqual(isoB(b), [
    '2024-09-01 2024-10-31 2024-10-01 2024-10-01 1 2 0.5 1.5',
    '2024-11-01 2024-12-31 2024-12-01 2024-12-01 10 25 5 16',
    '2025-01-01 2025-02-28 2025-01-01 2025-02-01 16.5 75 11 74',
  ]);
  assert.equal(isoOfDay(b.partial.start), '2025-03-01');
  b = buildBars(data, '3M', last);
  assert.deepEqual(isoB(b), ['2024-10-01 2024-12-31 2024-10-01 2024-12-01 1 25 0.5 16']);
  assert.equal(isoOfDay(b.partial.start), '2025-01-01');
  // once March has closed, the 1M bars still decide: no 1M bar for March means no March bar
  b = buildBars(data, '1M', D('2025-03-31'));
  assert.equal(b.n, 4);
  assert.equal(b.partial, null);
  // day and week timeframes ignore m
  assert.deepEqual(isoBars(buildBars(data, '1W', last)), isoBars(buildBars({ ...data, m: undefined }, '1W', last)));
  assert.deepEqual(isoBars(buildBars(data, '10D', last)), isoBars(buildBars({ ...data, m: undefined }, '10D', last)));
  // without m the month timeframes are rebuilt from the daily bars, as before
  assert.deepEqual(isoB(buildBars({ ...data, m: undefined }, '1M', last)).slice(1), [
    '2025-01-01 2025-01-31 2025-01-01 2025-01-31 16 56 11 47',
    '2025-02-01 2025-02-28 2025-02-01 2025-02-28 47 84 42 75',
  ]);
  // malformed 1M bars are refused
  for (const bad of [{ ...data.m, d: [D('2024-10-02'), ...data.m.d.slice(1)] }, { ...data.m, d: [data.m.d[1], data.m.d[0], ...data.m.d.slice(2)] },
    { ...data.m, c: data.m.c.slice(1) }, { ...data.m, h: [null, ...data.m.h.slice(1)] }]) {
    assert.throws(() => buildBars({ ...data, m: bad }, '1M', last), /1M bar|same length/);
  }
});

// TradingView's own 1W bars (w): week timeframes are aggregated from them, like month timeframes from m
test('buildBars: week timeframes come from TradingView\'s 1W bars when the file has them', () => {
  const rows = {};
  let k = 0;
  for (let d = D('2024-12-26'); d <= D('2025-02-12'); d++, k++) rows[isoOfDay(d)] = [10 + k, 20 + k, 5 + k, 11 + k];
  const data = daily('2024-12-26', '2025-02-12', rows); // day k from 2024-12-26: [10 + k, 20 + k, 5 + k, 11 + k]
  const last = D('2025-02-12'); // Wednesday: the week of 2025-02-10 is in progress (k 46 .. 48)
  data.w = {
    // the week of 2024-12-09 has no daily bar at all; 12-30 and 01-27 differ from the daily bars (like CRYPTO:HUNTUSD's
    // open week of 2026-10-26); the week of 01-20 has daily bars but no 1W bar
    d: ['2024-12-09', '2024-12-23', '2024-12-30', '2025-01-06', '2025-01-13', '2025-01-27', '2025-02-03'].map(D),
    o: [1, 10, 14, 21, 28, 42, 49], h: [2, 23, 33, 37, 44, 58, 65], l: [0.5, 5, 8.5, 16, 23, 37, 44], c: [1.5, 14, 21, 28, 35, 49.5, 56],
  };
  const isoB = (b) => isoBars(b).map((x) => x.join(' '));
  const part = (b) => [isoOfDay(b.partial.start), isoOfDay(b.partial.end), isoOfDay(b.partial.first), isoOfDay(b.partial.last), b.partial.o, b.partial.h, b.partial.l, b.partial.c].join(' ');
  // 1W: the 1W bars themselves; first/last = their Mondays; the week in progress still from the daily bars
  let b = buildBars(data, '1W', last);
  assert.deepEqual(isoB(b), [
    '2024-12-09 2024-12-15 2024-12-09 2024-12-09 1 2 0.5 1.5',
    '2024-12-23 2024-12-29 2024-12-23 2024-12-23 10 23 5 14',
    '2024-12-30 2025-01-05 2024-12-30 2024-12-30 14 33 8.5 21',
    '2025-01-06 2025-01-12 2025-01-06 2025-01-06 21 37 16 28',
    '2025-01-13 2025-01-19 2025-01-13 2025-01-13 28 44 23 35',
    '2025-01-27 2025-02-02 2025-01-27 2025-01-27 42 58 37 49.5',
    '2025-02-03 2025-02-09 2025-02-03 2025-02-03 49 65 44 56',
  ]);
  assert.equal(part(b), '2025-02-10 2025-02-16 2025-02-10 2025-02-12 56 68 51 59');
  // 2W and 3W: aggregates of the 1W bars of each bucket (cycles restart at the first Monday of the year; the 2024 cycle
  // ends with a one-week 2W and a two-week 3W bucket); the bucket in progress is not a confirmed bar
  b = buildBars(data, '2W', last);
  assert.deepEqual(isoB(b), [
    '2024-12-02 2024-12-15 2024-12-09 2024-12-09 1 2 0.5 1.5',
    '2024-12-16 2024-12-29 2024-12-23 2024-12-23 10 23 5 14',
    '2024-12-30 2025-01-05 2024-12-30 2024-12-30 14 33 8.5 21',
    '2025-01-06 2025-01-19 2025-01-06 2025-01-13 21 44 16 35',
    '2025-01-20 2025-02-02 2025-01-27 2025-01-27 42 58 37 49.5', // only the 1W bar of 01-27
  ]);
  assert.equal(part(b), '2025-02-03 2025-02-16 2025-02-03 2025-02-12 49 68 44 59');
  b = buildBars(data, '3W', last);
  assert.deepEqual(isoB(b), [
    '2024-12-02 2024-12-22 2024-12-09 2024-12-09 1 2 0.5 1.5',
    '2024-12-23 2025-01-05 2024-12-23 2024-12-30 10 33 5 21',
    '2025-01-06 2025-01-26 2025-01-06 2025-01-13 21 44 16 35',
  ]);
  assert.equal(part(b), '2025-01-27 2025-02-16 2025-01-27 2025-02-12 42 68 37 59');
  // once the week of 02-10 has closed, the 1W bars still decide: no 1W bar for it means no bar
  b = buildBars(data, '1W', D('2025-02-16'));
  assert.equal(b.n, 7);
  assert.equal(b.partial, null);
  // day and month timeframes ignore w
  for (const tf of ['1D', '10D', '1M', '2M']) assert.deepEqual(isoBars(buildBars(data, tf, last)), isoBars(buildBars({ ...data, w: undefined }, tf, last)), tf);
  // with both m and w, each serves its own timeframes
  const both = { ...data, m: { d: [D('2025-01-01')], o: [7], h: [8], l: [6], c: [7.5] } };
  assert.deepEqual(isoB(buildBars(both, '1W', last)), isoB(buildBars(data, '1W', last)));
  assert.deepEqual(isoB(buildBars(both, '1M', last)), ['2025-01-01 2025-01-31 2025-01-01 2025-01-01 7 8 6 7.5']);
  // without w the week timeframes are rebuilt from the daily bars, as before
  assert.deepEqual(isoB(buildBars({ ...data, w: undefined }, '1W', last)), [
    '2024-12-23 2024-12-29 2024-12-26 2024-12-29 10 23 5 14',
    '2024-12-30 2025-01-05 2024-12-30 2025-01-05 14 30 9 21',
    '2025-01-06 2025-01-12 2025-01-06 2025-01-12 21 37 16 28',
    '2025-01-13 2025-01-19 2025-01-13 2025-01-19 28 44 23 35',
    '2025-01-20 2025-01-26 2025-01-20 2025-01-26 35 51 30 42',
    '2025-01-27 2025-02-02 2025-01-27 2025-02-02 42 58 37 49',
    '2025-02-03 2025-02-09 2025-02-03 2025-02-09 49 65 44 56',
  ]);
  // malformed 1W bars are refused
  for (const bad of [{ ...data.w, d: [D('2024-12-10'), ...data.w.d.slice(1)] }, { ...data.w, d: [data.w.d[1], data.w.d[0], ...data.w.d.slice(2)] },
    { ...data.w, c: data.w.c.slice(1) }, { ...data.w, h: [null, ...data.w.h.slice(1)] }]) {
    assert.throws(() => buildBars({ ...data, w: bad }, '2W', last), /1W bar|same length/);
  }
});
