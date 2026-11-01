// The checks scripts/fetch-tv.mjs applies to TradingView's bars before writing a data file. Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TV_SYMBOLS ||= 'TEST:XUSD'; // import the module without reading data/tickers.json
const { toDaily, toMonthly, monthsVsDaily } = await import('../scripts/fetch-tv.mjs');

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
