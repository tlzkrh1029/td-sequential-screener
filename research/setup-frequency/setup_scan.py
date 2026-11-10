#!/usr/bin/env python3
"""TD Setup 9 frequency over the WMA 0.3 screener's daily closes.

TD Setup needs closes only, so the close-only data of tlzkrh1029/wma0.3-screenshot is enough to measure how often
Setup 9 occurs and how many closed bars each timeframe has. Countdown 13 needs open/high/low and is not measured.

- Bar buckets: port of keyFn() in wma0.3-screenshot/dashboard/engine.js (TradingView style: nD bars restart on
  January 1st, 1W is Monday-based, 2W/3W restart at the year's first Monday, nM bars restart every January).
  A bucket becomes a bar once a day inside it has a TradingView bar.
- Setup count: port of pinescript/td-research-v6/kidze_td_research_v6.pine lines 310-314 (strict price flip to
  start, counting from bar_index 5).
- Closed bars only: the daily fetch also stores the day still in progress, so the last day in the data is dropped
  by default (--last overrides), and a timeframe's last bar is dropped while its bucket is still open.

Usage:
  python3 setup_scan.py <wma-repo>/data/daily <wma-repo>/data/tickers.json [--last YYYY-MM-DD] [--window 365]
  python3 setup_scan.py <wma-repo>/data/daily --golden
"""
import argparse
import datetime
import json
import os
import re
import statistics
from collections import defaultdict

EPOCH = datetime.date(1970, 1, 1)
TFS = ['1D', '2D', '3D', '4D', '5D', '6D', '1W', '8D', '9D', '10D', '2W', '3W',
       '1M', '2M', '3M', '4M', '6M', '8M', '10M', '12M']
THRESHOLDS = (14, 30, 100, 200)  # Setup 9 possible / room for a countdown / - / full WMA 200


def day_of(date):
    return (date - EPOCH).days


def date_of(day):
    return EPOCH + datetime.timedelta(days=day)


def jan1(year):
    return day_of(datetime.date(year, 1, 1))


def first_monday(year):
    j = jan1(year)
    return j + ((1 - ((j + 4) % 7) + 7) % 7)


def bucket(tf, d):
    k, unit = int(tf[:-1]), tf[-1]
    if unit == 'D' and k == 1:
        return d
    date = date_of(d)
    year = date.year
    if unit == 'D':
        return year * 1000 + (d - jan1(year)) // k
    if unit == 'W':
        if k == 1:
            return (d + 3) // 7
        cycle = year if d >= first_monday(year) else year - 1
        return cycle * 100 + ((d - first_monday(cycle)) // 7) // k
    return year * 100 + (date.month - 1) // k


def load(daily_dir, ticker):
    name = re.sub(r'[^A-Za-z0-9.]+', '_', ticker) + '.json'  # same file name as build-site.mjs fileOf()
    with open(os.path.join(daily_dir, name), encoding='utf8') as fh:
        return json.load(fh)


class Axis:
    """Bucket key and bucket end day of every calendar day from day0 to last + 1."""

    def __init__(self, day0, last):
        self.day0, self.last = day0, last
        self.key = {tf: [bucket(tf, d) for d in range(day0, last + 2)] for tf in TFS}
        self.end = {}
        for tf in TFS:
            ends = {}
            for i, k in enumerate(self.key[tf]):
                ends[k] = day0 + i
            self.end[tf] = ends

    def bars(self, series, tf):
        """Closed bars of one timeframe: list of (first day with a bar, bucket end day, close)."""
        keys, out, cur = self.key[tf], [], None
        d0 = series['d0']
        for i, close in enumerate(series['c']):
            d = d0 + i
            if close is None or d < self.day0 or d > self.last:
                continue
            k = keys[d - self.day0]
            if cur is not None and cur[0] == k:
                cur[3] = close
            else:
                cur = [k, d, self.end[tf][k], close]
                out.append(cur)
        if out and keys[self.last + 1 - self.day0] == out[-1][0]:
            out.pop()  # the bucket is still open after the last closed day
        return [(b[1], b[2], b[3]) for b in out]


def setup9(closes):
    """Bar indices where the raw buy or sell Setup count reaches 9: list of (index, 'buy' | 'sell')."""
    out, buy, sell = [], 0, 0
    for i in range(5, len(closes)):
        c = closes
        buy = buy + 1 if c[i] < c[i - 4] and (buy > 0 or c[i - 1] > c[i - 5]) else 0
        sell = sell + 1 if c[i] > c[i - 4] and (sell > 0 or c[i - 1] < c[i - 5]) else 0
        if buy == 9:
            out.append((i, 'buy'))
        if sell == 9:
            out.append((i, 'sell'))
    return out


def scan(args):
    coins = [c for c in json.load(open(args.tickers, encoding='utf8'))['coins'] if c.get('usd')]
    series = {c['sym']: load(args.daily, c['usd']) for c in coins}
    last_in_data = max(s['d0'] + len(s['c']) - 1 for s in series.values())
    last = day_of(datetime.date.fromisoformat(args.last)) if args.last else last_in_data - 1
    axis = Axis(min(s['d0'] for s in series.values()), last)
    first = last - args.window + 1

    enough = {tf: [0] * len(THRESHOLDS) for tf in TFS}
    events, bars_in_window = defaultdict(int), defaultdict(int)
    today = {tf: [0, 0] for tf in TFS}
    coins_on_day, coins_on_day_1d = defaultdict(set), defaultdict(set)
    for sym, s in series.items():
        for tf in TFS:
            bars = axis.bars(s, tf)
            for j, n in enumerate(THRESHOLDS):
                enough[tf][j] += len(bars) >= n
            bars_in_window[tf] += sum(1 for b in bars if b[1] >= first)
            for i, side in setup9([b[2] for b in bars]):
                end = bars[i][1]
                if end >= first:
                    events[tf] += 1
                    coins_on_day[end].add(sym)
                    if tf == '1D':
                        coins_on_day_1d[end].add(sym)
                if end == last:
                    today[tf][side == 'sell'] += 1

    print(f"{len(coins)} coins with a USD ticker; last closed day {date_of(last)}; window {args.window} days\n")
    print('  TF |  >=14  >=30 >=100 >=200 | 9s/day | 9s per 100 bars | closing on last day: buy9 sell9')
    for tf in TFS:
        per100 = 100 * events[tf] / bars_in_window[tf] if bars_in_window[tf] else 0.0
        e = enough[tf]
        print(f"{tf:>4} | {e[0]:>5} {e[1]:>5} {e[2]:>5} {e[3]:>5} | {events[tf] / args.window:6.2f} | {per100:15.2f} |"
              f" {today[tf][0]:>29} {today[tf][1]:>5}")

    def dist(by_day):
        xs = sorted(len(by_day.get(d, ())) for d in range(first, last + 1))
        return statistics.mean(xs), xs[len(xs) // 2], xs[int(0.9 * len(xs))], xs[-1]

    print(f"\ndistinct coins with a new Setup 9 closing on a day, last {args.window} days: mean / median / p90 / max")
    print('  1D only       : %.1f / %d / %d / %d' % dist(coins_on_day_1d))
    print('  any of 20 TFs : %.1f / %d / %d / %d' % dist(coins_on_day))
    print(f"  on {date_of(last)}: {len(coins_on_day_1d.get(last, ()))} (1D), {len(coins_on_day.get(last, ()))} (any TF)")


def golden(args):
    """Checks against the TradingView chart and an earlier count."""
    s = load(args.daily, 'CRYPTO:BTCUSD')
    last = day_of(datetime.date.fromisoformat(args.last or '2026-10-30'))
    axis = Axis(s['d0'], last)
    bars = axis.bars(s, '2W')
    found = [(date_of(bars[i][0]).isoformat(), side) for i, side in setup9([b[2] for b in bars])]
    want = [('2021-11-08', 'sell'), ('2024-01-29', 'sell')]
    print('BTC 2W Setup 9 bars, 2021-2024:', [f for f in found if '2021' <= f[0] < '2025'])
    print('  TD Research v6 README (TradingView tooltip, 2026-10-31): SELL origins 2021-11-08 and 2024-01-29 ->',
          'found' if all(w in found for w in want) else 'MISSING')
    a, b = day_of(datetime.date(2024, 2, 1)), day_of(datetime.date(2026, 10, 27))
    bars = [x for x in Axis(s['d0'], b).bars(s, '1D')]
    hits = [(bars[i][0], side) for i, side in setup9([x[2] for x in bars]) if bars[i][0] >= a]
    print(f"BTC 1D 2024-02-01..2026-10-27: {len(hits)} Setup 9 (buy {sum(h[1] == 'buy' for h in hits)}, "
          f"sell {sum(h[1] == 'sell' for h in hits)}); td-sequential README on Binance US BTCUSDT: 26 (buy 11, sell 15)")


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('daily', help='data/daily folder of wma0.3-screenshot')
    p.add_argument('tickers', nargs='?', help='data/tickers.json of wma0.3-screenshot')
    p.add_argument('--last', help='last closed day (default: the day before the last day in the data)')
    p.add_argument('--window', type=int, default=365)
    p.add_argument('--golden', action='store_true', help='run the BTC checks instead of the scan')
    a = p.parse_args()
    if a.golden:
        golden(a)
    elif not a.tickers:
        p.error('tickers is required for the scan')
    else:
        scan(a)
