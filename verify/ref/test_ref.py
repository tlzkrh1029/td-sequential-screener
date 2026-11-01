#!/usr/bin/env python3
"""Unit tests of the reference port (python3 -m unittest discover -s verify/ref -p 'test_*.py').

The hand-made series are small enough to follow bar by bar; every expected label below was derived
by hand from the Pine rules (the derivation is in the comments), not by running the engine.

Label tuples are (x bar index, kind, direction, family, text, extra) as stored in Engine.labels:
extra = raw setup count for S, origin bar index for I/X, list of origin bar indices for C.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import bars_ref  # noqa: E402
import td_ref  # noqa: E402

REPO = os.path.dirname(os.path.dirname(_HERE))
DATA = os.path.join(REPO, 'data', 'daily')
D0 = bars_ref.iso_to_day('2020-01-01')


def run_rows(rows, **variant):
    """rows = [(o, h, l, c), ...] -> finished Engine (one bar per row)."""
    opts = td_ref.resolve_options(variant)
    o, h, l, c = zip(*rows) if rows else ((), (), (), ())
    return td_ref.Engine(opts, o, h, l, c).run()


def state(engine):
    runs = sorted(engine.runs, key=lambda r: (r.family, r.direction, r.originBar))
    return engine.buyRaw, engine.sellRaw, [(r.family, r.direction, r.originBar, r.n) for r in runs]


def S(x, txt, d, raw):
    return (x, 'S', d, None, txt, raw)


def I(x, txt, d, fam, origin):
    return (x, 'I', d, fam, txt, origin)


def X(x, d, fam, origin):
    return (x, 'X', d, fam, 'x', origin)


def C(x, txt, d, fam, origins):
    return (x, 'C', d, fam, txt, list(origins))


# --------------------------------------------------------------------------------------------
# Series A (Combo replay). Bars 0-5 rise (close 100..105), bars 6-14 fall by 1 (close 101..93):
# buy flip at bar 6 (c6=101 < c2=102 and c5=105 > c1=101), buy Setup 9 at bar 14.
# low = close - 0.5 except a long wick at bar 8 (low 96.5); open = close, high = close + 0.5.
#   lows: 99.5 100.5 101.5 102.5 103.5 104.5 | 100.5 99.5 96.5 97.5 96.5 95.5 94.5 93.5 92.5
# Combo buy replay (n<10: close<=lastCounted, close<=low[2], low<=low[1], close<close[1]):
#   6 ok(1) 7 ok(2) 8 ok(3) 9 NO (low 97.5 > low8 96.5) 10 NO (close 97 > low8 96.5)
#   11 ok(4) 12 ok(5) 13 ok(6) 14 ok(7)
# Aggressive Combo buy replay (n<10: low<=lastCounted low, low<=low[2], low<low[1]):
#   6(1) 7(2) 8(3, lc 96.5) 9 NO (97.5 > 96.5) 10 ok(4: 96.5<=96.5, <=low8, <low9) 11..14 -> 5..8
# Sequential (no replay) counts bar 14 itself: close 93 <= low12 94.5 -> 1.
# Setup 9 at 14 is perfected: min(92.5, 93.5) <= min(94.5, 95.5).
# --------------------------------------------------------------------------------------------
def series_a():
    closes = [100, 101, 102, 103, 104, 105, 101, 100, 99, 98, 97, 96, 95, 94, 93]
    rows = [(c, c + 0.5, c - 0.5, c) for c in closes]
    o, h, _l, c = rows[8]
    rows[8] = (o, h, 96.5, c)
    return rows


class ComboReplay(unittest.TestCase):

    def test_replay_with_backfill(self):
        e = run_rows(series_a(), showCounts=True, showBackfill=True)
        expected = [I(x, str(k + 1), -1, 2, 14) for k, x in enumerate([6, 7, 8, 11, 12, 13, 14])]
        expected += [I(x, str(k + 1), -1, 3, 14) for k, x in enumerate([6, 7, 8, 10, 11, 12, 13, 14])]
        expected += [S(14, '9*', -1, 9), I(14, '1', -1, 0, 14)]
        self.assertEqual(e.labels, expected)
        # The Combo runs were counted during the replay and are NOT advanced again on bar 14.
        self.assertEqual(state(e), (9, 0, [(0, -1, 14, 1), (2, -1, 14, 7), (3, -1, 14, 8)]))

    def test_replay_without_backfill_shows_only_the_current_bar(self):
        e = run_rows(series_a(), showCounts=True)
        self.assertEqual(e.labels, [I(14, '7', -1, 2, 14), I(14, '8', -1, 3, 14),
                                    S(14, '9*', -1, 9), I(14, '1', -1, 0, 14)])

    def test_defaults_show_only_the_setup(self):
        e = run_rows(series_a())
        self.assertEqual(e.labels, [S(14, '9*', -1, 9)])
        self.assertEqual(state(e), (9, 0, [(0, -1, 14, 1), (2, -1, 14, 7), (3, -1, 14, 8)]))

    def test_strict_combo_counts_and_combo_final(self):
        # comboRelaxed / comboFinal only matter from count 11 on; the replay is unchanged.
        e = run_rows(series_a(), showCounts=True, comboRelaxed=False, comboFinal='Close')
        self.assertEqual(state(e)[2], [(0, -1, 14, 1), (2, -1, 14, 7), (3, -1, 14, 8)])


# --------------------------------------------------------------------------------------------
# Series B/C (Sequential sell). open = previous close, high = max(o,c)+0.5, low = min(o,c)-0.5.
# Bars 0-5 fall (110..105, no flip), bars 6-25 rise by 2 (109..147): sell flip at bar 6
# (c6=109 > c2=108 and c5=105 < c1=109), sell Setup 9* at bar 14, raw 18 ("9") at bar 23.
# Sell Sequential counts close >= high[2] (= close[2] + 0.5) on bars 14..25 -> n = 12 at bar 25;
# count 8 is bar 21, close8 = 139.
# --------------------------------------------------------------------------------------------
def _ohlc_from_closes(closes):
    rows = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        rows.append((o, max(o, c) + 0.5, min(o, c) - 0.5, c))
    return rows


def _phase_rise():
    return [110, 109, 108, 107, 106, 105] + [109 + 2 * k for k in range(20)]   # bars 0..25


def series_b():
    """... then bars 26-33 fall (buy setup 1-8, the sell run never counts: close and open stay below
    high[2]) and bar 34 gaps up (open 140 >= high32 130.5, high 140 >= close8 139) and closes at 120
    (< close30 132): buy Setup 9* on the very bar where the sell 13 condition holds."""
    rows = _ohlc_from_closes(_phase_rise())
    rows.append((141, 141.5, 139.5, 140))                       # bar 26
    rows += _ohlc_from_closes([140, 138, 136, 134, 132, 130, 128, 126])[1:]   # bars 27..33
    rows.append((140, 140, 119.5, 120))                         # bar 34
    return rows


def series_c():
    """... then bar 26/27 drop (no count), bar 28 closes 133 >= high26 130.5 but its high 133.5 is
    below close8 139 (13 vs 8 fails -> '+13'), bar 29 closes 140 >= high27 128.5 with high 140.5
    >= 139 -> Sequential sell 13."""
    rows = _ohlc_from_closes(_phase_rise())
    rows += [(130, 130.5, 129.5, 130),     # 26
             (128, 128.5, 127.5, 128),     # 27
             (129, 133.5, 128.5, 133),     # 28
             (133, 140.5, 132.5, 140)]     # 29
    return rows


SEQ_ONLY = dict(enableCombo=False, enableAggCombo=False)


class OppositeSetupCancellation(unittest.TestCase):

    def test_cancellation_precedes_same_bar_13(self):
        e = run_rows(series_b(), showCancelMarks=True, **SEQ_ONLY)
        self.assertEqual(e.labels, [S(14, '9*', 1, 9), S(23, '9', 1, 18),
                                    X(34, 1, 0, 14), S(34, '9*', -1, 9)])
        # buy Sequential run born on bar 34 counted bar 34 itself (close 120 <= low32 127.5)
        self.assertEqual(state(e), (9, 0, [(0, -1, 34, 1)]))

    def test_default_hides_the_cancel_mark(self):
        e = run_rows(series_b(), **SEQ_ONLY)
        self.assertEqual(e.labels, [S(14, '9*', 1, 9), S(23, '9', 1, 18), S(34, '9*', -1, 9)])

    def test_without_cancellation_the_13_completes(self):
        # Proves bar 34 really satisfies the sell 13 (by its open, 'Open or Close' final).
        e = run_rows(series_b(), cancelOpposite=False, **SEQ_ONLY)
        self.assertEqual(e.labels, [S(14, '9*', 1, 9), S(23, '9', 1, 18), S(34, '9*', -1, 9),
                                    C(34, '13', 1, 0, [14])])
        self.assertEqual(state(e), (9, 0, [(0, -1, 34, 1)]))

    def test_close_only_final_does_not_complete(self):
        e = run_rows(series_b(), cancelOpposite=False, seqFinal='Close', **SEQ_ONLY)
        self.assertEqual([lab for lab in e.labels if lab[1] == 'C'], [])
        self.assertEqual(state(e), (9, 0, [(0, -1, 34, 1), (0, 1, 14, 12)]))


class Deferral13(unittest.TestCase):

    def test_plus13_then_13(self):
        e = run_rows(series_c(), **SEQ_ONLY)
        self.assertEqual(e.labels, [S(14, '9*', 1, 9), S(23, '9', 1, 18),
                                    I(28, '+13', 1, 0, 14), C(29, '13', 1, 0, [14])])
        # bars 26-29 are buy setup 1-4 (flip: c25 147 > c21 139)
        self.assertEqual(state(e), (4, 0, []))

    def test_without_qualifier_the_13_comes_one_bar_earlier(self):
        e = run_rows(series_c(), seqQ138=False, **SEQ_ONLY)
        self.assertEqual(e.labels, [S(14, '9*', 1, 9), S(23, '9', 1, 18), C(28, '13', 1, 0, [14])])

    def test_show_deferred_off(self):
        e = run_rows(series_c(), showDeferred=False, **SEQ_ONLY)
        self.assertEqual(e.labels, [S(14, '9*', 1, 9), S(23, '9', 1, 18), C(29, '13', 1, 0, [14])])

    def test_counts_and_prefix(self):
        e = run_rows(series_c(), showCounts=True, prefix=True, **SEQ_ONLY)
        counts = [lab for lab in e.labels if lab[1] == 'I']
        self.assertEqual(counts, [I(14 + k - 1, str(k), 1, 0, 14) for k in range(1, 13)]
                         + [I(28, '+13', 1, 0, 14)])
        self.assertEqual(e.labels[-1], C(29, 'S 13', 1, 0, [14]))


# --------------------------------------------------------------------------------------------
# Series D (13xN). open = close, high = close + 0.5, low = close - 0.5 except the second fall
# (low = close - 0.25) and bar 35 (low 89.0).
#   bars 0-5 rise 100..105; bars 6-17 fall by 1 (101..90): buy Setup 9* at 14.
#     Aggressive Combo run #1 (origin 14): replay 6..14 -> 9, then 15 (strict) 10, 16 11,
#     17 12; lastCounted = low17 = 89.5.
#   bars 18-22 bounce 95..99: buy setup broken, sell setup only reaches 5 (no cancellation).
#   bars 23-34 fall by 0.5 (95.5..90.0, lows 95.25..89.75 stay above 89.5, run #1 stalls):
#     buy flip at 23 (c23 95.5 < c19 96, c22 99 > c18 95), buy Setup 9* at 31.
#     Run #2 (origin 31): replay 23..31 -> 9, then 32 (strict) 10, 33 11, 34 12; lastCounted 89.75.
#   bar 35: low 89.0 <= 89.5 and <= 89.75 -> both complete -> "13x2".
#   completionTips order: runs is scanned from the last index down, so #2 (origin 31) comes first.
# --------------------------------------------------------------------------------------------
def series_d():
    closes = ([100, 101, 102, 103, 104, 105] + [101 - k for k in range(12)]
              + [95, 96, 97, 98, 99] + [95.5 - 0.5 * k for k in range(12)] + [89.5])
    rows = []
    for i, c in enumerate(closes):
        low = c - 0.25 if 23 <= i <= 34 else c - 0.5
        rows.append((c, c + 0.5, low, c))
    o, h, _l, c = rows[35]
    rows[35] = (o, h, 89.0, c)
    return rows


AGGCOMBO_ONLY = dict(enableSeq=False, enableCombo=False)


class Aggregation13xN(unittest.TestCase):

    def test_13x2(self):
        e = run_rows(series_d(), **AGGCOMBO_ONLY)
        self.assertEqual(e.labels, [S(14, '9*', -1, 9), S(31, '9*', -1, 9),
                                    C(35, '13x2', -1, 3, [31, 14])])
        self.assertEqual(state(e), (13, 0, []))

    def test_prefix(self):
        e = run_rows(series_d(), prefix=True, **AGGCOMBO_ONLY)
        self.assertEqual(e.labels[-1], C(35, 'AC* 13x2', -1, 3, [31, 14]))

    def test_capacity_one_drops_the_oldest_origin(self):
        e = run_rows(series_d(), maxOrigins=1, **AGGCOMBO_ONLY)
        self.assertEqual(e.labels[-1], C(35, '13', -1, 3, [31]))
        self.assertEqual(e.counters[0], 1)

    def test_keep_active_ignores_the_second_origin(self):
        e = run_rows(series_d(), originPolicy='Keep active', **AGGCOMBO_ONLY)
        self.assertEqual(e.labels[-1], C(35, '13', -1, 3, [14]))
        self.assertEqual(e.counters[2], 1)

    def test_newest_replaces_the_first_origin(self):
        e = run_rows(series_d(), originPolicy='Newest', **AGGCOMBO_ONLY)
        self.assertEqual(e.labels[-1], C(35, '13', -1, 3, [31]))

    def test_intermediate_numbers_newest_origin_only(self):
        e = run_rows(series_d(), showCounts=True, **AGGCOMBO_ONLY)
        counts = [(lab[0], lab[4], lab[5]) for lab in e.labels if lab[1] == 'I']
        # run #1: replay shows "9" at 14 only (no backfill), then 10, 11, 12 on 15..17;
        # run #2: "9" at 31, then 10, 11, 12 on 32..34; run #1 is no longer the newest origin.
        self.assertEqual(counts, [(14, '9', 14), (15, '10', 14), (16, '11', 14), (17, '12', 14),
                                  (31, '9', 31), (32, '10', 31), (33, '11', 31), (34, '12', 31)])


# --------------------------------------------------------------------------------------------
# Series E (13r). As series A but without the wick at bar 8 and a longer fall: Aggressive Combo
# reaches 12 at bar 17 on a long wick (low 80), stalls while the buy setup runs on to raw 18
# at bar 23 (refresh flag set), and completes at bar 24 (low 79 <= 80) -> "13r".
# --------------------------------------------------------------------------------------------
def series_e():
    closes = [100, 101, 102, 103, 104, 105] + [101 - k for k in range(19)]   # bars 0..24
    rows = [(c, c + 0.5, c - 0.5, c) for c in closes]
    rows[17] = (rows[17][0], rows[17][1], 80.0, rows[17][3])
    rows[24] = (rows[24][0], rows[24][1], 79.0, rows[24][3])
    return rows


class Refresh13r(unittest.TestCase):

    def test_13r(self):
        e = run_rows(series_e(), **AGGCOMBO_ONLY)
        self.assertEqual(e.labels, [S(14, '9*', -1, 9), S(23, '9', -1, 18),
                                    C(24, '13r', -1, 3, [14])])
        self.assertEqual(state(e), (19, 0, []))

    def test_refresh_annotation_off(self):
        e = run_rows(series_e(), showRefresh=False, **AGGCOMBO_ONLY)
        self.assertEqual(e.labels[-1], C(24, '13', -1, 3, [14]))


# --------------------------------------------------------------------------------------------
# Research options (all hand-derived)
# --------------------------------------------------------------------------------------------
class ResearchOptions(unittest.TestCase):

    def test_tdst_cancellation(self):
        # Series A + bars 15-18 closing 100, 104, 106, 108 (o=c, h=c+.5, l=c-.5). The buy setup's
        # true high is trueHi6 = max(101.5, close5 105) = 105 (= every buy run's tdst). No run
        # counts on 15-18; bar 18 has trueLo = min(107.5, close17 106) = 106 > 105 -> broken.
        rows = series_a() + [(c, c + 0.5, c - 0.5, c) for c in (100, 104, 106, 108)]
        e = run_rows(rows, cancelTDST=True, showCancelMarks=True)
        self.assertEqual(e.labels, [S(14, '9*', -1, 9), X(18, -1, 3, 14), X(18, -1, 2, 14),
                                    X(18, -1, 0, 14)])
        self.assertEqual(state(e), (0, 4, []))
        e = run_rows(rows, showCancelMarks=True)
        self.assertEqual(state(e), (0, 4, [(0, -1, 14, 1), (2, -1, 14, 7), (3, -1, 14, 8)]))

    def test_raw22_restart(self):
        # Steady fall 101 -> 75 on bars 6..32: Sequential from raw9 (bar 14) counts every bar and
        # completes on bar 26 (low 80.5 <= close8 86); raw22 is bar 27, where restart22 starts a
        # fresh run (no replay) that counts bar 27 itself and reaches 6 on bar 32.
        closes = [100, 101, 102, 103, 104, 105] + [101 - k for k in range(27)]
        rows = [(c, c + 0.5, c - 0.5, c) for c in closes]
        base = [S(14, '9*', -1, 9), S(23, '9', -1, 18), C(26, '13', -1, 0, [14]), S(32, '9', -1, 27)]
        e = run_rows(rows, **SEQ_ONLY)
        self.assertEqual(e.labels, base)
        self.assertEqual(state(e), (27, 0, []))
        e = run_rows(rows, restart22=True, **SEQ_ONLY)
        self.assertEqual(e.labels, base)
        self.assertEqual(state(e), (27, 0, [(0, -1, 27, 6)]))
        e = run_rows(rows, restart22=True, showCounts=True, **SEQ_ONLY)
        self.assertEqual([lab for lab in e.labels if lab[5] == 27 and lab[1] == 'I'][:2],
                         [I(27, '1', -1, 0, 27), I(28, '2', -1, 0, 27)])

    def test_reject_smaller(self):
        # Series D. Adopted reference of run #1: hi 105 (trueHi6), lo extended while the chain
        # lasts to 89.5 (bar 17) -> 15.5. Setup #2: hi 99 (trueHi23 = close22), lo 91.25 -> 7.75.
        e = run_rows(series_d(), rejectSmaller=True, **AGGCOMBO_ONLY)
        self.assertEqual(e.labels, [S(14, '9*', -1, 9), S(31, '9*', -1, 9),
                                    C(35, '13', -1, 3, [14])])
        self.assertEqual(e.counters[1], 1)

    def test_recycle_range(self):
        # ratio = 7.75 / 15.5 = 50 %: outside [100, 200] -> kept active; inside [0, 60] -> recycled.
        e = run_rows(series_d(), originPolicy='Recycle range', **AGGCOMBO_ONLY)
        self.assertEqual(e.labels[-1], C(35, '13', -1, 3, [14]))
        self.assertEqual(e.counters[2], 1)
        e = run_rows(series_d(), originPolicy='Recycle range', recycleMin=0.0, recycleMax=60.0,
                     **AGGCOMBO_ONLY)
        self.assertEqual(e.labels[-1], C(35, '13', -1, 3, [31]))
        self.assertEqual(e.counters[3], 1)

    def test_combo_final_wick_and_ticks(self):
        # Series A + bars 15-19 closing 92..88, bar 20 closes 88.5 (> lastCounted close 88) with a
        # low of 87.0. Combo: 15 -> 8, 16 -> 9, 17 -> 10 (strict), 18 -> 11, 19 -> 12 (relaxed).
        # Bar 20: the close fails the progression; the default Wick final accepts low 87 <= 88.
        rows = series_a() + [(c, c + 0.5, c - 0.5, c) for c in (92, 91, 90, 89, 88)]
        rows.append((88.5, 89.0, 87.0, 88.5))
        combo_only = dict(enableSeq=False, enableAggCombo=False)
        e = run_rows(rows, **combo_only)
        self.assertEqual(e.labels, [S(14, '9*', -1, 9), C(20, '13', -1, 2, [14])])
        self.assertEqual(state(e), (15, 0, []))
        for final in ('Close', 'Open or Close'):
            e = run_rows(rows, comboFinal=final, **combo_only)
            self.assertEqual(state(e), (15, 0, [(2, -1, 14, 12)]), final)
        # one tick of 0.5 lets the close pass: 88.5 <= 88 + 0.5; a tick of 0.25 does not
        e = run_rows(rows, comboFinal='Close', comboTicks=1, mintick=0.5, **combo_only)
        self.assertEqual(e.labels[-1], C(20, '13', -1, 2, [14]))
        e = run_rows(rows, comboFinal='Close', comboTicks=1, mintick=0.25, **combo_only)
        self.assertEqual(state(e), (15, 0, [(2, -1, 14, 12)]))


# --------------------------------------------------------------------------------------------
# Bars
# --------------------------------------------------------------------------------------------
def _bucket(tf, s):
    k = bars_ref.key_fn(tf)
    d = bars_ref.iso_to_day(s)
    kd = k(d)
    a = d
    while k(a - 1) == kd:
        a -= 1
    b = d
    while k(b + 1) == kd:
        b += 1
    return bars_ref.iso(a), bars_ref.iso(b)


def _daily(start_iso, rows):
    """rows: list of (o,h,l,c) or None (no daily bar)."""
    def col(j):
        return [None if r is None else r[j] for r in rows]
    return {'id': 'TEST:X', 'd0': bars_ref.iso_to_day(start_iso),
            'o': col(0), 'h': col(1), 'l': col(2), 'c': col(3)}


class Bars(unittest.TestCase):

    def test_buckets(self):
        cases = [
            ('1W', '2023-12-31', ('2023-12-25', '2023-12-31')),
            ('1W', '2024-01-01', ('2024-01-01', '2024-01-07')),
            # 2W/3W restart at the first Monday on/after Jan 1st; earlier days finish the old cycle
            ('2W', '2024-12-16', ('2024-12-16', '2024-12-29')),
            ('2W', '2025-01-01', ('2024-12-30', '2025-01-05')),
            ('2W', '2025-01-06', ('2025-01-06', '2025-01-19')),
            ('2W', '2021-11-08', ('2021-11-08', '2021-11-21')),
            ('2W', '2024-01-29', ('2024-01-29', '2024-02-11')),
            ('3W', '2025-01-03', ('2024-12-23', '2025-01-05')),
            # nD restart every January 1st (the last bucket of a year is truncated)
            ('3D', '2023-12-31', ('2023-12-30', '2023-12-31')),
            ('3D', '2024-12-31', ('2024-12-29', '2024-12-31')),
            ('2D', '2025-01-01', ('2025-01-01', '2025-01-02')),
            ('10D', '2024-12-31', ('2024-12-26', '2024-12-31')),
            # nM restart every January
            ('8M', '2024-08-31', ('2024-01-01', '2024-08-31')),
            ('8M', '2024-09-01', ('2024-09-01', '2024-12-31')),
            ('10M', '2024-12-15', ('2024-11-01', '2024-12-31')),
            ('3M', '2024-05-20', ('2024-04-01', '2024-06-30')),
            ('12M', '2024-06-01', ('2024-01-01', '2024-12-31')),
            ('1D', '2024-02-29', ('2024-02-29', '2024-02-29')),
        ]
        for tf, day, expected in cases:
            self.assertEqual(_bucket(tf, day), expected, (tf, day))

    def test_gaps_are_skipped_and_never_filled(self):
        # 2024-01-01 (Mon) .. 2024-01-21: week 1 has bars on Mon/Wed only, week 2 none, week 3 Sun.
        rows = [None] * 21
        rows[0] = (10, 12, 9, 11)
        rows[2] = (11, 15, 8, 14)
        rows[20] = (14, 14.5, 13, 13.5)
        daily = _daily('2024-01-01', rows)
        bars = bars_ref.build_bars(daily, '1W')
        self.assertEqual([(bars_ref.iso(b.start), bars_ref.iso(b.end), bars_ref.iso(b.first),
                           bars_ref.iso(b.last), b.o, b.h, b.l, b.c) for b in bars],
                         [('2024-01-01', '2024-01-07', '2024-01-01', '2024-01-03', 10, 15, 8, 14),
                          ('2024-01-15', '2024-01-21', '2024-01-21', '2024-01-21', 14, 14.5, 13, 13.5)])
        one_d = bars_ref.build_bars(daily, '1D')
        self.assertEqual([bars_ref.iso(b.start) for b in one_d],
                         ['2024-01-01', '2024-01-03', '2024-01-21'])

    def test_confirmation(self):
        rows = [(1, 2, 0.5, 1.5)] * 10                      # 2024-01-01 .. 2024-01-10
        daily = _daily('2024-01-01', rows)
        lcd = bars_ref.iso_to_day('2024-01-10')
        self.assertEqual(len(bars_ref.confirmed_prefix(bars_ref.build_bars(daily, '1D'), lcd)), 10)
        # 1W: 2024-01-08 .. 01-14 ends after lastClosedDay -> unconfirmed
        self.assertEqual(len(bars_ref.confirmed_prefix(bars_ref.build_bars(daily, '1W'), lcd)), 1)
        # 10D: Jan 1-10 is complete on Jan 10
        self.assertEqual(len(bars_ref.confirmed_prefix(bars_ref.build_bars(daily, '10D'), lcd)), 1)
        self.assertEqual(len(bars_ref.confirmed_prefix(bars_ref.build_bars(daily, '1M'), lcd)), 0)

    def test_month_timeframes_from_tradingview_1m_bars(self):
        # daily bars 2024-12-26 .. 2025-03-10, day k = (10+k, 20+k, 5+k, 11+k); March is in progress.
        # m holds TradingView's own 1M bars: October (no daily bar at all), December (= the daily
        # aggregate), January and February with other values than the daily bars (as HUNT 2026-10).
        n = bars_ref.iso_to_day('2025-03-10') - bars_ref.iso_to_day('2024-12-26') + 1
        daily = _daily('2024-12-26', [(10 + k, 20 + k, 5 + k, 11 + k) for k in range(n)])
        day = bars_ref.iso_to_day
        daily['m'] = {'d': [day('2024-10-01'), day('2024-12-01'), day('2025-01-01'), day('2025-02-01')],
                      'o': [1, 10, 16.5, 47], 'h': [2, 25, 40, 75], 'l': [0.5, 5, 11, 42],
                      'c': [1.5, 16, 46.5, 74]}
        lcd = day('2025-03-10')

        def rows(tf, data=daily, last=lcd):
            bars = bars_ref.confirmed_prefix(bars_ref.build_bars(data, tf), last)
            return [' '.join([bars_ref.iso(b.start), bars_ref.iso(b.end), bars_ref.iso(b.first),
                              bars_ref.iso(b.last)] + ['%g' % v for v in (b.o, b.h, b.l, b.c)])
                    for b in bars]

        # 1M = the 1M bars; first/last = the first day of their month
        self.assertEqual(rows('1M'), ['2024-10-01 2024-10-31 2024-10-01 2024-10-01 1 2 0.5 1.5',
                                      '2024-12-01 2024-12-31 2024-12-01 2024-12-01 10 25 5 16',
                                      '2025-01-01 2025-01-31 2025-01-01 2025-01-01 16.5 40 11 46.5',
                                      '2025-02-01 2025-02-28 2025-02-01 2025-02-01 47 75 42 74'])
        # 2M / 3M: aggregates of the 1M bars per bucket (Jan-Feb: o of Jan, max/min, c of Feb)
        self.assertEqual(rows('2M'), ['2024-09-01 2024-10-31 2024-10-01 2024-10-01 1 2 0.5 1.5',
                                      '2024-11-01 2024-12-31 2024-12-01 2024-12-01 10 25 5 16',
                                      '2025-01-01 2025-02-28 2025-01-01 2025-02-01 16.5 75 11 74'])
        self.assertEqual(rows('3M'), ['2024-10-01 2024-12-31 2024-10-01 2024-12-01 1 25 0.5 16'])
        # a closed month without a 1M bar is no month bar, even with daily bars
        self.assertEqual(len(rows('1M', last=day('2025-03-31'))), 4)
        # day and week timeframes ignore m; without m the months come from the daily bars
        plain = dict(daily)
        del plain['m']
        self.assertEqual(rows('1W'), rows('1W', data=plain))
        self.assertEqual(rows('10D'), rows('10D', data=plain))
        self.assertEqual(rows('1M', data=plain)[1:],
                         ['2025-01-01 2025-01-31 2025-01-01 2025-01-31 16 56 11 47',
                          '2025-02-01 2025-02-28 2025-02-01 2025-02-28 47 84 42 75'])
        # malformed 1M bars are refused
        m = daily['m']
        for bad in ({**m, 'd': [day('2024-10-02')] + m['d'][1:]},
                    {**m, 'd': [m['d'][1], m['d'][0]] + m['d'][2:]},
                    {**m, 'c': m['c'][1:]},
                    {**m, 'h': [None] + m['h'][1:]}):
            with self.assertRaises(ValueError):
                bars_ref.build_bars({**daily, 'm': bad}, '1M')

    def test_sha1(self):
        self.assertEqual(bars_ref.bars_sha1([]), 'da39a3ee5e6b4b0d3255bfef95601890afd80709')
        b = bars_ref.Bar(1, 2, 1, 2, 1.0, 1.0, 1.0, 1.0)
        import hashlib
        self.assertEqual(bars_ref.bars_sha1([b, b]),
                         hashlib.sha1(b'1,1,2\n1,1,2\n').hexdigest())

    def test_file_id(self):
        self.assertEqual(bars_ref.file_id('CRYPTO:BTCUSD'), 'CRYPTO_BTCUSD')
        self.assertEqual(bars_ref.file_id('A::B-c.d'), 'A_B_c.d')


# --------------------------------------------------------------------------------------------
# Options and CLI
# --------------------------------------------------------------------------------------------
class OptionsAndCli(unittest.TestCase):

    def test_defaults_and_validation(self):
        o = td_ref.resolve_options({})
        self.assertEqual((o['seqFinal'], o['comboFinal'], o['originPolicy'], o['maxOrigins'],
                          o['labelLimit'], o['enableAggSeq'], o['mintick']),
                         ('Open or Close', 'Wick', 'Independent', 8, 400, False, 0.01))
        for bad in ({'nope': 1}, {'seqTicks': 11}, {'seqFinal': 'High'}, {'enableSeq': 1},
                    {'maxOrigins': 0}, {'labelLimit': 2.5}, {'mintick': 0}):
            with self.assertRaises(ValueError, msg=bad):
                td_ref.resolve_options(bad)
        self.assertEqual(td_ref.resolve_options({'maxOrigins': 3.0})['maxOrigins'], 3)

    def test_recycle_min_above_max_is_a_runtime_error(self):
        with self.assertRaises(td_ref.PineRuntimeError):
            run_rows(series_a(), recycleMin=300.0)

    def test_cli_dump_format(self):
        tmp = tempfile.mkdtemp()
        try:
            data = os.path.join(tmp, 'daily')
            os.makedirs(data)
            with open(os.path.join(data, '_status.json'), 'w') as f:
                json.dump({'lastClosedDay': '2020-02-05'}, f)

            def write(ticker, daily):
                daily = dict(daily, id=ticker)
                with open(os.path.join(data, bars_ref.file_id(ticker) + '.json'), 'w') as f:
                    json.dump(daily, f)
            # TEST:A = series D on 2020-01-01 .. 2020-02-05 (bar i = day D0 + i, all confirmed on 1D)
            write('TEST:A', _daily('2020-01-01', series_d()))
            # TEST:B-1 = one daily bar on Tue 2020-02-04: confirmed on 1D; its week ends 02-09 -> the
            # 1W chart has zero confirmed bars.
            write('TEST:B-1', _daily('2020-02-04', [(1, 1, 1, 1)]))
            out = os.path.join(tmp, 'out')
            variant = os.path.join(tmp, 'v.json')
            with open(variant, 'w') as f:
                json.dump({'enableSeq': False, 'enableCombo': False}, f)
            subprocess.check_call([sys.executable, os.path.join(_HERE, 'td_ref.py'), '--out', out,
                                   '--data', data, '--tickers', 'TEST:A,TEST:B-1', '--tfs', '1D,1W',
                                   '--variant', variant, '--jobs', '1'],
                                  stdout=subprocess.DEVNULL)
            self.assertEqual(sorted(os.listdir(out)), ['TEST_A__1D.tsv', 'TEST_A__1W.tsv',
                                                       'TEST_B_1__1D.tsv', 'TEST_B_1__1W.tsv'])

            def read(name):
                with open(os.path.join(out, name), 'rb') as f:
                    return f.read()
            self.assertEqual(read('TEST_B_1__1W.tsv'),
                             b'B\t0\tda39a3ee5e6b4b0d3255bfef95601890afd80709\nE\t0\t0\t\n')
            day = bars_ref.iso_to_day('2020-02-04')
            self.assertEqual(read('TEST_B_1__1D.tsv'), ('B\t1\t%s\nE\t0\t0\t\n' % bars_ref.bars_sha1(
                [bars_ref.Bar(day, day, day, day, 1, 1, 1, 1)])).encode('ascii'))
            sha = bars_ref.bars_sha1([bars_ref.Bar(D0 + i, D0 + i, D0 + i, D0 + i, 0, 0, 0, 0)
                                      for i in range(36)])
            # series D: Setup 9* at bars 14 (2020-01-15) and 31 (2020-02-01), 13x2 at bar 35
            self.assertEqual(read('TEST_A__1D.tsv').decode('ascii'), '\n'.join([
                'B\t36\t' + sha,
                'L\t2020-01-15\tS\t-1\t-\t9*\t9',
                'L\t2020-02-01\tS\t-1\t-\t9*\t9',
                'L\t2020-02-05\tC\t-1\t3\t13x2\t2020-02-01,2020-01-15',
                'E\t13\t0\t']) + '\n')
            # 1W: 2019-12-30.. (data from Wed 01-01), ..., 2020-02-03..02-09 unconfirmed -> 5 bars
            week = read('TEST_A__1W.tsv').decode('ascii').split('\n')
            self.assertTrue(week[0].startswith('B\t5\t'), week[0])
        finally:
            shutil.rmtree(tmp)


# --------------------------------------------------------------------------------------------
# Golden case seen on the TradingView chart (README section 1)
# --------------------------------------------------------------------------------------------
@unittest.skipUnless(os.path.isfile(os.path.join(DATA, 'CRYPTO_BTCUSD.json')), 'no BTC data')
class GoldenBtc2W(unittest.TestCase):

    def test_pink_sell_13x2_on_2024_12_16(self):
        daily = bars_ref.load_daily(DATA, 'CRYPTO:BTCUSD')
        bars = bars_ref.confirmed_prefix(bars_ref.build_bars(daily, '2W'),
                                         bars_ref.load_last_closed_day(DATA))
        engine = td_ref.run_bars(bars, td_ref.resolve_options({}))
        lines = td_ref.dump_lines(bars, engine)
        on_bar = [ln.split('\t') for ln in lines if ln.startswith('L\t2024-12-16\t')]
        completions = [f for f in on_bar if f[2] == 'C']
        self.assertEqual(len(completions), 1, on_bar)
        _l, _day, _kind, direction, family, text, extra = completions[0]
        self.assertEqual((direction, family, text), ('1', '3', '13x2'))
        self.assertEqual(sorted(extra.split(',')), ['2021-11-08', '2024-01-29'])
        # tooltip order: the runs array is scanned from its last index, newest origin first
        self.assertEqual(extra, '2024-01-29,2021-11-08')
        # both origins are sell Setup 9 bars of this chart
        setups = {(f[1], f[3]) for f in (ln.split('\t') for ln in lines) if len(f) > 2 and f[2] == 'S'}
        self.assertIn(('2021-11-08', '1'), setups)
        self.assertIn(('2024-01-29', '1'), setups)


if __name__ == '__main__':
    unittest.main()
