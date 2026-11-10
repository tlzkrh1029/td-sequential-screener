// Bird eye study, chart view: Bird eye 차트.
//
// One coin on ONE daily candle chart, with the 9s and 13s of every timeframe written on it as numbers, and above it the
// bird eye strip (조감 띠): the coin's whole history with one row per timeframe and side, and a box for the period the
// chart shows (현재 창). Everything drawn comes from BE.detail(coin): the daily bars, per timeframe the engine's labels
// (res.labels) and the next-bar triggers with VIEW.fire. Nothing is counted here.
//
//   a number            a label of one timeframe, at the last day of its timeframe bar that has a daily candle (the day
//                       the bar closed): the engine's text ("13", "13x2", "13r", "9", "9*", "+13") with the timeframe
//                       as a superscript. Sell side above the candles, buy side under them. A 13 has the color of its
//                       family, a 9 is gray (a repeated 9 lighter), a +13 is smaller and lighter. All numbers have one
//                       size, whatever the timeframe.
//   layout              per side a skyline over the pixel columns of the plot: a number starts just outside the candles
//                       under its box and moves outward only as far as what is already there, so no number covers a
//                       candle or another number. The numbers of one day and side form a stack, the shortest timeframe
//                       nearest the candle. A stack is centered on its day; where that would hang it far from its own
//                       candle (on a slope a wide box may not cover the candles next to it) it stands to one side of
//                       its day, with a small pointer at the day. A number that is still far from its candle gets a
//                       thin line to it. A stack shows at most K numbers; what does not fit (K, or the end of the plot)
//                       folds into a chip "외 N개", 9s and +13s before 13s, outer ones first. A click on the chip unfolds
//                       its pile (its stacks and those standing in the same columns) as far as the plot has room, and
//                       nothing that was shown folds for it; "접기", the chip of what found no room, or moving the
//                       window folds it again. The price scale leaves the room the stacks need.
//   window              the days shown, and right of the newest day a margin for the 다음 봉 조건 zone. Moving back in
//                       history keeps the width of a day: the margin shrinks first (the zone leaves), then the days move.
//   level of detail     by pixels per day (PPD_* below): candles become thin bars, then a high-low range, then a band
//                       with the close as a line; 9s (and +13s) become small marks before any 13 does; below PPD_ALL13
//                       a 13 keeps its text only where there is room for it, the longest timeframes first, and the
//                       others become colored marks stacked on the candles.
//   다음 봉 조건          right of the newest candle, on the chart's price scale: per next-bar trigger that can fire a
//                       chip at the price the bar has to reach (the study's mark of a 13 that waits at 12, a dashed
//                       gray frame for a 9), its distance, a tick where the bar may close after that, and the newest
//                       close as a dashed line. In a narrow room the same conditions are a list under the chart.
//
// The root element carries __probe(): what is on the screen now, built from the objects the drawing uses.
(() => {
  const ID = 'chart-a', CSS_ID = 'be-chart-css';
  const { TFS, LAST, DAY, BUY, SELL, SIDE, FAM_NAME, FAM_COLOR, SETUP_COLOR, C, el, iso, nf, fmtPrice, fmtPct } = BE;
  const SANS = '"IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
  const MONO = '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
  const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
  const RANGES = [['3m', '3개월', 92], ['6m', '6개월', 183], ['1y', '1년', 365], ['2y', '2년', 730], ['5y', '5년', 1826], ['all', '전체', Infinity]];
  const NEARS = [3, 5, 10];
  // the timeframe groups of the screener's table: 1D…1W | 8D…3W | 1M…12M
  const GROUPS = (() => { const cut = [...BE.GROUP_START].sort((a, b) => a - b), out = []; let s = 0; for (const x of [...cut, TFS.length]) { if (x > s) out.push([s, x - 1]); s = x; } return out; })();
  const groupOf = (j) => GROUPS.findIndex((g) => j >= g[0] && j <= g[1]);

  // ---------- sizes ----------
  const K = 5;                 // numbers a stack shows; the rest fold into "외 N개"
  const LH = 14, LH_DEF = 12;  // height of a number's box (9, 13) and of a +13
  const ROW = LH + 1;          // distance between two numbers of a stack
  const GAP = 3;               // between a candle and the first number or mark
  const CHIP_H = 13;           // the "외 N개" chip and the "접기" handle
  const CHIP_JOIN = 10;        // stacks whose chips would stand this near share one chip
  const MARK_W = 3, MARK_CAP = 36;   // a mark's width; how far a pile of marks may reach from its candle
  const LEAD_FAR = 1.5 * LH, LEAD_SIDE = 3;   // a number further from its candle than this gets a line to its day
  const SHIFT_COST = ROW;      // a stack stands to one side of its day only if that brings it this much nearer to its candle
  const STACK_GAP = 3;         // between the stacks of two days that stand on each other (the numbers of one stack are 1 px apart)
  const BASE_M = 8;            // room above and under the candles when nothing else needs it
  const AXIS_H = 18, STRIP_AXIS = 15;
  const MIN_DAYS = 14;         // the shortest window
  const NARROW = 560;          // a picture narrower than this: narrow gutter, conditions as a list
  const ZONE_W = 170;          // the 다음 봉 조건 zone
  const EDGE = 6, PAD_L = 8, PAD_R = 16, PAD_R_NARROW = 10;   // right of the plot; inside the plot before the first and after the last day
  const COND_H = 15, COND_PITCH = 17, PINNED = 3;   // a condition chip, the distance between two, chips shown per edge
  // level of detail, in pixels per day
  const PPD_CANDLE = 4.5, PPD_THIN = 2.4, PPD_RANGE = 0.9;   // candles with a body from here / thin candles / one bar from low to high / below: band and line
  const PPD_NINE_TEXT = 2.6;   // 9s and +13s are numbers from here, marks below
  const PPD_ALL13 = 1.25;      // every 13 is a number from here (or folded); below, only where there is room
  const PPD_FEW13 = 0.45;      // below this even fewer lines of numbers
  const FONT = {
    num13: `700 12.5px ${SANS}`, num9: `600 12.5px ${SANS}`, numDef: `600 10px ${SANS}`, sup: `600 8.5px ${SANS}`, supDef: `500 7.5px ${SANS}`,
    chip: `500 10px ${SANS}`, axis: `500 10.5px ${MONO}`, axisS: `500 9.5px ${MONO}`, tag: `600 10.5px ${MONO}`, note: `12.5px ${SANS}`,
    cond: `700 11px ${SANS}`, condSup: `600 8px ${SANS}`, pct: `500 9.5px ${MONO}`, pctB: `700 9.5px ${MONO}`, zone: `600 10px ${SANS}`, small: `500 10px ${SANS}`,
    row: `500 8.5px ${MONO}`, band: `600 10px ${SANS}`, win: `600 10px ${SANS}`,
  };

  const CSS = `
.bec-ctl { gap: 6px 14px; padding: 7px 12px; }
.bec-ctl .ctl { gap: 6px; }
.bec-ctl .seg button { padding: 3px 8px; font-size: 12.5px; }
.bec-tfs { gap: 5px; }
.bec-tfg { display: inline-flex; flex-wrap: wrap; gap: 1px; padding: 2px; border-radius: 8px; background: var(--sunken); border: 1px solid var(--line); }
.bec-tfg button { border: 0; background: transparent; border-radius: 5px; padding: 2px 3px; min-width: 24px; font: 500 11px/17px var(--font-mono); color: var(--faint); cursor: pointer; white-space: nowrap; }
.bec-tfg button:hover { color: var(--fg); }
.bec-tfg button[aria-pressed="true"] { background: var(--surface); color: var(--fg); box-shadow: 0 1px 2px rgb(0 0 0 / .14); }
.bec-tfg .bec-grp { font: 600 11.5px/17px var(--font-sans); padding: 2px 7px; margin-right: 2px; color: var(--muted); }
.bec-tfg .bec-grp[aria-pressed="mixed"] { color: var(--fg); box-shadow: inset 0 0 0 1px var(--line); }
.bec-more { display: none; margin-left: auto; }
.bec-brk { display: none; flex-basis: 100%; height: 0; margin: -3px 0; }
.bec-pic { padding: 8px 10px 10px; display: grid; gap: 4px; grid-template-columns: minmax(0, 1fr); }
.bec-cap { margin: 0; font-size: 12.5px; line-height: 18px; color: var(--muted); }
.bec-cap b { color: var(--fg); font-weight: 600; margin-right: 6px; }
.bec-caprow { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; min-height: 20px; }
.bec-caprow .bec-cap { flex: 1 1 320px; min-width: 0; }
.bec-win { font: 12px/18px var(--font-mono); color: var(--muted); white-space: nowrap; }
.bec-now.btn { padding: 0 9px; font-size: 12px; line-height: 18px; }
.bec-box { position: relative; min-width: 0; overflow: hidden; }
.bec-box canvas { position: absolute; left: 0; top: 0; display: block; }
.bec-over { touch-action: pan-y; outline-offset: -2px; border-radius: 4px; }
.bec-chart .bec-over { cursor: crosshair; }
.bec-chart .bec-over.bec-drag, .bec-strip .bec-over.bec-drag { cursor: grabbing; }
.bec-wait p { margin: 0 0 10px; }
.bec-conds { display: grid; gap: 6px; grid-template-columns: minmax(0, 1fr); margin-top: 4px; }
.bec-conds h3 { font-size: 13px; font-weight: 600; display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: baseline; }
.bec-conds h3 span { font: 12px var(--font-mono); font-weight: 500; color: var(--muted); }
.bec-crow { display: grid; gap: 2px; grid-template-columns: minmax(0, 1fr); padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px; }
.bec-crow.bec-on { border-color: var(--accent); background: var(--accent-soft); }
.bec-r1 { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 7px; font-size: 12.5px; }
.bec-r1 .bec-end { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; }
.bec-dist { font: 600 13px var(--font-mono); }
.bec-near { font-size: 11px; font-weight: 600; line-height: 16px; padding: 0 5px; border-radius: 4px; background: var(--warn-bg); color: var(--warn-fg); white-space: nowrap; }
.bec-met { font-size: 11.5px; font-weight: 600; line-height: 18px; padding: 0 8px; border-radius: 999px; background: var(--fg); color: var(--surface); white-space: nowrap; }
.bec-px { font: 12px var(--font-mono); }
.bec-px i { font-style: normal; color: var(--muted); font-family: var(--font-sans); }
.bec-sent { margin: 0; font-size: 12px; line-height: 1.45; color: var(--muted); }
.bec-meta { display: flex; flex-wrap: wrap; gap: 2px 10px; font-size: 11.5px; color: var(--muted); }
.bec-meta a { margin-left: auto; white-space: nowrap; }
.bec-foot { padding: 10px 12px; display: grid; gap: 6px; grid-template-columns: minmax(0, 1fr); }
.bec-foot .legend > span { white-space: normal; }
.bec-foot .hint { max-width: 130ch; }
.bec-n { font: 700 12.5px/14px var(--font-sans); font-style: normal; white-space: nowrap; }
.bec-n sup { font-size: 8.5px; font-weight: 600; line-height: 0; margin-left: 1px; vertical-align: 4px; }
.bec-n.bec-n9 { font-weight: 600; color: var(--setup); }
.bec-n.bec-rep { opacity: .55; }
.bec-n.bec-def { font-size: 10px; font-weight: 600; opacity: .7; }
.bec-n.bec-def sup { font-size: 7.5px; vertical-align: 3px; }
.bec-w { display: inline-block; flex: none; font: 700 11px/13px var(--font-sans); font-style: normal; padding: 0 3px; border-radius: 4px; border: 1px solid var(--c, var(--setup)); color: var(--fg); white-space: nowrap; background: color-mix(in srgb, var(--c, transparent) 14%, transparent); }
.bec-w sup { font-size: 8px; font-weight: 600; line-height: 0; margin-left: 1px; vertical-align: 3px; }
.bec-w.bec-w1 { background: color-mix(in srgb, var(--c) 26%, transparent); box-shadow: 0 0 0 1px var(--c); }
.bec-w.bec-w0 { background: color-mix(in srgb, var(--c) 40%, transparent); box-shadow: 0 0 0 1px var(--c); }
.bec-w.bec-w9 { border-style: dashed; color: var(--setup-ink); background: transparent; }
.bec-w.bec-w9.bec-w0 { background: color-mix(in srgb, var(--setup) 22%, transparent); box-shadow: none; }
.bec-fold { display: inline-block; font: 500 10px/13px var(--font-sans); padding: 0 4px; border-radius: 4px; border: 1px solid var(--line); background: var(--sunken); color: var(--muted); white-space: nowrap; }
.bec-g { display: inline-block; flex: none; }
.bec-g13 { width: 9px; height: 3px; }
.bec-g9 { width: 9px; height: 1px; background: var(--setup); }
.bec-gm { width: 3px; height: 4px; }
.bec-gm9 { width: 3px; height: 2px; background: var(--setup); }
.bec-gl { width: 1px; height: 12px; background: var(--muted); opacity: .6; }
.bec-gt { width: 0; height: 0; border: 3px solid transparent; border-top-width: 0; border-bottom-width: 4px; }
.bec-gq { width: 7px; height: 12px; border-bottom: 2px solid var(--c); background: linear-gradient(90deg, transparent 3px, var(--c) 3px 4px, transparent 4px); opacity: .8; }
.bec-gw { width: 16px; height: 12px; background: color-mix(in srgb, var(--accent) 14%, transparent); border: 1px solid var(--accent); }
.bec-tip-foot { margin-top: 6px; color: var(--muted); }
.bec-tip-rows { display: grid; gap: 3px; }
@media (max-width: 720px) {
  .bec-more { display: inline-flex; }
  .bec-ctl.bec-open .bec-brk { display: block; }
  .bec-ctl:not(.bec-open) .bec-opt { display: none; }
  .bec-tfg button { min-width: 30px; padding: 5px 4px; }
  .bec-ctl .seg button { padding: 5px 9px; }
  .bec-pic { padding: 8px 6px; }
}`;

  // ---------- state ----------
  let root = null, ui = null, S = null;
  let cur = null;       // the coin shown: { c, det, d (daily data), first (first day with a daily bar), all (labels), cells (strip), late }
  let win = null;       // the window: { d0, d1 (unix days, both shown), custom (moved off a preset) }
  let M = null;         // the chart as laid out (layoutChart)
  let SM = null;        // the strip as laid out (layoutStrip)
  let hover = null;     // what the pointer is on: { type: 'label' | 'chip' | 'handle' | 'cond' | 'more' | 'day', ... }
  let cursor = null;    // the keyboard's place: { day } | { zone: true }, with pick (index into the things of that place) | null
  let pinned = null;    // touch: the number or condition a tap chose (a second tap opens its chart)
  let unfold = new Map();   // stacks shown without the K limit: key (side and day) -> the chip they were unfolded from
  const NO_UNFOLD = new Map(), NO_RESERVE = { [BUY]: false, [SELL]: false };
  let drag = null, sdrag = null, pinch = null, pointers = new Map();
  let raf = 0, dirty = 0, seq = 0, chartH = 420, sized = { c: '', s: '' }, ro = null, tallTimer = 0, seenH = 0, clickAt = 0;
  let INK = FAM_COLOR.slice();   // the family colors as drawn on the theme's surface (lifted where they would not stand out)
  const TW = new Map();          // text widths by font and text
  let mctx = null;               // a context to measure text with

  // ---------- small tools ----------
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const narrow = () => ((root && root.clientWidth) || innerWidth) < 640;   // a phone: shorter default window, lower strip
  const rangeKey = () => (S.range === 'auto' ? (narrow() ? '3m' : '6m') : S.range);
  const tfOn = (j) => !S.off.includes(TFS[j]);
  const dirOn = (d) => S.dir === 'both' || (S.dir === 'buy') === (d === BUY);
  const sideKo = (d) => `${SIDE[d]} 쪽`;
  const dayText = (d) => `${iso(d)} (${WEEKDAY[new Date(d * DAY).getUTCDay()]})`;
  const spanText = (s, e) => (s === e ? iso(s) : iso(s).slice(0, 4) === iso(e).slice(0, 4) ? `${iso(s)} ~ ${iso(e).slice(5)}` : `${iso(s)} ~ ${iso(e)}`);
  const hasBar = (day) => { const i = day - cur.d.d0; return day <= LAST && i >= 0 && i < cur.d.c.length && cur.d.c[i] != null; };
  function tw(font, text) {
    const key = font + '|' + text; let w = TW.get(key);
    if (w == null) { if (!mctx) mctx = document.createElement('canvas').getContext('2d'); mctx.font = font; w = mctx.measureText(text).width; TW.set(key, w); }
    return w;
  }
  // colors: a family color that hardly stands out from the surface (the Combo purple on the dark theme) is mixed towards
  // the text color until it does, as the price ladder of the study does; the same color everywhere in this view
  const rgbOf = (hex) => { const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim()); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
  const relLum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  function standOut(color, surface, fg) {
    const c = rgbOf(color), s = rgbOf(surface), f = rgbOf(fg);
    if (!c || !s || !f || contrast(c, s) >= 3) return color;
    for (let t = 0.1; t < 0.75; t += 0.1) { const m = c.map((v, i) => Math.round(v + (f[i] - v) * t)); if (contrast(m, s) >= 3.5) return `rgb(${m.join(', ')})`; }
    return fg;
  }
  function readInks() {
    INK = FAM_COLOR.map((c) => standOut(c, C.surface, C.fg));
    if (root) INK.forEach((c, f) => root.style.setProperty('--bec-f' + f, c));
  }
  const colorOf = (a) => (a.kind === 'S' ? SETUP_COLOR : INK[a.f]);
  const alphaOf = (a) => (a.rep ? 0.55 : a.kind === 'I' ? 0.7 : 1);
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
  // a number as the chart writes it, for tooltips, the legend and the list: text with the timeframe as a superscript
  function numEl(a) {
    const b = el('b', 'bec-n' + (a.kind === 'S' ? ' bec-n9' : '') + (a.rep ? ' bec-rep' : '') + (a.kind === 'I' ? ' bec-def' : ''), a.text);
    if (a.kind !== 'S') b.style.color = INK[a.f];
    b.append(el('sup', null, a.tf));
    return b;
  }
  // the mark of a condition that is still waiting: a 13 as a frame in the family color on a light ground of it (heavier
  // within the 임박 threshold, darker when the bar would get it as things are), a 9 as a dashed gray frame
  function waitEl(q) {
    const b = el('b', 'bec-w' + (q.is13 ? '' : ' bec-w9') + (q.fire.now ? ' bec-w0' : q.near ? ' bec-w1' : ''), q.is13 ? '13' : '9');
    if (q.is13) b.style.setProperty('--c', INK[q.f]);
    if (q.rep) b.style.opacity = '.6';
    b.append(el('sup', null, q.tf));
    return b;
  }
  // a text for a tooltip line: a date (or a span of dates) stays on one line
  function dated(cls, text) {
    const s = el('span', cls);
    String(text).split(/(\d{4}-\d\d-\d\d(?: ~ (?:\d{4}-)?\d\d-\d\d)?)/).forEach((part, i) => { if (!part) return; if (i % 2) { const d = el('span', null, part); d.style.whiteSpace = 'nowrap'; s.append(d); } else s.append(part); });
    return s;
  }
  const row = (...parts) => { const r = el('div', 'row'); for (const p of parts) if (p != null) r.append(typeof p === 'string' ? dated(null, p) : p); return r; };
  const muted = (t) => dated('m', t);

  // ---------- the coin ----------
  // Every label the picture may show, with the day it is written at: the last day of its timeframe bar that has a daily
  // candle. For a day timeframe that is bars.last; for a timeframe built from TradingView's own 1W or 1M bars, bars.last
  // is the first day of the bar's last week or month, so the day is looked up from the bar's end. `late`: the bar's
  // last calendar day has no daily candle, so the number stands at an earlier day.
  function prepare(c, det) {
    const d = det.d;
    let a = 0; while (a < d.c.length - 1 && d.c[a] == null) a++;
    cur = { c, det, d, first: d.d0 + a, all: [], cells: [], late: 0, hi: 0 };
    for (let i = a; i < d.h.length && d.d0 + i <= LAST; i++) if (d.h[i] > cur.hi) cur.hi = d.h[i];
    const cells = new Map();
    for (const x of det.tfs) {
      if (!x.res) continue;
      const b = x.bars, vis = x.res.chartVisibleFrom;
      x.res.labels.forEach((L, k) => {
        const is9 = L.kind === 'S' && L.text.startsWith('9'), is13 = L.kind === 'C', isDef = L.kind === 'I' && L.text.startsWith('+');
        if (!is9 && !is13 && !isDef) return;
        const s = b.start[L.bar], e = b.end[L.bar];
        let day = e; while (day > cur.first && !hasBar(day)) day--;
        if (day < cur.first) day = cur.first;
        const item = { j: x.j, tf: x.tf, k, L, bar: L.bar, s, e, day, dir: L.dir, kind: L.kind, f: is9 ? null : L.family, text: L.text,
          rep: is9 && L.raw >= 18, gone: k < vis, late: day !== e,
          // the order of one bar's labels outward from the candle, as the indicator stacks them: 9, then per family +13 or 13
          inner: is9 ? 0.5 : is13 ? 2 + 2 * L.family : 1.51 + 1.5 * L.family };
        if (item.late) cur.late++;
        cur.all.push(item);
        if (isDef) return;
        // the strip: one cell per timeframe bar and side that carries a 9 or a 13
        const key = (x.j * 1e6 + L.bar) * 2 + (L.dir === SELL ? 1 : 0);
        let cell = cells.get(key);
        if (!cell) { cell = { j: x.j, bar: L.bar, dir: L.dir, s, e, s9: null, c13: [] }; cells.set(key, cell); cur.cells.push(cell); }
        if (is9) cell.s9 = item; else cell.c13.push(item);
      });
    }
    cur.all.sort((p, q) => p.day - q.day || p.j - q.j || p.inner - q.inner || p.k - q.k);
    for (const cell of cur.cells) cell.c13.sort((p, q) => p.f - q.f);
  }
  // the room for the prices at the left, the same for the strip and the chart: as wide as the coin's prices are long,
  // and never narrower than the names of the strip's two bands
  const BAND_NAME = { [SELL]: '▲ 매도 쪽', [BUY]: '▼ 매수 쪽' };
  const gutter = (nar) => {
    const names = Math.ceil(Math.max(tw(FONT.band, BAND_NAME[SELL]), tw(FONT.band, BAND_NAME[BUY]))) + 6;
    return clamp(Math.ceil(tw(nar ? FONT.axisS : FONT.axis, fmtPrice(Number((cur.hi || 1).toPrecision(3))))) + 13, Math.max(nar ? 46 : 58, names), nar ? 66 : 90);
  };
  // what the toggles leave in the picture
  const selected = (a) => tfOn(a.j) && dirOn(a.dir) && (a.kind === 'S' ? S.nine === 'on' : a.kind === 'I' ? S.def === 'on' && BE.famOn(a.f) : BE.famOn(a.f));
  const firstAt = (day) => { let lo = 0, hi = cur.all.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (cur.all[mid].day < day) lo = mid + 1; else hi = mid; } return lo; };
  // the selected labels written at the days s..e
  function labelsAt(s, e) { const out = []; for (let i = firstAt(s); i < cur.all.length && cur.all[i].day <= e; i++) if (selected(cur.all[i])) out.push(cur.all[i]); return out; }

  // ---------- the window ----------
  // The chart's day axis: the days d0..d1 and, right of the newest day, a margin as wide as `fut` days. The margin is
  // the room of the 다음 봉 조건 zone: the zone is in view when the window is at the newest day with the whole margin
  // (win.end). A day keeps its width while the window moves back in history: first the margin shrinks (the newest
  // candles move right into it), then the days move. A window is given by its first day and its width in days T.
  const totalDays = () => LAST - cur.first + 1;
  const minSpan = () => Math.min(totalDays(), MIN_DAYS);
  const chartW = () => Math.max(240, ui.chart.clientWidth);
  const slotPx = () => { const nar = chartW() < NARROW; return Math.max(60, chartW() - EDGE - gutter(nar) - PAD_L - (nar ? PAD_R_NARROW : PAD_R)); };   // the room of the day slots
  const zonePx = () => (S.cond === 'on' && chartW() >= NARROW ? Math.min(ZONE_W - EDGE, slotPx() / 2) : 0);                                 // the margin of the zone
  const presetDays = () => clamp(RANGES.find((r) => r[0] === rangeKey())[2], minSpan(), totalDays());
  const spanT = () => win.d1 - win.d0 + 1 + win.fut;
  // true when the window changed. custom: it is not the chosen preset's window (keep: as it was, for a window that is
  // only fitted to a new room)
  function put(next, keep) {
    next.custom = keep && win ? win.custom : !(next.end && next.d1 - next.d0 + 1 === presetDays());
    const same = !!win && win.d0 === next.d0 && win.d1 === next.d1 && win.end === next.end && Math.abs(win.fut - next.fut) < 1e-9;
    win = next;
    return !same;
  }
  // the window of n days that ends at the newest day, with the zone in view
  function atEnd(n, keep) {
    n = clamp(Math.round(n), minSpan(), totalDays());
    const a = slotPx(), z = zonePx();
    return put({ d0: LAST - n + 1, d1: LAST, fut: z * n / (a - z), end: true }, keep);
  }
  // the window that begins at day d0 and is T days wide, held inside the data (between the shortest window and the
  // whole history); one that would reach past the newest day's margin ends there
  function setView(d0, T, keep) {
    const a = slotPx(), z = zonePx(), k = a / (a - z);   // k: width in days of a window at the newest day, per day shown
    T = clamp(T, minSpan() * k, totalDays() * k);
    d0 = Math.max(cur.first, Math.round(d0));
    if (d0 + T > LAST + 1 + z * T / a - 0.5) return atEnd(T / k, keep);
    const R = d0 + T, d1 = Math.min(LAST, Math.floor(R - 1 + 1e-6));
    return put({ d0, d1, fut: Math.max(0, R - d1 - 1), end: false }, keep);
  }
  const applyPreset = () => atEnd(presetDays());
  const panBy = (days) => setView(win.d0 + days, spanT());
  // a window `factor` times as wide, with the day `anchor` staying where it is on the screen
  function zoomAt(anchor, factor) { const T = spanT(), T2 = T * factor; return setView(anchor + 0.5 - (anchor + 0.5 - win.d0) / T * T2, T2); }
  // the same from the keyboard: at the newest day the window stays there
  const zoomKey = (anchor, factor) => (anchor == null && win.end ? atEnd(Math.round((win.d1 - win.d0 + 1) * factor) || 1) : zoomAt(anchor == null ? (win.d0 + win.d1) / 2 : anchor, factor));
  const toNewest = () => atEnd(spanT() * (slotPx() - zonePx()) / slotPx());
  // the window as it is, held to the room there is now (the picture's width or the zone's setting has changed)
  const renorm = () => (win.end ? atEnd(win.d1 - win.d0 + 1, true) : setView(win.d0, spanT(), true));
  // after the window moved: what was pointed at is elsewhere now
  // after the window has changed (what was unfolded folds again: it was unfolded for the picture that is gone)
  function moved() { unfold.clear(); hover = null; pinned = null; BE.tip.hide(); schedule(D_LAYOUT); }

  // ---------- drawing on demand ----------
  const D_LAYOUT = 1, D_BASE = 2, D_OVER = 4, D_STRIP = 8, D_SOVER = 16, D_SIZE = 32;
  function schedule(what) { dirty |= what; if (!raf) raf = requestAnimationFrame(flush); }
  function flush() {
    raf = 0;
    const w = dirty; dirty = 0;
    if (!root || !ui || !cur || !win) return;
    if (w & D_SIZE) { seenH = window.innerHeight; if (!win.custom) applyPreset(); }   // the default window follows the room
    if (w & (D_STRIP | D_SIZE)) { readInks(); layoutStrip(); paintStrip(); }
    if (w & D_SIZE) chartH = chartHeight();
    if (w & (D_LAYOUT | D_SIZE)) layoutChart();
    if (w & (D_LAYOUT | D_BASE | D_SIZE)) { const t0 = performance.now(); paintChart(); M.paintMs = performance.now() - t0; }
    if (w & (D_LAYOUT | D_BASE | D_OVER | D_SIZE)) paintOver();
    if (w & (D_LAYOUT | D_STRIP | D_SOVER | D_OVER | D_SIZE)) paintStripOver();
    if (w & (D_LAYOUT | D_SIZE)) syncHead();
  }
  const flushNow = () => { if (raf) { cancelAnimationFrame(raf); flush(); } };

  // ---------- the strip (조감 띠) ----------
  const stripPitch = () => (!narrow() && innerHeight >= 1000 ? 3 : 2);   // height of a timeframe row
  function layoutStrip() {
    const W = Math.max(240, ui.strip.clientWidth), nar = W < NARROW, gut = gutter(nar);
    const pitch = stripPitch(), gg = pitch, n = TFS.length;
    const bandH = n * pitch + (GROUPS.length - 1) * gg, mid = pitch === 3 ? 46 : 34;
    const sellT = 3, buyT = sellT + bandH + mid, plotB = buyT + bandH, H = plotB + STRIP_AXIS;
    const x0 = gut, x1 = W - 6, ppd = (x1 - x0) / totalDays();
    const X = (d) => x0 + (d - cur.first) * ppd;   // the left edge of a day
    // rows: the same order in both bands, 1D lowest and 12M highest, a gap between the timeframe groups
    const rowTop = (j, dir) => (dir === SELL ? sellT : buyT) + (n - 1 - j) * pitch + (GROUPS.length - 1 - groupOf(j)) * gg;
    // ticks: a 13 over the days of its timeframe bar in its family color (the families of one bar and side next to
    // each other), a 9 as a thinner gray line; each at least 2 px wide, a wide one 1 px short of the next bar
    const ticks = [];
    const box = (xa, xb, k) => {
      let bx = Math.round(xa), bw = Math.round(xb) - bx;
      if (bw >= 5) bw -= 1;
      if (bw < 2 * k) { bw = 2 * k; bx = Math.round((xa + xb) / 2 - k); }
      return [clamp(bx, x0, Math.max(x0, Math.floor(x1) - bw)), bw];
    };
    for (const cell of cur.cells) {
      if (!tfOn(cell.j) || !dirOn(cell.dir)) continue;
      const xa = X(Math.max(cell.s, cur.first)), xb = X(Math.min(cell.e, LAST) + 1), y = rowTop(cell.j, cell.dir);
      if (cell.s9 && S.nine === 'on') { const [bx, bw] = box(xa, xb, 1); ticks.push({ a: cell.s9, x0: bx, x1: bx + bw, y: y + pitch - 1, h: 1 }); }
      const c13 = cell.c13.filter((a) => BE.famOn(a.f)), k = c13.length;
      if (k) { const [bx, bw] = box(xa, xb, k); c13.forEach((a, i) => ticks.push({ a, x0: bx + Math.round(i * bw / k), x1: bx + Math.round((i + 1) * bw / k), y, h: 2 })); }
    }
    // the daily close on a log scale, between the bands
    const d = cur.d;
    let lo = Infinity, hi = -Infinity;
    for (let day = cur.first; day <= LAST; day++) { const v = d.c[day - d.d0]; if (v == null) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
    const f = lo > 0 ? Math.log : (v) => v, fl = f(lo), fh = f(hi), yA = sellT + 4, yZ = plotB - 4;
    const PY = (v) => (fh > fl ? yZ - (f(v) - fl) / (fh - fl) * (yZ - yA) : (yA + yZ) / 2);
    SM = { W, H, gut, pitch, bandH, sellT, buyT, plotB, x0, x1, ppd, X, rowTop, ticks, PY };
  }
  function paintStrip() {
    const g = SM, dpr = window.devicePixelRatio || 1, size = `${g.W}x${g.H}@${dpr}`;
    let ctx;
    if (size !== sized.s) { sized.s = size; ui.strip.style.height = g.H + 'px'; ctx = BE.setupCanvas(ui.sBase, g.W, g.H); BE.setupCanvas(ui.sOver, g.W, g.H); }
    else { ctx = ui.sBase.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    ctx.globalAlpha = 1; ctx.setLineDash([]);
    ctx.fillStyle = C.surface; ctx.fillRect(0, 0, g.W, g.H);
    // the close: a thin line over the whole height, broken where TradingView has no daily bar (a day between two such
    // days is a dot); the grounds of the bands, one per timeframe group, lie over it, so that it is faint behind the ticks
    const d = cur.d;
    ctx.strokeStyle = ctx.fillStyle = C.muted; ctx.lineWidth = 1; ctx.lineJoin = 'round'; ctx.beginPath();
    let run = 0;
    for (let day = cur.first; day <= LAST + 1; day++) {
      const v = day <= LAST ? d.c[day - d.d0] : null;
      if (v == null) { if (run === 1) { const p = d.c[day - 1 - d.d0]; ctx.fillRect(Math.round(g.X(day - 0.5)), Math.round(g.PY(p)), 1, 1); } run = 0; continue; }
      const x = g.X(day + 0.5), y = g.PY(v);
      if (run++) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = C.sunken; ctx.globalAlpha = 0.62;
    for (const dir of [SELL, BUY]) for (const gr of GROUPS) ctx.fillRect(g.x0, g.rowTop(gr[1], dir), g.x1 - g.x0, (gr[1] - gr[0] + 1) * g.pitch);
    for (const t of g.ticks) if (t.a.kind === 'S') { ctx.globalAlpha = t.a.rep ? 0.45 : 0.9; ctx.fillStyle = SETUP_COLOR; ctx.fillRect(t.x0, t.y, t.x1 - t.x0, t.h); }
    ctx.globalAlpha = 1;
    for (const t of g.ticks) if (t.a.kind === 'C') { ctx.fillStyle = INK[t.a.f]; ctx.fillRect(t.x0, t.y, t.x1 - t.x0, t.h); }
    // date ticks: years for a long history, months for a short one
    const y0 = new Date(cur.first * DAY).getUTCFullYear(), y1 = new Date(LAST * DAY).getUTCFullYear(), marks = [];
    if (totalDays() > 365 * 3) {
      const step = [1, 2, 5, 10].find((k) => k * 365.25 * g.ppd >= 40) || 20;
      for (let y = y0; y <= y1; y++) if (y % step === 0) marks.push([Date.UTC(y, 0, 1) / DAY, String(y)]);
    } else {
      const step = [1, 2, 3, 6].find((k) => k * 30.44 * g.ppd >= 56) || 12;
      for (let y = y0; y <= y1; y++) for (let m = 0; m < 12; m += step) marks.push([Date.UTC(y, m, 1) / DAY, `${y}-${String(m + 1).padStart(2, '0')}`]);
    }
    ctx.font = FONT.axisS; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    let lastX = -Infinity;
    for (const [day, text] of marks) {
      if (day < cur.first || day > LAST) continue;
      const x = g.X(day), half = ctx.measureText(text).width / 2;
      ctx.fillStyle = C.line; ctx.fillRect(Math.round(x), g.plotB, 1, 4);
      if (x - half < g.x0 || x + half > g.x1 || x - half < lastX + 8) continue;
      ctx.fillStyle = C.muted; ctx.fillText(text, x, g.plotB + STRIP_AXIS / 2 + 2.5); lastX = x + half;
    }
    // the scale at the left: which rows are which timeframes, and which band is which side
    ctx.textAlign = 'right'; ctx.font = FONT.row; ctx.fillStyle = C.muted;
    for (const dir of [SELL, BUY]) for (const gr of GROUPS) ctx.fillText(`${TFS[gr[0]]}~${TFS[gr[1]]}`, g.x0 - 5, g.rowTop(gr[1], dir) + (gr[1] - gr[0] + 1) * g.pitch / 2 + 0.5);
    ctx.font = FONT.band;
    ctx.fillText(BAND_NAME[SELL], g.x0 - 5, g.sellT + g.bandH + 10);
    ctx.fillText(BAND_NAME[BUY], g.x0 - 5, g.buyT - 8.5);
  }
  // the window box, and the tick of the number that is pointed at
  function paintStripOver() {
    const g = SM, ctx = ui.sOver.getContext('2d'), dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, g.W, g.H);
    const b = stripBox();
    ctx.fillStyle = C.accent; ctx.globalAlpha = BE.isDark() ? 0.18 : 0.1; ctx.fillRect(b.xa, 0, b.xb - b.xa, g.plotB);
    ctx.globalAlpha = 1; ctx.strokeStyle = C.accent; ctx.lineWidth = 1; ctx.strokeRect(b.xa + 0.5, 0.5, b.xb - b.xa - 1, g.plotB - 1);
    // its name: inside when the box is wide enough, else next to it
    ctx.font = FONT.win; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const text = '현재 창', w = ctx.measureText(text).width, y = g.sellT + g.bandH + 10;
    const x = b.xb - b.xa >= w + 10 ? b.xa + 5 : b.xa - w - 6 >= g.x0 ? b.xa - w - 5 : b.xb + 5;
    ctx.fillStyle = C.surface; ctx.globalAlpha = 0.82; ctx.fillRect(x - 2, y - 7, w + 4, 14);
    ctx.globalAlpha = 1; ctx.fillStyle = C.accent; ctx.fillText(text, x, y + 0.5);
    const a = activeLabel(), t = a && a.kind !== 'I' ? g.ticks.find((q) => q.a === a) : null;
    if (t) {
      const cx = (t.x0 + t.x1) / 2, sell = a.dir === SELL;
      ctx.strokeStyle = ctx.fillStyle = C.fg; ctx.lineWidth = 1.5; ctx.strokeRect(t.x0 - 2.25, t.y - 2.25, t.x1 - t.x0 + 4.5, t.h + 4.5);
      const ey = sell ? 0 : g.plotB;   // a pointer at the band's outer edge, so the place is found at a glance
      ctx.beginPath(); ctx.moveTo(cx - 4.5, ey); ctx.lineTo(cx + 4.5, ey); ctx.lineTo(cx, ey + (sell ? 6 : -6)); ctx.closePath(); ctx.fill();
    }
    ui.sOver.setAttribute('aria-valuenow', win.d1); ui.sOver.setAttribute('aria-valuetext', `${iso(win.d0)}부터 ${iso(win.d1)}까지`);
  }
  // the window box in strip pixels (at least 3 px wide)
  function stripBox() { const xa = Math.round(SM.X(win.d0)); return { xa, xb: Math.max(xa + 3, Math.round(SM.X(win.d1 + 1))) }; }
  // where a pointer is against the box: on its left or right edge, inside it, or elsewhere
  function stripZone(x) {
    const b = stripBox(), inn = Math.min(4, (b.xb - b.xa) / 3);
    if (x >= b.xa - 6 && x <= b.xa + inn) return 'l';
    if (x >= b.xb - inn && x <= b.xb + 6) return 'r';
    return x > b.xa && x < b.xb ? 'in' : 'out';
  }
  function wireStrip() {
    const cv = ui.sOver;
    const xOf = (e) => e.clientX - cv.getBoundingClientRect().left;
    cv.addEventListener('pointerdown', (e) => {
      if (!cur || !SM || e.button > 0) return;
      const x = xOf(e);
      let mode = stripZone(x);
      if (mode === 'out') {   // elsewhere: the window goes there, and can be dragged on from there
        const day = Math.floor(cur.first + (x - SM.x0) / SM.ppd);
        if (setView(day + 0.5 - spanT() / 2, spanT())) moved();
        mode = 'in';
      }
      sdrag = { id: e.pointerId, mode, x, d0: win.d0, d1: win.d1, T: spanT(), end: win.end };
      cv.classList.add('bec-drag');
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is already gone */ }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!cur || !SM) return;
      const x = xOf(e);
      if (!sdrag || sdrag.id !== e.pointerId) { if (e.pointerType === 'mouse') { const z = stripZone(x); cv.style.cursor = z === 'l' || z === 'r' ? 'ew-resize' : z === 'in' ? 'grab' : 'pointer'; } return; }
      const dd = Math.round((x - sdrag.x) / SM.ppd);
      let ch;
      if (sdrag.mode === 'in') ch = setView(sdrag.d0 + dd, sdrag.T);
      else if (sdrag.mode === 'l') {   // the left edge: the right end stays
        const d0 = clamp(sdrag.d0 + dd, cur.first, sdrag.d1 - minSpan() + 1);
        ch = sdrag.end ? atEnd(LAST - d0 + 1) : setView(d0, sdrag.d0 + sdrag.T - d0);
      } else {                         // the right edge: the first day stays; at the newest day the zone comes into view
        const d1 = clamp(sdrag.d1 + dd, sdrag.d0 + minSpan() - 1, LAST);
        ch = d1 >= LAST ? atEnd(LAST - sdrag.d0 + 1) : setView(sdrag.d0, d1 + 1 - sdrag.d0);
      }
      if (ch) moved();
    });
    const end = (e) => { if (sdrag && sdrag.id === e.pointerId) { sdrag = null; cv.classList.remove('bec-drag'); } };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('keydown', (e) => {
      if (!cur || !SM || e.altKey || e.ctrlKey || e.metaKey) return;
      const span = win.d1 - win.d0 + 1, k = e.key;
      let ch = false;
      if (k === 'ArrowLeft' || k === 'ArrowRight') ch = panBy((k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? span : Math.max(1, Math.round(span * 0.1))));
      else if (k === '+' || k === '=') ch = zoomKey(null, 1.25);
      else if (k === '-' || k === '_') ch = zoomKey(null, 0.8);
      else if (k === 'Home') ch = setView(cur.first, spanT());
      else if (k === 'End') ch = toNewest();
      else return;
      e.preventDefault();
      if (ch) moved();
    });
    cv.addEventListener('focus', () => schedule(D_SOVER));
  }

  // ---------- the chart: layout ----------
  const RANK = { C: 2, S: 1, I: 0 };   // a 13 before a 9 before a +13, wherever room is given out
  const byRank = (p, q) => RANK[q.a.kind] - RANK[p.a.kind] || p.a.j - q.a.j || p.a.inner - q.a.inner;
  function niceStep(range, target) { const raw = range / Math.max(1, target), p = Math.pow(10, Math.floor(Math.log10(raw))), k = raw / p; return (k < 1.5 ? 1 : k < 3.5 ? 2 : k < 7.5 ? 5 : 10) * p; }
  function priceTicks(pLo, pHi, log, target) {
    const out = [];
    if (log && pLo > 0) {
      // 1, 2, 5 of every decade; over many decades the decades alone, then every second one
      for (const [ks, every] of [[[1, 2, 5], 1], [[1], 1], [[1], 2], [[1], 3]]) {
        out.length = 0;
        for (let e = Math.floor(Math.log10(pLo)); e <= Math.ceil(Math.log10(pHi)); e++) { if (((e % every) + every) % every) continue; for (const k of ks) { const v = Number((k * Math.pow(10, e)).toPrecision(3)); if (v >= pLo && v <= pHi) out.push(v); } }
        if (out.length <= target + 4) break;
      }
      if (out.length >= 3) return out;
      out.length = 0;
    }
    // (on a linear scale the room for the numbers under the candles can reach below zero: no line at zero or under it)
    const st = niceStep(pHi - pLo, target);
    for (let v = Math.ceil(Math.max(pLo, 0) / st) * st; v <= pHi + st * 1e-9; v += st) if (v > 0) out.push(Number(v.toPrecision(12)));
    return out;
  }
  // a price for the axis: as short as it stays exact enough, shorter while fits(text) says it is too wide (a large
  // round price that still does not fit in thousands or millions: 2,000K, 1M)
  function axisText(v, fits) {
    let s = '';
    for (let p = Math.abs(v) >= 1000 ? 6 : 5; p >= 1; p--) { s = fmtPrice(Number(v.toPrecision(p))); if (!fits || fits(s)) return s; }
    for (const [d, u] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) if (Math.abs(v) >= d) { const t = fmtPrice(Number((v / d).toPrecision(3))) + u; if (fits(t)) return t; }
    return s;
  }
  // date ticks: days or Mondays in a short window, months, then years; whichever keeps the texts apart
  function dateTicks(d0, d1, ppd) {
    const out = [];
    const dayStep = ppd > 8.5 ? [1, 2, 7, 14].find((k) => k * ppd >= 58) : 0;
    if (dayStep) {
      for (let d = d0; d <= d1; d++) {
        if (dayStep >= 7 ? (d + 3) % 7 !== 0 || (dayStep === 14 && Math.floor((d + 3) / 7) % 2 === 1) : d % dayStep !== 0) continue;
        const t = iso(d); out.push({ d, at: 0.5, text: t.slice(5), full: t });
      }
      return out;
    }
    const y0 = new Date(d0 * DAY).getUTCFullYear(), y1 = new Date(d1 * DAY).getUTCFullYear();
    const monStep = [1, 2, 3, 6].find((k) => k * 30.44 * ppd >= 58);
    if (monStep) {
      for (let y = y0; y <= y1; y++) for (let mo = 0; mo < 12; mo += monStep) { const d = Date.UTC(y, mo, 1) / DAY; if (d >= d0 && d <= d1) out.push({ d, at: 0, text: `${y}-${String(mo + 1).padStart(2, '0')}`, full: null }); }
      return out;
    }
    const yStep = [1, 2, 5, 10].find((k) => k * 365.25 * ppd >= 44) || 20;
    for (let y = y0; y <= y1; y++) { if (y % yStep) continue; const d = Date.UTC(y, 0, 1) / DAY; if (d >= d0 && d <= d1) out.push({ d, at: 0, text: String(y), full: null }); }
    return out;
  }
  // the chart is as tall as the window leaves under it (at least 420 px); on a phone it has a height of its own
  function chartHeight() {
    if (narrow()) return 420;
    const top = ui.chart.getBoundingClientRect().top + window.scrollY;
    return Math.round(clamp(window.innerHeight - top - 12, 420, 1000));
  }
  // spreads chips over a price axis: items sorted by their target middle t; each gets cy, as near to t as the others
  // and the ends lo..hi allow, `pitch` apart
  function spread(items, lo, hi, pitch) {
    const cl = [];
    for (const it of items) {
      cl.push({ n: 1, sum: it.t, items: [it], pos: 0 });
      for (;;) {
        const c = cl[cl.length - 1];
        c.pos = clamp(c.sum / c.n - (c.n - 1) * pitch / 2, lo, Math.max(lo, hi - (c.n - 1) * pitch));
        const p = cl[cl.length - 2];
        if (!p || p.pos + p.n * pitch <= c.pos + 1e-6) break;
        p.items.push(...c.items); p.sum += c.sum; p.n += c.n; cl.pop();
      }
    }
    for (const c of cl) c.items.forEach((it, i) => { it.cy = c.pos + i * pitch; });
  }

  function layoutChart() {
    renorm();
    const W = chartW(), H = chartH, nar = W < NARROW;
    const d0 = win.d0, d1 = win.d1, n = d1 - d0 + 1, atEnd = win.end, D = cur.d, b0 = D.d0;
    const condOn = S.cond === 'on' && atEnd, zone = condOn && !nar;
    // the plot ends where the margin right of the newest day begins (the zone's room, or what is left of it)
    const gut = gutter(nar), padL = PAD_L, padR = nar ? PAD_R_NARROW : PAD_R, ppd = slotPx() / (n + win.fut);
    const plotL = gut, plotR = Math.round(W - EDGE - win.fut * ppd), plotT = 4, plotB = H - AXIS_H, plotH = plotB - plotT;
    const X = (d) => plotL + padL + (d - d0 + 0.5) * ppd;
    const nCol = Math.max(1, plotR - plotL);
    const nineText = ppd >= PPD_NINE_TEXT, all13 = ppd >= PPD_ALL13;
    const m = M = { W, H, nar, d0, d1, n, atEnd, zone, list: condOn && nar, gut, plotL, plotR, gridR: zone ? plotR : W - EDGE, plotT, plotB, padL, ppd, X, none: false, log: false,
      lod: { candle: ppd >= PPD_CANDLE ? 'candle' : ppd >= PPD_THIN ? 'thin' : ppd >= PPD_RANGE ? 'range' : 'line', nineText, all13 },
      items: [], chips: [], handles: [], conds: [], more: [], pTicks: [], dTicks: dateTicks(d0, d1, ppd), Y: null, P: null, zx: null, ms: 0 };
    const t0 = performance.now();

    // price range of the window's candles
    let lo = Infinity, hi = -Infinity;
    for (let d = d0; d <= d1; d++) { const i = d - b0; if (D.c[i] == null) continue; if (D.l[i] < lo) lo = D.l[i]; if (D.h[i] > hi) hi = D.h[i]; }
    if (!(lo < Infinity)) { m.none = true; lo = hi = cur.det.last > 0 ? cur.det.last : 1; }
    const log = lo > 0 && (S.scale === 'log' || (S.scale === 'auto' && hi / lo > 5));
    const f = log ? Math.log : (v) => v, fi = log ? Math.exp : (v) => v;
    let fl = f(lo), fh = f(hi);
    if (!(fh - fl > Math.abs(fh) * 1e-9)) { const pad = Math.abs(fh) * 0.02 || 1; fl -= pad; fh += pad; }
    m.log = log; m.colLo = null; m.colHi = null;

    // per pixel column of the plot: the lowest low and the highest high of the days whose slot touches it
    const colLo = new Float64Array(nCol).fill(NaN), colHi = new Float64Array(nCol).fill(NaN);
    for (let d = d0; d <= d1; d++) {
      const i = d - b0; if (D.c[i] == null) continue;
      const xa = padL + (d - d0) * ppd, ka = Math.max(0, Math.floor(xa + 1e-6)), kb = Math.min(nCol - 1, Math.ceil(xa + ppd - 1e-6) - 1);
      for (let k = ka; k <= kb; k++) { if (!(colLo[k] <= D.l[i])) colLo[k] = D.l[i]; if (!(colHi[k] >= D.h[i])) colHi[k] = D.h[i]; }
    }

    m.colLo = colLo; m.colHi = colHi;

    // the labels of the window, and how each is shown at this zoom: as a number (text) or as a mark
    // where a number's box stands against its day: centered on it ('c'), or with its right ('l') or its left ('r') edge
    // at the edge of the day's slot, so that it reaches over the days before or after it only
    const alignBox = (it, mode) => {
      const x = mode === 'l' ? Math.round(it.cx + ppd / 2) - it.w : mode === 'r' ? Math.round(it.cx - ppd / 2) : Math.round(it.cx - it.w / 2);
      it.x = clamp(x, plotL + 1, Math.max(plotL + 1, plotR - 1 - it.w));
      it.k0 = it.x - plotL; it.k1 = Math.min(nCol - 1, it.k0 + it.w - 1); it.side = it.x + it.w / 2 - it.cx;
    };
    const textBox = (it) => {
      const a = it.a, def = a.kind === 'I';
      it.nw = tw(def ? FONT.numDef : a.kind === 'C' ? FONT.num13 : FONT.num9, a.text);
      it.w = Math.ceil(it.nw + 1 + tw(def ? FONT.supDef : FONT.sup, a.tf)) + 2; it.h = def ? LH_DEF : LH;
      alignBox(it, 'c');
    };
    // the pixel columns of a day's own slot
    const dayCols = (day) => [clamp(Math.floor(padL + (day - d0) * ppd + 1e-6), 0, nCol - 1), clamp(Math.ceil(padL + (day - d0 + 1) * ppd - 1e-6) - 1, 0, nCol - 1)];
    const markBox = (it) => {
      it.w = MARK_W; it.h = it.a.kind === 'C' ? 4 : 2; it.nw = 0;
      it.x = clamp(Math.round(it.cx - MARK_W / 2), plotL, plotR - MARK_W);
      it.k0 = it.x - plotL; it.k1 = Math.min(nCol - 1, it.k0 + MARK_W - 1); it.side = 0;
    };
    for (const a of labelsAt(d0, d1)) m.items.push({ a, cx: X(a.day), text: a.kind === 'C' || nineText, shown: '', x: 0, y: 0, w: 0, h: 0, nw: 0, u: 0, far: 0, side: 0, k0: 0, k1: 0, st: null, chip: null, group: null, lead: false });
    if (!all13) {
      // too wide for every 13: a 13 keeps its text where fewer than `lines` numbers stand already, the longest
      // timeframes first, the newest first among them
      const lines = ppd >= PPD_FEW13 ? 2 : 1, cov = { [BUY]: new Uint8Array(nCol), [SELL]: new Uint8Array(nCol) };
      const cand = m.items.filter((it) => it.a.kind === 'C').sort((p, q) => q.a.j - p.a.j || q.a.day - p.a.day || p.a.inner - q.a.inner);
      for (const it of cand) {
        textBox(it);
        const c = cov[it.a.dir], k0 = Math.max(0, it.k0 - 3), k1 = Math.min(nCol - 1, it.k1 + 3);
        let ok = true;
        for (let k = k0; k <= k1; k++) if (c[k] >= lines) { ok = false; break; }
        if (ok) for (let k = k0; k <= k1; k++) c[k]++; else it.text = false;
      }
    }
    for (const it of m.items) (it.text ? textBox : markBox)(it);
    const marks = m.items.filter((it) => !it.text).sort((p, q) => RANK[q.a.kind] - RANK[p.a.kind] || p.a.day - q.a.day || p.a.j - q.a.j || p.a.inner - q.a.inner);
    // the numbers of one day and side are a stack, in the order of cur.all: the shortest timeframe first
    const stacks = new Map();
    for (const it of m.items) {
      if (!it.text) continue;
      const key = (it.a.dir === SELL ? 's' : 'b') + it.a.day;
      let st = stacks.get(key);
      if (!st) stacks.set(key, st = { key, day: it.a.day, dir: it.a.dir, list: [], rank: 0, top: -1 });
      st.list.push(it); it.st = st; st.rank = Math.max(st.rank, RANK[it.a.kind]); if (it.a.kind === 'C') st.top = Math.max(st.top, it.a.j);
    }
    // who chooses a place first: stacks with a 13, from the left; at a wide zoom the stacks of the longest timeframes
    const order = [...stacks.values()].sort(all13 ? (p, q) => q.rank - p.rank || p.day - q.day || p.dir - q.dir : (p, q) => q.top - p.top || q.day - p.day || p.dir - q.dir);
    const chipW = Math.ceil(tw(FONT.chip, '외 00개')) + 8, handleW = Math.ceil(tw(FONT.chip, '접기')) + 8;

    // One placement of everything on the scale Y. Per side a skyline over the pixel columns, in u = the distance
    // outward (buy side: y, sell side: -y): env = the candles' outer edge plus the gap, sky = what is taken so far.
    // final: the plot's ends are limits (measuring passes have none and report how far things reach beyond the plot);
    // reserve: per side, whether the numbers leave the last line before the plot's end to the chips.
    // U: the unfolded stacks in force; held: while a pile is unfolded, the numbers that are folded in the picture with
    // nothing unfolded. The stacks outside the pile keep exactly that choice, so unfolding changes nothing but the pile.
    // admit: of an unfolded pile's folded numbers, those that come back (null: all of them).
    let U = NO_UNFOLD, held = null, admit = null;
    const place = (Y, final, reserve) => {
      const out = { chips: [], handles: [], need: { [BUY]: 0, [SELL]: 0 }, failed: { [BUY]: false, [SELL]: false } }, sides = {};
      for (const dir of [BUY, SELL]) {
        const buy = dir === BUY, env = new Float32Array(nCol);
        for (let k = 0; k < nCol; k++) { const v = buy ? colLo[k] : colHi[k]; env[k] = v !== v ? -1e6 : buy ? Y(v) + GAP : GAP - Y(v); }
        const edge = buy ? plotB - 1 : -(plotT + 1);
        sides[dir] = { dir, env, sky: Float32Array.from(env), base: null, edge, limChip: final ? edge : Infinity, limText: final ? edge - (reserve[dir] ? CHIP_H + 1 : 0) : Infinity, chips: [], boxes: [] };
      }
      const top = (arr, k0, k1) => { let v = -Infinity; for (let k = k0; k <= k1; k++) if (arr[k] > v) v = arr[k]; return v; };
      const raise = (arr, k0, k1, u) => { for (let k = k0; k <= k1; k++) if (arr[k] < u) arr[k] = u; };
      const note = (sd, u) => { if (u - sd.edge > out.need[sd.dir]) out.need[sd.dir] = u - sd.edge; };
      // marks first: they stay at their candles, 13s nearest; a pile ends MARK_CAP from the candle (marks overlap there)
      for (const it of marks) {
        const sd = sides[it.a.dir], home = Math.ceil(top(sd.env, it.k0, it.k1));
        const u = Math.max(home, Math.min(Math.ceil(top(sd.sky, it.k0, it.k1)), home + MARK_CAP - it.h, sd.limText - it.h));
        it.u = u; it.far = u - home; raise(sd.sky, it.k0, it.k1, u + it.h + 1); note(sd, u + it.h); sd.boxes.push(it);
      }
      for (const dir of [BUY, SELL]) sides[dir].base = Float32Array.from(sides[dir].sky);
      for (const st of order) {
        const sd = sides[st.dir], open = U.has(st.key), fixed = !open && held !== null;
        const [ca, cb] = dayCols(st.day), own = Math.ceil(top(sd.env, ca, cb));   // where the day's own candle ends
        // the columns the stack may take in any alignment (with a little to spare), to put them back after a try
        let kA = nCol, kB = 0, wMax = 0;
        for (const it of st.list) { kA = Math.min(kA, cb - it.w - 1, it.k0); kB = Math.max(kB, ca + it.w + 1, it.k1); if (it.w > wMax) wMax = it.w; }
        kA = Math.max(0, kA); kB = Math.min(nCol - 1, kB);
        const saved = sd.sky.slice(kA, kB + 1);
        // One try: the numbers in the order of the stack, each just outside what is there. Returns what stays, what
        // folds and how far the stack reaches from its own candle (a folded number counts more than any distance).
        const run = (mode) => {
          sd.sky.set(saved, kA);
          for (const it of st.list) alignBox(it, mode);
          let keep = st.list, fold = [];
          if (fixed) { fold = keep.filter((it) => held.has(it.a)); keep = keep.filter((it) => !held.has(it.a)); }
          else if (open && admit) { fold = keep.filter((it) => held.has(it.a) && !admit.has(it.a)); keep = keep.filter((it) => !fold.includes(it)); }
          else if (!open && keep.length > K) { fold = keep.slice().sort(byRank).slice(K); keep = keep.filter((it) => !fold.includes(it)); }
          for (;;) {
            let ok = true;
            for (const it of keep) {
              const u = Math.ceil(top(sd.sky, it.k0, it.k1));
              // a number may stand K lines from what was there before the numbers (the candles, the marks), not further
              if ((!open && !fixed && u - Math.ceil(top(sd.base, it.k0, it.k1)) > (K - 1) * (ROW + STACK_GAP) + 2) || u + it.h > sd.limText) { ok = false; break; }
              it.u = u; it.far = u - own;
              raise(sd.sky, it.k0, it.k1, u + it.h + 1);
            }
            if (ok) break;
            // no room for all of them: the one that matters least folds, and the others are placed again
            sd.sky.set(saved, kA);
            const drop = keep.slice().sort(byRank).pop();
            keep = keep.filter((it) => it !== drop); fold.push(drop);
          }
          // what stands on this stack later (the numbers of another day) keeps a little apart from it
          for (const it of keep) raise(sd.sky, it.k0, it.k1, it.u + it.h + 1 + STACK_GAP);
          const last = keep[keep.length - 1];
          return { mode, keep, fold, cost: fold.length * 1e5 + (last ? last.u + last.h - own : 0) + (mode === 'c' ? 0 : SHIFT_COST) };
        };
        // Centered on its day when that keeps the stack at its candle. On a slope a centered number hangs far from its
        // own candle (it may not cover the candles next to it): then the stack may stand to one side of its day, if
        // that brings it at least a line nearer.
        let res = run('c');
        if (wMax > ppd + 4 && res.cost > st.list.length * ROW + 6) {
          for (const mode of ['l', 'r']) { const r = run(mode); if (r.cost < res.cost) res = r; }
          res = run(res.mode);
        }
        let { keep, fold } = res;
        for (const it of st.list) it.chip = null;
        for (const it of keep) { note(sd, it.u + it.h); sd.boxes.push(it); }
        st.kept = keep; st.own = null;
        if (fold.length) {
          // the chip of what folded: the chip that stands at this place already (one chip for the stacks of
          // neighbouring days), else a new one after the stack, or, where the plot ends before that, in the last
          // line of the plot (reserve)
          const x = clamp(Math.round(X(st.day) - chipW / 2), plotL + 1, Math.max(plotL + 1, plotR - 1 - chipW)), k0 = x - plotL, k1 = Math.min(nCol - 1, k0 + chipW - 1);
          const mk = (u) => { const c = { id: st.key, x, u, w: chipW, h: CHIP_H, dir: st.dir, day: st.day, far: u - own, members: [], keys: new Set() }; raise(sd.sky, k0, k1, u + CHIP_H + 1); sd.chips.push(c); out.chips.push(c); sd.boxes.push(c); return c; };
          let chip = sd.chips.find((c) => c.x < x + chipW + CHIP_JOIN && x < c.x + c.w + CHIP_JOIN) || null;
          if (!chip) { const u = Math.ceil(top(sd.sky, k0, k1)); chip = u + CHIP_H <= sd.limChip ? mk(u) : reserve[st.dir] ? mk(sd.limChip - CHIP_H) : null; st.own = chip; }
          if (chip) { fold.sort((p, q) => p.a.j - q.a.j || p.a.inner - q.a.inner); chip.members.push(...fold); chip.keys.add(st.key); for (const it of fold) it.chip = chip; note(sd, chip.u + CHIP_H); }
          else out.failed[st.dir] = true;
        }
      }
      // the stacks that were unfolded together end with one handle that folds them again, after the stack that
      // reaches furthest out
      const groups = new Map();
      for (const st of order) {
        const gid = U.get(st.key); if (gid == null || !st.kept.length) continue;
        const last = st.kept[st.kept.length - 1], end = last.u + last.h, was = groups.get(gid);
        if (!was || end > was.end) groups.set(gid, { st, end });
      }
      for (const [gid, { st, end }] of groups) {
        const sd = sides[st.dir], xMax = Math.max(plotL + 1, plotR - 1 - handleW), x0 = clamp(Math.round(X(st.day) - handleW / 2), plotL + 1, xMax);
        // where the plot ends before the handle: beside the end of the stack, at the nearest place that is free
        let x = x0, u = Math.ceil(top(sd.sky, x - plotL, Math.min(nCol - 1, x - plotL + handleW - 1)));
        for (let i = 1; u + CHIP_H > sd.limChip && i <= 16; i++) {
          for (const sx of [x0 + i * 12, x0 - i * 12]) {
            const xs = clamp(sx, plotL + 1, xMax), us = Math.ceil(top(sd.sky, xs - plotL, Math.min(nCol - 1, xs - plotL + handleW - 1)));
            if (us + CHIP_H <= sd.limChip) { x = xs; u = Math.max(us, Math.min(end - CHIP_H, sd.limChip - CHIP_H)); break; }
          }
        }
        if (u + CHIP_H > sd.limChip) continue;
        const k0 = x - plotL, k1 = Math.min(nCol - 1, k0 + handleW - 1), hd = { key: gid, x, u, w: handleW, h: CHIP_H, dir: st.dir, day: st.day };
        out.handles.push(hd); sd.boxes.push(hd); raise(sd.sky, k0, k1, u + CHIP_H + 1); note(sd, u + CHIP_H);
      }
      // a chip that would stand for one number: the number itself, where it fits in the chip's place (centered on its
      // day, or to one side of it)
      for (const c of out.chips.slice()) {
        if (c.members.length !== 1) continue;
        const it = c.members[0], sd = sides[c.dir], was = [it.x, it.k0, it.k1, it.side];
        let u = null;
        for (const mode of ['c', 'l', 'r']) {
          alignBox(it, mode);
          const v = Math.max(c.u, Math.ceil(top(sd.env, it.k0, it.k1)));
          if (v + it.h <= sd.limText && !sd.boxes.some((b) => b !== c && it.x < b.x + b.w && b.x < it.x + it.w && v < b.u + b.h + 1 && b.u < v + it.h + 1)) { u = v; break; }
        }
        if (u === null) { [it.x, it.k0, it.k1, it.side] = was; continue; }
        const [ca, cb] = dayCols(it.a.day);
        it.chip = null; it.u = u; it.far = u - Math.ceil(top(sd.env, ca, cb)); note(sd, u + it.h);
        sd.boxes[sd.boxes.indexOf(c)] = it; sd.chips.splice(sd.chips.indexOf(c), 1); out.chips.splice(out.chips.indexOf(c), 1);
        it.st.kept = [...it.st.kept, it]; if (it.st.own === c) it.st.own = null;
      }
      return out;
    };

    // The price scale leaves the room the stacks need above and under the candles, in whole lines; the candles keep
    // at least two fifths of the height. While a pile is unfolded the numbers may take more and the candles keep a
    // fifth (flatter candles let the other stacks meet more often, so both sides get the room); where the two sides
    // do not fit, it is the pile's side that gives way.
    const quant = (v) => BASE_M + Math.ceil(Math.max(0, v - BASE_M) / ROW) * ROW;
    let mT = BASE_M, mB = BASE_M, Y = null;
    const scale = () => { const yB = plotB - mB, ky = (yB - plotT - mT) / (fh - fl); Y = (v) => yB - (f(v) - fl) * ky; Y.ky = ky; Y.yB = yB; };
    const solve = () => {
      const loose = { [BUY]: false, [SELL]: false };
      for (const st of stacks.values()) if (U.has(st.key)) loose[st.dir] = true;
      const any = loose[BUY] || loose[SELL], capOne = Math.floor(plotH * (any ? 0.62 : 0.38)), capSum = Math.floor(plotH * (any ? 0.8 : 0.6));
      mT = mB = BASE_M;
      for (let pass = 0; pass < 6; pass++) {
        scale();
        const r = place(Y, false, NO_RESERVE);
        let t = Math.min(capOne, quant(mT + r.need[SELL])), b = Math.min(capOne, quant(mB + r.need[BUY]));
        if (t + b > capSum) {
          if (loose[SELL] && !loose[BUY]) t = Math.max(BASE_M, capSum - b);
          else if (loose[BUY] && !loose[SELL]) b = Math.max(BASE_M, capSum - t);
          else { const k = capSum / (t + b); t = Math.max(BASE_M, Math.floor(t * k)); b = Math.max(BASE_M, Math.floor(b * k)); }
        }
        if (t === mT && b === mB) break;
        mT = t; mB = b;
      }
      scale();
      // (a side whose chip found no room is placed again with its last line kept for the chips; the other side stays)
      const r = place(Y, true, NO_RESERVE);
      return r.failed[BUY] || r.failed[SELL] ? place(Y, true, r.failed) : r;
    };
    let res = solve();
    if ([...stacks.keys()].some((key) => unfold.has(key))) {
      // A pile of this window is unfolded. The picture above, with nothing unfolded, says what is folded elsewhere
      // (held) and what was shown: no number that was shown may fold for the pile. So the pile's folded numbers come
      // back only as far as that holds, the most important first; the others wait in a chip of the pile.
      const folded = [mT, mB];
      held = new Set(); for (const it of m.items) if (it.text && it.chip) held.add(it.a);
      const lost = () => m.items.some((it) => it.text && it.chip && !held.has(it.a));
      const final = () => { const r = place(Y, true, NO_RESERVE); res = r.failed[BUY] || r.failed[SELL] ? place(Y, true, r.failed) : r; return !lost(); };
      const most = () => {
        admit = null; if (final()) return true;
        const cand = m.items.filter((it) => it.text && U.has(it.st.key) && held.has(it.a)).sort(byRank);
        const withFirst = (n) => { admit = new Set(cand.slice(0, n).map((it) => it.a)); return final(); };
        let lo = 0, hi = cand.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (withFirst(mid)) lo = mid; else hi = mid - 1; }
        return withFirst(lo);
      };
      U = unfold; solve();   // the scale with room for the whole pile, as far as the plot gives it
      // (where the flatter candles let not even the shown numbers stand, the pile unfolds on the folded picture's scale)
      if (!most()) { [mT, mB] = folded; scale(); most(); }
    }
    m.Y = Y; m.P = (y) => fi(fl + (Y.yB - y) / Y.ky); m.ys = { log, a: Y.yB + fl * Y.ky, b: Y.ky };   // y = a - b * (log ? ln(price) : price)
    const toY = (dir, u, h) => (dir === BUY ? u : -(u + h));
    for (const c of res.chips) { c.y = toY(c.dir, c.u, c.h); c.lead = c.far > LEAD_FAR; }
    for (const h of res.handles) h.y = toY(h.dir, h.u, h.h);
    m.chips = res.chips; m.handles = res.handles;
    for (const it of m.items) {
      if (!it.text) { it.shown = 'mark'; it.y = toY(it.a.dir, it.u, it.h); }
      else if (it.chip) { const c = it.chip; it.shown = 'folded'; it.x = c.x; it.y = c.y; it.w = c.w; it.h = c.h; it.group = c.id; }
      else { it.shown = 'text'; it.y = toY(it.a.dir, it.u, it.h); it.lead = it.far > LEAD_FAR || Math.abs(it.side) > LEAD_SIDE; }
    }
    // a number that stands right on a number of its own stack needs no line of its own: the stack has one, from the
    // candle to the first of them (the same for the chip a stack ends with)
    const onTop = (b, prev) => !!prev && Math.abs(b.u - (prev.u + prev.h + 1)) <= 1 && Math.min(b.x + b.w, prev.x + prev.w) - Math.max(b.x, prev.x) >= 8;
    for (const st of order) {
      let prev = null;
      for (const it of st.kept) { if (onTop(it, prev)) it.lead = false; prev = it; }
      if (st.own && onTop(st.own, prev)) st.own.lead = false;
    }
    m.pTicks = m.none ? [] : priceTicks(m.P(plotB), m.P(plotT), log, Math.max(3, Math.round(plotH / 62))).map((v) => ({ v, y: Y(v) })).filter((t) => t.y >= plotT + 7 && t.y <= plotB - 7);

    // ---- 다음 봉 조건: every next-bar trigger of the timeframes, families and sides shown that one move of the price can meet ----
    const conds = m.conds;
    if (condOn) {
      for (const x of cur.det.tfs) {
        if (!tfOn(x.j)) continue;
        for (const t of x.trigs) {
          const is13 = t.k === 'C13';
          if (!t.fire || !dirOn(t.d) || (is13 ? !BE.famOn(t.f) : S.nine !== 'on')) continue;
          conds.push({ x, j: x.j, tf: x.tf, trig: t.t, k: t.k, d: t.d, f: is13 ? t.f : null, o: t.o, fire: t.fire, is13, rep: t.k === 'S9r',
            near: !t.fire.now && Math.abs(t.fire.pct) <= S.near / 100, shown: nar ? 'list' : '', bx: 0, by: 0, bw: 0, bh: COND_H, t: 0, cy: 0, lane: 0, qy: null, qTick: false });
        }
      }
      // "지금 값으로 충족" first, then the nearest first
      conds.sort((p, q) => Number(q.fire.now) - Number(p.fire.now) || Math.abs(p.fire.pct) - Math.abs(q.fire.pct) || p.j - q.j || (p.f == null ? -1 : p.f) - (q.f == null ? -1 : q.f));
    }
    if (zone) {
      const zx0 = plotR, zx1 = W - 2, chipX = zx0 + 24, last = cur.det.last, yC = Y(last);
      for (const q of conds) {
        q.nw = tw(FONT.cond, q.is13 ? '13' : '9'); q.bw = Math.ceil(q.nw + 1 + tw(FONT.condSup, q.tf)) + 8; q.bx = chipX;
        q.t = Y(q.fire.now ? last : q.fire.p);
        q.shown = q.t < plotT + 5 ? 'above' : q.t > plotB - 5 ? 'below' : 'in';
      }
      // beyond the price range: pinned to the edge, the nearest few; the others fold
      const near1st = (p, q) => Math.abs(p.fire.pct) - Math.abs(q.fire.pct);
      const up = { show: conds.filter((q) => q.shown === 'above').sort(near1st), rest: [] }, dn = { show: conds.filter((q) => q.shown === 'below').sort(near1st), rest: [] };
      for (const g of [up, dn]) if (g.show.length > PINNED + 1) g.rest = g.show.splice(PINNED);
      const ins = conds.filter((q) => q.shown === 'in').sort((p, q) => p.t - q.t);
      const top0 = plotT + 19 + COND_H / 2, bot0 = plotB - 4 - COND_H / 2;   // the middles of the first and of the last row
      const rows = (g) => g.show.length + (g.rest.length ? 1 : 0);
      for (;;) {
        const yLo = top0 + rows(up) * COND_PITCH, yHi = bot0 - rows(dn) * COND_PITCH;
        if (!ins.length || (ins.length - 1) * COND_PITCH <= yHi - yLo) { spread(ins, yLo, Math.max(yLo, yHi), COND_PITCH); break; }
        // more than the zone holds: the one farthest from the current price folds at its edge
        let far = 0; for (let i = 1; i < ins.length; i++) if (Math.abs(ins[i].fire.pct) > Math.abs(ins[far].fire.pct)) far = i;
        const q = ins.splice(far, 1)[0]; (q.t < yC ? up : dn).rest.push(q);
      }
      for (const q of ins) q.by = Math.round(q.cy - COND_H / 2);
      // pinned rows keep the order of the prices: at the top the nearest is the lowest, at the bottom the highest
      up.show.forEach((q, i) => { q.by = Math.round(top0 + (rows(up) - 1 - i) * COND_PITCH - COND_H / 2); });
      dn.show.forEach((q, i) => { q.by = Math.round(bot0 - (rows(dn) - 1 - i) * COND_PITCH - COND_H / 2); });
      const moreW = Math.ceil(tw(FONT.chip, '외 00개')) + 8;
      for (const [g, above] of [[up, true], [dn, false]]) {
        if (!g.rest.length) continue;
        const mo = { above, list: g.rest.sort(near1st), x: chipX, y: Math.round((above ? top0 : bot0) - CHIP_H / 2), w: moreW, h: CHIP_H };
        for (const q of g.rest) { q.shown = 'folded'; q.bx = mo.x; q.by = mo.y; q.bw = mo.w; q.bh = mo.h; }
        m.more.push(mo);
      }
      // the close level of a 13 (where the bar may close once it has reached the price): a thin line down a lane of its
      // own from the chip's price, with a tick where it ends inside the plot
      const lanes = [];
      for (const q of ins) {
        const fr = q.fire;
        if (fr.now || fr.q === fr.p) continue;
        const yq = clamp(Y(fr.q), plotT, plotB), a = Math.min(q.t, yq) - 2, b = Math.max(q.t, yq) + 2;
        let L = 0;
        while (L < 3 && lanes[L] && lanes[L].some((iv) => a < iv[1] && iv[0] < b)) L++;
        (lanes[L] || (lanes[L] = [])).push([a, b]);
        q.lane = L; q.qy = yq; q.qTick = fr.qpct !== 0 && Y(fr.q) >= plotT && Y(fr.q) <= plotB;
      }
      m.zx = { x0: zx0, x1: zx1, chipX, yC, last, up, dn, ins };
    }
    m.ms = performance.now() - t0;
  }

  // ---------- the chart: drawing ----------
  // a number: its text and the timeframe as a superscript, on a ground of the surface color
  function drawNumber(ctx, it) {
    const a = it.a, def = a.kind === 'I', base = it.y + (def ? 9.5 : 11.5);
    ctx.globalAlpha = 0.86; ctx.fillStyle = C.surface; ctx.fillRect(it.x, it.y, it.w, it.h);
    ctx.globalAlpha = alphaOf(a); ctx.fillStyle = colorOf(a); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = def ? FONT.numDef : a.kind === 'C' ? FONT.num13 : FONT.num9; ctx.fillText(a.text, it.x + 1, base);
    ctx.font = def ? FONT.supDef : FONT.sup; ctx.fillText(a.tf, it.x + 2 + it.nw, base - (def ? 3.4 : 4.2));
    ctx.globalAlpha = 1;
  }
  // the neutral chip of folded numbers ("외 N개"), and the handle of an unfolded stack ("접기")
  function drawFold(ctx, b, text) {
    ctx.globalAlpha = 1; ctx.fillStyle = C.sunken; roundRect(ctx, b.x, b.y, b.w, b.h, 3.5); ctx.fill();
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; roundRect(ctx, b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, 3); ctx.stroke();
    ctx.fillStyle = C.muted; ctx.font = FONT.chip; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, b.x + b.w / 2, b.y + b.h / 2 + 0.5);
  }
  // the mark of a condition that is waiting, as the study draws it: level 0 beyond the 임박 threshold, 1 within it,
  // 2 met as things are
  function drawWait(ctx, q) {
    const level = q.fire.now ? 2 : q.near ? 1 : 0, col = q.is13 ? INK[q.f] : SETUP_COLOR, a = q.rep ? 0.6 : 1;
    const lw = !q.is13 ? (level ? 1.5 : 1) : level ? 2 : 1.25, x = q.bx, y = q.by, w = q.bw, h = q.bh;
    ctx.globalAlpha = 1; ctx.fillStyle = C.surface; roundRect(ctx, x, y, w, h, 3.5); ctx.fill();
    const ground = a * (q.is13 ? [0.14, 0.26, 0.4][level] : level === 2 ? 0.22 : 0);
    if (ground > 0) { ctx.globalAlpha = ground; ctx.fillStyle = col; roundRect(ctx, x, y, w, h, 3.5); ctx.fill(); }
    ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.lineWidth = lw;
    if (!q.is13) ctx.setLineDash([2.5, 1.5]);
    roundRect(ctx, x + lw / 2, y + lw / 2, w - lw, h - lw, 3.5 - lw / 2); ctx.stroke();
    ctx.setLineDash([]); ctx.lineWidth = 1;
    ctx.fillStyle = q.is13 ? C.fg : C['setup-ink']; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = FONT.cond; ctx.fillText(q.is13 ? '13' : '9', x + 4, y + 11.3);
    ctx.font = FONT.condSup; ctx.fillText(q.tf, x + 5 + q.nw, y + 7.6);
    ctx.globalAlpha = 1;
  }
  const condInk = (q) => (q.is13 ? INK[q.f] : C['setup-ink']);
  // where the line from a number to its day begins: just outside the day's candle
  function candleEnd(a) { const i = a.day - cur.d.d0; return a.dir === BUY ? M.Y(cur.d.l[i]) + 1.5 : M.Y(cur.d.h[i]) - 1.5; }
  // the line from a number's box b to its day: straight down (or up) where the box reaches over the day, else to the
  // nearest end of the box. A box that stands to one side of its day gets a small pointer at the day as well, so that
  // the day is read off the pointer and not off the middle of the number.
  function drawLeader(ctx, a, b, color, alpha) {
    const cx = M.X(a.day), yc = candleEnd(a), x = clamp(cx, b.x + 2, b.x + b.w - 2), buy = a.dir === BUY, y = buy ? b.y : b.y + b.h;
    const straight = Math.abs(x - cx) < 0.01, sx = straight ? Math.round(cx) + 0.5 : cx;
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx, yc); ctx.lineTo(straight ? sx : x, y); ctx.stroke();
    if (straight && Math.abs(b.x + b.w / 2 - cx) > LEAD_SIDE) {
      ctx.globalAlpha = Math.min(1, alpha * 1.7); ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(sx - 3, y); ctx.lineTo(sx + 3, y); ctx.lineTo(sx, y + (buy ? -3 : 3)); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function paintChart() {
    const m = M, dpr = window.devicePixelRatio || 1, size = `${m.W}x${m.H}@${dpr}`;
    let ctx;
    if (size !== sized.c) { sized.c = size; ui.chart.style.height = m.H + 'px'; ctx = BE.setupCanvas(ui.cBase, m.W, m.H); BE.setupCanvas(ui.cOver, m.W, m.H); }
    else { ctx = ui.cBase.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    const { W, H, plotL, plotR, plotT, plotB, ppd, X, Y, d0, d1 } = m, D = cur.d, b0 = D.d0, dark = BE.isDark();
    ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.lineJoin = 'round';
    ctx.fillStyle = C.surface; ctx.fillRect(0, 0, W, H);
    if (m.zone) { ctx.globalAlpha = 0.55; ctx.fillStyle = C.sunken; roundRect(ctx, m.zx.x0, plotT, W - m.zx.x0, plotB - plotT, 5); ctx.fill(); ctx.globalAlpha = 1; }
    // price grid and axis (left), date axis (bottom)
    const axisFont = m.nar ? FONT.axisS : FONT.axis, fits = (s) => tw(axisFont, s) <= m.gut - 8;
    ctx.font = axisFont; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    for (const t of m.pTicks) {
      const y = Math.round(t.y);
      ctx.fillStyle = C.line; ctx.fillRect(plotL, y, m.gridR - plotL, 1);
      ctx.fillStyle = C.muted; ctx.fillText(axisText(t.v, fits), plotL - 6, y + 0.5);
    }
    ctx.fillStyle = C.line; ctx.fillRect(plotL, plotB, m.gridR - plotL, 1);
    ctx.textAlign = 'center';
    let lastX = -Infinity, year = '';
    for (const t of m.dTicks) {
      // a day tick carries its year when it is the first one written or the year has changed
      const x = plotL + m.padL + (t.d - d0 + t.at) * ppd, text = t.full && t.full.slice(0, 4) !== year ? t.full : t.text, half = tw(axisFont, text) / 2;
      ctx.fillStyle = C.line; ctx.fillRect(Math.round(x), plotB, 1, 4);
      if (x - half < plotL || x + half > plotR || x - half < lastX + 12) continue;
      ctx.fillStyle = C.muted; ctx.fillText(text, x, plotB + AXIS_H / 2 + 2); lastX = x + half;
      if (t.full) year = t.full.slice(0, 4);
    }
    if (m.none) {
      ctx.fillStyle = C.muted; ctx.font = FONT.note; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('이 기간에는 TradingView 일봉이 없습니다.', (plotL + plotR) / 2, (plotT + plotB) / 2);
    }
    // candles, neutral so that the colors of the numbers carry the meaning: a rising day hollow and light, a falling day
    // filled and dark; snapped to device pixels. Thinner as the days get narrower, at last a band with the close as a line.
    const snap = (v) => Math.round(v * dpr) / dpr, one = Math.max(1, Math.round(dpr)) / dpr;
    const soft = C.faint, hard = C.fg, aSoft = dark ? 0.95 : 0.66, aHard = dark ? 0.64 : 0.8;
    const lod = m.lod.candle;
    if (lod === 'line') {
      const nCol = m.colLo.length, close = new Float64Array(nCol).fill(NaN);
      for (let d = d0; d <= d1; d++) { const i = d - b0; if (D.c[i] != null) close[clamp(Math.floor(m.padL + (d - d0 + 0.5) * ppd), 0, nCol - 1)] = D.c[i]; }
      ctx.fillStyle = soft; ctx.globalAlpha = dark ? 0.5 : 0.36;
      for (let k = 0; k < nCol; k++) if (m.colLo[k] === m.colLo[k]) { const yh = Y(m.colHi[k]); ctx.fillRect(plotL + k, yh, 1, Math.max(1, Y(m.colLo[k]) - yh)); }
      ctx.globalAlpha = aHard; ctx.strokeStyle = hard; ctx.lineWidth = 1; ctx.beginPath();
      let pen = false;
      for (let k = 0; k < nCol; k++) { const v = close[k]; if (v !== v) { if (m.colLo[k] !== m.colLo[k]) pen = false; continue; } if (pen) ctx.lineTo(plotL + k + 0.5, Y(v)); else { ctx.moveTo(plotL + k + 0.5, Y(v)); pen = true; } }
      ctx.stroke(); ctx.globalAlpha = 1;
    } else {
      let bw = lod === 'candle' ? Math.round(ppd * 0.75) : lod === 'thin' ? (ppd >= 3.4 ? 3 : 2) : ppd >= 1.8 ? 2 : 1;
      if (lod === 'candle') { if (bw % 2 === 0) bw += bw + 1 <= ppd - 1 ? 1 : -1; bw = clamp(bw, 3, 13); }
      const bwS = Math.max(one, snap(bw));
      for (const up of [true, false]) {
        ctx.fillStyle = up ? soft : hard; ctx.globalAlpha = up ? aSoft : aHard;
        for (let d = d0; d <= d1; d++) {
          const i = d - b0; if (D.c[i] == null) continue;
          const o = D.o[i], c = D.c[i]; if ((c >= o) !== up) continue;
          const cx = X(d), yh = snap(Y(D.h[i])), yl = Math.max(yh + one, snap(Y(D.l[i])));
          if (lod === 'range') { ctx.fillRect(snap(cx - bwS / 2), yh, bwS, yl - yh); continue; }
          const x0 = snap(cx - bwS / 2), xw = snap(x0 + (bwS - one) / 2), y0 = snap(Y(Math.max(o, c))), y1 = Math.max(y0 + one, snap(Y(Math.min(o, c))));
          if (up && lod === 'candle' && y1 - y0 >= 3 * one) {
            // hollow: the wick above and under the body, the body as a frame
            ctx.fillRect(xw, yh, one, y0 - yh); ctx.fillRect(xw, y1, one, yl - y1);
            ctx.fillRect(x0, y0, bwS, one); ctx.fillRect(x0, y1 - one, bwS, one); ctx.fillRect(x0, y0 + one, one, y1 - y0 - 2 * one); ctx.fillRect(x0 + bwS - one, y0 + one, one, y1 - y0 - 2 * one);
          } else { ctx.fillRect(xw, yh, one, yl - yh); ctx.fillRect(x0, y0, bwS, y1 - y0); }
        }
      }
      ctx.globalAlpha = 1;
    }
    if (m.zone) paintZone(ctx);
    // lines from the numbers that stand away from their candle, under everything they pass
    for (const it of m.items) if (it.shown === 'text' && it.lead) drawLeader(ctx, it.a, it, colorOf(it.a), 0.5 * alphaOf(it.a));
    for (const c of m.chips) if (c.lead) drawLeader(ctx, c, c, C.muted, 0.6);
    // marks, then numbers (+13, 9, 13), then the chips of folded numbers
    for (const it of m.items) {
      if (it.shown !== 'mark') continue;
      const a = it.a;
      ctx.globalAlpha = a.kind === 'C' ? 1 : a.kind === 'S' ? (a.rep ? 0.5 : 0.9) : 0.55; ctx.fillStyle = colorOf(a); ctx.fillRect(it.x, it.y, it.w, it.h);
    }
    ctx.globalAlpha = 1;
    for (const kind of ['I', 'S', 'C']) for (const it of m.items) if (it.shown === 'text' && it.a.kind === kind) drawNumber(ctx, it);
    for (const c of m.chips) drawFold(ctx, c, `외 ${c.members.length}개`);
    for (const h of m.handles) drawFold(ctx, h, '접기');
  }
  // 다음 봉 조건: the newest close as a dashed line with its price, a chip per condition at its price with a pointer
  // from the exact price, the close level of a 13 as a thin line with a tick, the conditions beyond the range at the edges
  function paintZone(ctx) {
    const m = M, z = m.zx, { plotT, plotB } = m;
    ctx.font = FONT.zone; ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('다음 봉 조건', z.x0 + 8, plotT + 10);
    const inside = z.yC >= plotT + 1 && z.yC <= plotB - 1, yC = Math.round(z.yC) + 0.5;
    if (inside) {
      ctx.strokeStyle = C.muted; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      // (where a chip and its text stand on this line, the line stops before them and goes on after them)
      const on = [...z.ins, ...z.up.show, ...z.dn.show].filter((q) => q.by - 2 < z.yC && z.yC < q.by + q.bh + 2);
      const gapR = on.length ? Math.max(...on.map((q) => q.bx + q.bw + 7 + (q.fire.now ? tw(FONT.small, '충족') : tw(q.near ? FONT.pctB : FONT.pct, fmtPct(q.fire.pct))))) : 0;
      ctx.beginPath(); ctx.moveTo(m.X(m.d1) + m.ppd / 2 + 1, yC); ctx.lineTo(on.length ? z.x0 + 4 : z.x1, yC);
      if (on.length && gapR < z.x1 - 4) { ctx.moveTo(gapR, yC); ctx.lineTo(z.x1, yC); }
      ctx.stroke(); ctx.setLineDash([]);
      // the price: over the line at its right end (under it near the zone's top), as short as it has to be to fit
      const room = (s) => tw(FONT.tag, s) <= 64, full = fmtPrice(z.last), text = room(full) ? full : axisText(z.last, room), under = yC - 16 < plotT + 18;
      ctx.font = FONT.tag; ctx.fillStyle = C.fg; ctx.textAlign = 'right'; ctx.fillText(text, z.x1 - 3, yC + (under ? 8.5 : -7.5));
    }
    if (!m.conds.length) {
      ctx.font = FONT.small; ctx.fillStyle = C.faint; ctx.textAlign = 'left';
      ['지금은 9나 13이 나올', '조건이 없습니다.'].forEach((s, i) => ctx.fillText(s, z.x0 + 8, plotT + 30 + i * 14));
      return;
    }
    const pctText = (q, y) => {
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      if (q.fire.now) { ctx.font = FONT.small; ctx.fillStyle = C.fg; ctx.fillText('충족', q.bx + q.bw + 4, y + 0.5); return; }
      ctx.font = q.near ? FONT.pctB : FONT.pct; ctx.fillStyle = q.near ? C.fg : C.muted; ctx.globalAlpha = q.rep ? 0.75 : 1;
      ctx.fillText(fmtPct(q.fire.pct), q.bx + q.bw + 4, y + 0.5); ctx.globalAlpha = 1;
    };
    for (const q of z.ins) {
      const col = q.is13 ? INK[q.f] : SETUP_COLOR, rail = z.x0 + 7.5 + q.lane * 4, cy = q.by + q.bh / 2, py = Math.round(clamp(q.t, plotT, plotB)) + 0.5;
      const al = q.rep ? 0.6 : 1;
      ctx.strokeStyle = ctx.fillStyle = col; ctx.lineWidth = 1;
      if (q.qy != null) {
        const qy = Math.round(q.qy) + 0.5;
        ctx.globalAlpha = al * 0.45; ctx.beginPath(); ctx.moveTo(rail, py); ctx.lineTo(rail, qy); ctx.stroke();
        if (q.qTick) { ctx.globalAlpha = al; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(rail - 3.5, qy); ctx.lineTo(rail + 3.5, qy); ctx.stroke(); ctx.lineWidth = 1; }
      }
      ctx.globalAlpha = al * 0.85;
      // the pointer: from the exact price at the zone's edge to the chip
      ctx.beginPath(); ctx.moveTo(z.x0 + 2, py); ctx.lineTo(rail, py); ctx.lineTo(q.bx - 1, cy); ctx.stroke();
      if (q.fire.now) { ctx.globalAlpha = q.rep ? 0.6 : 1; ctx.beginPath(); ctx.arc(rail, py, 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      drawWait(ctx, q); pctText(q, cy);
    }
    for (const [g, above] of [[z.up, true], [z.dn, false]]) {
      for (const q of g.show) {
        const cy = q.by + q.bh / 2, ax = z.x0 + 12;
        ctx.fillStyle = condInk(q); ctx.globalAlpha = q.rep ? 0.6 : 1;
        ctx.beginPath(); ctx.moveTo(ax, cy + (above ? -4 : 4)); ctx.lineTo(ax - 4.5, cy + (above ? 3.5 : -3.5)); ctx.lineTo(ax + 4.5, cy + (above ? 3.5 : -3.5)); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
        drawWait(ctx, q); pctText(q, cy);
      }
    }
    for (const mo of m.more) drawFold(ctx, mo, `외 ${mo.list.length}개`);
  }

  // ---------- what is pointed at ----------
  const dayAt = (x) => clamp(M.d0 + Math.floor((x - M.plotL - M.padL) / M.ppd), M.d0, M.d1);
  // the days that share a day's pixel column (the day itself from 1 px a day)
  function colDays(day) {
    const m = M;
    if (m.ppd >= 1) return [day, day];
    const k = Math.floor(m.padL + (day - m.d0 + 0.5) * m.ppd);
    const s = m.d0 + Math.ceil((k - m.padL) / m.ppd - 0.5), e = m.d0 + Math.ceil((k + 1 - m.padL) / m.ppd - 0.5) - 1;
    return [clamp(Math.min(s, day), m.d0, m.d1), clamp(Math.max(e, day), m.d0, m.d1)];
  }
  // what stands at a point of the chart: a number (or its mark), a chip of folded numbers, the handle of an unfolded
  // stack, a condition, or the day; slack: how far outside a box still counts (a finger is less exact)
  function hitAt(x, y, slack = 0) {
    const m = M; if (!m) return null;
    const inBox = (b, pad) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
    if (m.zone && x >= m.zx.x0) {
      for (const q of m.conds) if (q.shown !== 'folded' && x >= q.bx - 3 - slack && x <= m.zx.x1 && y >= q.by - 1 - slack && y <= q.by + q.bh + 1 + slack) return { type: 'cond', q };
      for (const mo of m.more) if (inBox(mo, 2 + slack)) return { type: 'more', mo };
      return { type: 'zone' };
    }
    for (const it of m.items) if (it.shown === 'text' && inBox(it, slack)) return { type: 'label', it };
    for (const c of m.chips) if (inBox(c, slack)) return { type: 'chip', chip: c };
    for (const h of m.handles) if (inBox(h, slack)) return { type: 'handle', hd: h };
    let best = null, bd = Infinity;
    for (const it of m.items) {
      if (it.shown !== 'mark' || !inBox(it, 1.5 + slack)) continue;
      const dd = Math.abs(x - it.x - it.w / 2) + Math.abs(y - it.y - it.h / 2);
      if (dd < bd) { bd = dd; best = it; }
    }
    if (best) return { type: 'label', it: best };
    if (!m.none && x >= m.plotL && x <= m.plotR && y >= m.plotT && y <= m.H) return { type: 'day', day: dayAt(x), y: y <= m.plotB ? y : null };
    return null;
  }
  // the things at the keyboard's place, from the top of the picture down
  function thingsAt() {
    const m = M, out = [];
    if (!cursor || !m) return out;
    if (cursor.zone) {
      for (const q of m.conds) if (q.shown !== 'folded') out.push({ type: 'cond', q, y: q.by });
      for (const mo of m.more) out.push({ type: 'more', mo, y: mo.y });
    } else {
      const [s, e] = colDays(cursor.day);
      for (const it of m.items) if (it.a.day >= s && it.a.day <= e) out.push({ type: 'label', it, y: it.y + (it.shown === 'folded' ? 0.5 : 0) });
      for (const c of m.chips) if (c.day >= s && c.day <= e) out.push({ type: 'chip', chip: c, y: c.y });
      for (const h of m.handles) if (h.day >= s && h.day <= e) out.push({ type: 'handle', hd: h, y: h.y });
    }
    return out.sort((p, q) => p.y - q.y);
  }
  const picked = () => (cursor && cursor.pick != null ? thingsAt()[cursor.pick] || null : null);
  const sameCond = (p, q) => p.j === q.j && p.k === q.k && p.d === q.d && p.f === q.f && p.o === q.o;
  // the number or condition a tap chose, in the picture as it is now
  function pinnedThing() {
    if (!pinned || !M) return null;
    if (pinned.type === 'label') { const it = M.items.find((x) => x.a === pinned.a); return it ? { type: 'label', it } : null; }
    const q = M.conds.find((x) => sameCond(x, pinned.q)); return q ? { type: 'cond', q } : null;
  }
  // what is emphasized: the thing under the mouse, else the keyboard's choice, else the tapped one
  const focusThing = () => (hover && hover.type !== 'day' ? hover : hover ? null : picked() || pinnedThing());
  function activeLabel() { const t = focusThing(); return t && t.type === 'label' ? t.it.a : null; }

  // ---------- the layer over the chart: crosshair, the keyboard's day, the emphasized thing ----------
  function paintOver() {
    const m = M, ctx = ui.cOver.getContext('2d'), dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, m.W, m.H); ctx.globalAlpha = 1; ctx.setLineDash([]);
    const { plotL, plotR, plotT, plotB, X, ppd } = m, dark = BE.isDark();
    const dateTag = (day, bg, fg) => {
      const text = iso(day); ctx.font = FONT.tag;
      const w = ctx.measureText(text).width + 10, x = clamp(X(day) - w / 2, plotL, Math.max(plotL, plotR - w));
      ctx.fillStyle = bg; ctx.fillRect(x, plotB + 2, w, AXIS_H - 3);
      ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + w / 2, plotB + 2 + (AXIS_H - 3) / 2 + 0.5);
    };
    const priceTag = (y, price, bg, fg, frame) => {
      ctx.font = FONT.tag;
      const text = axisText(price, (s) => ctx.measureText(s).width <= m.gut - 9), w = ctx.measureText(text).width + 8, x = Math.max(0, plotL - 2 - w);
      ctx.fillStyle = bg; ctx.fillRect(x, y - 7.5, w, 15);
      if (frame) { ctx.strokeStyle = frame; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, Math.round(y - 7.5) + 0.5, w - 1, 14); }
      ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 4, y + 0.5);
    };
    const ring = (b, color, pad = 2.5) => { ctx.strokeStyle = color; ctx.lineWidth = 1.5; roundRect(ctx, b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad, 4); ctx.stroke(); ctx.lineWidth = 1; };
    const kb = cursor && document.activeElement === ui.cOver;
    if (kb && cursor.day != null && cursor.day >= m.d0 && cursor.day <= m.d1) {
      ctx.fillStyle = C.accent; ctx.globalAlpha = 0.9; ctx.fillRect(Math.round(X(cursor.day)), plotT, 1, plotB - plotT); ctx.globalAlpha = 1;
      dateTag(cursor.day, C.accent, C.surface);
    }
    if (kb && cursor.zone && m.zone) { ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; roundRect(ctx, m.zx.x0 + 1, plotT + 1, m.W - m.zx.x0 - 2, plotB - plotT - 2, 5); ctx.stroke(); ctx.lineWidth = 1; }
    if (hover && hover.type === 'day') {
      // the price line only where the pointer is at a price (under zero on a linear scale there is none)
      const cx = Math.round(X(hover.day)) + 0.5, price = hover.y != null ? m.P(hover.y) : 0;
      ctx.strokeStyle = C.muted; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(cx, plotT); ctx.lineTo(cx, plotB); ctx.stroke();
      if (price > 0) { const hy = Math.round(hover.y) + 0.5; ctx.beginPath(); ctx.moveTo(plotL, hy); ctx.lineTo(plotR, hy); ctx.stroke(); }
      ctx.setLineDash([]);
      dateTag(hover.day, C.fg, C.surface);
      if (price > 0) priceTag(hover.y, price, C.fg, C.surface, null);
      return;
    }
    const t = focusThing();
    if (!t) return;
    if (t.type === 'label') {
      const it = t.it, a = it.a, col = a.kind === 'S' ? C.fg : INK[a.f];
      // the days of its timeframe bar: a soft band, with an edge where the bar begins and ends inside the plot
      const xs = X(a.s) - ppd / 2, xe = X(a.e) + ppd / 2, xa = Math.max(plotL, xs), xb = Math.min(plotR, xe);
      if (xb > xa) {
        ctx.fillStyle = C.accent; ctx.globalAlpha = dark ? 0.16 : 0.09; ctx.fillRect(xa, plotT, xb - xa, plotB - plotT);
        ctx.globalAlpha = 0.7;
        if (xs >= plotL) ctx.fillRect(Math.round(xs), plotT, 1, plotB - plotT);
        if (xe <= plotR) ctx.fillRect(Math.round(xe) - 1, plotT, 1, plotB - plotT);
        ctx.globalAlpha = 1;
      }
      if (it.shown === 'text') { if (it.lead) drawLeader(ctx, a, it, col, 0.95); ring(it, col); }
      else if (it.shown === 'mark') ring(it, C.fg, 2);
      else ring(it, C.fg);
    } else if (t.type === 'chip') ring(t.chip, C.fg);
    else if (t.type === 'handle') ring(t.hd, C.fg);
    else if (t.type === 'more') ring(t.mo, C.fg);
    else if (t.type === 'cond' && m.zone) {
      const q = t.q, col = q.is13 ? INK[q.f] : SETUP_COLOR;
      ring({ x: q.bx, y: q.by, w: q.bw, h: q.bh }, C.fg);
      if (q.shown === 'in') {
        // its price across the chart, and the close level under it
        const py = Math.round(q.t) + 0.5;
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = 0.9; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(plotL, py); ctx.lineTo(m.zx.x0, py); ctx.stroke();
        if (q.qTick) { const qy = Math.round(q.qy) + 0.5; ctx.globalAlpha = 0.6; ctx.setLineDash([1.5, 3]); ctx.beginPath(); ctx.moveTo(plotL, qy); ctx.lineTo(m.zx.x0, qy); ctx.stroke(); }
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        priceTag(py, q.fire.now ? m.zx.last : q.fire.p, C.surface, C.fg, col);
      }
    }
  }

  // ---------- tooltips ----------
  // what a label is, in the words of the study's sheets
  function labelLine(a, short) {
    const b = cur.det.tfs[a.j].bars, L = a.L;
    if (a.kind === 'C') return `${FAM_NAME[a.f]} ${sideKo(a.dir)} 13 완성${/r/.test(a.text) ? ' (r: 셋업 18 이상 뒤)' : ''}${short ? '' : ` · 출발 봉 ${L.origins.map((o) => iso(b.start[o])).join(', ')}`}`;
    if (a.kind === 'I') return `${FAM_NAME[a.f]} ${sideKo(a.dir)} 13이 미뤄진 봉${short ? '' : ` · 출발 봉 ${iso(b.start[L.origin])}`}`;
    return a.rep ? `${sideKo(a.dir)} 반복 9 (셋업 ${L.raw})` : `${sideKo(a.dir)} 셋업 9${a.text === '9*' ? ' (퍼펙트)' : ''}`;
  }
  const goneText = () => `TradingView 차트에서는 지워진 라벨입니다. 지표가 라벨을 최근 ${BE.OPT.labelLimit}개까지만 남기기 때문입니다.`;
  // how the chart of a timeframe is opened, by the way the thing was reached
  const openText = (tf, how) => (how === 'key' ? `Enter 키를 누르면 TradingView ${tf} 차트가 열립니다.` : how === 'tap' ? `한 번 더 누르면 TradingView ${tf} 차트가 열립니다.` : `누르면 TradingView ${tf} 차트가 새 탭에서 열립니다.`);
  function labelTip(it, how) {
    const a = it.a, out = [el('div', 'h1', `${a.tf} 봉 ${spanText(a.s, a.e)}`), row(numEl(a), labelLine(a, false))];
    if (a.late) out.push(row(muted(`봉의 마지막 날 ${iso(a.e)}에는 일봉이 없어서, 숫자는 ${dayText(a.day)} 자리에 있습니다.`)));
    else if (a.s !== a.e) out.push(row(muted(`숫자는 봉의 마지막 날 ${dayText(a.day)} 자리에 있습니다.`)));
    if (it.shown === 'folded') out.push(el('div', 'm', '자리가 모자라 접힌 숫자입니다.'));
    if (a.gone) out.push(el('div', 'm', goneText()));
    out.push(el('div', 'bec-tip-foot', openText(a.tf, how)));
    return out;
  }
  // rows of labels for a list: the number as the chart writes it, what it is, and its bar
  function labelRows(list, max) {
    const box = el('div', 'sec');
    for (const a of list.slice(0, max)) box.append(row(numEl(a), labelLine(a, true), muted(`${a.tf} 봉 ${spanText(a.s, a.e)}`)));
    if (list.length > max) box.append(el('div', 'm', `외 ${list.length - max}개가 더 있습니다.`));
    return box;
  }
  function chipTip(chip, how) {
    // (the chip of a pile that is unfolded already holds what found no room: it folds the pile again)
    const rest = chipIsRest(chip), by = how === 'key' ? 'Enter 키를 누르면' : '누르면';
    return [el('div', 'h1', `접힌 숫자 ${chip.members.length}개`), labelRows(chip.members.map((it) => it.a), 12),
      el('div', 'bec-tip-foot', rest ? `펼칠 자리가 모자라 남은 숫자입니다. ${by} 펼친 숫자를 다시 접습니다.` : `${by} 이 자리에 펼칩니다.`)];
  }
  const handleTip = (how) => [el('div', null, how === 'key' ? 'Enter 키를 누르면 펼친 숫자를 다시 접습니다.' : '누르면 펼친 숫자를 다시 접습니다.')];
  function dayTip(day) {
    const d = cur.d, i = day - d.d0, [s, e] = colDays(day), out = [el('div', 'h1', dayText(day))];
    if (d.c[i] != null) {
      // open, high, low, close: each with its name on one line
      const r = el('div', 'row num');
      for (const [k, v] of [['시', d.o[i]], ['고', d.h[i]], ['저', d.l[i]], ['종', d.c[i]]]) { const s = el('span'); s.style.whiteSpace = 'nowrap'; s.append(el('span', 'm', k), ` ${fmtPrice(v)}`); r.append(s); }
      out.push(r);
    }
    else out.push(el('div', 'm', '이 날짜에는 TradingView 일봉이 없습니다.'));
    const list = labelsAt(s, e);
    if (e > s) out.push(el('div', 'm', `화면의 이 한 칸에는 ${iso(s)}부터 ${iso(e)}까지 ${e - s + 1}일이 겹쳐 있습니다.`));
    if (list.length) { out.push(labelRows(list, 14)); if (list.some((a) => a.gone)) out.push(el('div', 'bec-tip-foot', '이 가운데에는 TradingView 차트에서 지워진 라벨이 있습니다.')); }
    else out.push(el('div', 'm', e > s ? '이 기간에 놓인 9나 13이 없습니다.' : '이 날짜에 놓인 9나 13이 없습니다.'));
    return out;
  }
  // the bar a condition is about: the bar in progress, or the next bar when no closed day is in it yet (as on 1D)
  const barWord = (x) => (x.bars.partial ? '진행 중인 봉' : '다음 봉');
  function barDays(x) { const p = x.bars.partial; if (p) return [p.start, p.end]; try { return BARS.bucketFn(x.tf)(LAST + 1, [0, 0]); } catch (e) { return [LAST + 1, LAST + 1]; } }
  const condName = (q) => `${q.is13 ? FAM_NAME[q.f] + ' ' : ''}${sideKo(q.d)} ${q.is13 ? '13' : q.rep ? '반복 9' : '9'}`;
  const condSentence = (q) => BE.trigText(q.trig).replace(/^진행 중인 봉/, barWord(q.x));
  function condMeta(q) {
    const [s, e] = barDays(q.x), p = q.x.bars.partial, parts = [];
    if (q.is13 && q.o != null) parts.push(`출발 봉 ${iso(q.o)}`);
    parts.push(`${barWord(q.x)} ${spanText(s, e)}`);
    if (p && p.last < e) parts.push(`${iso(p.last)}까지 반영`);
    return parts.join(' · ');
  }
  function condTip(q, how) {
    const r = row(waitEl(q), BE.fireText(q.fire));
    if (q.near) r.append(el('span', 'bec-near', '임박'));
    return [el('div', 'h1', `${q.tf} · ${condName(q)}`), r, el('div', 'm', condSentence(q)), row(muted(condMeta(q))), el('div', 'bec-tip-foot', openText(q.tf, how))];
  }
  function condRows(list, max) {
    const box = el('div', 'sec');
    for (const q of list.slice(0, max)) box.append(row(waitEl(q), condName(q), el('span', 'num', q.fire.now ? '지금 값으로 충족' : `${fmtPct(q.fire.pct)} · ${fmtPrice(q.fire.p)}`)));
    if (list.length > max) box.append(el('div', 'm', `외 ${list.length - max}개가 더 있습니다.`));
    return box;
  }
  const moreTip = (mo) => [el('div', 'h1', `그 밖의 조건 ${mo.list.length}개`), el('div', 'm', mo.above ? '조건가가 차트의 가격 범위보다 위에 있거나, 자리가 모자라 접은 조건입니다.' : '조건가가 차트의 가격 범위보다 아래에 있거나, 자리가 모자라 접은 조건입니다.'), condRows(mo.list, 10)];
  function zoneTip() {
    const out = [el('div', 'h1', '다음 봉 조건'), el('div', 'm', `최근 종가 ${fmtPrice(cur.det.last)} (${iso(LAST)} 마감)`)];
    if (M.conds.length) out.push(condRows(M.conds, 12)); else out.push(el('div', 'm', '지금은 9나 13이 나올 조건이 없습니다.'));
    return out;
  }
  function tipOf(t, how) {
    return t.type === 'label' ? labelTip(t.it, how) : t.type === 'chip' ? chipTip(t.chip, how) : t.type === 'handle' ? handleTip(how)
      : t.type === 'cond' ? condTip(t.q, how) : t.type === 'more' ? moreTip(t.mo) : t.type === 'day' ? dayTip(t.day) : null;
  }
  const boxOf = (t) => (t.type === 'label' ? t.it : t.type === 'chip' ? t.chip : t.type === 'handle' ? t.hd : t.type === 'more' ? t.mo : t.type === 'cond' ? { x: t.q.bx, y: t.q.by, w: t.q.bw, h: t.q.bh } : null);
  const sayOf = (nodes) => nodes.map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join('. ');

  // ---------- pointer, wheel, keyboard ----------
  // Unfolding. A chip unfolds its pile: its own stacks and the stacks of that side that stand in the same pixel
  // columns, so that no number of the pile folds in exchange. What still finds no room before the plot's end stays in
  // a chip (chipIsRest): a click on that one folds the pile again, as its handle does.
  function pileKeys(chip) {
    let xa = chip.x, xb = chip.x + chip.w;
    for (const it of M.items) if (it.text && !it.chip && chip.keys.has(it.st.key)) { xa = Math.min(xa, it.x); xb = Math.max(xb, it.x + it.w); }
    const keys = new Set(chip.keys);
    for (const it of M.items) if (it.text && it.st.dir === chip.dir && it.x < xb && xa < it.x + it.w) keys.add(it.st.key);
    return keys;
  }
  const chipIsRest = (chip) => [...chip.keys].every((k) => unfold.has(k));
  const foldGroups = (gids) => { for (const [k, gid] of [...unfold]) if (gids.has(gid)) unfold.delete(k); };
  const openChart = (tf) => { try { window.open(BE.tvUrl(cur.c.usd, tf), '_blank', 'noopener'); } catch (e) { /* a host that allows no new window */ } };
  // a click or a tap on a thing: a chip unfolds its stacks, a handle folds one again, a number or a condition opens
  // the chart of its timeframe (a tap shows what it is first)
  function activate(t, how, x, y) {
    if (t.type === 'chip') {
      if (chipIsRest(t.chip)) foldGroups(new Set([...t.chip.keys].map((k) => unfold.get(k))));
      else for (const k of pileKeys(t.chip)) unfold.set(k, t.chip.id);
    }
    else if (t.type === 'handle') foldGroups(new Set([t.hd.key]));
    else if (t.type === 'label' || t.type === 'cond') {
      const tf = t.type === 'label' ? t.it.a.tf : t.q.tf, same = pinned && pinned.type === t.type && (t.type === 'label' ? pinned.a === t.it.a : sameCond(pinned.q, t.q));
      if (how !== 'tap' || same) { openChart(tf); return; }
      pinned = t.type === 'label' ? { type: 'label', a: t.it.a } : { type: 'cond', q: t.q };
      hover = null; BE.tip.show(x, y, tipOf(t, 'tap')); schedule(D_OVER);
      return;
    } else return;
    clickAt = performance.now(); hover = null; pinned = null; BE.tip.hide(); schedule(D_LAYOUT);
  }
  // the tooltip of the keyboard's place, next to it; the same in words for screen readers
  function showCursor() {
    flushNow();
    if (!cursor || !M) { BE.tip.hide(); return; }
    const r = ui.cOver.getBoundingClientRect(), t = picked();
    let nodes, x, y;
    if (t) { const b = boxOf(t); nodes = tipOf(t, 'key'); x = r.left + b.x + b.w; y = r.top + b.y + b.h / 2; }
    else if (cursor.zone) { nodes = zoneTip(); x = r.left + M.zx.x0 + 8; y = r.top + M.plotT + 16; }
    else { nodes = dayTip(cursor.day); x = r.left + M.X(cursor.day); y = r.top + M.plotT + 16; }
    BE.tip.show(x, y, nodes); ui.live.textContent = sayOf(nodes);
    schedule(D_OVER);
  }
  function wireChart() {
    const cv = ui.cOver;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    let wheelX = 0, hkey = '';
    const keyOf = (t) => (!t ? '' : t.type === 'label' ? `l${t.it.a.j}:${t.it.a.k}` : t.type === 'cond' ? `c${t.q.j}:${t.q.k}:${t.q.f}:${t.q.o}:${t.q.d}` : t.type === 'chip' ? `f${t.chip.id}` : t.type === 'handle' ? `h${t.hd.key}` : t.type === 'more' ? `m${t.mo.above}` : t.type === 'day' ? `d${t.day}` : '');
    cv.addEventListener('pointerdown', (e) => {
      if (!cur || !M || e.button > 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {   // two fingers: zoom around the point between them
        const [p, q] = [...pointers.values()], T = spanT(), anchor = dayAt((p.x + q.x) / 2 - cv.getBoundingClientRect().left);
        pinch = { dist: Math.max(12, Math.hypot(p.x - q.x, p.y - q.y)), T, anchor, rel: (anchor + 0.5 - win.d0) / T };
        drag = null; hover = null; BE.tip.hide(); cv.classList.remove('bec-drag');
        return;
      }
      const [x, y] = pos(e), touch = e.pointerType === 'touch';
      drag = { id: e.pointerId, x: e.clientX, d0: win.d0, T: spanT(), moved: false, touch, hit: hitAt(x, y, touch ? 6 : 0), plot: x >= M.plotL };
      if (!touch) { try { cv.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is already gone */ } }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!cur || !M) return;
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch) {
        if (pointers.size < 2) return;
        const [p, q] = [...pointers.values()], T = pinch.T * pinch.dist / Math.max(12, Math.hypot(p.x - q.x, p.y - q.y));
        if (setView(pinch.anchor + 0.5 - pinch.rel * T, T)) moved();
        return;
      }
      if (drag && drag.id === e.pointerId) {
        const dx = e.clientX - drag.x;
        if (!drag.moved && Math.abs(dx) > 4 && drag.plot) { drag.moved = true; cv.classList.add('bec-drag'); hover = null; BE.tip.hide(); schedule(D_OVER); }
        if (drag.moved) { if (setView(drag.d0 + Math.round(-dx / M.ppd), drag.T)) moved(); return; }
      }
      if (e.pointerType === 'touch') return;   // a finger has no hover: a tap shows
      const [x, y] = pos(e), t = hitAt(x, y), k = keyOf(t);
      const thing = t && t.type !== 'zone' ? t : null;
      cv.style.cursor = thing && thing.type !== 'day' ? 'pointer' : '';
      if (k !== hkey || (thing && thing.type === 'day')) { hkey = k; hover = thing; schedule(D_OVER | D_SOVER); }
      const nodes = thing ? tipOf(thing, 'mouse') : null;
      if (nodes) BE.tip.show(e.clientX, e.clientY, nodes); else BE.tip.hide();
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag; drag = null; cv.classList.remove('bec-drag');
      if (d.moved || e.type !== 'pointerup' || !cur || !M) return;
      if (performance.now() - clickAt < 350) return;   // the second click of a double click on a chip that has just unfolded
      const t = d.hit;
      if (t && t.type !== 'day' && t.type !== 'zone' && t.type !== 'more') { activate(t, d.touch ? 'tap' : 'mouse', e.clientX, e.clientY); return; }
      if (!d.touch) return;
      // a tap elsewhere: the day under the finger, or the list of folded conditions
      pinned = null;
      if (t && (t.type === 'day' || t.type === 'more')) { hover = t.type === 'day' ? { type: 'day', day: t.day, y: null } : t; BE.tip.show(e.clientX, e.clientY, tipOf(t, 'tap')); }
      else { hover = null; BE.tip.hide(); }
      schedule(D_OVER | D_SOVER);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'touch') return; hkey = ''; cv.style.cursor = ''; if (hover) { hover = null; schedule(D_OVER | D_SOVER); } BE.tip.hide(); });
    cv.addEventListener('wheel', (e) => {
      if (!cur || !M) return;
      const zoom = e.ctrlKey || e.metaKey, side = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!zoom && !side) return;   // a plain wheel scrolls the page
      e.preventDefault();
      let ch = false;
      if (zoom) ch = zoomAt(dayAt(pos(e)[0]), Math.exp(clamp(e.deltaY * (e.deltaMode ? 0.05 : 0.003), -0.3, 0.3)));
      else { wheelX += e.deltaX; const dd = Math.trunc(wheelX / M.ppd); if (dd) { wheelX -= dd * M.ppd; ch = panBy(dd); } }
      if (ch) { hkey = ''; moved(); }
    }, { passive: false });
    cv.addEventListener('dblclick', (e) => {
      if (!cur || !M) return;
      const [x, y] = pos(e), t = hitAt(x, y);
      if (t && t.type !== 'day') return;   // on a number or a chip the two clicks have done their work
      applyPreset(); cursor = null; moved();
    });
    cv.addEventListener('keydown', (e) => {
      if (!cur || !M || e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key, span = win.d1 - win.d0 + 1;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        const s = k === 'ArrowLeft' ? -1 : 1;
        if (e.shiftKey) {   // the window moves; the day cursor stays inside it
          if (panBy(s * Math.max(1, Math.round(span * 0.1)))) moved();
          if (cursor && cursor.day != null) cursor = { day: clamp(cursor.day, win.d0, win.d1), pick: null };
        } else {
          const step = M.ppd >= 1 ? 1 : Math.max(1, Math.round(1 / M.ppd));
          if (!cursor) cursor = { day: hover && hover.type === 'day' ? hover.day : win.d1, pick: null };
          else if (cursor.zone) { if (s < 0) cursor = { day: win.d1, pick: null }; }
          else if (s > 0 && cursor.day + step > win.d1 && M.zone) cursor = { zone: true, pick: null };
          else {
            cursor = { day: clamp(cursor.day + s * step, cur.first, LAST), pick: null };
            if (cursor.day < win.d0 ? panBy(cursor.day - win.d0) : cursor.day > win.d1 ? panBy(cursor.day - win.d1) : false) moved();
          }
        }
        hover = null;
        if (cursor) showCursor(); else BE.tip.hide();
      } else if (k === 'ArrowUp' || k === 'ArrowDown') {
        // through the numbers of the day (or the conditions of the zone); with none, the key is left to the page
        if (!cursor) return;
        const list = thingsAt(); if (!list.length) return;
        const to = cursor.pick == null ? (k === 'ArrowDown' ? 0 : list.length - 1) : cursor.pick + (k === 'ArrowDown' ? 1 : -1);
        cursor.pick = to < 0 || to >= list.length ? null : to;
        hover = null; showCursor();
      } else if (k === 'Home' || k === 'End') {
        if (k === 'Home' ? setView(cur.first, spanT()) : toNewest()) moved();
        cursor = { day: k === 'Home' ? win.d0 : win.d1, pick: null }; showCursor();
      } else if (k === '+' || k === '=' || k === '-' || k === '_') {
        if (zoomKey(cursor && cursor.day != null ? cursor.day : null, k === '+' || k === '=' ? 0.8 : 1.25)) moved();
        if (cursor) { cursor.pick = null; if (cursor.zone && !win.end) cursor = null; }
        if (cursor) showCursor();
      } else if (k === 'Enter' || k === ' ') {
        const t = picked(); if (!t || t.type === 'more') return;
        const b = boxOf(t), r = cv.getBoundingClientRect();
        cursor.pick = t.type === 'chip' || t.type === 'handle' ? null : cursor.pick;
        activate(t, 'key', r.left + b.x, r.top + b.y);
        if (t.type === 'chip' || t.type === 'handle') showCursor();
      } else if (k === 'Escape') {
        if (!cursor) return;
        if (cursor.pick != null) { cursor.pick = null; showCursor(); } else { cursor = null; BE.tip.hide(); ui.live.textContent = ''; schedule(D_OVER | D_SOVER); }
      } else return;
      e.preventDefault();
    });
    cv.addEventListener('focus', () => schedule(D_OVER));
    cv.addEventListener('blur', () => { if (cursor) { cursor = null; BE.tip.hide(); ui.live.textContent = ''; } schedule(D_OVER | D_SOVER); });
  }
  // a finger has no pointer to move away: a tap outside the chart closes what a tap opened
  const onAway = (e) => { if (e.pointerType === 'mouse' || !ui || e.target === ui.cOver) return; if (pinned || hover) { pinned = null; hover = null; schedule(D_OVER | D_SOVER); } BE.tip.hide(); };

  // ---------- around the picture: captions, the list of conditions in a narrow room, legend and hints ----------
  function syncHead() {
    const m = M;
    ui.winText.textContent = `${iso(m.d0)} ~ ${iso(m.d1)} · ${nf(m.n)}일`;
    ui.nowBtn.hidden = m.atEnd;
    ui.rangeCtl.sync();
    const shown = m.items.length;
    ui.cOver.setAttribute('aria-label', `${cur.c.s} 일봉 차트. ${iso(m.d0)}부터 ${iso(m.d1)}까지이고, 9와 13이 ${nf(shown)}개 있습니다. 좌우 화살표 키로 날짜를 옮기고, 위아래 화살표 키로 그 날짜의 숫자를 고릅니다.`);
    renderConds();
  }
  function captions() {
    const nar = narrow(), first = iso(cur.first);
    ui.capStrip.replaceChildren(el('b', null, '조감 띠'), document.createTextNode(nar
      ? `${first}부터의 종가와 9, 13입니다. 회색 눈금은 9, 색 눈금은 13이고, 파란 상자가 현재 창입니다.`
      : `${first}부터 ${iso(LAST)}까지의 종가(로그 축)와 타임프레임 ${TFS.length}개의 9, 13입니다. 회색 눈금은 9이고 색 눈금은 13이며, 파란 상자는 아래 차트가 보여 주는 현재 창입니다.`));
    ui.capChart.replaceChildren(el('b', null, '일봉 차트'), document.createTextNode(nar
      ? '숫자는 그 타임프레임 봉의 마지막 날 자리에 있고, 위 첨자는 타임프레임입니다.'
      : '숫자는 그 타임프레임 봉의 마지막 날 자리에 있고, 위 첨자는 타임프레임입니다. 색은 계열이고 회색은 9이며, 겹치는 숫자는 바깥쪽으로 쌓입니다.'));
    ui.sOver.setAttribute('aria-valuemin', cur.first); ui.sOver.setAttribute('aria-valuemax', LAST);
  }
  // The prices of a condition that is not met yet, as the price ladder of the study writes them: when the close may come
  // back after the bar has touched the price, that price is the level of the low or of the high and the close level
  // follows (not named when it is the current price); otherwise the close itself has to be there.
  function priceNodes(q) {
    const f = q.fire, out = [], lab = (t) => { const i = document.createElement('i'); i.textContent = t; return i; };
    if (f.q === f.p) out.push(lab('종가 '), fmtPrice(f.p));
    else { out.push(lab(f.dir < 0 ? '저가 ' : '고가 '), fmtPrice(f.p)); if (f.qpct !== 0) out.push(lab(' · 종가 '), `${fmtPrice(f.q)} (${fmtPct(f.qpct)})`); }
    return out;
  }
  // in a narrow room the conditions are a list under the chart, the nearest first
  function renderConds() {
    const m = M, box = ui.conds;
    const key = !m.list ? '' : [cur.c.slug, S.near, INK.join(), m.conds.map((q) => `${q.j}.${q.k}.${q.d}.${q.f}.${q.o}`).join(',')].join('|');
    if (box.dataset.key === key) return;
    box.dataset.key = key; box.hidden = !m.list; box.replaceChildren();
    if (!m.list) return;
    const h = el('h3', null, '다음 봉 조건'); h.append(el('span', null, `최근 종가 ${fmtPrice(cur.det.last)} · ${iso(LAST)} 마감`));
    box.append(h);
    if (!m.conds.length) { box.append(el('p', 'hint', '지금은 9나 13이 나올 조건이 없습니다.')); return; }
    for (const q of m.conds) {
      const r = el('div', 'bec-crow'), r1 = el('div', 'bec-r1'), end = el('span', 'bec-end');
      r1.append(waitEl(q), el('span', null, condName(q)));
      if (q.fire.now) end.append(el('span', 'bec-met', '지금 값으로 충족'));
      else { if (q.near) end.append(el('span', 'bec-near', '임박')); end.append(el('span', 'bec-dist', fmtPct(q.fire.pct))); }
      r1.append(end); r.append(r1);
      if (!q.fire.now) { const px = el('div', 'bec-px'); px.append(...priceNodes(q)); r.append(px); }
      r.append(el('p', 'bec-sent', condSentence(q)));
      const meta = el('div', 'bec-meta'), a = el('a', null, `${q.tf} 차트 ↗`);
      a.href = BE.tvUrl(cur.c.usd, q.tf); a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('aria-label', `TradingView ${q.tf} 차트`);
      meta.append(dated(null, condMeta(q)), a); r.append(meta);
      box.append(r);
    }
  }
  function renderFoot() {
    const lg = el('div', 'legend'), fams = BE.FAMS, f0 = fams.find((f) => BE.famOn(f)) ?? fams[0];
    const item = (...parts) => { const s = el('span'); for (const p of parts) s.append(typeof p === 'string' ? document.createTextNode(p) : p); lg.append(s); };
    const glyph = (cls, color) => { const i = el('i', 'bec-g ' + cls); if (color) i.style.background = color; return i; };
    for (const f of fams) item(numEl({ kind: 'C', f, text: '13', tf: '1W' }), `${FAM_NAME[f]} 13`);
    item(numEl({ kind: 'S', text: '9', tf: '1D' }), '9');
    item(numEl({ kind: 'S', text: '9', tf: '1D', rep: true }), '반복 9');
    if (S.def === 'on') item(numEl({ kind: 'I', f: f0, text: '+13', tf: '1D' }), '13이 미뤄진 봉');
    item('위 첨자는 타임프레임');
    item(waitEl({ is13: true, f: f0, tf: '1W', fire: { now: false }, near: false }), waitEl({ is13: false, tf: '1D', fire: { now: false }, near: false }), '테두리는 아직 대기 중인 다음 봉 조건');
    const qg = glyph('bec-gq'); qg.style.setProperty('--c', INK[f0]);
    item(qg, '조건가에 닿은 뒤 마감해도 되는 종가');
    item(el('span', 'bec-fold', '외 2개'), '자리가 모자라 접힌 숫자');
    item(glyph('bec-gm', INK[f0]), glyph('bec-gm9'), '넓은 기간에서 숫자 대신 놓는 표시 (색은 13, 회색은 9)');
    const tri = glyph('bec-gt'); tri.style.borderBottomColor = INK[f0];
    item(glyph('bec-gl'), tri, '숫자가 제 봉에서 떨어져 있을 때 그 숫자의 날을 가리키는 선과 세모');
    item(glyph('bec-g13', INK[f0]), glyph('bec-g9'), '조감 띠의 눈금 (색은 13, 회색은 9)');
    item('조감 띠의 한 줄은 한 타임프레임 (띠마다 1D가 가장 아래)');
    item(glyph('bec-gw'), '현재 창');
    const hints = ['기간을 넓히면 봉은 가는 막대와 선으로 바뀌고, 9가 먼저 작은 회색 표시로 바뀌며, 자리가 모자란 13은 긴 타임프레임부터 숫자로 남고 나머지는 색 표시로 바뀝니다.'];
    let mouse = true; try { mouse = matchMedia('(hover: hover)').matches; } catch (e) { /* old browsers: as with a mouse */ }
    if (mouse) {
      hints.push('차트나 조감 띠의 파란 상자를 좌우로 끌면 기간이 옮겨지고, Ctrl 키(Mac은 Command 키)를 누른 채 휠을 돌리면 확대되거나 축소되며, 차트를 두 번 누르면 처음 기간으로 돌아갑니다. 숫자에 마우스를 올리면 그 봉의 기간과 출발 봉이 나오고, 숫자를 누르면 그 타임프레임의 TradingView 차트가 열립니다.');
      hints.push('키보드에서는 차트를 고른 뒤 좌우 화살표 키로 날짜를 옮기고 위아래 화살표 키로 그 날짜의 숫자를 고르며, Shift 키와 좌우 화살표 키로 기간을 옮기고 + 키와 - 키로 확대하거나 축소합니다.');
    } else hints.push('차트를 좌우로 밀면 기간이 옮겨지고, 두 손가락을 벌리거나 모으면 확대되거나 축소됩니다. 숫자를 누르면 그 봉의 기간과 출발 봉이 나오고, 한 번 더 누르면 그 타임프레임의 TradingView 차트가 열립니다.');
    const notes = [];
    if (cur && cur.all.some((a) => a.gone && selected(a))) notes.push(`TradingView 차트는 타임프레임마다 라벨을 최근 ${BE.OPT.labelLimit}개까지만 남깁니다. 그보다 오래된 숫자도 여기에는 그대로 있고, 그런 숫자는 마우스를 올리면 지워진 라벨이라고 나옵니다.`);
    const late = cur ? cur.all.filter((a) => a.late && selected(a)).length : 0;
    if (late) notes.push(`봉의 마지막 날에 TradingView 일봉이 없는 숫자 ${nf(late)}개는 그 봉에서 일봉이 있는 마지막 날 자리에 놓았습니다.`);
    if (notes.length) hints.push(notes.join(' '));
    ui.foot.replaceChildren(lg, ...hints.map((t) => el('p', 'hint', t)));
  }

  // ---------- controls ----------
  // after a setting changed: everything is laid out again, folded as at first
  function reset() { unfold.clear(); hover = null; pinned = null; BE.tip.hide(); if (cur) { renderFoot(); schedule(D_LAYOUT | D_STRIP); } }
  // the timeframes: a toggle each, in the three groups of the screener's table; a group's name switches the group as a whole
  function tfControl() {
    const wrap = el('div', 'ctl bec-tfs bec-opt'), lab = el('span', null, '타임프레임'), btns = [], grps = [];
    lab.id = 'bec-lb-tf'; wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-labelledby', lab.id); wrap.append(lab);
    const all = el('button', 'btn sm', '전체'); all.type = 'button'; all.title = '모든 타임프레임을 켭니다';
    const sync = () => {
      btns.forEach((b, j) => b.setAttribute('aria-pressed', String(tfOn(j))));
      grps.forEach((b, g) => { const [s, e] = GROUPS[g]; let on = 0; for (let j = s; j <= e; j++) if (tfOn(j)) on++; b.setAttribute('aria-pressed', on === e - s + 1 ? 'true' : on ? 'mixed' : 'false'); });
      all.disabled = !S.off.length;
    };
    const apply = () => { BE.save(); sync(); reset(); };
    GROUPS.forEach(([s, e]) => {
      const box = el('div', 'bec-tfg'), names = TFS.slice(s, e + 1), gb = el('button', 'bec-grp', `${TFS[s]}~${TFS[e]}`);
      gb.type = 'button'; gb.title = `${TFS[s]}부터 ${TFS[e]}까지 한꺼번에 켜거나 끕니다`; gb.setAttribute('aria-label', `${TFS[s]}부터 ${TFS[e]}까지 모두`);
      gb.addEventListener('click', () => { const on = names.every((t) => !S.off.includes(t)); S.off = on ? [...S.off, ...names] : S.off.filter((t) => !names.includes(t)); apply(); });
      grps.push(gb); box.append(gb);
      for (let j = s; j <= e; j++) {
        const b = el('button', null, TFS[j]); b.type = 'button';
        b.addEventListener('click', () => { S.off = tfOn(j) ? [...S.off, TFS[j]] : S.off.filter((t) => t !== TFS[j]); apply(); });
        btns[j] = b; box.append(b);
      }
      wrap.append(box);
    });
    all.addEventListener('click', () => { S.off = []; apply(); });
    wrap.append(all); sync();
    return wrap;
  }

  // ---------- the probe: what is on the screen now (for checks) ----------
  // labels: every label the toggles and the window select (day: the day it is written at; s, e: the first and the last
  // calendar day of its timeframe bar), with how it is shown ('text' a number, 'mark', 'folded' into a chip: then x, y,
  // w, h are the chip's box and group its id); strip: every tick; conds: every condition ('in' the
  // zone at its price, 'above' / 'below' pinned to an edge, 'folded' into "외 N개", 'list' in a narrow room: then the box
  // is its row's, measured from the chart's corner). Coordinates are CSS px of the chart canvas (strip: of the strip's).
  // Besides: the scales (plot.x0 = the left edge of day d0, ys: y = a - b * price, or of ln(price) on a log scale;
  // stripScale: x = x0 + (day - first) * ppd), the chips of folded numbers and the handles of unfolded stacks.
  function probe() {
    flushNow();
    if (!cur || !M || !SM) return null;
    const m = M, cv = ui.cBase.getBoundingClientRect(), rows = m.list ? ui.conds.querySelectorAll('.bec-crow') : null;
    return {
      coin: cur.c.slug, sym: cur.c.s, d0: m.d0, d1: m.d1, end: m.atEnd, ppd: m.ppd, scale: m.log ? 'log' : 'lin', lod: { ...m.lod }, late: cur.late, ms: m.ms, paintMs: m.paintMs || 0,
      plot: { l: m.plotL, r: m.plotR, t: m.plotT, b: m.plotB, w: m.W, h: m.H, x0: m.plotL + m.padL }, ys: { ...m.ys }, last: cur.det.last,
      stripScale: { x0: SM.x0, x1: SM.x1, ppd: SM.ppd, first: cur.first, sellT: SM.sellT, buyT: SM.buyT, bandH: SM.bandH, pitch: SM.pitch },
      labels: m.items.map((it) => ({ j: it.a.j, tf: it.a.tf, bar: it.a.bar, day: it.a.day, s: it.a.s, e: it.a.e, dir: it.a.dir, kind: it.a.kind, f: it.a.f, text: it.a.text,
        shown: it.shown, x: it.x, y: it.y, w: it.w, h: it.h, group: it.group, lead: it.shown === 'text' && it.lead, late: it.a.late, gone: it.a.gone })),
      folds: m.chips.map((c) => ({ group: c.id, x: c.x, y: c.y, w: c.w, h: c.h, n: c.members.length, text: `외 ${c.members.length}개` })),
      handles: m.handles.map((h) => ({ key: h.key, x: h.x, y: h.y, w: h.w, h: h.h })),
      strip: SM.ticks.map((t) => ({ j: t.a.j, dir: t.a.dir, kind: t.a.kind, f: t.a.f, bar: t.a.bar, x0: t.x0, x1: t.x1, y: t.y, h: t.h })),
      stripBox: { ...stripBox(), w: SM.W, h: SM.H },
      conds: m.conds.map((q, i) => {
        let b = { x: q.bx, y: q.by, w: q.bw, h: q.bh };
        if (rows) { const r = rows[i] ? rows[i].getBoundingClientRect() : null; b = r ? { x: r.left - cv.left, y: r.top - cv.top, w: r.width, h: r.height } : { x: 0, y: 0, w: 0, h: 0 }; }
        return { j: q.j, tf: q.tf, k: q.k, d: q.d, f: q.f, o: q.o, p: q.fire.p, q: q.fire.q, pct: q.fire.pct, now: q.fire.now, near: q.near, shown: q.shown, ...b };
      }),
    };
  }

  // ---------- the variant ----------
  function showWait(nodes, busy) {
    if (!ui.body.hidden) ui.wait.style.minHeight = `${ui.body.offsetHeight}px`;   // the page keeps its length while the next coin loads
    ui.wait.className = `panel bec-wait ${busy ? 'loading' : 'empty'}`;
    ui.wait.replaceChildren(...nodes); ui.wait.hidden = false; ui.body.hidden = true;
  }
  function load() {
    const c = BE.coin(), my = ++seq;
    cur = null; win = null; M = null; SM = null; hover = null; cursor = null; pinned = null; unfold.clear(); BE.tip.hide();
    showWait([el('span', null, '불러오는 중입니다…')], true);
    BE.detail(c).then((det) => {
      if (my !== seq || !root) return;   // another coin was chosen meanwhile, or the view was left
      prepare(c, det); applyPreset();
      ui.wait.hidden = true; ui.wait.style.minHeight = ''; ui.body.hidden = false;
      sized = { c: '', s: '' }; ui.conds.dataset.key = '?';
      captions(); renderFoot(); schedule(D_SIZE); flushNow();
    }, (err) => {
      if (my !== seq || !root) return;
      // as the screener says it: a coin without data has nothing to try again; a newer build asks for a reload
      const noData = !c || !c.usd || !c.t, stale = !!(err && err.stale), why = err && err.message ? String(err.message) : String(err);
      const nodes = [el('p', null, noData ? `${why}.` : stale ? '이 화면을 연 뒤에 새 데이터가 배포되었습니다. 새로고침하면 최신 데이터로 다시 엽니다.' : `일봉 데이터를 불러오지 못했습니다 (${why}).`)];
      if (!noData) { const b = el('button', 'btn', stale ? '새로고침' : '다시 시도'); b.type = 'button'; b.addEventListener('click', () => (stale ? location.reload() : load())); nodes.push(b); }
      showWait(nodes, false);
    });
  }
  // the chart follows the window's height: lay it out again when only that has changed (not on a phone, where the
  // height changes while the page scrolls)
  const onResize = () => { clearTimeout(tallTimer); tallTimer = setTimeout(() => { if (root && cur && !narrow() && window.innerHeight !== seenH) schedule(D_SIZE); }, 160); };

  BE.register({
    view: 'chart', key: 'a', name: 'Bird eye 차트',
    blurb: '한 종목의 일봉 차트 한 장에 20개 타임프레임의 9와 13을 모두 숫자로 적었습니다. 숫자는 그 타임프레임의 봉이 마감한 날 자리에 있고, 위 첨자가 타임프레임, 색이 계열입니다. '
      + '위의 조감 띠는 전체 기간에서 9와 13이 나온 자리를 타임프레임마다 한 줄로 보여 주고, 차트 오른쪽 끝에는 진행 중인 봉에 다음 9나 13이 나오는 조건가가 있습니다.',
    mount(node) {
      root = node;
      if (!document.getElementById(CSS_ID)) { const st = document.createElement('style'); st.id = CSS_ID; st.textContent = CSS; document.head.append(st); }
      S = BE.vstate(ID, { range: 'auto', scale: 'auto', off: [], nine: 'on', def: 'off', dir: 'both', cond: 'on', near: 5 });
      const oneOf = (k, allowed, def) => { if (!allowed.includes(S[k])) S[k] = def; };
      oneOf('range', ['auto', ...RANGES.map((r) => r[0])], 'auto'); oneOf('scale', ['auto', 'lin', 'log'], 'auto'); oneOf('nine', ['on', 'off'], 'on');
      oneOf('def', ['on', 'off'], 'off'); oneOf('dir', ['both', 'buy', 'sell'], 'both'); oneOf('cond', ['on', 'off'], 'on'); oneOf('near', NEARS, 5);
      S.off = Array.isArray(S.off) ? S.off.filter((t) => TFS.includes(t)) : [];
      ui = {}; cur = null; win = null; M = null; SM = null; hover = null; cursor = null; pinned = null; unfold = new Map(); sized = { c: '', s: '' }; dirty = 0;
      readInks();

      const ctl = el('div', 'panel controls bec-ctl'); ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', 'Bird eye 차트 보기 설정');
      const opt = (node2) => { node2.classList.add('bec-opt'); return node2; };
      const set = (k) => (v) => { S[k] = v; BE.save(); reset(); };
      ui.rangeCtl = BE.seg('기간', RANGES.map((r) => [r[0], r[1]]), () => (win && win.custom ? '' : rangeKey()), (v) => { S.range = v; BE.save(); if (cur) { applyPreset(); cursor = null; moved(); } });
      const more = el('button', 'btn sm bec-more', '설정 열기'); more.type = 'button'; more.setAttribute('aria-expanded', 'false');
      more.addEventListener('click', () => { const open = ctl.classList.toggle('bec-open'); more.textContent = open ? '설정 닫기' : '설정 열기'; more.setAttribute('aria-expanded', String(open)); });
      ctl.append(ui.rangeCtl, more, el('span', 'bec-brk'),
        opt(BE.seg('가격 축', [['auto', '자동'], ['lin', '선형'], ['log', '로그']], () => S.scale, set('scale'))),
        opt(BE.seg('9', [['on', '켬'], ['off', '끔']], () => S.nine, set('nine'))),
        opt(BE.seg('+13', [['on', '켬'], ['off', '끔']], () => S.def, set('def'))),
        opt(BE.seg('방향', [['both', '양쪽'], ['buy', '매수 쪽'], ['sell', '매도 쪽']], () => S.dir, set('dir'))),
        opt(BE.seg('다음 봉 조건', [['on', '켬'], ['off', '끔']], () => S.cond, set('cond'))),
        opt(BE.seg('임박 기준', NEARS.map((x) => [x, `${x}%`]), () => S.near, set('near'))),
        tfControl());

      ui.wait = el('div', 'panel loading bec-wait'); ui.wait.setAttribute('role', 'status');
      ui.body = el('div'); ui.body.style.cssText = 'display:grid;gap:12px;min-width:0;grid-template-columns:minmax(0,1fr)'; ui.body.hidden = true;
      const pic = el('section', 'panel bec-pic'); pic.setAttribute('aria-label', 'Bird eye 차트');
      const canvas = (cls) => { const cv = el('canvas', cls); if (!cls) cv.setAttribute('aria-hidden', 'true'); return cv; };
      ui.capStrip = el('p', 'bec-cap');
      ui.strip = el('div', 'bec-box bec-strip'); ui.sBase = canvas(''); ui.sOver = canvas('bec-over');
      ui.sOver.tabIndex = 0; ui.sOver.setAttribute('role', 'slider'); ui.sOver.setAttribute('aria-orientation', 'horizontal');
      ui.sOver.setAttribute('aria-label', '조감 띠의 현재 창. 좌우 화살표 키로 창을 옮기고, + 키와 - 키로 창을 넓히거나 좁힙니다.');
      ui.strip.append(ui.sBase, ui.sOver);
      const caprow = el('div', 'bec-caprow');
      ui.capChart = el('p', 'bec-cap'); ui.winText = el('span', 'bec-win');
      ui.nowBtn = el('button', 'btn sm bec-now', '최근으로'); ui.nowBtn.type = 'button'; ui.nowBtn.hidden = true; ui.nowBtn.title = '마지막으로 마감한 날까지 보이도록 창을 옮깁니다';
      ui.nowBtn.addEventListener('click', () => { if (cur && toNewest()) moved(); });
      caprow.append(ui.capChart, ui.winText, ui.nowBtn);
      ui.chart = el('div', 'bec-box bec-chart'); ui.cBase = canvas(''); ui.cOver = canvas('bec-over');
      ui.cOver.tabIndex = 0; ui.cOver.setAttribute('role', 'img');
      ui.chart.append(ui.cBase, ui.cOver);
      ui.live = el('div', 'sr-only'); ui.live.setAttribute('aria-live', 'polite');
      ui.conds = el('div', 'bec-conds'); ui.conds.hidden = true;
      pic.append(ui.capStrip, ui.strip, caprow, ui.chart, ui.live, ui.conds);
      ui.foot = el('div', 'panel bec-foot');
      ui.body.append(pic, ui.foot);
      root.append(ctl, ui.wait, ui.body);
      wireStrip(); wireChart();
      if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => { if (ui && cur && M && ui.chart.clientWidth > 0 && Math.max(240, ui.chart.clientWidth) !== M.W) schedule(D_SIZE); }); ro.observe(ui.chart); }
      addEventListener('resize', onResize);
      document.addEventListener('pointerdown', onAway, true);
      root.__probe = probe;
    },
    render(why) {
      if (!ui) return;
      if (why === 'mount' || why === 'coin') { load(); return; }
      if (!cur) return;   // still loading, or the message of a failed load is up
      if (why === 'fam') { reset(); return; }
      if (why === 'theme') { TW.clear(); readInks(); ui.conds.dataset.key = '?'; renderFoot(); schedule(D_SIZE | D_STRIP); return; }   // new colors, or the fonts have arrived
      // resize: the default window, the strip's height and the captions follow the room
      BE.tip.hide(); hover = null; pinned = null;
      captions(); renderFoot(); schedule(D_SIZE | D_STRIP);
    },
    unmount() {
      seq++; if (raf) cancelAnimationFrame(raf); raf = 0; dirty = 0; clearTimeout(tallTimer);
      if (ro) ro.disconnect(); ro = null;
      removeEventListener('resize', onResize); document.removeEventListener('pointerdown', onAway, true);
      BE.tip.hide();
      if (root) delete root.__probe;
      root = null; ui = null; cur = null; win = null; M = null; SM = null; hover = null; cursor = null; pinned = null; drag = null; sdrag = null; pinch = null; pointers = new Map();
    },
  });
})();
