#!/usr/bin/env python3
"""Reference bar bucketing for the differential test of the TD screener (Python 3, stdlib only).

Written independently of the JavaScript port, from two sources only:
  * keyFn(tf) in wma0.3-screenshot/dashboard/engine.js lines 16-34 (ported literally below), and
  * the bar rules of the verification contract:
      - daily file data/daily/<FILE_ID>.json = {id, d0, o, h, l, c}; index i is unix day d0 + i;
        a day whose four values are null has no TradingView daily bar and is NOT a bar
        (skipped, never forward-filled);
      - a bucket (a run of calendar days sharing one keyFn key) becomes a bar only if at least one
        of its days has a daily bar; open = open of its first daily bar, high = max of the highs,
        low = min of the lows, close = close of its last daily bar;
      - bar start day = first calendar day of the bucket (the first day d with that key),
        bar end day = last calendar day of the bucket;
      - a bar is confirmed iff its end day <= lastClosedDay (data/daily/_status.json).
  * and, for the month timeframes (1M-12M), the native-bar check of 2026-11-01 (TradingView's month
    bars follow its own 1M bars): when the file holds TradingView's 1M bars of the closed
    months, m = {d, o, h, l, c} with d[j] the unix day of the first day of the month, the same rules
    apply with those 1M bars in place of the daily bars (see build_bars).

Unix days are integers counted from 1970-01-01 UTC.
"""

import datetime
import functools
import hashlib
import json
import math
import os
import re

EPOCH = datetime.date(1970, 1, 1)

# The 20 timeframes of the screener, in display order.
TIMEFRAMES = ['1D', '2D', '3D', '4D', '5D', '6D', '1W', '8D', '9D', '10D',
              '2W', '3W', '1M', '2M', '3M', '4M', '6M', '8M', '10M', '12M']

_TF_RE = re.compile(r'^(\d+)([DWM])$')
_FILE_ID_RE = re.compile(r'[^A-Za-z0-9.]+')


def file_id(ticker):
    """Ticker id -> file id: every run of characters outside [A-Za-z0-9.] becomes '_'."""
    return _FILE_ID_RE.sub('_', ticker)


def day_to_date(d):
    return EPOCH + datetime.timedelta(days=d)


def date_to_day(dt):
    return (dt - EPOCH).days


def iso(d):
    """Unix day -> 'YYYY-MM-DD'."""
    return day_to_date(d).isoformat()


def iso_to_day(s):
    return date_to_day(datetime.date.fromisoformat(s))


@functools.lru_cache(maxsize=None)
def _utc_parts(d):
    """(UTC full year, UTC month 0-11, unix day of January 1st of that year) of unix day d.

    Mirrors `new Date(d * DAYMS)`, getUTCFullYear(), getUTCMonth() and
    `Date.UTC(y, 0, 1) / DAYMS` of engine.js line 22.
    """
    t = day_to_date(d)
    return t.year, t.month - 1, date_to_day(datetime.date(t.year, 1, 1))


@functools.lru_cache(maxsize=None)
def _first_monday(yy):
    """engine.js line 28: firstMon(yy) = j + ((1 - ((j + 4) % 7) + 7) % 7), j = Jan 1st of yy."""
    j = date_to_day(datetime.date(yy, 1, 1))
    return j + ((1 - ((j + 4) % 7) + 7) % 7)


def parse_tf(tf):
    m = _TF_RE.match(tf)
    if not m:
        raise ValueError('bad timeframe %r (expected <n>D, <n>W or <n>M)' % (tf,))
    k = int(m.group(1))
    if k < 1:
        raise ValueError('bad timeframe %r (multiplier must be >= 1)' % (tf,))
    return k, m.group(2)


def key_fn(tf):
    """Literal port of keyFn(tf), engine.js lines 18-34. Returns a function unix day -> bucket key.

    JS Math.floor(a / b) with b > 0 equals Python's a // b for every integer a.
    """
    k, u = parse_tf(tf)

    def key(d):
        if u == 'D' and k == 1:                       # line 21
            return d
        y, month0, jan1 = _utc_parts(d)                 # line 22
        if u == 'D':                                    # line 23
            return y * 1000 + (d - jan1) // k
        if u == 'W':                                    # line 24
            if k == 1:                                  # line 25 (Monday-based weeks)
                return (d + 3) // 7
            cy = y if d >= _first_monday(y) else y - 1  # line 29
            return cy * 100 + ((d - _first_monday(cy)) // 7) // k   # line 30
        return y * 100 + month0 // k                    # line 32

    return key


class Bar(object):
    """One timeframe bar: calendar bucket [start, end], first/last day with a daily bar, OHLC."""
    __slots__ = ('start', 'end', 'first', 'last', 'o', 'h', 'l', 'c')

    def __init__(self, start, end, first, last, o, h, l, c):
        self.start = start
        self.end = end
        self.first = first
        self.last = last
        self.o = o
        self.h = h
        self.l = l
        self.c = c

    def __repr__(self):
        return 'Bar(%s..%s data %s..%s O=%r H=%r L=%r C=%r)' % (
            iso(self.start), iso(self.end), iso(self.first), iso(self.last), self.o, self.h, self.l, self.c)


def daily_rows(daily):
    """Yield (day, o, h, l, c) for every day that has a TradingView daily bar, ascending."""
    d0 = daily['d0']
    o, h, l, c = daily['o'], daily['h'], daily['l'], daily['c']
    if not (len(o) == len(h) == len(l) == len(c)):
        raise ValueError('%s: o/h/l/c lengths differ' % daily.get('id'))
    for i in range(len(c)):
        vals = (o[i], h[i], l[i], c[i])
        nulls = sum(1 for v in vals if v is None)
        if nulls == 4:
            continue                  # no daily bar that day: not a bar, never forward-filled
        if nulls:
            raise ValueError('%s: day %s has a partial null row' % (daily.get('id'), iso(d0 + i)))
        yield (d0 + i,) + vals


def monthly_rows(daily):
    """Yield (day, o, h, l, c) for every TradingView 1M bar in daily['m'], ascending.

    daily['m'] = {d, o, h, l, c}: TradingView's own 1M bars of the closed months, as scripts/fetch-tv.mjs
    stores them; d[j] is the unix day of the first day of the month of the j-th bar.
    """
    m = daily['m']
    d, o, h, l, c = m['d'], m['o'], m['h'], m['l'], m['c']
    if not (len(d) == len(o) == len(h) == len(l) == len(c)):
        raise ValueError('%s: m.d/o/h/l/c lengths differ' % daily.get('id'))
    prev = None
    for j in range(len(d)):
        dj = d[j]
        if (not isinstance(dj, int) or isinstance(dj, bool) or day_to_date(dj).day != 1
                or (prev is not None and dj <= prev)):
            raise ValueError('%s: m.d[%d] = %r is not the first day of a month after the previous one'
                             % (daily.get('id'), j, dj))
        vals = (o[j], h[j], l[j], c[j])
        if any(v is None or isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
               for v in vals):
            raise ValueError('%s: 1M bar %s has a missing value' % (daily.get('id'), iso(dj)))
        prev = dj
        yield (dj,) + vals


def build_bars(daily, tf):
    """All bars of one timeframe (confirmed or not), in time order.

    Month timeframes are built from TradingView's own 1M bars when the file has them (daily['m']): a 1M
    chart shows those bars, and they keep prices TradingView later revised away in its daily bars
    (2026-11-01: CRYPTO:HUNTUSD 1M 2026-10 low 0.082473, CRYPTO:TDROPUSD 1M 2026-10 close 0.00042404, in no
    version of their daily bars); TradingView's own 3M/6M/12M equal the aggregate of its 1M bars
    (verify/native/check-native-bars.mjs). The buckets and the rules are the same, with 1M bars in place of
    daily bars: first/last are then the first days of the months of the bucket's first/last 1M bar.
    """
    key = key_fn(tf)
    _k, unit = parse_tf(tf)
    rows = monthly_rows(daily) if unit == 'M' and daily.get('m') is not None else daily_rows(daily)
    bars = []
    cur = None
    cur_key = None
    for d, o, h, l, c in rows:
        kd = key(d)
        if cur is not None and kd == cur_key:
            # same bucket: extend
            cur.last = d
            if h > cur.h:
                cur.h = h
            if l < cur.l:
                cur.l = l
            cur.c = c
            continue
        if cur is not None and kd < cur_key:
            raise AssertionError('keyFn not monotone at %s (%s)' % (iso(d), tf))
        # A new bucket becomes a bar: its first calendar day is the first day with this key,
        # its last calendar day the last day with this key (keys form contiguous runs of days).
        start = d
        while key(start - 1) == kd:
            start -= 1
        end = d
        while key(end + 1) == kd:
            end += 1
        cur = Bar(start, end, d, d, o, h, l, c)
        cur_key = kd
        bars.append(cur)
    return bars


def confirmed_prefix(bars, last_closed_day):
    """The confirmed bars (end day <= lastClosedDay). They must form a prefix: at most the last
    bar may be unconfirmed (the in-progress daily bar is already dropped from the data)."""
    n = 0
    while n < len(bars) and bars[n].end <= last_closed_day:
        n += 1
    if len(bars) - n > 1:
        raise AssertionError('more than one unconfirmed bar: %r' % (bars[n:],))
    return bars[:n]


def bars_sha1(bars):
    """SHA-1 (lowercase hex) of the concatenation of '<startDay>,<firstDataDay>,<lastDataDay>\\n'."""
    h = hashlib.sha1()
    for b in bars:
        h.update(('%d,%d,%d\n' % (b.start, b.first, b.last)).encode('ascii'))
    return h.hexdigest()


def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_daily(data_dir, ticker):
    daily = load_json(os.path.join(data_dir, file_id(ticker) + '.json'))
    if daily.get('id') != ticker:
        raise ValueError('%s: file holds id %r' % (ticker, daily.get('id')))
    return daily


def load_last_closed_day(data_dir):
    status = load_json(os.path.join(data_dir, '_status.json'))
    return iso_to_day(status['lastClosedDay'])


def load_usd_tickers(tickers_json):
    """coins[].usd of data/tickers.json, in file order, without duplicates."""
    seen = set()
    out = []
    for coin in load_json(tickers_json)['coins']:
        t = coin.get('usd')
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out
