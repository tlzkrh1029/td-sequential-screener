// The checks scripts/fetch-tv.mjs applies to TradingView's bars before writing a data file. Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TV_SYMBOLS ||= 'TEST:XUSD'; // import the module without reading data/tickers.json
const { toDaily, toMonthly, toWeekly, monthsVsDaily, weeksVsDaily, barRevisions } = await import('../scripts/fetch-tv.mjs');

const DAY = 86400;
const t = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const day = (iso) => t(iso) / DAY;

test('toMonthly: 1M bars of the closed months; the month in progress is dropped', () => {
  const bars = new Map([
    [t('2025-01-01'), [1, 2, 0.5, 1.5]],
    [t('2025-03-01'), [3, 4, 2.5, 3.5]], // no February bar: a gap stays a gap
    [t('2025-04-01'), [4, 5, 3.5, 4.5]],
  ]);
  // cutoff = first day not written: on 2025-04-30 April is still in progress
  assert.deepEqual(toMonthly(bars, day('2025-04-30')), { d: [day('2025-01-01'), day('2025-03-01')], o: [1, 3], h: [2, 4], l: [0.5, 2.5], c: [1.5, 3.5] });
  // on 2025-05-01 April has closed
  assert.equal(toMonthly(bars, day('2025-05-01')).d.length, 3);
  assert.throws(() => toMonthly(new Map([[t('2025-01-02'), [1, 2, 0.5, 1.5]]]), day('2025-05-01')), /1st of a month/);
  assert.throws(() => toMonthly(new Map([[t('2025-01-01') + 3600, [1, 2, 0.5, 1.5]]]), day('2025-05-01')), /00:00 UTC/);
  assert.throws(() => toMonthly(new Map([[t('2025-01-01'), [1, 2, null, 1.5]]]), day('2025-05-01')), /missing value/);
});

test('monthsVsDaily: closed months with a 1M bar but no daily bar, and the other way round', () => {
  const daily = toDaily(new Map([
    [t('2025-01-30'), [1, 1, 1, 1]], [t('2025-03-02'), [1, 1, 1, 1]], [t('2025-04-29'), [1, 1, 1, 1]],
  ]), day('2025-04-30')).daily;
  const m = toMonthly(new Map([[t('2025-01-01'), [1, 1, 1, 1]], [t('2025-02-01'), [1, 1, 1, 1]]]), day('2025-04-30'));
  // February: 1M bar only; March: daily bars only; April is in progress and not compared
  assert.deepEqual(monthsVsDaily(daily, m, day('2025-04-30')), { only1M: ['2025-02'], only1D: ['2025-03'] });
  const m2 = toMonthly(new Map([[t('2025-01-01'), [1, 1, 1, 1]], [t('2025-03-01'), [1, 1, 1, 1]]]), day('2025-04-30'));
  assert.equal(monthsVsDaily(daily, m2, day('2025-04-30')), null);
});

test('toWeekly: 1W bars of the closed weeks; the week in progress is dropped', () => {
  const bars = new Map([
    [t('2025-01-06'), [1, 2, 0.5, 1.5]], // Monday
    [t('2025-01-20'), [3, 4, 2.5, 3.5]], // no bar for the week of 01-13: a gap stays a gap
    [t('2025-01-27'), [4, 5, 3.5, 4.5]],
  ]);
  // cutoff = first day not written: on Sunday 2025-02-02 the week of 01-27 is still in progress
  assert.deepEqual(toWeekly(bars, day('2025-02-02')), { d: [day('2025-01-06'), day('2025-01-20')], o: [1, 3], h: [2, 4], l: [0.5, 2.5], c: [1.5, 3.5] });
  // on Monday 2025-02-03 it has closed
  assert.equal(toWeekly(bars, day('2025-02-03')).d.length, 3);
  assert.throws(() => toWeekly(new Map([[t('2025-01-07'), [1, 2, 0.5, 1.5]]]), day('2025-02-03')), /Monday/); // a Tuesday
  assert.throws(() => toWeekly(new Map([[t('2025-01-06') + 3600, [1, 2, 0.5, 1.5]]]), day('2025-02-03')), /00:00 UTC/);
  assert.throws(() => toWeekly(new Map([[t('2025-01-06'), [1, 2, NaN, 1.5]]]), day('2025-02-03')), /missing value/);
  // the week in progress is not checked for values (like the daily and monthly bar in progress)
  assert.equal(toWeekly(new Map([[t('2025-01-27'), [1, 2, null, 1.5]]]), day('2025-02-02')).d.length, 0);
});

test('weeksVsDaily: closed weeks with a 1W bar but no daily bar, and the other way round', () => {
  const daily = toDaily(new Map([
    [t('2025-01-08'), [1, 1, 1, 1]], [t('2025-01-26'), [1, 1, 1, 1]], [t('2025-02-01'), [1, 1, 1, 1]],
  ]), day('2025-02-02')).daily;
  const w = toWeekly(new Map([[t('2025-01-06'), [1, 1, 1, 1]], [t('2025-01-13'), [1, 1, 1, 1]], [t('2025-01-27'), [1, 1, 1, 1]]]), day('2025-02-02'));
  // week of 01-13: 1W bar only; week of 01-20 (its Sunday 01-26 has a daily bar): daily bars only; the week of 01-27
  // is in progress on 2025-02-02 and not compared
  assert.deepEqual(weeksVsDaily(daily, w, day('2025-02-02')), { only1W: ['2025-01-13'], only1D: ['2025-01-20'] });
  const w2 = toWeekly(new Map([[t('2025-01-06'), [1, 1, 1, 1]], [t('2025-01-20'), [1, 1, 1, 1]]]), day('2025-02-02'));
  assert.equal(weeksVsDaily(daily, w2, day('2025-02-02')), null);
});

test('barRevisions: stored 1M / 1W bars that changed or disappeared', () => {
  const prev = { d: [10, 17, 24], o: [1, 2, 3], h: [1, 2, 3], l: [1, 2, 3], c: [1, 2, 3] };
  assert.equal(barRevisions(undefined, prev), null); // a file without such bars yet
  assert.equal(barRevisions(prev, { ...prev, d: [...prev.d, 31], o: [...prev.o, 4], h: [...prev.h, 4], l: [...prev.l, 4], c: [...prev.c, 4] }), null); // a new bar is not a revision
  assert.equal(barRevisions(prev, { ...prev, l: [1, 1.5, 3] }), 1);
  assert.equal(barRevisions(prev, { d: [24], o: [3], h: [3], l: [3], c: [3.5] }), 3); // two gone, one changed
});
