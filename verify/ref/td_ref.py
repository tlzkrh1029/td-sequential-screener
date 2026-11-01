#!/usr/bin/env python3
"""Independent reference port of TD Research v6 (kidze_td_research_v6.pine, Pine Script v6, 444 lines).

Purpose: differential testing of the production JavaScript port. Python 3, standard library only.
Written only from the Pine source, its README, keyFn (wma0.3 engine.js lines 16-34) and the
verification contract; it does not look at the JavaScript port.

The port is statement by statement; '# NNN' comments give the Pine line numbers. Only code that can
change which labels are created (or the run state) is ported. Display-only code (label y positions,
pad/ATR, colours, sizes, tooltip text, plots, the status table, alertcondition) is noted and skipped.

Pine semantics reproduced here (standard Pine v6):
  * na is None. Any comparison with an na operand is false (_lt/_le/_gt/_ge/_eq); arithmetic with
    na gives na (_sub); na() is `is None`; nz(x, y) is `y if x is None else x`.
  * x[k] is the value k bars back on the same bar sequence, na before the first bar (_hist).
  * `for i = a to b` is inclusive at both ends and steps by -1 when a > b (pine_range).
  * CountRun / Adopted are reference objects: array.get returns the object itself, field
    assignments mutate it, Adopted.new() is a fresh object whose fields are all na.
  * Non-var globals (complete, refreshed, completionTips, trueHi, trueLo) are rebuilt every bar;
    var globals persist. The main block runs once per confirmed bar (lines 308-309); only confirmed
    bars are fed to the engine, so barstate.isconfirmed is always true here. State changes start at
    bar_index 5 (line 310).
  * v6 `and`/`or` short-circuit; no operand in this script has a side effect, so evaluation order
    cannot matter.

CLI (canonical dump, see dump_text):
  python3 verify/ref/td_ref.py --out <dir> [--variant f.json] [--tickers a,b] [--tfs 1D,2W]
                               [--data data/daily] [--jobs N]
"""

import argparse
import collections
import json
import os
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import bars_ref  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(_HERE))

# ------------------------------------------------------------------------------------------------
# Inputs. name -> (type, default, constraint). Defaults are the script defaults (lines 16-55).
# ------------------------------------------------------------------------------------------------
FINAL_OPTIONS = ('Close', 'Open or Close', 'Wick')
POLICY_OPTIONS = ('Independent', 'Keep active', 'Recycle range', 'Newest')

INPUTS = collections.OrderedDict([
    ('enableSeq', ('bool', True, None)),                          # 16
    ('enableCombo', ('bool', True, None)),                        # 17
    ('enableAggSeq', ('bool', False, None)),                      # 18
    ('enableAggCombo', ('bool', True, None)),                     # 19
    ('seqFinal', ('string', 'Open or Close', FINAL_OPTIONS)),     # 21
    ('seqQ138', ('bool', True, None)),                            # 22
    ('seqQ85', ('bool', False, None)),                            # 23
    ('seqTicks', ('int', 0, (0, 10))),                            # 24
    ('comboFinal', ('string', 'Wick', FINAL_OPTIONS)),            # 26
    ('comboRelaxed', ('bool', True, None)),                       # 27
    ('comboTicks', ('int', 0, (0, 10))),                          # 28
    ('showRefresh', ('bool', True, None)),                        # 29
    ('aggQ138', ('bool', True, None)),                            # 31
    ('aggQ85', ('bool', False, None)),                            # 32
    ('aggComboRelaxed', ('bool', True, None)),                    # 33
    ('originPolicy', ('string', 'Independent', POLICY_OPTIONS)),  # 35
    ('rejectSmaller', ('bool', False, None)),                     # 36
    ('recycleMin', ('float', 100.0, (0.0, 1000.0))),              # 37
    ('recycleMax', ('float', 200.0, (0.0, 1000.0))),              # 38
    ('cancelOpposite', ('bool', True, None)),                     # 39
    ('cancelTDST', ('bool', False, None)),                        # 40
    ('restart22', ('bool', False, None)),                         # 41
    ('maxOrigins', ('int', 8, (1, 16))),                          # 42
    ('showSetups', ('bool', True, None)),                         # 44
    ('setupNineOnly', ('bool', True, None)),                      # 45
    ('wrapSetup', ('bool', True, None)),                          # 46
    ('showCounts', ('bool', False, None)),                        # 47
    ('newestCountsOnly', ('bool', True, None)),                   # 48
    ('showBackfill', ('bool', False, None)),                      # 49
    ('showDeferred', ('bool', True, None)),                       # 50
    ('showCancelMarks', ('bool', False, None)),                   # 51
    ('prefix', ('bool', False, None)),                            # 54
    ('labelLimit', ('int', 400, (50, 480))),                      # 55
    ('mintick', ('float', 0.01, 'positive')),                     # syminfo.mintick (contract)
])
# Display-only inputs of the script: accepted and validated, but they cannot change any label.
DISPLAY_ONLY = collections.OrderedDict([
    ('showTDST', ('bool', False, None)),                          # 52
    ('showPanel', ('bool', True, None)),                          # 53
    ('spacing', ('float', 0.25, (0.05, 2.0))),                    # 56
    ('seqColor', ('color', None, None)),                          # 57
    ('comboColor', ('color', None, None)),                        # 58
    ('aggSeqColor', ('color', None, None)),                       # 59
    ('aggComboColor', ('color', None, None)),                     # 60
    ('setupColor', ('color', None, None)),                        # 61
])


def _check_option(name, spec, value):
    kind, _default, constraint = spec
    if kind == 'color':
        return value
    if kind == 'bool':
        if not isinstance(value, bool):
            raise ValueError('option %s must be true/false, got %r' % (name, value))
        return value
    if kind == 'string':
        if value not in constraint:
            raise ValueError('option %s must be one of %r, got %r' % (name, constraint, value))
        return value
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError('option %s must be a number, got %r' % (name, value))
    if kind == 'int':
        if isinstance(value, float):
            if value != int(value):
                raise ValueError('option %s must be an integer, got %r' % (name, value))
            value = int(value)
    else:
        value = float(value)
    if constraint == 'positive':
        if not value > 0:
            raise ValueError('option %s must be > 0, got %r' % (name, value))
    elif constraint is not None:
        lo, hi = constraint
        if value < lo or value > hi:
            raise ValueError('option %s must be within [%r, %r] (Pine minval/maxval), got %r'
                             % (name, lo, hi, value))
    return value


def resolve_options(variant=None):
    """Script defaults overridden by a variant mapping {pineVariableName: value}."""
    opts = collections.OrderedDict((name, spec[1]) for name, spec in INPUTS.items())
    for name, value in (variant or {}).items():
        if name in INPUTS:
            opts[name] = _check_option(name, INPUTS[name], value)
        elif name in DISPLAY_ONLY:
            _check_option(name, DISPLAY_ONLY[name], value)   # validated, has no effect on labels
        else:
            raise ValueError('unknown option %r' % (name,))
    return opts


# ------------------------------------------------------------------------------------------------
# Pine primitives
# ------------------------------------------------------------------------------------------------
def _lt(a, b):
    return a is not None and b is not None and a < b


def _le(a, b):
    return a is not None and b is not None and a <= b


def _gt(a, b):
    return a is not None and b is not None and a > b


def _ge(a, b):
    return a is not None and b is not None and a >= b


def _eq(a, b):
    return a is not None and b is not None and a == b


def _sub(a, b):
    return None if a is None or b is None else a - b


def _add(a, b):
    return None if a is None or b is None else a + b


def _max(a, b):
    """math.max: na if any argument is na."""
    return None if a is None or b is None else (a if a >= b else b)


def _min(a, b):
    """math.min: na if any argument is na."""
    return None if a is None or b is None else (a if a <= b else b)


def _nz(x, y):
    return y if x is None else x


def pine_range(a, b):
    """`for i = a to b`: both ends inclusive, step -1 when a > b."""
    return range(a, b + 1) if a <= b else range(a, b - 1, -1)


class PineRuntimeError(Exception):
    """runtime.error() of the script."""


# 63-77
class CountRun(object):
    # family:0=Seq,1=AggSeq,2=Combo,3=AggCombo; direction:-1=buy,+1=sell.
    __slots__ = ('family', 'direction', 'originBar', 'originTime', 'setupStart', 'chainStart', 'tdst',
                 'n', 'lastCounted', 'close5', 'close8', 'refresh', 'lastProcessed')

    def __init__(self, family, direction, originBar, originTime, setupStart, chainStart, tdst):
        self.family = family                 # 65
        self.direction = direction           # 66
        self.originBar = originBar           # 67
        self.originTime = originTime         # 68
        self.setupStart = setupStart         # 69
        self.chainStart = chainStart         # 70
        self.tdst = tdst                     # 71
        self.n = 0                           # 72
        self.lastCounted = None              # 73
        self.close5 = None                   # 74
        self.close8 = None                   # 75
        self.refresh = False                 # 76
        self.lastProcessed = -1              # 77

    def __repr__(self):
        return 'CountRun(f=%d d=%d origin=%d n=%d last=%r)' % (
            self.family, self.direction, self.originBar, self.n, self.lastCounted)


# 79-84
class Adopted(object):
    __slots__ = ('chainStart', 'hi', 'lo', 'tdst', 'originBar')

    def __init__(self):
        self.chainStart = None               # 80
        self.hi = None                       # 81
        self.lo = None                       # 82
        self.tdst = None                     # 83
        self.originBar = None                # 84


# 99-100
def f_slot(family, direction):
    return family * 2 + (1 if direction == 1 else 0)


# 116-121
def f_short(family):
    if family == 0:
        return 'S'
    if family == 1:
        return 'AS'
    if family == 2:
        return 'C'
    return 'AC*'


# 130-131
def f_compare(value, boundary, direction, strict, tolerance):
    if direction == -1:
        limit = _add(boundary, tolerance)
        return _lt(value, limit) if strict else _le(value, limit)
    limit = _sub(boundary, tolerance)
    return _gt(value, limit) if strict else _ge(value, limit)


# Label kinds of the canonical dump.
KIND_SETUP = 'S'         # 365-375
KIND_INTERMEDIATE = 'I'  # 144-155 (countdown numbers 1-12, deferrals +8/+13)
KIND_CANCEL = 'X'        # 223 and 351
KIND_COMPLETE = 'C'      # 394-403


class Engine(object):
    """One script instance on one chart (ticker + timeframe), fed with its confirmed bars."""

    def __init__(self, opts, opens, highs, lows, closes, times=None):
        for name in INPUTS:
            setattr(self, name, opts[name])
        if not (len(opens) == len(highs) == len(lows) == len(closes)):
            raise ValueError('OHLC lengths differ')
        self.O = list(opens)
        self.H = list(highs)
        self.L = list(lows)
        self.C = list(closes)
        self.T = list(times) if times is not None else list(range(len(closes)))
        self.bar_index = -1
        # Every label.new() of the script, in creation order:
        # (x bar index, kind, direction, family or None, text, extra)
        #   extra: S -> raw setup count; I/X -> originBar of the run; C -> list of originBars in
        #   completionTips order.
        self.labels = []
        self.alive = []          # False once deleted by the labelLimit FIFO (lines 137-138)
        # var globals
        self.runs = []                                   # 86
        self.anchors = []                                # 87
        self.labelQueue = collections.deque()            # 88
        self.counters = [0, 0, 0, 0]                     # 90
        self.buyRaw = 0                                  # 292
        self.sellRaw = 0                                 # 293
        self.buyStart = None                             # 294
        self.sellStart = None                            # 295
        self.buyHi = None                                # 296
        self.buyLo = None                                # 297
        self.sellHi = None                               # 298
        self.sellLo = None                               # 299
        self.committed = None                            # 300
        # non-var globals, rebuilt every bar (91-93, 96-97)
        self.complete = None
        self.refreshed = None
        self.completionTips = None
        self.trueHi = None
        self.trueLo = None

    # x[k] on the current bar: na before the first bar.
    def _hist(self, series, k):
        i = self.bar_index - k
        return series[i] if i >= 0 else None

    # 102-107
    def f_enabled(self, family):
        if family == 0:
            return self.enableSeq
        if family == 1:
            return self.enableAggSeq
        if family == 2:
            return self.enableCombo
        return self.enableAggCombo

    # 133-139. y, colour, tooltip, style and size are display-only and not modelled.
    def f_emitLabel(self, x, txt, direction, kind, family, extra):
        idx = len(self.labels)
        self.labels.append((x, kind, direction, family, txt, extra))     # 135 label.new
        self.alive.append(True)
        self.labelQueue.append(idx)                                      # 136
        if len(self.labelQueue) > self.labelLimit:                       # 137
            self.alive[self.labelQueue.popleft()] = False                # 138
        return idx                                                       # 139

    # 144-155
    def f_intermediate(self, r, offset, status):
        anchor = self.anchors[f_slot(r.family, r.direction)]                              # 145
        selected = (not self.newestCountsOnly) or _eq(anchor.originBar, r.originBar)      # 146
        eligible = selected and ((status > 0 and status < 13 and self.showCounts)
                                 or (status < 0 and self.showDeferred))                   # 147
        if eligible:                                                                      # 148
            # 149-151 label y (display-only)
            txt = ('+' + str(-status)) if status < 0 else str(status)                    # 152
            # 153 provenance tooltip (display-only)
            self.f_emitLabel(self.bar_index - offset, txt, r.direction, KIND_INTERMEDIATE,
                             r.family, r.originBar)                                       # 154
        return eligible                                                                   # 155

    # 157-165
    def f_comboAccept(self, r, offset, value, wick):
        tolerance = self.comboTicks * self.mintick if r.n == 12 else 0.0                  # 158
        progression = r.lastCounted is None or f_compare(value, r.lastCounted, r.direction,
                                                         False, tolerance)                # 159
        accepted = progression                                                            # 160
        if r.n < 10 or not self.comboRelaxed:                                             # 161
            if r.direction == -1:
                boundary = self._hist(self.L, offset + 2)                                 # 162
                prevWick = self._hist(self.L, offset + 1)                                 # 163
            else:
                boundary = self._hist(self.H, offset + 2)                                 # 162
                prevWick = self._hist(self.H, offset + 1)                                 # 163
            accepted = (progression
                        and f_compare(value, boundary, r.direction, False, 0.0)
                        and f_compare(wick, prevWick, r.direction, False, 0.0)
                        and f_compare(value, self._hist(self.C, offset + 1), r.direction,
                                      True, 0.0))                                         # 164
        return accepted                                                                   # 165

    # 167-215. Mutates only this run. Returns accepted count, negative deferred count, or 0.
    def f_advance(self, r, offset):
        c = self._hist(self.C, offset)                                                    # 169
        o = self._hist(self.O, offset)                                                    # 170
        wick = self._hist(self.L, offset) if r.direction == -1 else self._hist(self.H, offset)  # 171
        last = r.n == 12                                                                  # 172
        accepted = False                                                                  # 173
        status = 0                                                                        # 174
        if r.family < 2:                                                                  # 175
            boundary = (self._hist(self.L, offset + 2) if r.direction == -1
                        else self._hist(self.H, offset + 2))                              # 176
            tolerance = self.seqTicks * self.mintick if last else 0.0                     # 177
            value = wick if r.family == 1 else c                                          # 178
            accepted = f_compare(value, boundary, r.direction, False, tolerance)          # 179
            if last and r.family == 0:                                                    # 180
                if self.seqFinal == 'Open or Close':                                      # 181
                    accepted = accepted or f_compare(o, boundary, r.direction, False, tolerance)     # 182
                elif self.seqFinal == 'Wick':                                             # 183
                    accepted = accepted or f_compare(wick, boundary, r.direction, False, tolerance)  # 184
            qualifier85 = self.seqQ85 if r.family == 0 else self.aggQ85                   # 185
            qualifier138 = self.seqQ138 if r.family == 0 else self.aggQ138                # 186
            if accepted and r.n == 7 and qualifier85 and (
                    r.close5 is None or not f_compare(wick, r.close5, r.direction, False, 0.0)):    # 187
                accepted = False                                                          # 188
                status = -8                                                               # 189
            if accepted and last and qualifier138 and (
                    r.close8 is None or not f_compare(wick, r.close8, r.direction, False, 0.0)):    # 190
                accepted = False                                                          # 191
                status = -13                                                              # 192
        elif r.family == 2:                                                               # 193
            accepted = self.f_comboAccept(r, offset, c, wick)                             # 194
            if last:                                                                      # 195
                if self.comboFinal == 'Open or Close':                                    # 196
                    accepted = accepted or self.f_comboAccept(r, offset, o, wick)         # 197
                elif self.comboFinal == 'Wick':                                           # 198
                    accepted = accepted or self.f_comboAccept(r, offset, wick, wick)      # 199
        else:                                                                             # 200
            accepted = r.lastCounted is None or f_compare(wick, r.lastCounted, r.direction,
                                                          False, 0.0)                     # 201
            if r.n < 10 or not self.aggComboRelaxed:                                      # 202
                if r.direction == -1:
                    boundary = self._hist(self.L, offset + 2)                             # 203
                    prevWick = self._hist(self.L, offset + 1)                             # 204
                else:
                    boundary = self._hist(self.H, offset + 2)                             # 203
                    prevWick = self._hist(self.H, offset + 1)                             # 204
                accepted = (accepted
                            and f_compare(wick, boundary, r.direction, False, 0.0)
                            and f_compare(wick, prevWick, r.direction, True, 0.0))        # 205
        if accepted:                                                                      # 206
            r.n += 1                                                                      # 207
            r.lastCounted = wick if r.family == 3 else c                                  # 208
            if r.n == 5:                                                                  # 209
                r.close5 = c                                                              # 210
            if r.n == 8:                                                                  # 211
                r.close8 = c                                                              # 212
            status = r.n                                                                  # 213
        r.lastProcessed = self.bar_index - offset                                         # 214
        return status                                                                     # 215

    # 217-229
    def f_removeDirection(self, direction, reason, clearAnchors):
        if len(self.runs) > 0:                                                            # 218
            for i in pine_range(len(self.runs) - 1, 0):                                   # 219
                r = self.runs[i]                                                          # 220
                if r.direction == direction:                                              # 221
                    if self.showCancelMarks:                                              # 222
                        self.f_emitLabel(self.bar_index, 'x', direction, KIND_CANCEL,
                                         r.family, r.originBar)                           # 223
                    del self.runs[i]                                                      # 224
                    self.counters[3] += 1                                                 # 225
        if clearAnchors:                                                                  # 226
            for family in pine_range(0, 3):                                               # 227
                self.anchors[f_slot(family, direction)] = Adopted()                       # 228
        return True                                                                       # 229

    # 231-280
    def f_start(self, family, direction, chainStart, chainHi, chainLo, raw22):
        slot = f_slot(family, direction)                                                  # 232
        anchor = self.anchors[slot]                                                       # 233
        span = _sub(chainHi, chainLo)                                                     # 234
        oldSpan = _sub(anchor.hi, anchor.lo)                                              # 235
        ratio = (span / oldSpan * 100.0) if (oldSpan is not None and oldSpan > 0
                                             and span is not None) else None              # 236
        active = 0                                                                        # 237
        if len(self.runs) > 0:                                                            # 238
            for r in self.runs:                                                           # 239
                if r.family == family and r.direction == direction:                       # 240
                    active += 1                                                           # 241
        small = (self.rejectSmaller and oldSpan is not None and _lt(span, oldSpan)
                 and not raw22)                                                           # 242
        accept = (active == 0 or self.originPolicy == 'Independent'
                  or self.originPolicy == 'Newest' or raw22
                  or (self.originPolicy == 'Recycle range' and ratio is not None
                      and ratio >= self.recycleMin and ratio <= self.recycleMax))         # 243
        if small:                                                                         # 244
            self.counters[1] += 1                                                         # 245
            accept = False                                                                # 246
        elif not accept:                                                                  # 247
            self.counters[2] += 1                                                         # 248
        if accept:                                                                        # 249
            if (self.originPolicy != 'Independent' or raw22) and len(self.runs) > 0:      # 250
                for i in pine_range(len(self.runs) - 1, 0):                               # 251
                    old = self.runs[i]                                                    # 252
                    if old.family == family and old.direction == direction:               # 253
                        del self.runs[i]                                                  # 254
                        self.counters[3] += 1                                             # 255
                active = 0                                                                # 256
            if active >= self.maxOrigins:                                                 # 257
                oldest = None                                                             # 258
                for i in pine_range(0, len(self.runs) - 1):                               # 259
                    candidate = self.runs[i]                                              # 260
                    if (oldest is None and candidate.family == family
                            and candidate.direction == direction):                        # 261
                        oldest = i                                                        # 262
                if oldest is not None:                                                    # 263
                    del self.runs[oldest]                                                 # 264
                    self.counters[0] += 1                                                 # 265
            tdst = chainHi if direction == -1 else chainLo                                # 266
            r = CountRun(family, direction, self.bar_index, self.T[self.bar_index],
                         self.bar_index if raw22 else self.bar_index - 8, chainStart, tdst)   # 267
            self.runs.append(r)                                                           # 268
            anchor.chainStart = chainStart                                                # 269
            anchor.hi = chainHi                                                           # 270
            anchor.lo = chainLo                                                           # 271
            anchor.tdst = tdst                                                            # 272
            anchor.originBar = self.bar_index                                             # 273
            # Replay exactly once on confirmed9; current bar is INCLUDED here.            # 274
            if family >= 2 and not raw22:                                                 # 275
                for offset in pine_range(8, 0):                                           # 276
                    status = self.f_advance(r, offset)                                    # 277
                    if offset == 0 or self.showBackfill:                                  # 278
                        self.f_intermediate(r, offset, status)                            # 279
        return accept                                                                     # 280

    # ---- one confirmed bar -------------------------------------------------------------------
    def step(self):
        """Run the script once on the next confirmed bar."""
        self.bar_index += 1
        b = self.bar_index
        high = self.H[b]
        low = self.L[b]
        close = self.C[b]
        self.complete = [0] * 8                                     # 91
        self.refreshed = [False] * 8                                # 92
        self.completionTips = [[] for _ in range(8)]                # 93 (origins of the tips)
        # 94-95 atr14 / pad: display-only (label y positions)
        prevClose = self._hist(self.C, 1)
        self.trueHi = _max(high, _nz(prevClose, high))              # 96
        self.trueLo = _min(low, _nz(prevClose, low))                # 97

        if b == 0:                                                  # 302 barstate.isfirst
            for _slot in pine_range(0, 7):                          # 303
                self.anchors.append(Adopted())                      # 304
            if self.recycleMin > self.recycleMax:                   # 305
                raise PineRuntimeError('Recycle minimum must not exceed maximum.')   # 306

        # 308: barstate.isconfirmed is true (only confirmed bars are fed in)
        if self.committed is None or self.committed != b:
            self.committed = b                                      # 309
            if b >= 5:                                              # 310
                self._main(high, low, close)

    def _main(self, high, low, close):
        b = self.bar_index
        trueHi = self.trueHi
        trueLo = self.trueLo
        buyContinues = _lt(close, self._hist(self.C, 4)) and (
            self.buyRaw > 0 or _gt(self._hist(self.C, 1), self._hist(self.C, 5)))          # 311
        sellContinues = _gt(close, self._hist(self.C, 4)) and (
            self.sellRaw > 0 or _lt(self._hist(self.C, 1), self._hist(self.C, 5)))         # 312
        self.buyRaw = self.buyRaw + 1 if buyContinues else 0                               # 313
        self.sellRaw = self.sellRaw + 1 if sellContinues else 0                            # 314
        if self.buyRaw == 1:                                                               # 315
            self.buyStart = b                                                              # 316
            self.buyHi = trueHi                                                            # 317
            self.buyLo = trueLo                                                            # 318
        elif self.buyRaw > 1:                                                              # 319
            self.buyHi = _max(self.buyHi, trueHi)                                          # 320
            self.buyLo = _min(self.buyLo, trueLo)                                          # 321
        if self.sellRaw == 1:                                                              # 322
            self.sellStart = b                                                             # 323
            self.sellHi = trueHi                                                           # 324
            self.sellLo = trueLo                                                           # 325
        elif self.sellRaw > 1:                                                             # 326
            self.sellHi = _max(self.sellHi, trueHi)                                        # 327
            self.sellLo = _min(self.sellLo, trueLo)                                        # 328
        # Extend ONLY the adopted reference, using prices known now.                      # 329
        for slot in pine_range(0, 7):                                                      # 330
            a = self.anchors[slot]                                                         # 331
            buy = slot % 2 == 0                                                            # 332
            if buy and self.buyRaw > 0 and _eq(a.chainStart, self.buyStart):               # 333
                a.hi = self.buyHi                                                          # 334
                a.lo = self.buyLo                                                          # 335
            if (not buy) and self.sellRaw > 0 and _eq(a.chainStart, self.sellStart):       # 336
                a.hi = self.sellHi                                                         # 337
                a.lo = self.sellLo                                                         # 338
        # Opposite9 and TDST invalidation precede current-bar13.                          # 339
        if self.cancelOpposite:                                                            # 340
            if self.buyRaw == 9:                                                           # 341
                self.f_removeDirection(1, 'opposite Setup9', True)                         # 342
            if self.sellRaw == 9:                                                          # 343
                self.f_removeDirection(-1, 'opposite Setup9', True)                        # 344
        if self.cancelTDST and len(self.runs) > 0:                                         # 345
            for i in pine_range(len(self.runs) - 1, 0):                                    # 346
                r = self.runs[i]                                                           # 347
                broken = _gt(trueLo, r.tdst) if r.direction == -1 else _lt(trueHi, r.tdst)  # 348
                if broken:                                                                 # 349
                    if self.showCancelMarks:                                               # 350
                        self.f_emitLabel(b, 'x', r.direction, KIND_CANCEL, r.family,
                                         r.originBar)                                      # 351
                    del self.runs[i]                                                       # 352
                    self.counters[3] += 1                                                  # 353
        for family in pine_range(0, 3):                                                    # 354
            if self.f_enabled(family):                                                     # 355
                if self.buyRaw == 9:                                                       # 356
                    self.f_start(family, -1, self.buyStart, self.buyHi, self.buyLo, False)      # 357
                if self.sellRaw == 9:                                                      # 358
                    self.f_start(family, 1, self.sellStart, self.sellHi, self.sellLo, False)    # 359
                if self.restart22 and family < 2:                                          # 360
                    if self.buyRaw == 22:                                                  # 361
                        self.f_start(family, -1, self.buyStart, self.buyHi, self.buyLo, True)   # 362
                    if self.sellRaw == 22:                                                 # 363
                        self.f_start(family, 1, self.sellStart, self.sellHi, self.sellLo, True)  # 364
        if self.showSetups:                                                                # 365
            if self.buyRaw > 0:                                                            # 366
                displayed = (self.buyRaw - 1) % 9 + 1 if self.wrapSetup else self.buyRaw   # 367
                if not self.setupNineOnly or displayed == 9:                               # 368
                    perfected = self.buyRaw == 9 and _le(
                        _min(low, self._hist(self.L, 1)),
                        _min(self._hist(self.L, 2), self._hist(self.L, 3)))                # 369
                    self.f_emitLabel(b, str(displayed) + ('*' if perfected else ''), -1,
                                     KIND_SETUP, None, self.buyRaw)                        # 370
            if self.sellRaw > 0:                                                           # 371
                displayed = (self.sellRaw - 1) % 9 + 1 if self.wrapSetup else self.sellRaw  # 372
                if not self.setupNineOnly or displayed == 9:                               # 373
                    perfected = self.sellRaw == 9 and _ge(
                        _max(high, self._hist(self.H, 1)),
                        _max(self._hist(self.H, 2), self._hist(self.H, 3)))                # 374
                    self.f_emitLabel(b, str(displayed) + ('*' if perfected else ''), 1,
                                     KIND_SETUP, None, self.sellRaw)                       # 375
        complete = self.complete
        refreshed = self.refreshed
        completionTips = self.completionTips
        if len(self.runs) > 0:                                                             # 376
            for i in pine_range(len(self.runs) - 1, 0):                                    # 377
                r = self.runs[i]                                                           # 378
                if (self.buyRaw if r.direction == -1 else self.sellRaw) >= 18:             # 379
                    r.refresh = True                                                       # 380
                # Combo's new origin bar was counted during replay; never count twice.    # 381
                if r.lastProcessed != b:                                                   # 382
                    status = self.f_advance(r, 0)                                          # 383
                    if status == 13:                                                       # 384
                        slot = f_slot(r.family, r.direction)                               # 385
                        complete[slot] = complete[slot] + 1                                # 386
                        refreshed[slot] = refreshed[slot] or (
                            self.showRefresh and r.family >= 2 and r.refresh)              # 387
                        completionTips[slot].append(r.originBar)                           # 388-389
                        del self.runs[i]                                                   # 390
                    else:                                                                  # 391
                        self.f_intermediate(r, 0, status)                                  # 392
        # Aggregate same-family/same-bar completions; never hide another family.          # 393
        for slot in pine_range(0, 7):                                                      # 394
            amount = complete[slot]                                                        # 395
            if amount > 0:                                                                 # 396
                family = int(slot / 2)                                                     # 397
                direction = -1 if slot % 2 == 0 else 1                                     # 398
                txt = (((f_short(family) + ' ') if self.prefix else '') + '13'
                       + ('r' if refreshed[slot] else '')
                       + (('x' + str(amount)) if amount > 1 else ''))                      # 399
                # 400-402 label y (display-only)
                self.f_emitLabel(b, txt, direction, KIND_COMPLETE, family,
                                 list(completionTips[slot]))                               # 403
        # 405-444: TDST plots, status table and alertconditions are display-only.

    def run(self):
        for _ in range(len(self.C)):
            self.step()
        return self


# ------------------------------------------------------------------------------------------------
# Canonical dump
# ------------------------------------------------------------------------------------------------
def run_bars(bars, opts):
    """Run the engine over a list of confirmed bars_ref.Bar objects."""
    return Engine(opts, [b.o for b in bars], [b.h for b in bars], [b.l for b in bars],
                  [b.c for b in bars], [b.start for b in bars]).run()


def dump_lines(bars, engine):
    iso = bars_ref.iso
    starts = [b.start for b in bars]
    out = ['B\t%d\t%s' % (len(bars), bars_ref.bars_sha1(bars))]
    for x, kind, direction, family, txt, extra in engine.labels:
        if kind == KIND_SETUP:
            fam = '-'
            ex = '%d' % extra
        elif kind == KIND_COMPLETE:
            fam = '%d' % family
            ex = ','.join(iso(starts[i]) for i in extra)
        else:
            fam = '%d' % family
            ex = iso(starts[extra])
        out.append('L\t%s\t%s\t%d\t%s\t%s\t%s' % (iso(starts[x]), kind, direction, fam, txt, ex))
    runs = sorted(engine.runs, key=lambda r: (r.family, r.direction, r.originBar))
    out.append('E\t%d\t%d\t%s' % (engine.buyRaw, engine.sellRaw, ';'.join(
        '%d,%d,%s,%d' % (r.family, r.direction, iso(starts[r.originBar]), r.n) for r in runs)))
    return out


def dump_text(bars, engine):
    return '\n'.join(dump_lines(bars, engine)) + '\n'


def _process_ticker(job):
    ticker, tfs, data_dir, out_dir, opts, last_closed_day = job
    t0 = time.time()
    daily = bars_ref.load_daily(data_dir, ticker)
    fid = bars_ref.file_id(ticker)
    counts = collections.Counter()
    if daily.get('m') is None and any(tf.endswith('M') for tf in tfs):
        counts['noMonthly'] += 1      # month timeframes rebuilt from the daily bars
    for tf in tfs:
        bars = bars_ref.confirmed_prefix(bars_ref.build_bars(daily, tf), last_closed_day)
        engine = run_bars(bars, opts)
        text = dump_text(bars, engine)
        with open(os.path.join(out_dir, '%s__%s.tsv' % (fid, tf)), 'wb') as f:
            f.write(text.encode('utf-8'))
        counts['files'] += 1
        counts['bars'] += len(bars)
        for lab in engine.labels:
            counts['L' + lab[1]] += 1
    return ticker, counts, time.time() - t0


def _default_data_dir():
    if os.path.isdir(os.path.join('data', 'daily')):
        return os.path.join('data', 'daily')
    return os.path.join(REPO_ROOT, 'data', 'daily')


def _tickers_json(data_dir):
    for cand in (os.path.join(os.path.dirname(os.path.abspath(data_dir)), 'tickers.json'),
                 os.path.join(REPO_ROOT, 'data', 'tickers.json')):
        if os.path.isfile(cand):
            return cand
    raise FileNotFoundError('data/tickers.json not found next to %s' % data_dir)


def main(argv=None):
    ap = argparse.ArgumentParser(description='TD Research v6 reference port: canonical dump writer')
    ap.add_argument('--out', required=True, help='output directory')
    ap.add_argument('--variant', help='JSON file {pineInputName: value}')
    ap.add_argument('--tickers', help='comma list of ticker ids (default: every coins[].usd)')
    ap.add_argument('--tfs', help='comma list of timeframes (default: the 20 screener timeframes)')
    ap.add_argument('--data', help='daily data directory (default data/daily)')
    ap.add_argument('--jobs', type=int, default=os.cpu_count() or 1, help='worker processes')
    args = ap.parse_args(argv)

    variant = None
    if args.variant:
        with open(args.variant, 'r', encoding='utf-8') as f:
            variant = json.load(f)
        if not isinstance(variant, dict):
            ap.error('--variant must hold a JSON object')
    opts = resolve_options(variant)
    if opts['recycleMin'] > opts['recycleMax']:
        # line 305-306: the script stops with runtime.error on its first bar; no labels exist.
        ap.error('recycleMin > recycleMax: the script raises runtime.error (lines 305-306)')

    data_dir = args.data or _default_data_dir()
    if args.tickers:
        tickers = [t.strip() for t in args.tickers.split(',') if t.strip()]
    else:
        tickers = bars_ref.load_usd_tickers(_tickers_json(data_dir))
    tfs = [t.strip() for t in args.tfs.split(',')] if args.tfs else list(bars_ref.TIMEFRAMES)
    for tf in tfs:
        bars_ref.parse_tf(tf)
    last_closed_day = bars_ref.load_last_closed_day(data_dir)
    os.makedirs(args.out, exist_ok=True)

    t0 = time.time()
    jobs = [(t, tfs, data_dir, args.out, dict(opts), last_closed_day) for t in tickers]
    total = collections.Counter()
    slowest = []
    if args.jobs > 1 and len(jobs) > 1:
        import multiprocessing
        with multiprocessing.Pool(args.jobs) as pool:
            for ticker, counts, secs in pool.imap_unordered(_process_ticker, jobs, chunksize=1):
                total.update(counts)
                slowest.append((secs, ticker))
    else:
        for job in jobs:
            ticker, counts, secs = _process_ticker(job)
            total.update(counts)
            slowest.append((secs, ticker))
    elapsed = time.time() - t0
    slowest.sort(reverse=True)
    sys.stdout.write('tickers %d, timeframes %d, files %d, confirmed bars %d, labels S=%d I=%d X=%d C=%d\n'
                     % (len(tickers), len(tfs), total['files'], total['bars'], total['LS'],
                        total['LI'], total['LX'], total['LC']))
    if total['noMonthly']:
        sys.stderr.write('%d tickers without TradingView 1M bars (m): month timeframes rebuilt from 1D\n'
                         % total['noMonthly'])
    sys.stdout.write('lastClosedDay %s, out %s, %.1f s wall (%d jobs); slowest ticker %s %.1f s\n'
                     % (bars_ref.iso(last_closed_day), args.out, elapsed, args.jobs,
                        slowest[0][1] if slowest else '-', slowest[0][0] if slowest else 0.0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
