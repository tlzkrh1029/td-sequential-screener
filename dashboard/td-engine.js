// TD Research v6 engine: a line-by-line port of kidze_td_research_v6.pine (Pine Script v6, 444 lines;
// tlzkrh1029/pinescript td-research-v6). The script is the spec: every 9 and 13 this engine creates must be the label
// the indicator draws on the TradingView chart with the same bars and inputs. Shared by the Node build and the
// screener page, which inlines it: plain ES module, no DOM, no Node APIs, no dependencies.
//
// runTD(bars, options) runs the script's main block (lines 302-403) once per bar of `bars`, which must be the
// CONFIRMED bars only, oldest first: the script changes state only on a confirmed bar (lines 308-309), so the bar
// still in progress on the chart never counts. "Line N" comments point at the Pine source.
//
// Pine semantics kept here: na is NaN, so every comparison with an na operand is false (as in Pine) and na() is
// Number.isNaN; x[k] reads k bars back on the same bar sequence and is na before the first bar; CountRun and Adopted
// objects are references (array.get returns the object, field assignments mutate it); `for i = a to b` counts down
// when a > b, both ends included. Display-only code (label y, pad, ATR, colors, tooltips, plots, the status table,
// alertcondition) is left out: it never decides which labels exist.

// ---------- inputs (lines 16-61), default values exactly as in the script ----------
export const V6_DEFAULTS = Object.freeze({
  // 1 | Families (lines 16-19)
  enableSeq: true,
  enableCombo: true,
  enableAggSeq: false,
  enableAggCombo: true,
  // 2 | Sequential (lines 21-24)
  seqFinal: 'Open or Close',
  seqQ138: true,
  seqQ85: false,
  seqTicks: 0,
  // 3 | Combo (lines 26-29)
  comboFinal: 'Wick',
  comboRelaxed: true,
  comboTicks: 0,
  showRefresh: true,
  // 4 | Aggressive candidates (lines 31-33)
  aggQ138: true,
  aggQ85: false,
  aggComboRelaxed: true,
  // 5 | Origins and cancellation (lines 35-42)
  originPolicy: 'Independent',
  rejectSmaller: false,
  recycleMin: 100.0,
  recycleMax: 200.0,
  cancelOpposite: true,
  cancelTDST: false,
  restart22: false,
  maxOrigins: 8,
  // 6 | Display (lines 44-61)
  showSetups: true,
  setupNineOnly: true,
  wrapSetup: true,
  showCounts: false,
  newestCountsOnly: true,
  showBackfill: false,
  showDeferred: true,
  showCancelMarks: false,
  showTDST: false,
  showPanel: true,
  prefix: false,
  labelLimit: 400,
  spacing: 0.25,
  seqColor: '#DC2A2A', // color.rgb(220, 42, 42)
  comboColor: '#74279A', // color.rgb(116, 39, 154)
  aggSeqColor: '#EB9223', // color.rgb(235, 146, 35)
  aggComboColor: '#E74BB1', // color.rgb(231, 75, 177)
  setupColor: '#787B86', // color.gray
});

// syminfo.mintick is not an input; runTD takes it as option `mintick`. It only matters when seqTicks or comboTicks > 0.
export const DEFAULT_MINTICK = 0.01;

// family: 0 = Sequential, 1 = Aggressive Sequential, 2 = Combo, 3 = Aggressive Combo candidate (line 63)
export const FAMILY_NAMES = Object.freeze(['Sequential', 'Aggressive Sequential', 'Combo', 'Aggressive Combo candidate']); // f_name, lines 109-114
export const FAMILY_SHORT = Object.freeze(['S', 'AS', 'C', 'AC*']); // f_short, lines 116-121
export const FAMILY_COLOR_INPUT = Object.freeze(['seqColor', 'aggSeqColor', 'comboColor', 'aggComboColor']); // f_color, lines 123-128

const FINALS = ['Close', 'Open or Close', 'Wick'];
const POLICIES = ['Independent', 'Keep active', 'Recycle range', 'Newest'];
// [kind, min, max] for every option; min/max are the input's minval/maxval
const OPTION_TYPES = {
  enableSeq: ['bool'], enableCombo: ['bool'], enableAggSeq: ['bool'], enableAggCombo: ['bool'],
  seqFinal: [FINALS], seqQ138: ['bool'], seqQ85: ['bool'], seqTicks: ['int', 0, 10],
  comboFinal: [FINALS], comboRelaxed: ['bool'], comboTicks: ['int', 0, 10], showRefresh: ['bool'],
  aggQ138: ['bool'], aggQ85: ['bool'], aggComboRelaxed: ['bool'],
  originPolicy: [POLICIES], rejectSmaller: ['bool'], recycleMin: ['float', 0, 1000], recycleMax: ['float', 0, 1000],
  cancelOpposite: ['bool'], cancelTDST: ['bool'], restart22: ['bool'], maxOrigins: ['int', 1, 16],
  showSetups: ['bool'], setupNineOnly: ['bool'], wrapSetup: ['bool'], showCounts: ['bool'], newestCountsOnly: ['bool'],
  showBackfill: ['bool'], showDeferred: ['bool'], showCancelMarks: ['bool'], showTDST: ['bool'], showPanel: ['bool'],
  prefix: ['bool'], labelLimit: ['int', 50, 480], spacing: ['float', 0.05, 2.0],
  seqColor: ['color'], comboColor: ['color'], aggSeqColor: ['color'], aggComboColor: ['color'], setupColor: ['color'],
  mintick: ['float', Number.MIN_VALUE, Infinity],
};

// Defaults merged with `options`; an unknown name or a value the input would not accept throws.
export function resolveOptions(options = {}) {
  const P = { ...V6_DEFAULTS, mintick: DEFAULT_MINTICK };
  for (const [name, value] of Object.entries(options ?? {})) {
    const t = OPTION_TYPES[name];
    if (!t) throw new Error(`unknown TD option "${name}"`);
    const [kind, min, max] = t;
    const ok = Array.isArray(kind) ? kind.includes(value)
      : kind === 'bool' ? typeof value === 'boolean'
        : kind === 'color' ? typeof value === 'string'
          : typeof value === 'number' && Number.isFinite(value) && (kind !== 'int' || Number.isInteger(value)) && value >= min && value <= max;
    if (!ok) {
      const want = Array.isArray(kind) ? kind.map((s) => JSON.stringify(s)).join(' | ') : kind === 'int' || kind === 'float' ? `${kind} in [${min}, ${max}]` : kind;
      throw new Error(`TD option ${name} = ${JSON.stringify(value)}: expected ${want}`);
    }
    P[name] = value;
  }
  return P;
}

// f_slot (lines 99-100)
const slotOf = (family, direction) => family * 2 + (direction === 1 ? 1 : 0);

// CountRun (lines 64-77). originTime is left out: it only feeds the tooltip text.
function newRun(family, direction, originBar, setupStart, chainStart, tdst) {
  return { family, direction, originBar, setupStart, chainStart, tdst, n: 0, lastCounted: NaN, close5: NaN, close8: NaN, refresh: false, lastProcessed: -1 };
}
// Adopted (lines 79-84): Adopted.new() is a fresh object with na fields
function newAdopted() {
  return { chainStart: NaN, hi: NaN, lo: NaN, tdst: NaN, originBar: NaN };
}

// f_compare (lines 130-131). With an na (NaN) operand every branch is false, as in Pine.
function compare(value, boundary, direction, strict, tolerance) {
  return direction === -1
    ? (strict ? value < boundary + tolerance : value <= boundary + tolerance)
    : (strict ? value > boundary - tolerance : value >= boundary - tolerance);
}

// Runs the script over `bars` = {o, h, l, c} (arrays or typed arrays of the confirmed bars, oldest first).
// Returns
//   labels  every label the script creates, in label.new order (including those its labelLimit FIFO later deletes):
//           {bar, kind, dir, family, text, raw, origin, origins, size}
//             bar     bar index the label is placed on (bar_index - offset for retrospective Combo numbers)
//             kind    'S' Setup (lines 365-375), 'I' countdown number / deferral (f_intermediate, lines 144-155),
//                     'X' cancellation mark (lines 223, 351), 'C' completed 13 (lines 394-403)
//             dir     -1 buy, 1 sell; family 0-3 (null for S)
//             text    the text the script draws: '9', '9*', '4', '+13', '13', '13r', '13x2', 'AC* 13rx2', 'x', ...
//             raw     S: raw setup count (null otherwise); origin: I/X: origin bar of the run (null otherwise)
//             origins C: origin bars of the completed runs, in the order their tooltips are appended (null otherwise)
//             size    'large' | 'small' | 'tiny'
//   chartVisibleFrom  index of the first label still on the chart after the labelLimit FIFO (lines 136-138)
//   state   the script's var state after the last bar (na -> null)
export function runTD(bars, options = {}) {
  const P = resolveOptions(options);
  const O = bars.o, H = bars.h, L = bars.l, C = bars.c;
  const N = C.length;
  if (O.length !== N || H.length !== N || L.length !== N) throw new Error('runTD: o, h, l and c must have the same length');
  // lines 305-306 (runtime.error on the first bar)
  if (P.recycleMin > P.recycleMax) throw new Error('Recycle minimum must not exceed maximum.');

  const enabled = [P.enableSeq, P.enableAggSeq, P.enableCombo, P.enableAggCombo]; // f_enabled, lines 102-107
  const seqTol = P.seqTicks * P.mintick; // seqTicks * syminfo.mintick (line 177)
  const comboTol = P.comboTicks * P.mintick; // comboTicks * syminfo.mintick (line 158)

  // var globals (lines 86-90, 292-300)
  const runs = []; // var array<CountRun> runs
  const anchors = []; // var array<Adopted> anchors
  const counters = [0, 0, 0, 0]; // 0 = capacity removals, 1 = small rejections, 2 = kept active, 3 = cancellations
  const labels = []; // every label.new, in order (the labelQueue FIFO of lines 136-138 is only applied as chartVisibleFrom)
  let buyRaw = 0, sellRaw = 0;
  let buyStart = NaN, sellStart = NaN, buyHi = NaN, buyLo = NaN, sellHi = NaN, sellLo = NaN;

  // non-var globals, re-initialised on every bar (lines 91-93, 96-97)
  const complete = [0, 0, 0, 0, 0, 0, 0, 0];
  const refreshed = [false, false, false, false, false, false, false, false];
  const tipOrigins = [[], [], [], [], [], [], [], []]; // completionTips: the runs whose f_tip was appended, in order
  let trueHi = NaN, trueLo = NaN;

  let bar = 0; // bar_index
  // close[k], open[k], high[k], low[k] on the current bar; na before the first bar
  const closeAt = (k) => (bar - k >= 0 ? C[bar - k] : NaN);
  const openAt = (k) => (bar - k >= 0 ? O[bar - k] : NaN);
  const highAt = (k) => (bar - k >= 0 ? H[bar - k] : NaN);
  const lowAt = (k) => (bar - k >= 0 ? L[bar - k] : NaN);

  // f_emitLabel (lines 133-139)
  function emit(x, kind, dir, family, text, size, raw, origin, origins) {
    labels.push({ bar: x, kind, dir, family, text, raw, origin, origins, size });
  }

  // f_intermediate (lines 144-155)
  function intermediate(r, offset, status) {
    const anchor = anchors[slotOf(r.family, r.direction)];
    const selected = !P.newestCountsOnly || anchor.originBar === r.originBar; // na originBar never matches
    const eligible = selected && ((status > 0 && status < 13 && P.showCounts) || (status < 0 && P.showDeferred));
    if (eligible) {
      const txt = status < 0 ? '+' + String(-status) : String(status); // line 152
      emit(bar - offset, 'I', r.direction, r.family, txt, 'tiny', null, r.originBar, null); // line 154
    }
    return eligible;
  }

  // f_comboAccept (lines 157-165)
  function comboAccept(r, offset, value, wick) {
    const tolerance = r.n === 12 ? comboTol : 0.0;
    const progression = Number.isNaN(r.lastCounted) || compare(value, r.lastCounted, r.direction, false, tolerance);
    let accepted = progression;
    if (r.n < 10 || !P.comboRelaxed) {
      const boundary = r.direction === -1 ? lowAt(offset + 2) : highAt(offset + 2);
      const prevWick = r.direction === -1 ? lowAt(offset + 1) : highAt(offset + 1);
      accepted = progression && compare(value, boundary, r.direction, false, 0.0) && compare(wick, prevWick, r.direction, false, 0.0)
        && compare(value, closeAt(offset + 1), r.direction, true, 0.0);
    }
    return accepted;
  }

  // f_advance (lines 167-215): mutates only this run; returns the accepted count, a negative deferred count, or 0
  function advance(r, offset) {
    const c = closeAt(offset); // line 169
    const o = openAt(offset); // line 170
    const wick = r.direction === -1 ? lowAt(offset) : highAt(offset); // line 171
    const last = r.n === 12; // line 172
    let accepted = false;
    let status = 0;
    if (r.family < 2) { // lines 175-192: Sequential, Aggressive Sequential
      const boundary = r.direction === -1 ? lowAt(offset + 2) : highAt(offset + 2);
      const tolerance = last ? seqTol : 0.0;
      const value = r.family === 1 ? wick : c;
      accepted = compare(value, boundary, r.direction, false, tolerance);
      if (last && r.family === 0) {
        if (P.seqFinal === 'Open or Close') accepted = accepted || compare(o, boundary, r.direction, false, tolerance);
        else if (P.seqFinal === 'Wick') accepted = accepted || compare(wick, boundary, r.direction, false, tolerance);
      }
      const qualifier85 = r.family === 0 ? P.seqQ85 : P.aggQ85;
      const qualifier138 = r.family === 0 ? P.seqQ138 : P.aggQ138;
      if (accepted && r.n === 7 && qualifier85 && (Number.isNaN(r.close5) || !compare(wick, r.close5, r.direction, false, 0.0))) {
        accepted = false; // line 188
        status = -8;
      }
      if (accepted && last && qualifier138 && (Number.isNaN(r.close8) || !compare(wick, r.close8, r.direction, false, 0.0))) {
        accepted = false; // line 191
        status = -13;
      }
    } else if (r.family === 2) { // lines 193-199: Combo
      accepted = comboAccept(r, offset, c, wick);
      if (last) {
        if (P.comboFinal === 'Open or Close') accepted = accepted || comboAccept(r, offset, o, wick);
        else if (P.comboFinal === 'Wick') accepted = accepted || comboAccept(r, offset, wick, wick);
      }
    } else { // lines 200-205: Aggressive Combo candidate
      accepted = Number.isNaN(r.lastCounted) || compare(wick, r.lastCounted, r.direction, false, 0.0);
      if (r.n < 10 || !P.aggComboRelaxed) {
        const boundary = r.direction === -1 ? lowAt(offset + 2) : highAt(offset + 2);
        const prevWick = r.direction === -1 ? lowAt(offset + 1) : highAt(offset + 1);
        accepted = accepted && compare(wick, boundary, r.direction, false, 0.0) && compare(wick, prevWick, r.direction, true, 0.0);
      }
    }
    if (accepted) { // lines 206-213
      r.n += 1;
      r.lastCounted = r.family === 3 ? wick : c;
      if (r.n === 5) r.close5 = c;
      if (r.n === 8) r.close8 = c;
      status = r.n;
    }
    r.lastProcessed = bar - offset; // line 214
    return status;
  }

  // f_removeDirection (lines 217-229)
  function removeDirection(direction, clearAnchors) {
    if (runs.length > 0) {
      for (let i = runs.length - 1; i >= 0; i--) {
        const r = runs[i];
        if (r.direction === direction) {
          if (P.showCancelMarks) emit(bar, 'X', direction, r.family, 'x', 'tiny', null, r.originBar, null); // line 223
          runs.splice(i, 1);
          counters[3] += 1;
        }
      }
    }
    if (clearAnchors) {
      for (let family = 0; family <= 3; family++) anchors[slotOf(family, direction)] = newAdopted(); // line 228
    }
    return true;
  }

  // f_start (lines 231-280)
  function start(family, direction, chainStart, chainHi, chainLo, raw22) {
    const slot = slotOf(family, direction);
    const anchor = anchors[slot];
    const span = chainHi - chainLo;
    const oldSpan = anchor.hi - anchor.lo;
    const ratio = !Number.isNaN(oldSpan) && oldSpan > 0 ? span / oldSpan * 100.0 : NaN;
    let active = 0;
    for (const r of runs) if (r.family === family && r.direction === direction) active += 1;
    const small = P.rejectSmaller && !Number.isNaN(oldSpan) && span < oldSpan && !raw22;
    let accept = active === 0 || P.originPolicy === 'Independent' || P.originPolicy === 'Newest' || raw22
      || (P.originPolicy === 'Recycle range' && !Number.isNaN(ratio) && ratio >= P.recycleMin && ratio <= P.recycleMax);
    if (small) { // lines 244-246
      counters[1] += 1;
      accept = false;
    } else if (!accept) { // lines 247-248
      counters[2] += 1;
    }
    if (accept) {
      if ((P.originPolicy !== 'Independent' || raw22) && runs.length > 0) { // lines 250-256
        for (let i = runs.length - 1; i >= 0; i--) {
          const old = runs[i];
          if (old.family === family && old.direction === direction) {
            runs.splice(i, 1);
            counters[3] += 1;
          }
        }
        active = 0;
      }
      if (active >= P.maxOrigins) { // lines 257-265: drop the oldest active origin of this family/direction
        let oldest = -1;
        for (let i = 0; i < runs.length; i++) {
          const candidate = runs[i];
          if (oldest < 0 && candidate.family === family && candidate.direction === direction) oldest = i;
        }
        if (oldest >= 0) {
          runs.splice(oldest, 1);
          counters[0] += 1;
        }
      }
      const tdst = direction === -1 ? chainHi : chainLo; // line 266
      const r = newRun(family, direction, bar, raw22 ? bar : bar - 8, chainStart, tdst); // line 267
      runs.push(r);
      anchor.chainStart = chainStart; // lines 269-273
      anchor.hi = chainHi;
      anchor.lo = chainLo;
      anchor.tdst = tdst;
      anchor.originBar = bar;
      // lines 274-279: Combo families replay the setup bars once on the confirmed 9, current bar included
      if (family >= 2 && !raw22) {
        for (let offset = 8; offset >= 0; offset--) {
          const status = advance(r, offset);
          if (offset === 0 || P.showBackfill) intermediate(r, offset, status);
        }
      }
    }
    return accept;
  }

  // line 302-304 (barstate.isfirst): eight empty anchors
  for (let slot = 0; slot <= 7; slot++) anchors.push(newAdopted());

  // lines 308-403: once per confirmed bar
  for (bar = 0; bar < N; bar++) {
    complete.fill(0); // lines 91-93
    refreshed.fill(false);
    for (const t of tipOrigins) t.length = 0;
    const high = H[bar], low = L[bar], close = C[bar];
    const prevClose = closeAt(1);
    trueHi = Math.max(high, Number.isNaN(prevClose) ? high : prevClose); // line 96
    trueLo = Math.min(low, Number.isNaN(prevClose) ? low : prevClose); // line 97
    if (bar < 5) continue; // line 310

    // lines 311-314: raw setup counts
    const buyContinues = close < closeAt(4) && (buyRaw > 0 || closeAt(1) > closeAt(5));
    const sellContinues = close > closeAt(4) && (sellRaw > 0 || closeAt(1) < closeAt(5));
    buyRaw = buyContinues ? buyRaw + 1 : 0;
    sellRaw = sellContinues ? sellRaw + 1 : 0;
    // lines 315-328: chain start and true extremes
    if (buyRaw === 1) {
      buyStart = bar;
      buyHi = trueHi;
      buyLo = trueLo;
    } else if (buyRaw > 1) {
      buyHi = Math.max(buyHi, trueHi);
      buyLo = Math.min(buyLo, trueLo);
    }
    if (sellRaw === 1) {
      sellStart = bar;
      sellHi = trueHi;
      sellLo = trueLo;
    } else if (sellRaw > 1) {
      sellHi = Math.max(sellHi, trueHi);
      sellLo = Math.min(sellLo, trueLo);
    }
    // lines 329-338: extend only the adopted reference, with prices known now
    for (let slot = 0; slot <= 7; slot++) {
      const a = anchors[slot];
      const buy = slot % 2 === 0;
      if (buy && buyRaw > 0 && a.chainStart === buyStart) {
        a.hi = buyHi;
        a.lo = buyLo;
      }
      if (!buy && sellRaw > 0 && a.chainStart === sellStart) {
        a.hi = sellHi;
        a.lo = sellLo;
      }
    }
    // lines 339-344: an opposite actual Setup 9 cancels before this bar's 13
    if (P.cancelOpposite) {
      if (buyRaw === 9) removeDirection(1, true);
      if (sellRaw === 9) removeDirection(-1, true);
    }
    // lines 345-353: TDST true-extreme break
    if (P.cancelTDST && runs.length > 0) {
      for (let i = runs.length - 1; i >= 0; i--) {
        const r = runs[i];
        const broken = r.direction === -1 ? trueLo > r.tdst : trueHi < r.tdst;
        if (broken) {
          if (P.showCancelMarks) emit(bar, 'X', r.direction, r.family, 'x', 'tiny', null, r.originBar, null); // line 351
          runs.splice(i, 1);
          counters[3] += 1;
        }
      }
    }
    // lines 354-364: new origins (Combo families replay inside f_start)
    for (let family = 0; family <= 3; family++) {
      if (enabled[family]) {
        if (buyRaw === 9) start(family, -1, buyStart, buyHi, buyLo, false);
        if (sellRaw === 9) start(family, 1, sellStart, sellHi, sellLo, false);
        if (P.restart22 && family < 2) {
          if (buyRaw === 22) start(family, -1, buyStart, buyHi, buyLo, true);
          if (sellRaw === 22) start(family, 1, sellStart, sellHi, sellLo, true);
        }
      }
    }
    // lines 365-375: setup labels
    if (P.showSetups) {
      if (buyRaw > 0) {
        const displayed = P.wrapSetup ? (buyRaw - 1) % 9 + 1 : buyRaw;
        if (!P.setupNineOnly || displayed === 9) {
          const perfected = buyRaw === 9 && (Math.min(low, lowAt(1)) <= Math.min(lowAt(2), lowAt(3)));
          emit(bar, 'S', -1, null, String(displayed) + (perfected ? '*' : ''), displayed === 9 ? 'large' : 'small', buyRaw, null, null);
        }
      }
      if (sellRaw > 0) {
        const displayed = P.wrapSetup ? (sellRaw - 1) % 9 + 1 : sellRaw;
        if (!P.setupNineOnly || displayed === 9) {
          const perfected = sellRaw === 9 && (Math.max(high, highAt(1)) >= Math.max(highAt(2), highAt(3)));
          emit(bar, 'S', 1, null, String(displayed) + (perfected ? '*' : ''), displayed === 9 ? 'large' : 'small', sellRaw, null, null);
        }
      }
    }
    // lines 376-392: advance every run, newest first
    if (runs.length > 0) {
      for (let i = runs.length - 1; i >= 0; i--) {
        const r = runs[i];
        if ((r.direction === -1 ? buyRaw : sellRaw) >= 18) r.refresh = true;
        // line 382: a Combo run's origin bar was counted in the replay; never count it twice
        if (r.lastProcessed !== bar) {
          const status = advance(r, 0);
          if (status === 13) {
            const slot = slotOf(r.family, r.direction);
            complete[slot] += 1;
            refreshed[slot] = refreshed[slot] || (P.showRefresh && r.family >= 2 && r.refresh);
            tipOrigins[slot].push(r.originBar); // line 389: completionTips[slot] += f_tip(r)
            runs.splice(i, 1);
          } else {
            intermediate(r, 0, status);
          }
        }
      }
    }
    // lines 393-403: one label per family/direction for this bar's completions
    for (let slot = 0; slot <= 7; slot++) {
      const amount = complete[slot];
      if (amount > 0) {
        const family = Math.trunc(slot / 2);
        const direction = slot % 2 === 0 ? -1 : 1;
        const txt = (P.prefix ? FAMILY_SHORT[family] + ' ' : '') + '13' + (refreshed[slot] ? 'r' : '') + (amount > 1 ? 'x' + String(amount) : '');
        emit(bar, 'C', direction, family, txt, 'large', null, null, tipOrigins[slot].slice());
      }
    }
  }

  const nn = (x) => (Number.isNaN(x) ? null : x);
  return {
    labels,
    chartVisibleFrom: Math.max(0, labels.length - P.labelLimit),
    state: {
      buyRaw, sellRaw,
      buyStart: nn(buyStart), sellStart: nn(sellStart),
      buyHi: nn(buyHi), buyLo: nn(buyLo), sellHi: nn(sellHi), sellLo: nn(sellLo),
      runs: runs.map((r) => ({
        family: r.family, direction: r.direction, originBar: r.originBar, setupStart: r.setupStart, chainStart: r.chainStart,
        tdst: nn(r.tdst), n: r.n, lastCounted: nn(r.lastCounted), close5: nn(r.close5), close8: nn(r.close8),
        refresh: r.refresh, lastProcessed: r.lastProcessed,
      })),
      anchors: anchors.map((a) => ({ chainStart: nn(a.chainStart), hi: nn(a.hi), lo: nn(a.lo), tdst: nn(a.tdst), originBar: nn(a.originBar) })),
      counters: counters.slice(),
      labelCount: labels.length,
    },
  };
}
