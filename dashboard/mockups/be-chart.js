// Bird eye study, chart view: Bird Eye 차트.
//
// One coin on ONE daily candle chart, with the 9s and 13s of every timeframe written on it as numbers, and above it the
// strip of the whole history (전체 기간): the close in a lane of its own between two bands with one row per timeframe,
// sell side above and buy side below, and a box for the period the chart shows (현재 창). Everything drawn comes from
// BE.detail(coin): the daily bars, per timeframe the engine's labels (res.labels) and the next-bar triggers with
// VIEW.fire. Nothing is counted here.
//
//   a number            a label of one timeframe, at the last day of its timeframe bar that has a daily candle (the day
//                       the bar closed): the engine's text ("13", "13x2", "13r", "9", "9*", "+13") with the timeframe
//                       as a superscript. Sell side above the candles, buy side under them. A 13 has the color of its
//                       family, a 9 is gray (a repeated 9 a little lighter), a +13 is smaller and lighter. All numbers
//                       have ONE size, whatever the timeframe; the size follows the chart's width (SIZES). The digits
//                       are centered on the day and the superscript hangs to the right of them. A label the indicator
//                       has deleted on TradingView (older than its label limit) is fainter with a dotted underline.
//   layout              per side the numbers stand outward from the candles, in boxes that touch nothing: a number
//                       takes the place nearest its candle that is free. The numbers of one day and side form a stack,
//                       the shorter timeframe nearer the candle, without exception. A stack is centered on its day;
//                       where that hangs it far from its own candle it stands to one side of its day with a pointer.
//                       A number further than a line from its candle gets a thin neutral line with a dot at the candle.
//   importance          13 before 9 before +13, and inside a kind the LONGER timeframe first. Stacks choose their place
//                       in that order, and where a pile has more than fits (K numbers a stack, K lines from the candles,
//                       the end of the plot) the less important number gives way: a number that finds no place makes
//                       the least important number that stands in its way fold, never the other way round. Before any
//                       13 of a pile folds, the 9s and +13s in the pile's columns become the small marks of the wide
//                       windows. What folds is in a chip that says what it holds ("13 7개" with a square per family,
//                       "9 3개"); a click on the chip pins the list of its numbers, the chart itself does not move.
//   window              the days shown, and right of the newest day a margin for the 다음 봉 조건 zone. Moving back in
//                       history keeps the width of a day: the margin shrinks first (the zone leaves), then the days move.
//   level of detail     by pixels per day (PPD_* below): candles become thin bars, then a high-low range, then a band
//                       with the close as a line. From PPD_ALL13 up every 13 is a number, and the 9s (and +13s) are
//                       numbers from PPD_NINE_TEXT and marks below. Under PPD_ALL13 it is decided per timeframe by the
//                       width of its bar on the screen (modeOf): number, mark, or left to the strip, so that the wide
//                       windows write the long timeframes and no timeframe shows numbers and marks of one kind.
//   다음 봉 조건          right of the newest candle, on the chart's price scale: per next-bar trigger that can fire the
//                       number at the price the bar has to reach, quiet while the price is far (dashed frame), framed
//                       and tinted within the 임박 threshold, filled when the bar would get the label as things are.
//                       The level where the bar may close after that shows for the chip that is pointed at. Conditions
//                       beyond the price range are counted in one line per edge. In a narrow room the same conditions
//                       are one line under the chart that opens into a list.
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
  // the days of a timeframe's bar (a month as 30.44 days): how wide its bar is on the screen
  const TF_DAYS = TFS.map((tf) => { const m = /^(\d+)([DWM])$/.exec(tf); return Number(m[1]) * (m[2] === 'D' ? 1 : m[2] === 'W' ? 7 : 30.44); });
  const J_LONG = TFS.indexOf('2W');   // a folded 13 of this timeframe or a longer one lets no shorter 13 stay written next to it

  // ---------- sizes ----------
  const K = 5;                 // numbers a stack shows; what is beyond gives way
  // One size for every timeframe, by the chart's width: n narrower than NARROW, m up to WIDE, l from there.
  // num / sup: the font sizes of a 9 or 13 and of its superscript; def / supDef: of a +13; lh / lhDef: the height of
  // a number's box; base / rise: the baseline in the box and how far the superscript is raised; chip: the chip's height
  const SIZES = {
    n: { key: 'n', num: 13, sup: 9, def: 12, supDef: 9, lh: 15, lhDef: 14, base: 12, rise: 4.4, baseDef: 11.3, riseDef: 4, chip: 13, chipFont: 10 },
    m: { key: 'm', num: 15, sup: 10.5, def: 12, supDef: 9, lh: 17, lhDef: 14, base: 14, rise: 5.2, baseDef: 11.3, riseDef: 4, chip: 14, chipFont: 10.5 },
    l: { key: 'l', num: 17, sup: 11.5, def: 14, supDef: 10, lh: 19, lhDef: 16, base: 15.7, rise: 6, baseDef: 13, riseDef: 4.6, chip: 15, chipFont: 11.5 },
  };
  const WIDE = 1700;
  const sizeOf = (w) => (w < NARROW ? SIZES.n : w < WIDE ? SIZES.m : SIZES.l);
  const GAP = 3;               // between a candle and the first number or mark
  const CHIP_JOIN = 10;        // stacks whose chips would stand this near share one chip
  const MARK_W = 3, MARK_CAP = 36;   // a mark's width; how far a pile of marks may reach from its candle
  const LEAD_SIDE = 1;         // a number whose digits stand further than this beside its day gets a line to it, with a pointer
  const STACK_GAP = 3;         // between the stacks of two days that stand on each other (the numbers of one stack are 1 px apart)
  const NEAR_PX = 40;          // "next to": how near a shorter 13 may not stay written while a 13 of 2W or longer is folded
  const BASE_M = 8;            // room above and under the candles when nothing else needs it
  const AXIS_H = 18, STRIP_AXIS = 15;
  const MIN_DAYS = 14;         // the shortest window
  const NARROW = 560;          // a picture narrower than this: narrow gutter, small numbers, conditions as a list, low strip
  const ZONE_W = 120;          // the 다음 봉 조건 zone
  const EDGE = 6, PAD_L = 8, PAD_R = 16, PAD_R_NARROW = 6;   // right of the plot; inside the plot before the first and after the last day
  const COND_H = 15, COND_PITCH = 17, EDGE_LINE = 14;   // a condition chip, the distance between two, the line of an edge's count
  const MIN_CHART = 360;       // the chart is never lower than this
  // level of detail, in pixels per day
  const PPD_CANDLE = 4.5, PPD_THIN = 2.4, PPD_RANGE = 0.9;   // candles with a body from here / thin candles / one bar from low to high / below: band and line
  const PPD_NINE_TEXT = 2.6;   // 9s and +13s are numbers from here, marks below
  const PPD_ALL13 = 1.25;      // every 13 is a number from here (or folded); below, per timeframe by the width of its bar
  const T_NUM = 4.5;           // under PPD_ALL13: a timeframe's labels are numbers when its bar is this many px wide
  const FONT = {
    axis: `500 10.5px ${MONO}`, axisS: `500 9.5px ${MONO}`, tag: `600 10.5px ${MONO}`, note: `12.5px ${SANS}`,
    cond: `700 11px ${SANS}`, condSup: `700 8px ${SANS}`, pct: `500 9.5px ${MONO}`, pctB: `700 9.5px ${MONO}`, zone: `600 10px ${SANS}`, small: `500 10px ${SANS}`,
    row: `500 10px ${MONO}`, rowS: `500 9px ${MONO}`, band: `600 10px ${SANS}`, win: `600 10px ${SANS}`,
  };
  // the fonts of a number of the size in force: a 13 bold, a 9 a little lighter, a +13 smaller; the superscript bold
  const numFont = (kind) => (kind === 'I' ? `600 ${Z.def}px ${SANS}` : kind === 'C' ? `700 ${Z.num}px ${SANS}` : `600 ${Z.num}px ${SANS}`);
  const supFont = (kind) => (kind === 'I' ? `600 ${Z.supDef}px ${SANS}` : `700 ${Z.sup}px ${SANS}`);
  const chipFont = () => `600 ${Z.chipFont}px ${SANS}`;

  const CSS = `
.bec-ctl { position: relative; gap: 4px 10px; padding: 4px 8px; }
.bec-ctl .ctl { gap: 6px; flex-wrap: nowrap; }
.bec-ctl .seg { padding: 2px; flex-wrap: nowrap; }
.bec-ctl .seg button { padding: 2px 7px; font-size: 12.5px; line-height: 20px; }
.bec-row > .ctl > span, .bec-hid { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.bec-nine button { font-weight: 700; color: var(--bec-setup, var(--setup)); min-width: 26px; }
.bec-nine button[aria-pressed="false"] { opacity: .55; }
.bec-grp button[aria-pressed="mixed"] { color: var(--fg); box-shadow: inset 0 0 0 1px var(--line); }
.bec-grp button { font-family: var(--font-mono); font-size: 11.5px; }
.bec-more.btn { padding: 2px 10px; font-size: 12.5px; line-height: 20px; white-space: nowrap; }
.bec-more[aria-expanded="true"] { background: var(--sunken); }
.bec-win { font: 12px/20px var(--font-mono); color: var(--muted); white-space: nowrap; }
.bec-now.btn { margin-left: auto; padding: 2px 9px; font-size: 12px; line-height: 18px; white-space: nowrap; }
/* (the button keeps its place while it is not needed, so that nothing over the chart moves when the window does) */
.bec-ctl .bec-now[hidden], .bec-caprow .bec-now[hidden] { display: inline-block !important; visibility: hidden; }
.bec-row { display: contents; }
.bec-set { position: absolute; z-index: 25; top: calc(100% + 4px); left: 8px; width: max-content; max-width: calc(100% - 16px); padding: 10px 12px 12px; display: grid; gap: 8px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); box-shadow: 0 10px 28px rgb(0 0 0 / .2); }
.bec-set .ctl { flex-wrap: wrap; }
.bec-set .ctl > span { min-width: 76px; }
.bec-set .seg { flex-wrap: wrap; }
.bec-tfs { gap: 5px; align-items: flex-start; }
.bec-tfs > span { line-height: 26px; }
.bec-tfg { display: inline-flex; flex-wrap: wrap; gap: 1px; padding: 2px; border-radius: 8px; background: var(--sunken); border: 1px solid var(--line); }
.bec-tfg button { border: 0; background: transparent; border-radius: 5px; padding: 2px 3px; min-width: 26px; font: 500 11px/18px var(--font-mono); color: var(--faint); cursor: pointer; white-space: nowrap; }
.bec-tfg button:hover { color: var(--fg); }
.bec-tfg button[aria-pressed="true"] { background: var(--surface); color: var(--fg); box-shadow: 0 1px 2px rgb(0 0 0 / .14); }
.bec-tfbox { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.bec-pic { padding: 8px 8px 10px; display: grid; gap: 4px; grid-template-columns: minmax(0, 1fr); }
.bec-cap { margin: 0; font-size: 12.5px; line-height: 18px; color: var(--muted); }
.bec-cap b { color: var(--fg); font-weight: 600; margin-right: 6px; }
.bec-caprow { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; min-height: 18px; }
.bec-caprow .bec-cap { flex: 1 1 280px; min-width: 0; }
.bec-box { position: relative; min-width: 0; overflow: hidden; }
.bec-box canvas { position: absolute; left: 0; top: 0; display: block; }
.bec-over { touch-action: pan-y; outline-offset: -2px; border-radius: 4px; }
.bec-chart .bec-over { cursor: crosshair; }
.bec-chart .bec-over.bec-drag, .bec-strip .bec-over.bec-drag { cursor: grabbing; }
.bec-wait p { margin: 0 0 10px; }
.bec-list { position: absolute; z-index: 5; display: grid; gap: 4px; padding: 7px 4px 7px 9px; min-width: 196px; max-width: calc(100% - 12px); background: var(--surface); color: var(--fg); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 6px 18px rgb(0 0 0 / .2); font-size: 12px; }
.bec-list h3 { display: flex; align-items: center; gap: 12px; font: 600 12px/18px var(--font-mono); padding-right: 5px; }
.bec-list h3 button { margin-left: auto; border: 0; background: transparent; color: var(--muted); font: 500 11.5px/18px var(--font-sans); padding: 0 4px; border-radius: 4px; cursor: pointer; }
.bec-list h3 button:hover { color: var(--fg); background: var(--sunken); }
.bec-rows { display: grid; gap: 1px; overflow-y: auto; overscroll-behavior: contain; padding-right: 5px; }
.bec-rows a { display: flex; align-items: baseline; gap: 9px; padding: 2px 5px; border-radius: 5px; color: var(--fg); text-decoration: none; white-space: nowrap; }
.bec-rows a:hover, .bec-rows a:focus-visible { background: var(--sunken); }
.bec-rows a .m { color: var(--muted); font: 11.5px var(--font-mono); }
.bec-rows a .bec-go { margin-left: auto; padding-left: 6px; color: var(--accent); font-size: 11px; }
.bec-conds { display: grid; gap: 4px; grid-template-columns: minmax(0, 1fr); margin-top: 2px; }
.bec-csum, .bec-crow > button { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 7px; width: 100%; min-height: 40px; padding: 4px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); font-size: 12.5px; line-height: 18px; text-align: left; cursor: pointer; }
.bec-csum b { font-weight: 600; }
.bec-csum .bec-chev, .bec-crow .bec-chev { margin-left: auto; color: var(--muted); font-size: 11.5px; white-space: nowrap; }
@media (max-width: 379px) { .bec-csum .bec-chev { font-size: 0; } .bec-csum .bec-chev::after { content: attr(data-g); font-size: 13px; } }
.bec-crow { display: grid; grid-template-columns: minmax(0, 1fr); border: 1px solid var(--line); border-radius: 8px; }
.bec-crow > button { border: 0; background: transparent; }
.bec-crow.bec-on { border-color: var(--accent); }
.bec-crow .bec-end { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; }
.bec-cbody { display: grid; gap: 3px; padding: 0 10px 9px; }
.bec-dist { font: 600 12.5px var(--font-mono); }
.bec-near { font-size: 11px; font-weight: 600; line-height: 16px; padding: 0 5px; border-radius: 4px; background: var(--warn-bg); color: var(--warn-fg); white-space: nowrap; }
.bec-met { font-size: 11.5px; font-weight: 600; line-height: 18px; padding: 0 8px; border-radius: 999px; background: var(--fg); color: var(--surface); white-space: nowrap; }
.bec-fire { margin: 0; font-size: 12.5px; font-weight: 600; line-height: 1.5; font-variant-numeric: tabular-nums; }
.bec-sent { margin: 0; font-size: 12px; line-height: 1.5; color: var(--muted); }
.bec-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; font-size: 11.5px; color: var(--muted); }
.bec-meta a { margin-left: auto; white-space: nowrap; line-height: 40px; }
.bec-foot { padding: 7px 12px; display: grid; gap: 3px; grid-template-columns: minmax(0, 1fr); }
.bec-foot .legend { gap: 4px 18px; }
.bec-foot .hint { max-width: 150ch; font-size: 12px; }
.bec-n { font: 700 13px/15px var(--font-sans); font-style: normal; white-space: nowrap; }
.bec-n sup { font-size: 9px; font-weight: 700; line-height: 0; margin-left: 1px; vertical-align: 4.5px; }
.bec-n.bec-n9 { font-weight: 600; color: var(--bec-setup, var(--setup)); }
.bec-n.bec-rep { opacity: .8; }
.bec-n.bec-def { font-size: 11px; font-weight: 600; opacity: .7; }
.bec-n.bec-def sup { font-size: 8px; font-weight: 600; vertical-align: 3.5px; }
.bec-n.bec-gone { opacity: .55; text-decoration: underline dotted; text-decoration-thickness: 1px; text-underline-offset: 3px; }
.bec-w { display: inline-block; flex: none; font: 700 11px/13px var(--font-sans); font-style: normal; padding: 0 3px; border-radius: 4px; border: 1px dashed color-mix(in srgb, var(--c, var(--setup)) 70%, transparent); color: color-mix(in srgb, var(--c, var(--setup-ink)) 78%, var(--surface)); white-space: nowrap; }
.bec-w sup { font-size: 8px; font-weight: 700; line-height: 0; margin-left: 1px; vertical-align: 3px; }
.bec-w.bec-w1 { border: 1px solid var(--c, var(--setup)); color: var(--fg); background: color-mix(in srgb, var(--c, var(--setup)) 22%, transparent); box-shadow: 0 0 0 .5px var(--c, var(--setup)); }
.bec-w.bec-w0 { border: 1px solid var(--c, var(--setup)); color: var(--i, var(--surface)); background: var(--c, var(--setup)); }
.bec-chipx { display: inline-flex; align-items: center; gap: 3px; font: 500 10.5px/14px var(--font-sans); padding: 0 5px; border-radius: 4px; border: 1px solid var(--line); background: var(--sunken); color: var(--muted); white-space: nowrap; }
.bec-chipx i { display: inline-block; width: 3px; height: 5px; margin-right: -2px; }
.bec-chipx i:last-of-type { margin-right: 0; }
.bec-chipx b { font-weight: 700; color: var(--fg); }
.bec-g { display: inline-block; flex: none; }
.bec-gm { width: 3px; height: 4px; }
.bec-gm9 { width: 3px; height: 2px; background: var(--bec-setup, var(--setup)); }
.bec-gl { position: relative; width: 3px; height: 13px; }
.bec-gl::before { content: ""; position: absolute; left: 1px; top: 0; width: 1px; height: 11px; background: var(--muted); opacity: .8; }
.bec-gl::after { content: ""; position: absolute; left: 0; bottom: 0; width: 3px; height: 3px; border-radius: 50%; background: var(--muted); opacity: .8; }
.tip.bec-pin { pointer-events: auto; }
.bec-tip-link { display: block; margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--line); white-space: nowrap; }
.bec-tip-foot { margin-top: 6px; color: var(--muted); }
.bec-tip-rows { display: grid; gap: 3px; }
.bec-help h2 { margin-bottom: 0; }
.bec-nar.bec-ctl { padding: 0; gap: 4px 6px; border: 0; background: transparent; }
.bec-nar.bec-ctl .seg { padding: 0 2px; }
.bec-nar.bec-ctl .seg button { min-height: 40px; padding: 0 7px; line-height: 38px; }
.bec-nar .bec-more.btn { min-height: 40px; margin-left: auto; padding: 0 10px; }
.bec-nar .bec-set { left: 0; right: 0; width: auto; max-width: none; }
.bec-nar .bec-set { gap: 6px; padding: 10px; }
.bec-nar .bec-set .ctl > span { min-width: 88px; }
.bec-nar .bec-tfg button { min-width: 40px; min-height: 40px; }
.bec-nar .bec-set .btn { min-height: 40px; padding: 0 12px; }
.bec-nar .bec-pic { padding: 6px 6px 8px; gap: 3px; }
.bec-nar .bec-cap { font-size: 12px; line-height: 16px; }
.bec-nar .bec-caprow { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; }
.bec-nar .bec-caprow .bec-cap, .bec-nar .bec-caprow .bec-win { grid-column: 1; }
.bec-nar .bec-win { font-size: 11.5px; line-height: 18px; }
.bec-nar .bec-now.btn { grid-column: 2; grid-row: 1 / span 2; align-self: center; min-height: 40px; margin-left: 0; padding: 0 12px; }
.bec-nar .bec-rows a { min-height: 40px; align-items: center; }
.bec-nar .bec-list h3 button { min-height: 40px; padding: 0 10px; }`;

  // ---------- state ----------
  let root = null, ui = null, S = null;
  let cur = null;       // the coin shown: { c, det, d (daily data), first (first day with a daily bar), all (labels), cells (strip), late, dec }
  let win = null;       // the window: { d0, d1 (unix days, both shown), custom (moved off a preset) }
  let M = null;         // the chart as laid out (layoutChart)
  let SM = null;        // the strip as laid out (layoutStrip)
  let Z = SIZES.m;      // the sizes in force (sizeOf the chart's width)
  let hover = null;     // what the pointer is on: { type: 'label' | 'chip' | 'cond' | 'edge' | 'day', ... }
  let shover = null;    // what the pointer is on in the strip: { day, a: the label of the tick there | null }
  let cursor = null;    // the keyboard's place: { day } | { zone: true }, with pick (index into the things of that place) | null
  let pinned = null;    // the number or condition a click or a tap chose: its tooltip stays, with the link to its chart
  let listOf = null;    // the id of the chip whose list is pinned (the chips are laid out anew with every layout)
  let nar = false;      // the narrow arrangement (a phone): set with the size
  let condsOpen = false, condRow = null;   // the narrow list of conditions: open, and the condition whose sentence is open
  let drag = null, sdrag = null, pinch = null, pointers = new Map();
  let raf = 0, dirty = 0, seq = 0, chartH = 420, sized = { c: '', s: '' }, ro = null, tallTimer = 0, seenH = 0, seenTop = -1;
  let INK = FAM_COLOR.slice();   // the family colors as drawn on the theme's surface
  let INK9 = SETUP_COLOR;        // the gray of a 9 on the theme's surface
  let GROUND = '';               // the ground of the strip's bands
  let LEAD = '';                 // the neutral color of the lines from a number to its day
  const TW = new Map();          // text widths by font and text
  let mctx = null;               // a context to measure text with

  // ---------- small tools ----------
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const phone = () => ((root && root.clientWidth) || innerWidth) < 640;   // a phone: the shorter default window
  const rangeKey = () => (S.range === 'auto' ? (phone() ? '3m' : '6m') : S.range);
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
  // a price as TradingView's price scale writes it: rounded to the coin's price step, with its decimals
  function tickPrice(v) {
    if (v == null || !Number.isFinite(v)) return fmtPrice(v);
    const [i, f] = v.toFixed(cur ? cur.dec : 2).split('.');
    return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : '');
  }
  // colors
  const rgbOf = (c) => { const m = /^#([0-9a-f]{6})$/i.exec(String(c).trim()); if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)); const r = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(String(c).trim()); return r ? [Number(r[1]), Number(r[2]), Number(r[3])] : null; };
  const relLum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const mix = (a, b, t) => { const x = rgbOf(a), y = rgbOf(b); return x && y ? `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(', ')})` : a; };
  const hexOf = (c) => { const r = rgbOf(c); return r ? '#' + r.map((v) => v.toString(16).padStart(2, '0')).join('') : c; };
  // The colors of the numbers on the theme's surface. Light: the indicator's own. Dark: the red and the purple made
  // lighter and the 9 a lighter gray, so that every number stands out from the surface more than the candles do.
  // The grounds of the strip's bands: the sunken color, mixed towards the line color until it stands out enough.
  const DARK_INK = { 0: '#e25151', 2: '#a866e0' }, DARK_NINE = '#9296a1';
  function readInks() {
    const dark = BE.isDark();
    INK = FAM_COLOR.map((c, f) => (dark && DARK_INK[f] ? DARK_INK[f] : c));
    INK9 = dark ? DARK_NINE : SETUP_COLOR;
    GROUND = C.sunken;
    const s = rgbOf(C.surface);
    if (s && rgbOf(C.sunken) && rgbOf(C.line)) for (let t = 0; t <= 1.001; t += 0.1) { GROUND = hexOf(mix(C.sunken, C.line, t)); if (contrast(rgbOf(GROUND), s) >= 1.125) break; }
    LEAD = C.muted;
    if (root) { INK.forEach((c, f) => root.style.setProperty('--bec-f' + f, c)); root.style.setProperty('--bec-setup', INK9); }
    // the 계열 buttons are the color key: their squares are the colors the numbers have here
    if (BE.solo && BE.famCtl) INK.forEach((c, f) => BE.famCtl.style.setProperty('--f' + f, c));
    if (BE.tip.el) BE.tip.el.style.setProperty('--bec-setup', INK9);
  }
  const colorOf = (a) => (a.kind === 'S' ? INK9 : INK[a.f]);
  const alphaOf = (a) => (a.kind === 'I' ? 0.7 : a.rep ? 0.8 : 1) * (a.gone ? 0.55 : 1);
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
  // a number as the chart writes it, for tooltips, the legend and the lists: text with the timeframe as a superscript
  function numEl(a) {
    const b = el('b', 'bec-n' + (a.kind === 'S' ? ' bec-n9' : '') + (a.rep ? ' bec-rep' : '') + (a.kind === 'I' ? ' bec-def' : '') + (a.gone ? ' bec-gone' : ''), a.text);
    if (a.kind !== 'S') b.style.color = INK[a.f];
    b.append(el('sup', null, a.tf));
    return b;
  }
  // the mark of a condition that is still waiting, as the zone draws it: quiet with a dashed frame while the price is
  // far, framed and tinted within the 임박 threshold, filled when the bar would get the label as things are
  function waitEl(q) {
    const b = el('b', 'bec-w' + (q.fire.now ? ' bec-w0' : q.near ? ' bec-w1' : ''), q.is13 ? '13' : '9');
    if (q.is13) { b.style.setProperty('--c', INK[q.f]); b.style.setProperty('--i', inkOn(INK[q.f])); } else b.style.setProperty('--c', INK9);
    if (q.rep) b.style.opacity = '.8';
    b.append(el('sup', null, q.tf));
    return b;
  }
  const inkOn = (color) => { const c = rgbOf(color); return c && contrast(c, [255, 255, 255]) < contrast(c, [20, 25, 34]) ? '#141922' : '#ffffff'; };
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
  // last calendar day has no daily candle, so the number stands at an earlier day. `gone`: older than the indicator's
  // label limit, so TradingView's chart no longer shows it.
  const anchorDay = (e) => { let day = e; while (day > cur.first && !hasBar(day)) day--; return Math.max(day, cur.first); };
  function prepare(c, det) {
    const d = det.d;
    let a = 0; while (a < d.c.length - 1 && d.c[a] == null) a++;
    cur = { c, det, d, first: d.d0 + a, all: [], cells: [], late: 0, hi: 0, dec: clamp(Math.round(-Math.log10(det.mintick > 0 ? det.mintick : 0.01)), 0, 12) };
    for (let i = a; i < d.h.length && d.d0 + i <= LAST; i++) if (d.h[i] > cur.hi) cur.hi = d.h[i];
    const cells = new Map();
    for (const x of det.tfs) {
      if (!x.res) continue;
      const b = x.bars, vis = x.res.chartVisibleFrom;
      x.res.labels.forEach((L, k) => {
        const is9 = L.kind === 'S' && L.text.startsWith('9'), is13 = L.kind === 'C', isDef = L.kind === 'I' && L.text.startsWith('+');
        if (!is9 && !is13 && !isDef) return;
        const s = b.start[L.bar], e = b.end[L.bar], day = anchorDay(e);
        const item = { j: x.j, tf: x.tf, k, L, bar: L.bar, s, e, day, dir: L.dir, kind: L.kind, f: is9 ? null : L.family, text: L.text,
          rep: is9 && L.raw >= 18, gone: k < vis, late: day !== e,
          // how much a number matters where room is short: a 13 before a 9 before a +13, the longer timeframe first
          imp: (is13 ? 2 : is9 ? 1 : 0) * 100 + x.j,
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
  // and never narrower than the names at the strip's left
  const BAND_NAME = { [SELL]: '매도 쪽', [BUY]: '매수 쪽' };
  const gutter = (small) => {
    const names = Math.ceil(Math.max(tw(FONT.band, BAND_NAME[SELL]), tw(FONT.band, BAND_NAME[BUY]), ...GROUPS.map((g) => tw(FONT.row, `${TFS[g[0]]}~${TFS[g[1]]}`)))) + 8;
    return clamp(Math.ceil(tw(small ? FONT.axisS : FONT.axis, fmtPrice(Number((cur.hi || 1).toPrecision(3))))) + 13, Math.max(small ? 46 : 58, names), small ? 66 : 90);
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
  const slotPx = () => { const small = chartW() < NARROW; return Math.max(60, chartW() - EDGE - gutter(small) - PAD_L - (small ? PAD_R_NARROW : PAD_R)); };   // the room of the day slots
  const zonePx = () => (S.cond === 'on' && chartW() >= NARROW ? Math.min(ZONE_W - EDGE, slotPx() / 2) : 0);                                     // the margin of the zone
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
  // after the window has changed: what was pointed at, pinned or listed belongs to the picture that is gone
  function moved() { hover = null; pinned = null; closeList(); hideTip(); schedule(D_LAYOUT); }

  // ---------- drawing on demand ----------
  const D_LAYOUT = 1, D_BASE = 2, D_OVER = 4, D_STRIP = 8, D_SOVER = 16, D_SIZE = 32;
  function schedule(what) { dirty |= what; if (!raf) raf = requestAnimationFrame(flush); }
  function flush() {
    raf = 0;
    const w = dirty; dirty = 0;
    if (!root || !ui || !cur || !win) return;
    if (w & D_SIZE) { seenH = window.innerHeight; arrange(); if (!win.custom) applyPreset(); }   // the default window follows the room
    if (w & (D_STRIP | D_SIZE)) { readInks(); layoutStrip(); paintStrip(); }
    if (w & D_SIZE) chartH = chartHeight();
    if (w & (D_LAYOUT | D_SIZE)) layoutChart();
    if (w & (D_LAYOUT | D_BASE | D_SIZE)) { const t0 = performance.now(); paintChart(); M.paintMs = performance.now() - t0; }
    if (w & (D_LAYOUT | D_BASE | D_OVER | D_SIZE)) paintOver();
    if (w & (D_LAYOUT | D_STRIP | D_SOVER | D_OVER | D_SIZE)) paintStripOver();
    if (w & (D_LAYOUT | D_SIZE)) syncHead();
  }
  const flushNow = () => { if (raf) { cancelAnimationFrame(raf); flush(); } };

  // ---------- the strip (전체 기간) ----------
  // Two bands of rows, the sell side above and the buy side below, and between them a lane for the close alone.
  function layoutStrip() {
    const W = Math.max(240, ui.strip.clientWidth), small = W < NARROW, gut = gutter(small);
    const pitch = small ? 1.5 : innerHeight >= 1000 ? 3 : 2, gg = pitch, n = TFS.length;   // height of a timeframe row; the gap between two groups
    const bandH = n * pitch + (GROUPS.length - 1) * gg;
    const lane = small ? 22 : innerHeight >= 800 ? 64 : 44, lanePad = small ? 3 : 4;
    const sellT = 3, laneT = sellT + bandH, buyT = laneT + lane, plotB = buyT + bandH, H = Math.ceil(plotB) + STRIP_AXIS;
    const x0 = gut, x1 = W - 6, ppd = (x1 - x0) / totalDays();
    const X = (d) => x0 + (d - cur.first) * ppd;   // the left edge of a day
    // rows: the same order in both bands, 1D lowest and 12M highest, a gap between the timeframe groups
    const rowTop = (j, dir) => (dir === SELL ? sellT : buyT) + (n - 1 - j) * pitch + (GROUPS.length - 1 - groupOf(j)) * gg;
    // ticks: a 13 over the days of its timeframe bar in its family color (the families of one bar and side next to
    // each other), a 9 as a thinner gray line (none in a narrow strip); each at least 2 px wide, a wide one 1 px short
    // of the next bar
    const ticks = [], h13 = Math.min(2, pitch);
    const box = (xa, xb, k) => {
      let bx = Math.round(xa), bw = Math.round(xb) - bx;
      if (bw >= 5) bw -= 1;
      if (bw < 2 * k) { bw = 2 * k; bx = Math.round((xa + xb) / 2 - k); }
      return [clamp(bx, x0, Math.max(x0, Math.floor(x1) - bw)), bw];
    };
    for (const cell of cur.cells) {
      if (!tfOn(cell.j) || !dirOn(cell.dir)) continue;
      const xa = X(Math.max(cell.s, cur.first)), xb = X(Math.min(cell.e, LAST) + 1), y = rowTop(cell.j, cell.dir);
      if (cell.s9 && S.nine === 'on' && !small) { const [bx, bw] = box(xa, xb, 1); ticks.push({ a: cell.s9, x0: bx, x1: bx + bw, y: y + pitch - 1, h: 1 }); }
      const c13 = cell.c13.filter((a) => BE.famOn(a.f)), k = c13.length;
      if (k) { const [bx, bw] = box(xa, xb, k); c13.forEach((a, i) => ticks.push({ a, x0: bx + Math.round(i * bw / k), x1: bx + Math.round((i + 1) * bw / k), y, h: h13 })); }
    }
    // the daily close on a log scale, in its lane
    const d = cur.d;
    let lo = Infinity, hi = -Infinity;
    for (let day = cur.first; day <= LAST; day++) { const v = d.c[day - d.d0]; if (v == null) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
    const f = lo > 0 ? Math.log : (v) => v, fl = f(lo), fh = f(hi), yA = laneT + lanePad, yZ = buyT - lanePad;
    const PY = (v) => (fh > fl ? yZ - (f(v) - fl) / (fh - fl) * (yZ - yA) : (yA + yZ) / 2);
    SM = { W, H, small, gut, pitch, bandH, sellT, laneT, buyT, plotB, x0, x1, ppd, X, rowTop, ticks, PY, yA, yZ };
  }
  function paintStrip() {
    const g = SM, dpr = window.devicePixelRatio || 1, size = `${g.W}x${g.H}@${dpr}`;
    let ctx;
    if (size !== sized.s) { sized.s = size; ui.strip.style.height = g.H + 'px'; ctx = BE.setupCanvas(ui.sBase, g.W, g.H); BE.setupCanvas(ui.sOver, g.W, g.H); }
    else { ctx = ui.sBase.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    ctx.globalAlpha = 1; ctx.setLineDash([]);
    ctx.fillStyle = C.surface; ctx.fillRect(0, 0, g.W, g.H);
    // the grounds of the bands, one per timeframe group, opaque
    ctx.fillStyle = GROUND;
    for (const dir of [SELL, BUY]) for (const gr of GROUPS) ctx.fillRect(g.x0, g.rowTop(gr[1], dir), g.x1 - g.x0, (gr[1] - gr[0] + 1) * g.pitch);
    // the close in its lane: broken where TradingView has no daily bar (a day between two such days is a dot)
    const d = cur.d;
    ctx.strokeStyle = ctx.fillStyle = C.fg; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.25; ctx.lineJoin = 'round'; ctx.beginPath();
    let run = 0;
    for (let day = cur.first; day <= LAST + 1; day++) {
      const v = day <= LAST ? d.c[day - d.d0] : null;
      if (v == null) { if (run === 1) { const p = d.c[day - 1 - d.d0]; ctx.fillRect(Math.round(g.X(day - 0.5)), Math.round(g.PY(p)), 1, 1); } run = 0; continue; }
      const x = g.X(day + 0.5), y = g.PY(v);
      if (run++) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
    // ticks, snapped to device pixels; one of a label that TradingView has deleted is fainter, as an outline where it is high enough
    const snap = (v) => Math.round(v * dpr) / dpr;
    const tick = (t, color, alpha) => {
      const y = snap(t.y), h = Math.max(1 / dpr, snap(t.y + t.h) - y), w = t.x1 - t.x0;
      if (!t.a.gone) { ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fillRect(t.x0, y, w, h); return; }
      ctx.globalAlpha = alpha * 0.6;
      if (h >= 2 && w >= 2) { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(t.x0 + 0.5, y + 0.5, w - 1, h - 1); } else { ctx.fillStyle = color; ctx.fillRect(t.x0, y, w, h); }
    };
    for (const t of g.ticks) if (t.a.kind === 'S') tick(t, INK9, t.a.rep ? 0.5 : 0.9);
    for (const t of g.ticks) if (t.a.kind === 'C') tick(t, INK[t.a.f], 1);
    ctx.globalAlpha = 1;
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
    ctx.font = FONT.band; ctx.fillStyle = C.fg; ctx.globalAlpha = 0.86;
    const inset = g.small ? 6 : 9;
    ctx.fillText(BAND_NAME[SELL], g.x0 - 5, g.laneT + inset);
    ctx.fillText(BAND_NAME[BUY], g.x0 - 5, g.buyT - inset + 1);
    ctx.globalAlpha = 1;
  }
  // the window box, the day the pointer is at, the tick of the number that is pointed at and the origin bars of a 13
  function paintStripOver() {
    const g = SM, ctx = ui.sOver.getContext('2d'), dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, g.W, g.H);
    const b = stripBox();
    ctx.fillStyle = C.accent; ctx.globalAlpha = BE.isDark() ? 0.18 : 0.1; ctx.fillRect(b.xa, 0, b.xb - b.xa, g.plotB);
    ctx.globalAlpha = 1; ctx.strokeStyle = C.accent; ctx.lineWidth = 1; ctx.strokeRect(b.xa + 0.5, 0.5, b.xb - b.xa - 1, g.plotB - 1);
    // its name: inside when the box is wide enough, else next to it
    ctx.font = FONT.win; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const text = '현재 창', w = ctx.measureText(text).width, y = g.laneT + (g.small ? 6 : 9);
    const x = b.xb - b.xa >= w + 10 ? b.xa + 5 : b.xa - w - 6 >= g.x0 ? b.xa - w - 5 : b.xb + 5;
    ctx.fillStyle = C.surface; ctx.globalAlpha = 0.82; ctx.fillRect(x - 2, y - 7, w + 4, 14);
    ctx.globalAlpha = 1; ctx.fillStyle = C.accent; ctx.fillText(text, x, y + 0.5);
    // the day the pointer is at: a hairline, and its date on the axis
    if (shover && !sdrag) {
      const hx = Math.round(g.X(shover.day + 0.5)) + 0.5, t = iso(shover.day);
      ctx.strokeStyle = C.fg; ctx.globalAlpha = 0.55; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, g.plotB); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.font = FONT.tag; const tw2 = ctx.measureText(t).width + 10, tx = clamp(hx - tw2 / 2, g.x0, Math.max(g.x0, g.x1 - tw2));
      ctx.fillStyle = C.fg; ctx.fillRect(tx, g.plotB + 1, tw2, STRIP_AXIS - 2);
      ctx.fillStyle = C.surface; ctx.textAlign = 'center'; ctx.fillText(t, tx + tw2 / 2, g.plotB + 1 + (STRIP_AXIS - 2) / 2 + 0.5); ctx.textAlign = 'left';
    }
    const a = activeLabel();
    // the origin bars of a 13 that is pointed at: a 1 px tick each, over the band of its side
    if (a && a.kind === 'C') {
      ctx.fillStyle = C.fg;
      for (const od of originDays(a)) { const ox = Math.round(g.X(od + 0.5)); ctx.fillRect(ox, a.dir === SELL ? g.sellT - 3 : g.buyT, 1, g.bandH + 3); }
    }
    const t = a && a.kind !== 'I' ? g.ticks.find((q) => q.a === a) : null;
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
  // the tick at a point of the strip (the nearest within 2 px), or null
  function tickAt(x, y) {
    let best = null, bd = Infinity;
    for (const t of SM.ticks) {
      if (x < t.x0 - 2 || x > t.x1 + 2 || y < t.y - 2 || y > t.y + t.h + 2) continue;
      const dd = Math.abs(x - (t.x0 + t.x1) / 2) + 2 * Math.abs(y - (t.y + t.h / 2)) - (t.a.kind === 'C' ? 0.5 : 0);
      if (dd < bd) { bd = dd; best = t; }
    }
    return best;
  }
  function wireStrip() {
    const cv = ui.sOver;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const dayOf = (x) => clamp(Math.floor(cur.first + (x - SM.x0) / SM.ppd), cur.first, LAST);
    cv.addEventListener('pointerdown', (e) => {
      if (!cur || !SM || e.button > 0) return;
      const [x] = pos(e);
      let mode = stripZone(x);
      if (mode === 'out') {   // elsewhere: the window goes there, and can be dragged on from there
        const day = Math.floor(cur.first + (x - SM.x0) / SM.ppd);
        if (setView(day + 0.5 - spanT() / 2, spanT())) moved();
        mode = 'in';
      }
      sdrag = { id: e.pointerId, mode, x, d0: win.d0, d1: win.d1, T: spanT(), end: win.end };
      cv.classList.add('bec-drag'); hideTip();
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is already gone */ }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!cur || !SM) return;
      const [x, y] = pos(e);
      if (!sdrag || sdrag.id !== e.pointerId) {
        if (e.pointerType !== 'mouse') return;
        const z = stripZone(x); cv.style.cursor = z === 'l' || z === 'r' ? 'ew-resize' : z === 'in' ? 'grab' : 'pointer';
        // the day under the pointer, and the number whose tick is there
        const inside = x >= SM.x0 && x <= SM.x1, t = inside ? tickAt(x, y) : null;
        shover = inside ? { day: dayOf(x), a: t ? t.a : null } : null;
        if (t) showTip(labelTip(t.a, null, 'strip'), { x: e.clientX, y: e.clientY }); else hideTip();
        schedule(D_SOVER | D_OVER);
        return;
      }
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
    const end = (e) => { if (sdrag && sdrag.id === e.pointerId) { sdrag = null; cv.classList.remove('bec-drag'); schedule(D_SOVER); } };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'mouse') return; if (shover) { shover = null; hideTip(); schedule(D_SOVER | D_OVER); } });
    cv.addEventListener('keydown', (e) => {
      if (!cur || !SM || e.altKey || e.ctrlKey || e.metaKey) return;
      const span = win.d1 - win.d0 + 1, k = e.key;
      let ch = false;
      if (k === 'ArrowLeft' || k === 'ArrowRight') ch = panBy((k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? span : Math.max(1, Math.round(span * 0.1))));
      else if (k === '+' || k === '=') ch = zoomKey(null, 0.8);     // as on the chart: + shows fewer days, - more
      else if (k === '-' || k === '_') ch = zoomKey(null, 1.25);
      else if (k === 'Home') ch = setView(cur.first, spanT());
      else if (k === 'End') ch = toNewest();
      else return;
      e.preventDefault();
      if (ch) moved();
    });
    cv.addEventListener('focus', () => schedule(D_SOVER));
  }
  // the days at which the origin bars of a 13 (or of a +13) have their numbers: each bar's last day with a daily candle
  function originDays(a) {
    const b = cur.det.tfs[a.j].bars, L = a.L, list = a.kind === 'C' ? L.origins || [] : L.origin != null ? [L.origin] : [];
    return list.filter((o) => o >= 0 && o < b.n).map((o) => anchorDay(b.end[o]));
  }

  // ---------- the chart: layout ----------
  function niceStep(range, target) { const raw = range / Math.max(1, target), p = Math.pow(10, Math.floor(Math.log10(raw))), k = raw / p; return (k < 1.5 ? 1 : k < 3.5 ? 2 : k < 7.5 ? 5 : 10) * p; }
  // the prices of the grid lines between pLo and pHi (the prices at the plot's ends); lo..hi: the part of it where
  // lines are drawn (the window's lowest low to its highest high)
  function priceTicks(pLo, pHi, log, target, lo = pLo, hi = pHi) {
    const out = [], a = Math.max(pLo, lo), b = Math.min(pHi, hi);
    if (log && a > 0) {
      // 1, 2, 5 of every decade; over many decades the decades alone, then every second one; where fewer than three
      // of them lie between the low and the high (a range of less than a decade), a finer ladder
      const ladder = (ks, every) => { out.length = 0; for (let e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++) { if (((e % every) + every) % every) continue; for (const k of ks) { const v = Number((k * Math.pow(10, e)).toPrecision(3)); if (v >= a && v <= b) out.push(v); } } return out.length; };
      for (const [ks, every] of [[[1, 2, 5], 1], [[1], 1], [[1], 2], [[1], 3]]) if (ladder(ks, every) <= target + 4) break;
      if (out.length >= 3) return out;
      if (ladder([1, 1.5, 2, 3, 4, 5, 6, 8], 1) >= 3) return out;
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
  // date ticks: days or Mondays in a window shorter than four months, months from there on, then years; whichever
  // keeps the texts apart
  function dateTicks(d0, d1, ppd) {
    const out = [];
    const dayStep = d1 - d0 + 1 < 120 && ppd > 8.5 ? [1, 2, 7, 14].find((k) => k * ppd >= 58) : 0;
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
  // The chart is as tall as the window leaves under it: window height minus the chart's top minus 12 px, at least
  // MIN_CHART. In the narrow arrangement the one line of the conditions stays in view under it.
  function chartHeight() {
    const top = ui.chart.getBoundingClientRect().top + window.scrollY;
    seenTop = Math.round(top);
    return Math.round(Math.max(MIN_CHART, window.innerHeight - top - 12 - (nar && S.cond === 'on' ? 48 : 0)));
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
    const W = chartW(), H = chartH, small = W < NARROW;
    Z = sizeOf(W);
    const LH = Z.lh, ROW = LH + 1, CHIP_H = Z.chip, LINES_MAX = (K - 1) * (ROW + STACK_GAP) + 2;
    const d0 = win.d0, d1 = win.d1, n = d1 - d0 + 1, atEnd = win.end, D = cur.d, b0 = D.d0;
    const condOn = S.cond === 'on' && atEnd, zone = condOn && !small;
    // the plot ends where the margin right of the newest day begins (the zone's room, or what is left of it)
    const gut = gutter(small), padL = PAD_L, ppd = slotPx() / (n + win.fut);
    const plotL = gut, plotR = Math.round(W - EDGE - win.fut * ppd), plotT = 4, plotB = H - AXIS_H, plotH = plotB - plotT;
    const X = (d) => plotL + padL + (d - d0 + 0.5) * ppd;
    const nCol = Math.max(1, plotR - plotL);
    const nineText = ppd >= PPD_NINE_TEXT, all13 = ppd >= PPD_ALL13;
    // How a label of a kind and a timeframe is shown at this zoom: as a number, as a mark, or not on the chart. From
    // PPD_ALL13 up by the kind alone; under it by the width of the timeframe's bar on the screen, so that a timeframe
    // never has numbers and marks of one kind in one window.
    const modeOf = (kind, j) => {
      if (nineText) return 'text';
      if (all13) return kind === 'C' ? 'text' : 'mark';
      const w = TF_DAYS[j] * ppd;
      return w >= T_NUM ? 'text' : w >= (kind === 'C' ? T_NUM / 5 : T_NUM / 2) ? 'mark' : 'none';
    };
    const modes = TFS.map((tf, j) => ({ tf, C: modeOf('C', j), S: modeOf('S', j), I: modeOf('I', j) }));
    const m = M = { W, H, nar: small, size: Z, d0, d1, n, atEnd, zone, list: condOn && small, gut, plotL, plotR, gridR: W - EDGE, plotT, plotB, padL, ppd, X, none: false, log: false,
      lod: { candle: ppd >= PPD_CANDLE ? 'candle' : ppd >= PPD_THIN ? 'thin' : ppd >= PPD_RANGE ? 'range' : 'line', nineText, all13, modes },
      items: [], chips: [], conds: [], edges: [], pTicks: [], dTicks: dateTicks(d0, d1, ppd), dLabels: [], Y: null, P: null, zx: null, ms: 0, passes: 0, restarts: 0,
      empty: S.off.length >= TFS.length };
    const t0 = performance.now();

    // price range of the window's candles
    let lo = Infinity, hi = -Infinity;
    for (let d = d0; d <= d1; d++) { const i = d - b0; if (D.c[i] == null) continue; if (D.l[i] < lo) lo = D.l[i]; if (D.h[i] > hi) hi = D.h[i]; }
    if (!(lo < Infinity)) { m.none = true; lo = hi = cur.det.last > 0 ? cur.det.last : 1; }
    const log = lo > 0 && (S.scale === 'log' || (S.scale === 'auto' && hi / lo > 5));
    const f = log ? Math.log : (v) => v, fi = log ? Math.exp : (v) => v;
    let fl = f(lo), fh = f(hi);
    if (!(fh - fl > Math.abs(fh) * 1e-9)) { const pad = Math.abs(fh) * 0.02 || 1; fl -= pad; fh += pad; }
    m.log = log; m.lo = lo; m.hi = hi;

    // per pixel column of the plot: the lowest low and the highest high of the days whose slot touches it
    const colLo = new Float64Array(nCol).fill(NaN), colHi = new Float64Array(nCol).fill(NaN);
    for (let d = d0; d <= d1; d++) {
      const i = d - b0; if (D.c[i] == null) continue;
      const xa = padL + (d - d0) * ppd, ka = Math.max(0, Math.floor(xa + 1e-6)), kb = Math.min(nCol - 1, Math.ceil(xa + ppd - 1e-6) - 1);
      for (let k = ka; k <= kb; k++) { if (!(colLo[k] <= D.l[i])) colLo[k] = D.l[i]; if (!(colHi[k] >= D.h[i])) colHi[k] = D.h[i]; }
    }
    m.colLo = colLo; m.colHi = colHi;

    // ---- the labels of the window, and their boxes ----
    // Where a number's box stands against its day: 'c' the DIGITS centered on the day (the superscript hangs to the
    // right of them), or the whole box with its right ('l') or its left ('r') edge at the edge of the day's slot, so
    // that it reaches over the days before or after it only. al: the alignment in force ('e': held back by the plot's end).
    const alignBox = (it, mode) => {
      const x = mode === 'l' ? Math.round(it.cx + ppd / 2) - it.w : mode === 'r' ? Math.round(it.cx - ppd / 2) : Math.round(it.cx - it.nw / 2 - 1);
      it.x = clamp(x, plotL + 1, Math.max(plotL + 1, plotR - 1 - it.w));
      it.k0 = it.x - plotL; it.k1 = Math.min(nCol - 1, it.k0 + it.w - 1);
      it.side = it.x + 1 + it.nw / 2 - it.cx; it.al = it.x !== x ? 'e' : mode;
    };
    const textBox = (it) => {
      const a = it.a;
      it.nw = tw(numFont(a.kind), a.text);
      it.w = Math.ceil(it.nw + 1 + tw(supFont(a.kind), a.tf)) + 2; it.h = a.kind === 'I' ? Z.lhDef : LH;
      alignBox(it, 'c'); it.c0 = it.k0; it.c1 = it.k1;
    };
    // the pixel columns of a day's own slot
    const dayCols = (day) => [clamp(Math.floor(padL + (day - d0) * ppd + 1e-6), 0, nCol - 1), clamp(Math.ceil(padL + (day - d0 + 1) * ppd - 1e-6) - 1, 0, nCol - 1)];
    const markBox = (it) => {
      it.w = MARK_W; it.h = it.a.kind === 'C' ? 4 : 2; it.nw = 0;
      it.x = clamp(Math.round(it.cx - MARK_W / 2), plotL, plotR - MARK_W);
      it.k0 = it.x - plotL; it.k1 = Math.min(nCol - 1, it.k0 + MARK_W - 1); it.side = 0; it.al = 'c';
    };
    for (const a of labelsAt(d0, d1)) {
      const mode = modes[a.j][a.kind];
      const it = { a, cx: X(a.day), mode, dem: false, fold: false, placed: false, shown: '', x: 0, y: 0, w: 0, h: 0, nw: 0, u: 0, far: 0, side: 0, al: 'c', k0: 0, k1: 0, c0: 0, c1: 0, st: null, chip: null, group: null, lead: false };
      if (mode === 'text') textBox(it);
      m.items.push(it);
    }
    // the numbers of one day and side are a stack, in the order of cur.all: the shorter timeframe first
    const stacks = { [BUY]: [], [SELL]: [] }, byKey = new Map();
    for (const it of m.items) {
      if (it.mode !== 'text') continue;
      const key = (it.a.dir === SELL ? 's' : 'b') + it.a.day;
      let st = byKey.get(key);
      if (!st) { st = { key, day: it.a.day, dir: it.a.dir, list: [], kept: [], chip: null, own: null, best: -1, at: 0, mode: 'c' }; byKey.set(key, st); stacks[it.a.dir].push(st); }
      st.list.push(it); it.st = st;
    }
    const chipW13 = Math.ceil(tw(chipFont(), '13 00개')) + BE.FAMS.length * 4 + 11, chipW9 = Math.ceil(tw(chipFont(), '9 00개')) + 9;
    const top = (arr, k0, k1) => { let v = -Infinity; for (let k = k0; k <= k1; k++) if (arr[k] > v) v = arr[k]; return v; };
    const raise = (arr, k0, k1, u) => { for (let k = k0; k <= k1; k++) if (arr[k] < u) arr[k] = u; };
    const least = (list) => { let x = list[0]; for (const it of list) if (it.a.imp < x.a.imp || (it.a.imp === x.a.imp && it.a.inner > x.a.inner)) x = it; return x; };
    // who chooses a place first: the stack with the most important number (the longest 13), then the earlier day.
    // from: the stacks before this place in `was` are placed already and keep their turn; the others are put in order
    // by what they hold now.
    const orderOf = (dir, was, from) => {
      for (const st of stacks[dir]) { st.best = -1; for (const it of st.list) if (!it.dem && !it.fold && it.a.imp > st.best) st.best = it.a.imp; }
      const byBest = (p, q) => q.best - p.best || p.day - q.day;
      return was ? was.slice(0, from).concat(was.slice(from).sort(byBest)) : stacks[dir].slice().sort(byBest);
    };

    // One side placed on the scale Y, in u = the distance outward (buy side: y, sell side: -y). env: the candles' outer
    // edge plus the gap, per pixel column; base: the same with the marks on it; boxes: the numbers and chips placed so
    // far. final: the plot's end is a limit (a measuring pass has none and reports how far things reach beyond it);
    // reserve: the numbers leave the last line before the plot's end to the chips.
    // exact: where room is short the less important number gives way, wherever it stands (the picture that is shown);
    // otherwise a stack folds its own least important number (enough to measure the room the stacks need).
    const placeSide = (dir, Y, final, reserve, exact) => {
      const buy = dir === BUY, env = new Float32Array(nCol), base = new Float32Array(nCol);
      for (let k = 0; k < nCol; k++) { const v = buy ? colLo[k] : colHi[k]; env[k] = v !== v ? -1e6 : buy ? Y(v) + GAP : GAP - Y(v); }
      const edge = buy ? plotB - 1 : -(plotT + 1);
      const sd = { dir, env, base, edge, limChip: final ? edge : Infinity, limText: final ? edge - (reserve ? CHIP_H + 1 : 0) : Infinity, boxes: [], chips: [], need: 0, failed: false };
      const mine = m.items.filter((it) => it.a.dir === dir);
      // the lowest place at or beyond u0 where a box h high over the columns k0..k1 keeps clear of every box placed so
      // far: 1 px from a box of its own stack, STACK_GAP more from another stack's
      // (the boxes are also kept by 64 px wide strips of columns, so that a place is looked for among its neighbours only)
      const grid = Array.from({ length: (nCol >> 6) + 1 }, () => []);
      const addBox = (b) => { sd.boxes.push(b); for (let g = b.k0 >> 6; g <= b.k1 >> 6; g++) grid[g].push(b); };
      const cutBoxes = (n) => { sd.boxes.length = n; for (const g of grid) g.length = 0; for (const b of sd.boxes) for (let g = b.k0 >> 6; g <= b.k1 >> 6; g++) grid[g].push(b); };
      const lowest = (st, k0, k1, h, u0) => {
        let u = u0;
        for (let again = true; again;) {
          again = false;
          for (let gi = k0 >> 6; gi <= k1 >> 6; gi++) for (const b of grid[gi]) {
            if (b.k1 < k0 || b.k0 > k1 || b.off) continue;
            const g = b.st === st ? 1 : 1 + STACK_GAP;
            if (u < b.u + b.h + g && b.u < u + h + g) { u = b.u + b.h + g; again = true; }
          }
        }
        return u;
      };
      // One try of a stack in an alignment: its numbers from the candle outward, each at the lowest free place beyond
      // the one before it. A number may stand K lines from what was there before the numbers (the candles and the
      // marks), not further, and not beyond the plot. fail: the first number that finds no place; at: where it would be.
      const tryStack = (st, keep, mode, own) => {
        let after = -Infinity, end = own, n = 0;
        for (const it of keep) {
          alignBox(it, mode);
          const b0 = Math.ceil(top(base, it.k0, it.k1)), u = lowest(st, it.k0, it.k1, it.h, Math.max(b0, after));
          if (u - b0 > LINES_MAX || u + it.h > sd.limText) return { mode, fail: it, at: u, n, cost: Infinity };
          it.u = u; it.far = u - own; after = u + it.h + 1; end = u + it.h; n++;
        }
        return { mode, fail: null, at: 0, n, cost: end - own + (mode === 'c' ? 0 : ROW) };
      };
      // the columns of the pile a number belongs to: its own box and the chip of its day, with the room a chip joins over
      const pileOf = (x) => { const cw = chipW13 / 2, cc = x.cx - plotL; return [Math.min(x.c0, cc - cw) - CHIP_JOIN, Math.max(x.c1, cc + cw) + CHIP_JOIN]; };
      // A number gives way. A +13 becomes a mark. A 13 folds into a chip, but not before the 9s and +13s that stand in
      // its pile's columns have become marks; a 9 folds into a chip of 9s, or becomes a mark where a 13 has folded.
      // Returns null when nothing that is placed has changed (a number of the stack being placed has folded), else
      // { restart } (marks have changed: the whole side again) or { from: the stack to place again from }.
      // a 9 or a +13 becomes a mark, and with it every less important 9 and +13 of its own stack: in a stack the less
      // important number gives way first (a 9 of 10D is never a mark while the 9 of 2D of that day is written)
      const demote = (y) => { for (const z of y.st ? y.st.list : [y]) if (z.a.kind !== 'C' && !z.dem && (z === y || z.a.imp < y.a.imp)) { z.dem = true; z.fold = false; } };
      const giveWay = (st, x) => {
        if (x.a.kind === 'I') { x.dem = true; return { restart: true }; }
        if (x.a.kind === 'C') {
          const [pa, pb] = pileOf(x);
          let any = false;
          for (const y of mine) if (y.mode === 'text' && !y.dem && y.a.kind !== 'C' && y.c0 <= pb && pa <= y.c1) { demote(y); any = true; }
          if (any) return { restart: true };
        } else {
          for (const y of mine) { if (!y.fold || y.a.kind !== 'C') continue; const [pa, pb] = pileOf(y); if (x.c0 <= pb && pa <= x.c1) { demote(x); return { restart: true }; } }
        }
        x.fold = true;
        return x.st === st ? null : { from: x.st };
      };
      // does a 13 stand in the columns of a more important 13 that has folded?
      const underFolded = (it) => { for (const y of mine) if (y.fold && y.a.kind === 'C' && y.a.imp > it.a.imp && it.k0 <= y.c1 + 2 && y.c0 - 2 <= it.k1) return true; return false; };
      const placeStack = (st) => {
        // where the day's own candle ends: its own low or high (the pixel columns of its slot would not do: the edge
        // columns are shared with the days next to it, whose candles can be much taller); in the widest zooms, where a
        // column of the band holds several days, the band's end over the day's columns
        const [ca, cb] = dayCols(st.day), v0 = buy ? D.l[st.day - b0] : D.h[st.day - b0];
        const own = m.lod.candle === 'line' || v0 == null ? Math.ceil(top(env, ca, cb)) : Math.ceil(buy ? Y(v0) + GAP : GAP - Y(v0));
        let keep = st.list.filter((it) => !it.dem && !it.fold);
        st.own = own;
        for (;;) {
          // a stack shows K numbers: beyond that the least important give way
          while (keep.length > K) { const x = least(keep), r = exact ? giveWay(st, x) : (x.fold = true, null); if (r) return r; keep = keep.filter((it) => it !== x); }
          if (!keep.length) break;
          // Centered on its day when that keeps the stack at its candle. On a slope a centered number hangs far from its
          // own candle (it may not cover the candles next to it): then the stack may stand to one side of its day, if
          // that brings it at least a line nearer.
          let best = tryStack(st, keep, 'c', own), last = 'c';
          let wMax = 0; for (const it of keep) if (it.w > wMax) wMax = it.w;
          if (wMax > ppd + 4 && (best.fail || best.cost > keep.length * ROW + 6)) {
            for (const mode of ['l', 'r']) { const r = tryStack(st, keep, mode, own); last = mode; if (r.fail ? best.fail && r.n > best.n : !!best.fail || r.cost < best.cost) best = r; }
          }
          if (!best.fail) {
            if (last !== best.mode) tryStack(st, keep, best.mode, own);
            // (a 13 does not take a place in the columns of a more important 13 that has folded: it folds as well, so
            // that what is written in a pile is always more important than what is in its chip)
            const x = exact ? keep.find((it) => it.a.kind === 'C' && underFolded(it)) : null;
            if (!x) { st.mode = best.mode; break; }
            const r = giveWay(st, x); if (r) return r;
            keep = keep.filter((it) => it !== x); continue;
          }
          // A number finds no place. To measure, the stack folds its least important number. In the picture that is
          // shown, the least important number that stands in its way gives way (a number under it in its own stack, or
          // a number of a stack placed before); when nothing less important is in its way, the number itself.
          if (!exact) { const x = least(keep); x.fold = true; keep = keep.filter((it) => it !== x); continue; }
          if (last !== best.mode) tryStack(st, keep, best.mode, own);
          const nfail = best.fail, at = best.at + nfail.h;
          let kA = nfail.k0, kB = nfail.k1, victim = null;
          for (const it of keep) { if (it === nfail) break; if (it.k0 < kA) kA = it.k0; if (it.k1 > kB) kB = it.k1; if (it.a.imp < nfail.a.imp && (!victim || it.a.imp < victim.a.imp)) victim = it; }
          for (const b of sd.boxes) { const it = b.it; if (!it || b.k1 < kA || b.k0 > kB || b.u >= at) continue; if (it.a.imp < nfail.a.imp && (!victim || it.a.imp < victim.a.imp)) victim = it; }
          const x = victim || nfail, r = giveWay(st, x);
          if (r) return r;
          keep = keep.filter((it) => it !== x);
        }
        for (const it of keep) { it.placed = true; addBox({ it, st, k0: it.k0, k1: it.k1, u: it.u, h: it.h }); }
        st.kept = keep; st.chip = null;
        // the chip of what has folded: the chip that stands at this place already (one chip for the stacks of
        // neighbouring days), else a new one after the stack, or, where the plot ends before that, in the last line of
        // the plot (reserve). A chip holds 13s or 9s, never both.
        let is13 = false, any = false;
        for (const it of st.list) if (it.fold) { any = true; if (it.a.kind === 'C') is13 = true; }
        if (!any) return null;
        const w = is13 ? chipW13 : chipW9, x = clamp(Math.round(X(st.day) - w / 2), plotL + 1, Math.max(plotL + 1, plotR - 1 - w)), k0 = x - plotL, k1 = Math.min(nCol - 1, k0 + w - 1);
        const lastKept = keep[keep.length - 1], u = lowest(st, k0, k1, CHIP_H, Math.max(Math.ceil(top(base, k0, k1)), lastKept ? lastKept.u + lastKept.h + 1 : -Infinity));
        const fits = u + CHIP_H <= sd.limChip, want = fits ? u : sd.limChip - CHIP_H;
        const mk = (cu) => { const c = { id: st.key, is13, x, u: cu, w, h: CHIP_H, k0, k1, dir, day: st.day, far: cu - own, st, members: [], keys: new Set(), lead: false }; sd.chips.push(c); addBox({ it: null, chip: c, st, k0, k1, u: cu, h: CHIP_H }); return c; };
        let chip = null;
        for (const c of sd.chips) if (c.is13 === is13 && c.x < x + w + CHIP_JOIN && x < c.x + c.w + CHIP_JOIN && Math.abs(c.u - want) <= 3 * ROW && (!chip || Math.abs(c.x - x) < Math.abs(chip.x - x))) chip = c;
        if (!chip && (fits || reserve)) chip = mk(want);
        st.chip = chip;
        return null;
      };
      // What has to hold on the finished side. (b) No 9 is written in the columns of a chip that holds a 13, and none is
      // folded into one. (a) No 13 stays written in the columns of a more important 13 that has folded, nor within
      // NEAR_PX of a folded 13 of 2W or longer when its own timeframe is shorter. A number that breaks one of them
      // gives way, and the side is placed again.
      const audit = () => {
        let changed = false;
        for (const c of sd.chips) {
          if (!c.is13) continue;
          for (const b of sd.boxes) { const it = b.it; if (it && it.a.kind !== 'C' && !it.dem && b.k0 <= c.k1 && c.k0 <= b.k1) { demote(it); changed = true; } }
        }
        for (const st of stacks[dir]) if (st.chip && st.chip.is13) for (const it of st.list) if (it.fold && it.a.kind !== 'C') { demote(it); changed = true; }
        // (a chip of 9s that came to stand on a chip of 13s at the plot's end: its 9s are in that pile)
        for (const c of sd.chips) {
          if (c.is13) continue;
          if (!sd.chips.some((o) => o.is13 && o.k0 <= c.k1 && c.k0 <= o.k1 && o.u < c.u + c.h + 1 && c.u < o.u + o.h + 1)) continue;
          for (const st of stacks[dir]) if (st.chip === c) for (const it of st.list) if (it.fold) { demote(it); changed = true; }
        }
        if (changed) return true;
        for (const b of sd.boxes) { const it = b.it; if (it && it.a.kind === 'C' && underFolded(it)) { it.fold = true; it.placed = false; changed = true; } }
        for (const x of mine) {
          if (!x.fold || x.a.kind !== 'C' || x.a.j < J_LONG) continue;
          const c = x.st.chip, xa = Math.min(x.cx, c ? c.x : x.cx) - NEAR_PX, xb = Math.max(x.cx, c ? c.x + c.w : x.cx) + NEAR_PX;
          for (const b of sd.boxes) {
            const it = b.it; if (!it || it.fold || it.a.kind !== 'C' || it.a.j >= x.a.j) continue;
            if (Math.min(it.x, it.cx) <= xb && xa <= Math.max(it.x + it.w, it.cx)) { it.fold = true; it.placed = false; changed = true; }
          }
        }
        return changed;
      };
      const marks = () => mine.filter((it) => it.mode === 'mark' || (it.dem && all13)).sort((p, q) => q.a.imp - (q.a.imp % 100) - (p.a.imp - (p.a.imp % 100)) || p.a.day - q.a.day || p.a.j - q.a.j || p.a.inner - q.a.inner);
      for (let guard = 0; guard < 6000; guard++) {
        // the marks first: they stay at their candles, 13s nearest; a pile ends MARK_CAP from the candle (marks overlap there)
        base.set(env);
        for (const it of marks()) {
          if (it.mode !== 'mark') markBox(it);
          const home = Math.ceil(top(env, it.k0, it.k1)), u = Math.max(home, Math.min(Math.ceil(top(base, it.k0, it.k1)), home + MARK_CAP - it.h, sd.limText - it.h));
          it.u = u; it.far = u - home; raise(base, it.k0, it.k1, u + it.h + 1);
        }
        cutBoxes(0); sd.chips.length = 0;
        for (const it of mine) it.placed = false;
        let order = orderOf(dir), again = false;
        for (let i = 0; i < order.length; i++) {
          const st = order[i];
          st.at = sd.boxes.length; st.atChip = sd.chips.length;
          const r = placeStack(st);
          if (!r) continue;
          m.restarts++;
          if (r.restart) { again = true; break; }
          // a number of a stack placed before has folded: everything from that stack on is placed again
          const from = r.from;
          for (let k = from.at; k < sd.boxes.length; k++) if (sd.boxes[k].it) sd.boxes[k].it.placed = false;
          cutBoxes(from.at); sd.chips.length = from.atChip;
          const j = order.indexOf(from);
          order = orderOf(dir, order, j); i = j - 1;
        }
        if (again) continue;
        if (exact && audit()) { m.restarts++; continue; }
        break;
      }
      // A chip that would stand for ONE number: the number itself is written in the chip's place, with its line to
      // its candle, where that keeps every rule. It has to be the outermost of its stack in the reading order (no
      // longer timeframe is written nearer the candle than it would stand) and stand in the stack's alignment, its
      // stack shows fewer than K, no more important 13 is folded in its columns
      // and no longer 13 of 2W or more within NEAR_PX, a 9 stands in no pile where a 13 has folded, and its box fits
      // at most one line beyond where the chip stood. The more important number first.
      if (exact && final) {
        const single = [];
        for (const c of sd.chips) { let n = 0, one = null; for (const st of stacks[dir]) if (st.chip === c) for (const it of st.list) if (it.fold) { n++; one = it; } if (n === 1) single.push([c, one]); }
        single.sort((p, q) => q[1].a.imp - p[1].a.imp || p[1].a.day - q[1].a.day);
        for (const [c, it] of single) {
          const st = it.st, cb = sd.boxes.find((b) => b.chip === c);
          if (!cb || st.kept.length >= K || st.kept.some((k) => k.a.j > it.a.j)) continue;
          const is13 = it.a.kind === 'C', lastKept = st.kept[st.kept.length - 1], was = [it.x, it.k0, it.k1, it.side, it.al];
          let u = null;
          cb.off = true;
          // (it joins its stack in the stack's own alignment, so that the stack stays one column with one line to its
          // day; a number that is the only one of its day may stand to one side, with a line of its own)
          for (const mode of st.kept.length ? [st.mode] : it.w > ppd + 4 ? ['c', 'l', 'r'] : ['c']) {
            alignBox(it, mode);
            if (is13) {
              if (underFolded(it)) continue;
              let nearLong = false;
              for (const x of mine) {
                if (x === it || !x.fold || x.a.kind !== 'C' || x.a.j < J_LONG || it.a.j >= x.a.j) continue;
                const xc = x.st.chip, xa = Math.min(x.cx, xc ? xc.x : x.cx) - NEAR_PX, xb = Math.max(x.cx, xc ? xc.x + xc.w : x.cx) + NEAR_PX;
                if (Math.min(it.x, it.cx) <= xb && xa <= Math.max(it.x + it.w, it.cx)) { nearLong = true; break; }
              }
              if (nearLong) continue;
            } else {
              let in13 = false;
              for (const y of mine) { if (!y.fold || y.a.kind !== 'C') continue; const [pa, pb] = pileOf(y); if (Math.min(it.c0, it.k0) <= pb && pa <= Math.max(it.c1, it.k1)) { in13 = true; break; } }
              if (in13 || sd.chips.some((o) => o !== c && o.is13 && o.k0 <= it.k1 && it.k0 <= o.k1)) continue;
            }
            const v = lowest(st, it.k0, it.k1, it.h, Math.max(Math.ceil(top(base, it.k0, it.k1)), lastKept ? lastKept.u + lastKept.h + 1 : -Infinity));
            if (v + it.h <= edge && v <= c.u + ROW) { u = v; break; }
          }
          if (u === null) { cb.off = false; [it.x, it.k0, it.k1, it.side, it.al] = was; continue; }
          it.fold = false; it.placed = true; it.u = u; it.far = u - st.own;
          addBox({ it, st, k0: it.k0, k1: it.k1, u, h: it.h });
          st.kept = [...st.kept, it]; st.chip = null; sd.chips.splice(sd.chips.indexOf(c), 1);
        }
      }
      // how far things reach beyond the plot's end, and whether a chip found no room
      let far = -Infinity;
      for (const b of sd.boxes) if (!b.off && b.u + b.h > far) far = b.u + b.h;
      for (const it of mine) if ((it.mode === 'mark' || (it.dem && all13)) && it.u + it.h > far) far = it.u + it.h;
      sd.need = Math.max(0, far - edge);
      for (const st of stacks[dir]) if (!st.chip && st.list.some((it) => it.fold)) sd.failed = true;
      return sd;
    };
    const NONE = { [BUY]: false, [SELL]: false };
    const place = (Y, final, reserve, exact) => {
      for (const it of m.items) { it.dem = false; it.fold = false; it.placed = false; it.chip = null; if (it.mode === 'mark') markBox(it); else if (it.mode === 'text') textBox(it); }
      m.passes++;
      return { [BUY]: placeSide(BUY, Y, final, reserve[BUY], exact), [SELL]: placeSide(SELL, Y, final, reserve[SELL], exact) };
    };

    // The price scale leaves the room the stacks need above and under the candles, in whole lines; the candles keep
    // at least two fifths of the height.
    const quant = (v) => BASE_M + Math.ceil(Math.max(0, v - BASE_M) / ROW) * ROW;
    let mT = BASE_M, mB = BASE_M, Y = null;
    const scale = () => { const yB = plotB - mB, ky = (yB - plotT - mT) / (fh - fl); Y = (v) => yB - (f(v) - fl) * ky; Y.ky = ky; Y.yB = yB; };
    const capOne = Math.floor(plotH * 0.38), capSum = Math.floor(plotH * 0.6);
    for (let pass = 0; pass < 6; pass++) {
      scale();
      const r = place(Y, false, NONE, false);
      let t = Math.min(capOne, quant(mT + r[SELL].need)), b = Math.min(capOne, quant(mB + r[BUY].need));
      if (t + b > capSum) { const k = capSum / (t + b); t = Math.max(BASE_M, Math.floor(t * k)); b = Math.max(BASE_M, Math.floor(b * k)); }
      if (t === mT && b === mB) break;
      mT = t; mB = b;
    }
    scale();
    // (a side whose chip found no room is placed again with its last line kept for the chips)
    let res = place(Y, true, NONE, true);
    if (res[BUY].failed || res[SELL].failed) res = place(Y, true, { [BUY]: res[BUY].failed, [SELL]: res[SELL].failed }, true);
    m.Y = Y; m.P = (y) => fi(fl + (Y.yB - y) / Y.ky); m.ys = { log, a: Y.yB + fl * Y.ky, b: Y.ky };   // y = a - b * (log ? ln(price) : price)
    const toY = (dir, u, h) => (dir === BUY ? u : -(u + h));
    // the chips: what each holds (the longest timeframe first), and what it says
    for (const dir of [BUY, SELL]) {
      for (const st of stacks[dir]) if (st.chip) { for (const it of st.list) if (it.fold) { st.chip.members.push(it); it.chip = st.chip; } st.chip.keys.add(st.key); }
      for (const c of res[dir].chips) {
        if (!c.members.length) continue;
        c.members.sort((p, q) => q.a.imp - p.a.imp || q.a.day - p.a.day || p.a.inner - q.a.inner);
        c.n13 = c.members.filter((it) => it.a.kind === 'C').length; c.n9 = c.members.length - c.n13;
        c.fams = [...new Set(c.members.filter((it) => it.a.kind === 'C').map((it) => it.a.f))].sort((p, q) => p - q);
        c.text = c.n13 ? `13 ${c.n13}개` : `9 ${c.n9}개`;
        c.y = toY(dir, c.u, c.h); c.lead = c.far + GAP >= ROW;
        m.chips.push(c);
      }
    }
    for (const it of m.items) {
      if (it.mode === 'none' || (it.dem && !all13)) { it.shown = it.a.kind === 'I' ? 'none' : 'strip'; it.x = it.y = it.w = it.h = 0; }
      else if (it.mode === 'mark' || it.dem) { it.shown = 'mark'; it.y = toY(it.a.dir, it.u, it.h); }
      else if (it.fold && it.chip) { const c = it.chip; it.shown = 'folded'; it.x = c.x; it.y = c.y; it.w = c.w; it.h = c.h; it.group = c.id; }
      else { it.shown = 'text'; it.y = toY(it.a.dir, it.u, it.h); it.lead = it.far + GAP >= ROW || Math.abs(it.side) > LEAD_SIDE; }
    }
    // a number that stands right on a number of its own stack needs no line of its own: the stack has one, from the
    // candle to the first of them (the same for the chip a stack ends with)
    const onTop = (b, prev) => !!prev && Math.abs(b.u - (prev.u + prev.h + 1)) <= 1 && Math.min(b.x + b.w, prev.x + prev.w) - Math.max(b.x, prev.x) >= 8;
    for (const dir of [BUY, SELL]) for (const st of stacks[dir]) {
      let prev = null;
      for (const it of st.kept) { if (onTop(it, prev)) it.lead = false; prev = it; }
      if (st.chip && st.chip.st === st && onTop(st.chip, prev)) st.chip.lead = false;
    }
    // price lines: none above the window's highest high or under its lowest low
    m.pTicks = m.none ? [] : priceTicks(m.P(plotB), m.P(plotT), log, Math.max(3, Math.round(plotH / 62)), lo, hi).filter((v) => v <= hi && v >= lo).map((v) => ({ v, y: Y(v) })).filter((t) => t.y >= plotT + 7 && t.y <= plotB - 7);

    // ---- 다음 봉 조건: every next-bar trigger of the timeframes, families and sides shown that one move of the price can meet ----
    const conds = m.conds;
    if (condOn) {
      for (const x of cur.det.tfs) {
        if (!tfOn(x.j)) continue;
        for (const t of x.trigs) {
          const is13 = t.k === 'C13';
          if (!t.fire || !dirOn(t.d) || (is13 ? !BE.famOn(t.f) : S.nine !== 'on')) continue;
          const near = !t.fire.now && Math.abs(t.fire.pct) <= S.near / 100;
          conds.push({ x, j: x.j, tf: x.tf, trig: t.t, k: t.k, d: t.d, f: is13 ? t.f : null, o: t.o, fire: t.fire, is13, rep: t.k === 'S9r',
            near, style: t.fire.now ? 'now' : near ? 'near' : 'far', shown: small ? 'list' : '', bx: 0, by: 0, bw: 0, bh: COND_H, t: 0, cy: 0, qy: null });
        }
      }
      // "지금 값으로 충족" first, then the nearest first
      conds.sort((p, q) => Number(q.fire.now) - Number(p.fire.now) || Math.abs(p.fire.pct) - Math.abs(q.fire.pct) || p.j - q.j || (p.f == null ? -1 : p.f) - (q.f == null ? -1 : q.f));
    }
    if (zone) {
      const zx0 = plotR, zx1 = W - 2, chipX = zx0 + 20, last = cur.det.last, yC = Y(last);
      for (const q of conds) {
        q.nw = tw(FONT.cond, q.is13 ? '13' : '9'); q.bw = Math.ceil(q.nw + 1 + tw(FONT.condSup, q.tf)) + 8; q.bx = chipX;
        q.t = Y(q.fire.now ? last : q.fire.p);
        q.shown = q.t < plotT + 5 ? 'above' : q.t > plotB - 5 ? 'below' : 'in';
      }
      // beyond the price range: counted in one line at that edge. More conditions inside than the zone holds (not seen
      // with real data): the farthest from the current price joins the line of its edge.
      const near1st = (p, q) => Math.abs(p.fire.pct) - Math.abs(q.fire.pct);
      const up = conds.filter((q) => q.shown === 'above'), dn = conds.filter((q) => q.shown === 'below');
      const ins = conds.filter((q) => q.shown === 'in').sort((p, q) => p.t - q.t);
      let over = { up: 0, dn: 0 };
      for (;;) {
        const yLo = plotT + 19 + (up.length ? EDGE_LINE : 0) + COND_H / 2, yHi = plotB - 4 - (dn.length ? EDGE_LINE : 0) - COND_H / 2;
        if (!ins.length || (ins.length - 1) * COND_PITCH <= yHi - yLo) { spread(ins, yLo, Math.max(yLo, yHi), COND_PITCH); break; }
        let far = 0; for (let i = 1; i < ins.length; i++) if (Math.abs(ins[i].fire.pct) > Math.abs(ins[far].fire.pct)) far = i;
        const q = ins.splice(far, 1)[0];
        if (q.t < yC) { q.shown = 'above'; up.push(q); over.up++; } else { q.shown = 'below'; dn.push(q); over.dn++; }
      }
      for (const q of ins) { q.by = Math.round(q.cy - COND_H / 2); const fr = q.fire; q.qy = !fr.now && fr.q !== fr.p ? clamp(Y(fr.q), plotT, plotB) : null; }
      for (const [list, above, extra] of [[up, true, over.up], [dn, false, over.dn]]) {
        if (!list.length) continue;
        list.sort(near1st);
        const text = `${above ? '▲' : '▼'} ${extra ? '그 밖의 조건' : '범위 밖'} ${list.length}개`;
        const e = { above, list, text, x: chipX, y: above ? plotT + 19 : plotB - 4 - EDGE_LINE, w: Math.ceil(tw(FONT.small, text)) + 4, h: EDGE_LINE };
        for (const q of list) { q.bx = e.x; q.by = e.y; q.bw = e.w; q.bh = e.h; }
        m.edges.push(e);
      }
      m.zx = { x0: zx0, x1: zx1, chipX, yC, last, ins };
    }
    m.ms = performance.now() - t0;
  }

  // ---------- the chart: drawing ----------
  // a number: its text and the timeframe as a superscript, on a ground of the surface color. One that TradingView has
  // deleted: fainter, with a dotted line under it.
  function drawNumber(ctx, it) {
    const a = it.a, def = a.kind === 'I', base = it.y + (def ? Z.baseDef : Z.base), al = alphaOf(a), col = colorOf(a);
    ctx.globalAlpha = 0.86; ctx.fillStyle = C.surface; ctx.fillRect(it.x, it.y, it.w, it.h);
    ctx.globalAlpha = al; ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = numFont(a.kind); ctx.fillText(a.text, it.x + 1, base);
    ctx.font = supFont(a.kind); ctx.fillText(a.tf, it.x + 2 + it.nw, base - (def ? Z.riseDef : Z.rise));
    if (a.gone) {
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([1, 2]);
      ctx.beginPath(); ctx.moveTo(it.x + 1, it.y + it.h - 0.5); ctx.lineTo(it.x + it.w - 1, it.y + it.h - 0.5); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }
  // the chip of folded numbers: what it holds, "13 7개" with a small square per family in it, or "9 3개"
  function drawChip(ctx, c) {
    ctx.globalAlpha = 1; ctx.fillStyle = C.sunken; roundRect(ctx, c.x, c.y, c.w, c.h, 3.5); ctx.fill();
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; roundRect(ctx, c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1, 3); ctx.stroke();
    const font = chipFont(), sq = c.n13 ? c.fams.length * 4 + 1 : 0, cy = c.y + c.h / 2;
    let x = Math.round(c.x + (c.w - sq - tw(font, c.text)) / 2);
    if (c.n13) for (const f of c.fams) { ctx.fillStyle = INK[f]; ctx.fillRect(x, Math.round(cy - 2.5), 3, 5); x += 4; }
    ctx.fillStyle = c.n13 ? C.fg : C.muted; ctx.font = font; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(c.text, x + (sq ? 1 : 0), cy + 0.5);
  }
  // The mark of a condition that is waiting. far: beyond the 임박 threshold, the number in its color at 70% in a 1 px
  // dashed frame, no ground. near: within it, a solid frame on a light ground. now: met as things are, filled.
  function drawWait(ctx, q) {
    const col = q.is13 ? INK[q.f] : INK9, a = q.rep ? 0.8 : 1, st = q.style, x = q.bx, y = q.by, w = q.bw, h = q.bh, lw = st === 'near' ? 1.5 : 1;
    if (st !== 'far') {
      ctx.globalAlpha = 1; ctx.fillStyle = C.surface; roundRect(ctx, x, y, w, h, 3.5); ctx.fill();
      ctx.globalAlpha = a * (st === 'now' ? 1 : 0.22); ctx.fillStyle = col; roundRect(ctx, x, y, w, h, 3.5); ctx.fill();
    }
    ctx.globalAlpha = a * (st === 'far' ? 0.7 : 1); ctx.strokeStyle = col; ctx.lineWidth = lw;
    if (st === 'far') ctx.setLineDash([2.5, 1.5]);
    roundRect(ctx, x + lw / 2, y + lw / 2, w - lw, h - lw, 3.5 - lw / 2); ctx.stroke();
    ctx.setLineDash([]); ctx.lineWidth = 1;
    ctx.fillStyle = st === 'now' ? inkOn(col) : st === 'near' ? C.fg : col; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = FONT.cond; ctx.fillText(q.is13 ? '13' : '9', x + 4, y + 11.3);
    ctx.font = FONT.condSup; ctx.fillText(q.tf, x + 5 + q.nw, y + 7.6);
    ctx.globalAlpha = 1;
  }
  // where the line from a number to its day begins: just outside the day's candle
  function candleEnd(a) { const i = a.day - cur.d.d0; return a.dir === BUY ? M.Y(cur.d.l[i]) + 1.5 : M.Y(cur.d.h[i]) - 1.5; }
  // The line from a number's box b (or a chip's) to its day: 1 px, with a 3 px dot where it leaves the candle; straight
  // where the box reaches over the day, else to the nearest end of the box. pointer: a box that stands beside its day
  // gets a small pointer in this color at the line's end, so that the day is read off the pointer.
  function drawLeader(ctx, a, b, line, alpha, pointer) {
    const cx = M.X(a.day), yc = candleEnd(a), buy = a.dir === BUY, y = buy ? b.y : b.y + b.h;
    const x = clamp(cx, b.x + 3, b.x + b.w - 3), straight = Math.abs(x - cx) < 0.01, sx = Math.round(cx) + 0.5, ex = straight ? sx : x;
    ctx.globalAlpha = alpha; ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(sx, yc); ctx.lineTo(ex, y); ctx.stroke();
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(sx, yc); ctx.lineTo(sx, yc + 0.01); ctx.stroke();
    ctx.lineCap = 'butt'; ctx.lineWidth = 1;
    if (pointer) {
      ctx.globalAlpha = 1; ctx.fillStyle = pointer;
      ctx.beginPath(); ctx.moveTo(ex - 2.5, y); ctx.lineTo(ex + 2.5, y); ctx.lineTo(ex, y + (buy ? -4 : 4)); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  const LEAD_ALPHA = 0.8;
  function paintChart() {
    const m = M, dpr = window.devicePixelRatio || 1, size = `${m.W}x${m.H}@${dpr}`;
    let ctx;
    if (size !== sized.c) { sized.c = size; ui.chart.style.height = m.H + 'px'; ctx = BE.setupCanvas(ui.cBase, m.W, m.H); BE.setupCanvas(ui.cOver, m.W, m.H); }
    else { ctx = ui.cBase.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    const { W, H, plotL, plotR, plotT, plotB, ppd, X, Y, d0, d1 } = m, D = cur.d, b0 = D.d0, dark = BE.isDark();
    ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
    ctx.fillStyle = C.surface; ctx.fillRect(0, 0, W, H);
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
    m.dLabels.length = 0;
    for (const t of m.dTicks) {
      // a day tick carries its year when it is the first one written or the year has changed
      const x = plotL + m.padL + (t.d - d0 + t.at) * ppd, text = t.full && t.full.slice(0, 4) !== year ? t.full : t.text, half = tw(axisFont, text) / 2;
      ctx.fillStyle = C.line; ctx.fillRect(Math.round(x), plotB, 1, 4);
      if (x - half < plotL || x + half > plotR || x - half < lastX + 12) continue;
      ctx.fillStyle = C.muted; ctx.fillText(text, x, plotB + AXIS_H / 2 + 2); lastX = x + half;
      m.dLabels.push({ x0: x - half, x1: x + half, text });
      if (t.full) year = t.full.slice(0, 4);
    }
    if (m.none) {
      ctx.fillStyle = C.muted; ctx.font = FONT.note; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('이 기간에는 TradingView 일봉이 없습니다.', (plotL + plotR) / 2, (plotT + plotB) / 2);
    }
    // candles, neutral so that the colors of the numbers carry the meaning: a rising day hollow and light, a falling day
    // filled (on the dark theme at a lower strength, so that the candles are quieter than the numbers); snapped to
    // device pixels. Thinner as the days get narrower, at last a band with the close as a line.
    const snap = (v) => Math.round(v * dpr) / dpr, one = Math.max(1, Math.round(dpr)) / dpr;
    const soft = C.faint, hard = C.fg, aSoft = dark ? 0.95 : 0.66, aHard = dark ? 0.42 : 0.8;
    const lod = m.lod.candle;
    if (lod === 'line') {
      const nCol = m.colLo.length, close = new Float64Array(nCol).fill(NaN);
      for (let d = d0; d <= d1; d++) { const i = d - b0; if (D.c[i] != null) close[clamp(Math.floor(m.padL + (d - d0 + 0.5) * ppd), 0, nCol - 1)] = D.c[i]; }
      ctx.fillStyle = soft; ctx.globalAlpha = dark ? 0.5 : 0.36;
      for (let k = 0; k < nCol; k++) if (m.colLo[k] === m.colLo[k]) { const yh = Y(m.colHi[k]); ctx.fillRect(plotL + k, yh, 1, Math.max(1, Y(m.colLo[k]) - yh)); }
      ctx.globalAlpha = dark ? 0.6 : 0.8; ctx.strokeStyle = hard; ctx.lineWidth = 1; ctx.beginPath();
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
    // lines from the numbers that stand away from their candle, under everything they pass: neutral, the pointer of a
    // number beside its day in the number's color
    for (const it of m.items) if (it.shown === 'text' && it.lead) drawLeader(ctx, it.a, it, LEAD, LEAD_ALPHA, Math.abs(it.side) > LEAD_SIDE ? colorOf(it.a) : null);
    for (const c of m.chips) if (c.lead) drawLeader(ctx, c, c, LEAD, LEAD_ALPHA, null);
    // marks (one of a label that TradingView has deleted: an outline), then numbers (+13, 9, 13), then the chips of folded numbers
    for (const it of m.items) {
      if (it.shown !== 'mark') continue;
      const a = it.a, al = a.kind === 'C' ? 1 : a.kind === 'S' ? (a.rep ? 0.6 : 0.9) : 0.55;
      if (a.gone) { ctx.globalAlpha = al * 0.7; ctx.strokeStyle = colorOf(a); ctx.lineWidth = 1; ctx.strokeRect(it.x + 0.5, it.y + 0.5, it.w - 1, it.h - 1); }
      else { ctx.globalAlpha = al; ctx.fillStyle = colorOf(a); ctx.fillRect(it.x, it.y, it.w, it.h); }
    }
    ctx.globalAlpha = 1;
    for (const kind of ['I', 'S', 'C']) for (const it of m.items) if (it.shown === 'text' && it.a.kind === kind) drawNumber(ctx, it);
    for (const c of m.chips) drawChip(ctx, c);
    // nothing to show because every timeframe is switched off: said in the plot
    if (m.empty && !m.none) {
      const text = '켜 둔 타임프레임이 없어서 보여 줄 숫자가 없습니다.', cx = (plotL + plotR) / 2, w = tw(FONT.note, text) + 16;
      ctx.globalAlpha = 0.9; ctx.fillStyle = C.surface; roundRect(ctx, cx - w / 2, plotT + 8, w, 24, 6); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = C.muted; ctx.font = FONT.note; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, cx, plotT + 20.5);
    }
  }
  // 다음 봉 조건: a line at the last day and the small title; the newest close as a dashed line with its price; per
  // condition inside the price range its mark at its price, with a pointer from the exact price and its distance;
  // the conditions beyond the range as one muted line per edge
  function paintZone(ctx) {
    const m = M, z = m.zx, { plotT, plotB } = m;
    ctx.fillStyle = C.line; ctx.fillRect(z.x0, plotT, 1, plotB - plotT);
    ctx.font = FONT.zone; ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    // (the title and the lines of the edges stand in the chips' column: the pointers run in the gutter before it)
    ctx.fillText('다음 봉 조건', m.conds.length ? z.chipX : z.x0 + 8, plotT + 10);
    const inside = z.yC >= plotT + 1 && z.yC <= plotB - 1, yC = Math.round(z.yC) + 0.5;
    const distText = (q) => (q.fire.now ? '충족' : fmtPct(q.fire.pct)), distFont = (q) => (q.fire.now ? FONT.small : q.near ? FONT.pctB : FONT.pct);
    if (inside) {
      ctx.strokeStyle = C.muted; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      // (where a chip and its text stand on this line, the line stops before them and goes on after them)
      const on = z.ins.filter((q) => q.by - 2 < z.yC && z.yC < q.by + q.bh + 2);
      const gapR = on.length ? Math.max(...on.map((q) => q.bx + q.bw + 7 + tw(distFont(q), distText(q)))) : 0;
      ctx.beginPath(); ctx.moveTo(m.X(m.d1) + m.ppd / 2 + 1, yC); ctx.lineTo(on.length ? z.x0 + 4 : z.x1, yC);
      if (on.length && gapR < z.x1 - 4) { ctx.moveTo(gapR, yC); ctx.lineTo(z.x1, yC); }
      ctx.stroke(); ctx.setLineDash([]);
      // the price: over the line at its right end, or under it; where conditions stand there, at the nearest free place
      // within two lines, else not written (the page's first row has it); as short as it has to be to fit
      const room = (s) => tw(FONT.tag, s) <= 64, full = fmtPrice(z.last), text = room(full) ? full : axisText(z.last, room), tx0 = z.x1 - 3 - tw(FONT.tag, text);
      const busy = [...z.ins.filter((q) => q.bx + q.bw + 4 + tw(distFont(q), distText(q)) > tx0 - 4).map((q) => [q.by - 1, q.by + q.bh + 1]), ...m.edges.map((e) => [e.y, e.y + e.h])];
      const free = (cy) => cy - 6 >= plotT + 18 && cy + 6 <= plotB - 2 && !busy.some(([a, b]) => cy + 6 > a && cy - 6 < b);
      let ty = null;
      for (let k = 0; k <= 5 && ty === null; k++) for (const cy of [yC - 7.5 - k * 6, yC + 8.5 + k * 6]) if (free(cy)) { ty = cy; break; }
      if (ty !== null) { ctx.font = FONT.tag; ctx.fillStyle = C.fg; ctx.textAlign = 'right'; ctx.fillText(text, z.x1 - 3, ty); }
    }
    if (!m.conds.length) {
      ctx.font = FONT.small; ctx.fillStyle = C.muted; ctx.textAlign = 'left';
      (m.empty ? ['켜 둔 타임프레임이', '없습니다.'] : ['지금은 9나 13이 나올', '조건이 없습니다.']).forEach((s, i) => ctx.fillText(s, z.x0 + 8, plotT + 30 + i * 14));
      return;
    }
    for (const q of z.ins) {
      const col = q.is13 ? INK[q.f] : INK9, cy = q.by + q.bh / 2, py = Math.round(clamp(q.t, plotT, plotB)) + 0.5, al = (q.rep ? 0.8 : 1) * (q.style === 'far' ? 0.6 : 1);
      // the pointer: from the exact price at the zone's edge to the mark
      ctx.strokeStyle = ctx.fillStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = al;
      ctx.beginPath(); ctx.moveTo(z.x0 + 1, py); ctx.lineTo(z.x0 + 8, py); ctx.lineTo(q.bx - 1, cy); ctx.stroke();
      if (q.fire.now) { ctx.beginPath(); ctx.arc(z.x0 + 8, py, 2.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      drawWait(ctx, q);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = distFont(q); ctx.fillStyle = q.fire.now || q.near ? C.fg : C.muted;
      ctx.fillText(distText(q), q.bx + q.bw + 4, cy + 0.5);
    }
    ctx.font = FONT.small; ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const e of m.edges) ctx.fillText(e.text, e.x, e.y + e.h / 2 + 0.5);
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
  const drawn = (it) => it.shown === 'text' || it.shown === 'mark' || it.shown === 'folded';
  // what stands at a point of the chart: a number (or its mark), a chip of folded numbers, a condition, the line of
  // an edge's conditions, or the day; slack: how far outside a box still counts (a finger is less exact)
  function hitAt(x, y, slack = 0) {
    const m = M; if (!m) return null;
    const inBox = (b, pad) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
    if (m.zone && x >= m.zx.x0) {
      for (const q of m.zx.ins) if (x >= q.bx - 3 - slack && x <= m.zx.x1 && y >= q.by - 1 - slack && y <= q.by + q.bh + 1 + slack) return { type: 'cond', q };
      for (const e of m.edges) if (inBox(e, 2 + slack)) return { type: 'edge', e };
      return { type: 'zone' };
    }
    for (const it of m.items) if (it.shown === 'text' && inBox(it, slack)) return { type: 'label', it };
    for (const c of m.chips) if (inBox(c, slack)) return { type: 'chip', chip: c };
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
      if (m.zone) { for (const q of m.zx.ins) out.push({ type: 'cond', q, y: q.by }); for (const e of m.edges) out.push({ type: 'edge', e, y: e.y }); }
    } else {
      const [s, e] = colDays(cursor.day);
      for (const it of m.items) if (drawn(it) && it.a.day >= s && it.a.day <= e) out.push({ type: 'label', it, y: it.y + (it.shown === 'folded' ? 0.5 : 0) });
      for (const c of m.chips) if (c.day >= s && c.day <= e) out.push({ type: 'chip', chip: c, y: c.y });
    }
    return out.sort((p, q) => p.y - q.y);
  }
  const picked = () => (cursor && cursor.pick != null ? thingsAt()[cursor.pick] || null : null);
  const sameCond = (p, q) => p.j === q.j && p.k === q.k && p.d === q.d && p.f === q.f && p.o === q.o;
  // the number or condition a click or a tap chose, in the picture as it is now
  function pinnedThing() {
    if (!pinned || !M) return null;
    if (pinned.type === 'label') { const it = M.items.find((x) => x.a === pinned.a); return it && drawn(it) ? { type: 'label', it } : null; }
    if (pinned.type === 'edge') { const e = M.edges.find((x) => x.above === pinned.above); return e ? { type: 'edge', e } : null; }
    const q = M.conds.find((x) => sameCond(x, pinned.q)); return q && q.shown === 'in' ? { type: 'cond', q } : null;
  }
  const isPinned = (t) => !!pinned && !!t && pinned.type === t.type && (t.type === 'label' ? pinned.a === t.it.a : t.type === 'cond' ? sameCond(pinned.q, t.q) : t.type === 'edge' ? pinned.above === t.e.above : false);
  // what is emphasized: the thing under the mouse, else the keyboard's choice, else the pinned one
  const focusThing = () => (hover && hover.type !== 'day' ? hover : picked() || pinnedThing());
  // the label whose bar, tick and origin bars are marked: the one pointed at in the strip, else the emphasized one
  function activeLabel() { if (shover && shover.a) return shover.a; const t = focusThing(); return t && t.type === 'label' ? t.it.a : null; }

  // ---------- the layer over the chart: crosshair, the keyboard's day, the emphasized thing ----------
  function paintOver() {
    const m = M, ctx = ui.cOver.getContext('2d'), dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, m.W, m.H); ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.lineCap = 'butt';
    const { plotL, plotR, plotT, plotB, X, ppd } = m, dark = BE.isDark();
    // the date under the crosshair or the keyboard's day; an axis label within 4 px of it is covered
    const dateTag = (day, bg, fg) => {
      const text = iso(day); ctx.font = FONT.tag;
      const w = ctx.measureText(text).width + 10, x = clamp(X(day) - w / 2, plotL, Math.max(plotL, plotR - w));
      ctx.fillStyle = C.surface;
      for (const L of m.dLabels) if (L.x0 < x + w + 4 && x - 4 < L.x1) ctx.fillRect(L.x0 - 1, plotB + 1, L.x1 - L.x0 + 2, AXIS_H - 1);
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
    // the label that is pointed at (here or in the strip), chosen or pinned: the days of its timeframe bar as a soft
    // band, the origin bars of a 13 as dashed lines, its line to its day and a ring
    const a = activeLabel();
    if (a) {
      const it = m.items.find((x) => x.a === a), col = a.kind === 'S' ? C.fg : INK[a.f];
      const xs = X(a.s) - ppd / 2, xe = X(a.e) + ppd / 2, xa = Math.max(plotL, xs), xb = Math.min(plotR, xe);
      if (xb > xa) {
        ctx.fillStyle = C.accent; ctx.globalAlpha = dark ? 0.16 : 0.09; ctx.fillRect(xa, plotT, xb - xa, plotB - plotT);
        ctx.globalAlpha = 0.7;
        if (xs >= plotL) ctx.fillRect(Math.round(xs), plotT, 1, plotB - plotT);
        if (xe <= plotR) ctx.fillRect(Math.round(xe) - 1, plotT, 1, plotB - plotT);
        ctx.globalAlpha = 1;
      }
      if (a.kind !== 'S') {
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = 0.85; ctx.setLineDash([4, 3]);
        for (const od of originDays(a)) { if (od < m.d0 || od > m.d1) continue; const ox = Math.round(X(od)) + 0.5; ctx.beginPath(); ctx.moveTo(ox, plotT); ctx.lineTo(ox, plotB); ctx.stroke(); }
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      if (it && it.shown === 'text') { if (it.lead) drawLeader(ctx, a, it, col, 0.95, Math.abs(it.side) > LEAD_SIDE ? col : null); ring(it, col); }
      else if (it && it.shown === 'mark') ring(it, C.fg, 2);
      else if (it && it.shown === 'folded') ring(it, C.fg);
    }
    const t = focusThing();
    if (t && t.type === 'chip') ring(t.chip, C.fg);
    else if (t && t.type === 'edge' && m.zone) ring(t.e, C.fg, 1.5);
    else if (t && t.type === 'cond' && m.zone && t.q.shown === 'in') {
      // its price across the chart, and the level the close has to keep after that: across the chart as a dotted
      // line, and down the zone's edge from the price to it
      const q = t.q, col = q.is13 ? INK[q.f] : INK9, py = Math.round(clamp(q.t, plotT, plotB)) + 0.5, fr = q.fire;
      ring({ x: q.bx, y: q.by, w: q.bw, h: q.bh }, C.fg);
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = 0.9; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(plotL, py); ctx.lineTo(m.zx.x0, py); ctx.stroke(); ctx.setLineDash([]);
      let qy = null;
      if (q.qy != null) {
        qy = Math.round(q.qy) + 0.5;
        const rail = m.zx.x0 + 4.5, inPlot = fr.qpct !== 0 && m.Y(fr.q) >= plotT && m.Y(fr.q) <= plotB;
        ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(rail, py); ctx.lineTo(rail, qy); ctx.stroke();
        if (inPlot) {
          ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(rail - 3.5, qy); ctx.lineTo(rail + 3.5, qy); ctx.stroke(); ctx.lineWidth = 1;
          ctx.globalAlpha = 0.7; ctx.setLineDash([1.5, 3]); ctx.beginPath(); ctx.moveTo(plotL, qy); ctx.lineTo(m.zx.x0, qy); ctx.stroke(); ctx.setLineDash([]);
        } else qy = null;
      }
      ctx.globalAlpha = 1;
      if (qy != null && Math.abs(qy - py) >= 16) priceTag(qy, fr.qc ? fr.qc.v : fr.q, C.surface, C.muted, col);
      priceTag(py, fr.now ? m.zx.last : fr.pc ? fr.pc.v : fr.p, C.surface, C.fg, col);
    }
    if (hover && hover.type === 'day') {
      // the price line only where the pointer is at a price (under zero on a linear scale there is none)
      const cx = Math.round(X(hover.day)) + 0.5, price = hover.y != null ? m.P(hover.y) : 0;
      ctx.strokeStyle = C.muted; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(cx, plotT); ctx.lineTo(cx, plotB); ctx.stroke();
      if (price > 0) { const hy = Math.round(hover.y) + 0.5; ctx.beginPath(); ctx.moveTo(plotL, hy); ctx.lineTo(plotR, hy); ctx.stroke(); }
      ctx.setLineDash([]);
      dateTag(hover.day, C.fg, C.surface);
      if (price > 0) priceTag(hover.y, price, C.fg, C.surface, null);
    }
  }

  // ---------- tooltips ----------
  // what a label is, in the words of the study's sheets
  function labelWhat(a) {
    if (a.kind === 'C') return `${FAM_NAME[a.f]} ${sideKo(a.dir)} 13 완성`;
    if (a.kind === 'I') return `${FAM_NAME[a.f]} ${sideKo(a.dir)} 13이 미뤄진 봉`;
    return a.rep ? `${sideKo(a.dir)} 반복 9 (셋업 ${a.L.raw})` : `${sideKo(a.dir)} 셋업 9${a.text === '9*' ? ' (퍼펙트)' : ''}`;
  }
  const originText = (a) => { const b = cur.det.tfs[a.j].bars, L = a.L; return a.kind === 'C' ? L.origins.map((o) => iso(b.start[o])).join(', ') : a.kind === 'I' ? iso(b.start[L.origin]) : ''; };
  const goneText = () => `TradingView 차트에서는 지워진 라벨입니다. 지표는 차트마다 라벨을 최근 ${BE.OPT.labelLimit}개까지만 남깁니다.`;
  const chartLink = (tf) => { const a = el('a', 'bec-tip-link', `TradingView ${tf} 차트 ↗`); a.href = BE.tvUrl(cur.c.usd, tf); a.target = '_blank'; a.rel = 'noopener'; return a; };
  // A number's tooltip: line 1 the number as drawn and what it is, line 2 its bar, line 3 the origin bars of a 13.
  // Where it stands is said only when that is not the bar's last day. link: with the link to its TradingView chart
  // (the tooltip is pinned, or the keyboard chose the number: a second click or Enter opens it).
  function labelTip(a, it, how) {
    const out = [row(numEl(a), `· ${labelWhat(a)}`), row(`${a.tf} 봉 ${spanText(a.s, a.e)}`)];
    if (a.kind !== 'S') out.push(row(muted(`출발 봉 ${originText(a)}`)));
    if (a.late) out.push(el('div', 'm', `봉의 마지막 날 ${iso(a.e)}에는 일봉이 없어서, 숫자는 ${dayText(a.day)}에 있습니다.`));
    if (a.kind === 'C' && /r/.test(a.text)) out.push(el('div', 'm', 'r은 셋업이 18 이상 이어진 뒤에 나온 13이라는 표시입니다.'));
    if (it && it.shown === 'folded') out.push(el('div', 'm', '자리가 모자라 접힌 숫자입니다.'));
    if (a.gone) out.push(el('div', 'm', goneText()));
    if (how === 'pin' || how === 'key') out.push(chartLink(a.tf));
    return out;
  }
  // rows of labels for the day's list: the number as the chart writes it, what it is, and its bar
  function labelRows(list, max) {
    const box = el('div', 'sec');
    for (const a of list.slice(0, max)) box.append(row(numEl(a), labelWhat(a), muted(`${a.tf} 봉 ${spanText(a.s, a.e)}`)));
    if (list.length > max) box.append(el('div', 'm', `${list.length - max}개가 더 있습니다.`));
    return box;
  }
  // a chip's tooltip: the first lines of its list (the longest timeframe first), one line a number
  const CHIP_ROWS = 8;
  function chipTip(chip) {
    const box = el('div', 'sec'), list = chip.members.map((it) => it.a);
    for (const a of list.slice(0, CHIP_ROWS)) box.append(row(numEl(a), muted(spanText(a.s, a.e))));
    if (list.length > CHIP_ROWS) box.append(el('div', 'm', `${list.length - CHIP_ROWS}개가 더 있습니다.`));
    return [el('div', 'h1', `접힌 숫자 ${list.length}개`), box];
  }
  function dayTip(day) {
    const d = cur.d, i = day - d.d0, [s, e] = colDays(day), out = [el('div', 'h1', dayText(day))];
    if (d.c[i] != null) {
      // open, high, low, close: each with its name on one line, rounded to the coin's price step
      const r = el('div', 'row num');
      for (const [k, v] of [['시', d.o[i]], ['고', d.h[i]], ['저', d.l[i]], ['종', d.c[i]]]) { const sp = el('span'); sp.style.whiteSpace = 'nowrap'; sp.append(el('span', 'm', k), ` ${tickPrice(v)}`); r.append(sp); }
      out.push(r);
    }
    else out.push(el('div', 'm', '이 날짜에는 TradingView 일봉이 없습니다.'));
    const list = labelsAt(s, e);
    if (e > s) out.push(el('div', 'm', `화면의 이 한 칸에는 ${iso(s)}부터 ${iso(e)}까지 ${e - s + 1}일이 겹쳐 있습니다.`));
    if (list.length) { out.push(labelRows(list, 14)); if (list.some((a) => a.gone)) out.push(el('div', 'bec-tip-foot', '이 가운데에는 TradingView 차트에서 지워진 라벨이 있습니다.')); }
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
    const out = [el('div', 'h1', `${q.tf} · ${condName(q)}`), r, el('div', 'm', condSentence(q)), row(muted(condMeta(q)))];
    if (how === 'pin' || how === 'key') out.push(chartLink(q.tf));
    return out;
  }
  function condRows(list, max) {
    const box = el('div', 'sec');
    for (const q of list.slice(0, max)) box.append(row(waitEl(q), condName(q), el('span', 'num', BE.fireText(q.fire))));
    if (list.length > max) box.append(el('div', 'm', `${list.length - max}개가 더 있습니다.`));
    return box;
  }
  const edgeTip = (e) => [el('div', 'h1', `${e.above ? '위쪽' : '아래쪽'} 조건 ${e.list.length}개`), el('div', 'm', e.above ? '조건가가 차트의 가격 범위보다 위에 있는 조건입니다.' : '조건가가 차트의 가격 범위보다 아래에 있는 조건입니다.'), condRows(e.list, 12)];
  function zoneTip() {
    const out = [el('div', 'h1', '다음 봉 조건'), el('div', 'm', `최근 종가 ${fmtPrice(cur.det.last)} (${iso(LAST)} 마감)`)];
    if (M.conds.length) out.push(condRows(M.conds, 12)); else out.push(el('div', 'm', M.empty ? '켜 둔 타임프레임이 없습니다.' : '지금은 9나 13이 나올 조건이 없습니다.'));
    return out;
  }
  function tipOf(t, how) {
    return t.type === 'label' ? labelTip(t.it.a, t.it, how) : t.type === 'chip' ? chipTip(t.chip) : t.type === 'cond' ? condTip(t.q, how) : t.type === 'edge' ? edgeTip(t.e) : t.type === 'day' ? dayTip(t.day) : null;
  }
  const boxOf = (t) => (t.type === 'label' ? t.it : t.type === 'chip' ? t.chip : t.type === 'edge' ? t.e : t.type === 'cond' ? { x: t.q.bx, y: t.q.by, w: t.q.bw, h: t.q.bh } : null);
  // a tooltip in words (for the live region): its blocks as sentences, the parts of a block with a space between them
  // (a block that is a sentence already keeps its one full stop)
  const wordsOf = (n) => (n.children && n.children.length && !/^(B|A|SUP)$/.test(n.tagName) ? [...n.childNodes].map(wordsOf).filter(Boolean).join(' ') : n.textContent.replace(/\s+/g, ' ').trim());
  const sayOf = (nodes) => nodes.map(wordsOf).filter(Boolean).map((t) => t.replace(/[.]$/, '')).join('. ');
  // Where a tooltip stands. A number's: beside its stack (right of the widest box of its day and side, left where the
  // window ends), so that it covers no number of that day and side. A condition's: left of the zone. A finger's:
  // above the finger. Otherwise next to the pointer.
  let tipKey = '';
  function hideTip() { tipKey = ''; BE.tip.hide(); if (BE.tip.el) BE.tip.el.classList.remove('bec-pin'); }
  function showTip(nodes, where, pin) {
    const t = BE.tip.el; if (t) t.classList.toggle('bec-pin', !!pin);
    if (where.touch) BE.tip.at(nodes, (w, h) => { const top = where.touch.y - h - 22; return [where.touch.x - w / 2, top >= 8 ? top : where.touch.y + 28]; });
    else if (where.x0 != null) {
      const r = ui.cOver.getBoundingClientRect(), vw = document.documentElement.clientWidth;
      BE.tip.at(nodes, (w, h) => { let x = r.left + where.x1 + 12; if (where.left || x + w > vw - 8) x = r.left + where.x0 - 12 - w; return [x, r.top + where.cy - h / 2]; });
    } else BE.tip.show(where.x, where.y, nodes);
  }
  // the tooltip of a thing of the chart, where it belongs; touch: the finger's place
  function showThing(t, how, touch) {
    const nodes = tipOf(t, how); if (!nodes) { hideTip(); return; }
    const b = boxOf(t), pin = how === 'pin';
    if (touch) { showTip(nodes, { touch }, pin); return; }
    let x0 = b.x, x1 = b.x + b.w;
    if (t.type === 'label') for (const it of M.items) if (it.shown === 'text' && it.a.day === t.it.a.day && it.a.dir === t.it.a.dir) { x0 = Math.min(x0, it.x); x1 = Math.max(x1, it.x + it.w); }
    showTip(nodes, { x0, x1, cy: b.y + b.h / 2, left: t.type === 'cond' || t.type === 'edge' }, pin);
  }
  const openChart = (tf) => { try { window.open(BE.tvUrl(cur.c.usd, tf), '_blank', 'noopener'); } catch (e) { /* a host that allows no new window */ } };

  // ---------- the list of a chip: pinned beside it, the chart stays as it is ----------
  function closeList() { if (ui && ui.list) { ui.list.remove(); ui.list = null; } listOf = null; }
  function openList(chip, focus) {
    closeList(); listOf = chip.id;
    const n = chip.members.length, box = el('div', 'bec-list'), h = el('h3', null, `접힌 숫자 ${n}개`), x = el('button', null, '닫기'), rows = el('div', 'bec-rows');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', `접힌 숫자 ${n}개`);
    x.type = 'button'; x.addEventListener('click', () => { closeList(); ui.cOver.focus(); schedule(D_OVER); });
    h.append(x);
    for (const it of chip.members) {
      const a = it.a, r = el('a');
      r.href = BE.tvUrl(cur.c.usd, a.tf); r.target = '_blank'; r.rel = 'noopener'; r.title = `TradingView ${a.tf} 차트를 엽니다.`;
      r.append(numEl(a), el('span', 'm', spanText(a.s, a.e)), el('span', 'bec-go', '↗'));
      rows.append(r);
    }
    box.append(h, rows); ui.chart.append(box);
    // not taller than 60% of the chart: the rows scroll inside
    rows.style.maxHeight = Math.max(60, Math.floor(M.H * 0.6) - (box.offsetHeight - rows.offsetHeight)) + 'px';
    // beside the chip: right of it, or left where the chart ends; held inside the chart
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let left = chip.x + chip.w + 8; if (left + bw > M.W - 4) left = chip.x - 8 - bw;
    box.style.left = clamp(left, 4, Math.max(4, M.W - bw - 4)) + 'px';
    box.style.top = clamp(chip.dir === SELL ? chip.y - 2 : chip.y + chip.h + 2 - bh, 4, Math.max(4, M.H - bh - 4)) + 'px';
    box.addEventListener('keydown', (e) => {
      const links = [...rows.querySelectorAll('a')], i = links.indexOf(document.activeElement);
      if (e.key === 'Escape') { closeList(); ui.cOver.focus(); schedule(D_OVER); e.preventDefault(); e.stopPropagation(); }
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && links.length) { links[clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, links.length - 1)].focus(); e.preventDefault(); }
    });
    ui.list = box;
    if (focus) { const first = rows.querySelector('a'); if (first) first.focus(); }
  }

  // ---------- pointer, wheel, keyboard ----------
  // A click or a tap on a thing. A number or a condition: the first one pins its tooltip, with the link to the
  // TradingView chart of its timeframe; a second one opens that chart. A chip: its list is pinned beside it (again:
  // the list closes). Elsewhere: what was pinned is let go.
  function click(t, touch) {
    if (t && t.type === 'chip') {
      const same = listOf === t.chip.id;
      pinned = null; hover = null; hideTip();
      if (same) closeList(); else openList(t.chip, false);
      schedule(D_OVER | D_SOVER); return;
    }
    closeList();
    if (t && (t.type === 'label' || t.type === 'cond' || t.type === 'edge')) {
      if (isPinned(t) && t.type !== 'edge') { openChart(t.type === 'label' ? t.it.a.tf : t.q.tf); return; }
      pinned = t.type === 'label' ? { type: 'label', a: t.it.a } : t.type === 'cond' ? { type: 'cond', q: t.q } : { type: 'edge', above: t.e.above };
      hover = touch ? null : t; showThing(t, 'pin', touch); schedule(D_OVER | D_SOVER);
      return;
    }
    // elsewhere: a tap shows the day under the finger
    const had = !!pinned; pinned = null;
    if (touch && t && t.type === 'day') { hover = { type: 'day', day: t.day, y: null }; showTip(dayTip(t.day), { touch }); }
    else if (touch || had) { if (touch) hover = null; hideTip(); }
    schedule(D_OVER | D_SOVER);
  }
  // the tooltip of the keyboard's place, next to it; the same in words for screen readers
  function showCursor() {
    flushNow();
    if (!cursor || !M) { hideTip(); return; }
    if (cursor.zone && !M.zone) cursor = { day: win.d1, pick: null };   // the zone has left the window
    const r = ui.cOver.getBoundingClientRect(), t = picked();
    let nodes;
    if (t) { nodes = tipOf(t, 'key'); showThing(t, 'key', null); }
    else if (cursor.zone) { nodes = zoneTip(); BE.tip.show(r.left + M.zx.x0 - 300, r.top + M.plotT + 16, nodes); }
    else { nodes = dayTip(cursor.day); BE.tip.show(r.left + M.X(cursor.day), r.top + M.plotT + 16, nodes); }
    ui.live.textContent = sayOf(nodes);
    schedule(D_OVER | D_SOVER);
  }
  // the nearest day beyond `from` (dir -1 before it, 1 after it) that has a number, a mark or a chip at this zoom
  function numberDay(from, dir) {
    const all = cur.all, show = (a) => selected(a) && M.lod.modes[a.j][a.kind] !== 'none';
    if (dir > 0) { for (let i = firstAt(from + 1); i < all.length; i++) if (show(all[i])) return all[i].day; return null; }
    for (let i = firstAt(from) - 1; i >= 0; i--) if (show(all[i])) return all[i].day;
    return null;
  }
  function wireChart() {
    const cv = ui.cOver;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    let wheelX = 0, hkey = '';
    const keyOf = (t) => (!t ? '' : t.type === 'label' ? `l${t.it.a.j}:${t.it.a.k}` : t.type === 'cond' ? `c${t.q.j}:${t.q.k}:${t.q.f}:${t.q.o}:${t.q.d}` : t.type === 'chip' ? `f${t.chip.id}` : t.type === 'edge' ? `e${t.e.above}` : t.type === 'day' ? `d${t.day}` : '');
    cv.addEventListener('pointerdown', (e) => {
      if (!cur || !M || e.button > 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {   // two fingers: zoom around the point between them
        const [p, q] = [...pointers.values()], T = spanT(), anchor = dayAt((p.x + q.x) / 2 - cv.getBoundingClientRect().left);
        pinch = { dist: Math.max(12, Math.hypot(p.x - q.x, p.y - q.y)), T, anchor, rel: (anchor + 0.5 - win.d0) / T };
        drag = null; hover = null; hideTip(); cv.classList.remove('bec-drag');
        return;
      }
      const [x, y] = pos(e), touch = e.pointerType === 'touch';
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, d0: win.d0, T: spanT(), moved: false, slip: 0, touch, hit: hitAt(x, y, touch ? 6 : 0), plot: x >= M.plotL };
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
        drag.slip = Math.max(drag.slip, Math.abs(dx), Math.abs(e.clientY - drag.y));
        if (!drag.moved && Math.abs(dx) > 4 && drag.plot) { drag.moved = true; cv.classList.add('bec-drag'); hover = null; hideTip(); schedule(D_OVER); }
        if (drag.moved) { if (setView(drag.d0 + Math.round(-dx / M.ppd), drag.T)) moved(); return; }
      }
      if (e.pointerType === 'touch') return;   // a finger has no hover: a tap shows
      const [x, y] = pos(e), t = hitAt(x, y), k = keyOf(t);
      const thing = t && t.type !== 'zone' ? t : null;
      cv.style.cursor = thing && thing.type !== 'day' ? 'pointer' : '';
      if (k !== hkey || (thing && thing.type === 'day')) { hkey = k; hover = thing; schedule(D_OVER | D_SOVER); }
      // the tooltip: of the thing under the pointer; else the pinned one stays; else the day's
      if (thing && thing.type !== 'day') { const pin = isPinned(thing), key = k + (pin ? '!' : ''); if (tipKey !== key) { showThing(thing, pin ? 'pin' : 'hover', null); tipKey = key; } }
      else if (pinned) { const p = pinnedThing(); if (!p) { pinned = null; hideTip(); } else if (tipKey !== 'pin') { showThing(p, 'pin', null); tipKey = 'pin'; } }
      else if (thing) { tipKey = ''; showTip(dayTip(thing.day), { x: e.clientX, y: e.clientY }); }
      else hideTip();
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag; drag = null; cv.classList.remove('bec-drag');
      if (d.moved || e.type !== 'pointerup' || !cur || !M) return;
      if (d.slip >= 3) return;   // a press that slipped is no click
      const t = d.hit && d.hit.type !== 'zone' ? d.hit : null;
      click(t, d.touch ? { x: e.clientX, y: e.clientY } : null);
      tipKey = pinned && !d.touch ? 'pin' : '';
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch') return;
      hkey = ''; cv.style.cursor = '';
      if (hover) { hover = null; schedule(D_OVER | D_SOVER); }
      // (a pinned tooltip stays: the pointer may be on its way to the link in it)
      if (pinned) { const p = pinnedThing(); if (p && tipKey !== 'pin') { showThing(p, 'pin', null); tipKey = 'pin'; } } else hideTip();
    });
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
      if (t && t.type !== 'day') return;   // on a number, a chip or a condition the two clicks have done their work
      applyPreset(); cursor = null; moved();
    });
    cv.addEventListener('keydown', (e) => {
      if (!cur || !M || e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key, span = win.d1 - win.d0 + 1;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        const s = k === 'ArrowLeft' ? -1 : 1;
        if (e.shiftKey) {   // the window moves; the day cursor stays inside it (one in the zone goes back to the newest day when the zone leaves)
          if (panBy(s * Math.max(1, Math.round(span * 0.1)))) moved();
          if (cursor) cursor = cursor.zone && win.end ? cursor : { day: clamp(cursor.day != null ? cursor.day : win.d1, win.d0, win.d1), pick: null };
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
        hover = null; pinned = null;
        if (cursor) showCursor(); else hideTip();
      } else if (k === 'ArrowUp' || k === 'ArrowDown') {
        // through the numbers of the day (or the conditions of the zone). Without a day cursor the key is the page's;
        // with one it is always taken, so that the page does not scroll under the cursor
        if (!cursor) return;
        const list = thingsAt();
        if (list.length) { const to = cursor.pick == null ? (k === 'ArrowDown' ? 0 : list.length - 1) : cursor.pick + (k === 'ArrowDown' ? 1 : -1); cursor.pick = to < 0 || to >= list.length ? null : to; }
        hover = null; pinned = null; showCursor();
      } else if (k === 'PageUp' || k === 'PageDown') {
        // to the day before, or after, that has a number
        const s = k === 'PageUp' ? -1 : 1, from = cursor && cursor.day != null ? cursor.day : s < 0 ? win.d1 + 1 : cursor && cursor.zone ? LAST : win.d0 - 1;
        const day = numberDay(from, s);
        if (day != null) {
          cursor = { day, pick: null };
          if (day < win.d0 || day > win.d1) { if (setView(day + 0.5 - spanT() / 2, spanT())) moved(); }
          hover = null; pinned = null; showCursor();
        }
      } else if (k === 'Home' || k === 'End') {
        if (k === 'Home' ? setView(cur.first, spanT()) : toNewest()) moved();
        cursor = { day: k === 'Home' ? win.d0 : win.d1, pick: null }; showCursor();
      } else if (k === '+' || k === '=' || k === '-' || k === '_') {
        if (zoomKey(cursor && cursor.day != null ? cursor.day : null, k === '+' || k === '=' ? 0.8 : 1.25)) moved();
        if (cursor) { cursor.pick = null; if (cursor.zone && !win.end) cursor = { day: win.d1, pick: null }; }
        if (cursor) showCursor();
      } else if (k === 'Enter' || k === ' ') {
        // the chosen number or condition (by the keys, or pinned by a click): its TradingView chart; a chip: its list
        const t = picked() || pinnedThing(); if (!t || t.type === 'edge') return;
        if (t.type === 'chip') { hideTip(); openList(t.chip, true); schedule(D_OVER); }
        else openChart(t.type === 'label' ? t.it.a.tf : t.q.tf);
      } else if (k === 'Escape') {
        if (listOf) { closeList(); schedule(D_OVER); }
        else if (pinned) { pinned = null; hideTip(); schedule(D_OVER | D_SOVER); }
        else if (!cursor) return;
        else if (cursor.pick != null) { cursor.pick = null; showCursor(); }
        else { cursor = null; hideTip(); ui.live.textContent = ''; schedule(D_OVER | D_SOVER); }
      } else return;
      e.preventDefault();
    });
    cv.addEventListener('focus', () => schedule(D_OVER));
    cv.addEventListener('blur', () => { if (cursor) { cursor = null; if (!pinned) hideTip(); ui.live.textContent = ''; } schedule(D_OVER | D_SOVER); });
  }
  // a press outside: the 설정 panel and a chip's list close, and what a click or a tap had pinned is let go
  const onAway = (e) => {
    if (!ui) return;
    const t = e.target, tip = BE.tip.el;
    if (ui.set && !ui.set.hidden && !ui.set.contains(t) && !ui.more.contains(t)) setPanel(false);
    if (ui.list && !ui.list.contains(t) && t !== ui.cOver) { closeList(); schedule(D_OVER); }
    if (t === ui.cOver || (tip && tip.contains(t))) return;
    if (pinned || (hover && e.pointerType !== 'mouse')) { pinned = null; hover = null; hideTip(); schedule(D_OVER | D_SOVER); }
  };
  const onKey = (e) => { if (e.key === 'Escape' && ui && ui.set && !ui.set.hidden) { setPanel(false); ui.more.focus(); } };

  // ---------- around the picture: captions, the conditions in a narrow room, the legend line, 설명 ----------
  function syncHead() {
    const m = M;
    ui.winText.textContent = `${iso(m.d0)} ~ ${iso(m.d1)} · ${nf(m.n)}일`;
    ui.nowBtn.hidden = m.atEnd;
    ui.rangeCtl.sync(); ui.rangeCtl.rove();
    const shown = m.items.filter(drawn).length;
    ui.cOver.setAttribute('aria-label', `${cur.c.s} 일봉 차트. ${iso(m.d0)}부터 ${iso(m.d1)}까지이고, 9와 13이 ${nf(shown)}개 있습니다. 좌우 화살표 키로 날짜를 옮기고, 위아래 화살표 키로 그 날짜의 숫자를 고릅니다.`);
    renderConds(); renderFoot();
    // a chip's list that is pinned follows its chip (the chips are laid out anew), or closes with it
    if (listOf) { const c = m.chips.find((x) => x.id === listOf), had = ui.list && ui.list.contains(document.activeElement); if (c) openList(c, had); else closeList(); }
  }
  function captions() {
    ui.capStrip.replaceChildren(el('b', null, '전체 기간'), document.createTextNode(nar
      ? '계열 색 눈금은 13이고, 파란 상자는 아래 차트의 구간입니다.'
      : `${iso(cur.first)} ~ ${iso(LAST)}의 종가(로그 축)와 ${TFS.length}개 타임프레임의 9와 13입니다. 회색 눈금은 9이고 계열 색 눈금은 13이며, 파란 상자는 아래 차트의 구간입니다.`));
    ui.capChart.textContent = nar
      ? '숫자는 그 타임프레임 봉의 마지막 날에 있고, 위 첨자는 타임프레임입니다.'
      : '숫자는 그 타임프레임 봉의 마지막 날에 있고, 위 첨자는 타임프레임입니다. 봉 위는 매도 쪽이고 봉 아래는 매수 쪽이며, 색은 계열이고 회색은 9입니다.';
    ui.sOver.setAttribute('aria-valuemin', cur.first); ui.sOver.setAttribute('aria-valuemax', LAST);
  }
  // In a narrow room the conditions stand under the chart: one line that says how many there are and which is the
  // nearest; a tap opens the list, one line a condition (mark, family and side, distance); a tap on a line opens its
  // prices, its sentence, its bars and the link to its chart.
  const condKey = (q) => `${q.j}.${q.k}.${q.d}.${q.f}.${q.o}`;
  function renderConds() {
    const m = M, box = ui.conds;
    const key = !m.list ? '' : [cur.c.slug, S.near, INK.join(), m.empty, condsOpen, condRow, m.conds.map(condKey).join(',')].join('|');
    if (box.dataset.key === key) return;
    box.dataset.key = key; box.hidden = !m.list; box.replaceChildren();
    if (!m.list) return;
    if (!m.conds.length) { const p = el('p', 'hint'); p.append(el('b', null, '다음 봉 조건'), ' ', m.empty ? '켜 둔 타임프레임이 없습니다.' : '지금은 9나 13이 나올 조건이 없습니다.'); box.append(p); return; }
    const first = m.conds[0], sum = el('button', 'bec-csum');
    sum.type = 'button'; sum.setAttribute('aria-expanded', String(condsOpen));
    const chev = el('span', 'bec-chev', condsOpen ? '접기' : '펼치기'); chev.dataset.g = condsOpen ? '▴' : '▾';   // (the sign stands for the word where the line would not fit)
    sum.append(el('b', null, `다음 봉 조건 ${m.conds.length}개`), el('span', null, '· 가장 가까운 조건'), waitEl(first), el('span', 'bec-dist', first.fire.now ? '충족' : fmtPct(first.fire.pct)), chev);
    sum.addEventListener('click', () => { condsOpen = !condsOpen; if (!condsOpen) condRow = null; renderConds(); });
    box.append(sum);
    if (!condsOpen) return;
    for (const q of m.conds) {
      const k = condKey(q), open = condRow === k, r = el('div', 'bec-crow' + (open ? ' bec-on' : '')), b = el('button'), end = el('span', 'bec-end');
      b.type = 'button'; b.setAttribute('aria-expanded', String(open));
      b.append(waitEl(q), el('span', null, condName(q)));
      if (q.fire.now) end.append(el('span', 'bec-met', '충족'));
      else { if (q.near) end.append(el('span', 'bec-near', '임박')); end.append(el('span', 'bec-dist', fmtPct(q.fire.pct))); }
      b.append(end);
      b.addEventListener('click', () => { condRow = open ? null : k; renderConds(); });
      r.append(b);
      if (open) {
        const body = el('div', 'bec-cbody'), meta = el('div', 'bec-meta'), a = el('a', null, `TradingView ${q.tf} 차트 ↗`);
        a.href = BE.tvUrl(cur.c.usd, q.tf); a.target = '_blank'; a.rel = 'noopener';
        meta.append(dated(null, condMeta(q)), a);
        // (the price that decides with its comparison, as the zone's tooltip says it; then the sentence and the bars)
        body.append(el('p', 'bec-fire', BE.fireText(q.fire)), el('p', 'bec-sent', condSentence(q)), meta); r.append(body);
      }
      box.append(r);
    }
  }
  // Under the chart: ONE legend line, only of what the picture shows now and the captions and the 계열 buttons do not
  // say, and one line about the data where it applies. Nothing to say: no panel.
  function renderFoot() {
    const m = M, items = m ? m.items : [];
    const has = { rep: false, mark: false, gone: false, lead: false, def: false, late: 0 };
    for (const it of items) {
      if (!drawn(it)) continue;
      if (it.a.rep && it.shown === 'text') has.rep = true;
      if (it.shown === 'mark') has.mark = true;
      if (it.a.gone) has.gone = true;
      if (it.lead && it.shown === 'text') has.lead = true;
      if (it.a.kind === 'I' && it.shown === 'text') has.def = true;
      if (it.a.late) has.late++;
    }
    const chip = m && m.chips.length ? m.chips.find((c) => c.n13) || m.chips[0] : null;
    if (m) for (const c of m.chips) if (c.lead) has.lead = true;
    const key = [has.rep, has.mark, has.gone, has.lead, has.def, has.late, chip ? chip.is13 : '-', INK.join(), INK9].join('|');
    if (ui.foot.dataset.key === key) return;
    ui.foot.dataset.key = key;
    const lg = el('div', 'legend'), f0 = BE.FAMS.find((f) => BE.famOn(f)) ?? BE.FAMS[0];
    const item = (...parts) => { const s = el('span'); for (const p of parts) s.append(typeof p === 'string' ? document.createTextNode(p) : p); lg.append(s); };
    const glyph = (cls, color) => { const i = el('i', 'bec-g ' + cls); if (color) i.style.background = color; return i; };
    if (has.rep) item(numEl({ kind: 'S', text: '9', tf: '1D', rep: true }), '반복 9');
    if (has.def) item(numEl({ kind: 'I', f: f0, text: '+13', tf: '1D' }), '13이 미뤄진 봉');
    if (chip) {
      const c = el('span', 'bec-chipx');
      if (chip.is13) { for (const f of BE.FAMS.filter((x) => BE.famOn(x)).slice(0, 2)) { const i = el('i'); i.style.background = INK[f]; c.append(i); } c.append(el('b', null, '13 2개')); } else c.append('9 2개');
      item(c, '자리가 모자라 접힌 숫자');
    }
    if (has.mark) item(glyph('bec-gm', INK[f0]), glyph('bec-gm9'), '숫자 대신 놓은 표시 (색은 13, 회색은 9)');
    if (has.gone) item(numEl({ kind: 'C', f: f0, text: '13', tf: '1D', gone: true }), 'TradingView 차트에서 지워진 라벨');
    if (has.lead) item(glyph('bec-gl'), '숫자와 그 날의 봉을 잇는 선');
    const nodes = [];
    if (lg.children.length) nodes.push(lg);
    if (has.late) nodes.push(el('p', 'hint', `봉의 마지막 날에 TradingView 일봉이 없는 숫자 ${nf(has.late)}개는 그 봉에서 일봉이 있는 마지막 날에 놓았습니다.`));
    ui.foot.hidden = !nodes.length; ui.foot.replaceChildren(...nodes);
  }
  // 설명: how the picture is read and handled, as short sentences (asked for by the shell when the panel opens)
  function help() {
    let mouse = true; try { mouse = matchMedia('(hover: hover)').matches; } catch (e) { /* old browsers: as with a mouse */ }
    const sec = (title, lines) => { const s = el('section'); s.append(el('h3', null, title), ...lines.filter(Boolean).map((t) => el('p', null, t))); return s; };
    const out = [el('h2', null, 'Bird Eye 차트 읽는 법')];
    out.push(sec('차트', [
      `한 종목의 일봉 차트 한 장에 ${TFS.length}개 타임프레임의 9와 13을 적었습니다.`,
      '숫자의 글자는 TradingView 차트의 라벨과 같고, 크기는 타임프레임과 상관없이 하나입니다.',
      '숫자가 한곳에 몰리면 긴 타임프레임의 13부터 남기고, 나머지는 개수를 적은 칩으로 접습니다.',
      '13을 접어야 하는 자리에서는 9를 먼저 작은 회색 표시로 바꿉니다.',
      '기간을 넓히면 짧은 타임프레임의 숫자부터 작은 색 표시로 바뀝니다.',
      '더 넓히면 봉은 가는 막대와 선으로 바뀝니다.',
    ]));
    out.push(sec('다음 봉 조건', [
      '차트 오른쪽 끝에는 진행 중인 봉에 9나 13이 나오는 조건가가 있습니다.',
      '조건가가 임박 기준 안에 들어오면 테두리가 실선으로 바뀌고 바탕색이 생깁니다.',
      mouse ? '조건에 마우스를 올리면 조건가와, 조건가에 닿은 뒤 종가가 지켜야 하는 가격이 선으로 나옵니다.' : '좁은 화면에서는 차트 아래의 한 줄을 누르면 조건 목록이 나옵니다.',
    ]));
    if (mouse) {
      out.push(sec('마우스', [
        '차트나 전체 기간의 파란 상자를 좌우로 끌면 기간이 옮겨집니다.',
        'Ctrl 키(Mac은 Command 키)를 누른 채 휠을 돌리면 확대되거나 축소됩니다.',
        '차트를 두 번 누르면 고른 기간의 최근 구간으로 돌아갑니다.',
        '숫자에 마우스를 올리면 그 봉의 기간과 출발 봉이 나옵니다.',
        '숫자를 누르면 그 설명이 고정되고, 한 번 더 누르면 그 타임프레임의 TradingView 차트가 열립니다.',
        '칩을 누르면 접힌 숫자의 목록이 나옵니다.',
        '전체 기간에 마우스를 올리면 날짜가 나오고, 눈금 위에서는 그 숫자의 설명이 나옵니다.',
      ]));
      out.push(sec('키보드', [
        '좌우 화살표 키는 날짜를 옮깁니다.',
        '위아래 화살표 키는 그 날짜의 숫자를 고릅니다.',
        'Page Up 키와 Page Down 키는 숫자가 있는 이전 날과 다음 날로 옮깁니다.',
        'Shift 키와 좌우 화살표 키는 기간을 옮깁니다.',
        '+ 키는 확대하고 - 키는 축소합니다.',
        'Home 키와 End 키는 가장 오래된 날과 최근 날로 옮깁니다.',
        'Enter 키는 고른 숫자의 TradingView 차트를 엽니다.',
        'Esc 키는 선택을 풉니다.',
      ]));
    } else {
      out.push(sec('손가락', [
        '차트를 좌우로 밀면 기간이 옮겨집니다.',
        '두 손가락을 벌리거나 모으면 확대되거나 축소됩니다.',
        '숫자를 누르면 그 봉의 기간과 출발 봉이 나오고, 한 번 더 누르면 그 타임프레임의 TradingView 차트가 열립니다.',
        '칩을 누르면 접힌 숫자의 목록이 나옵니다.',
      ]));
    }
    const gone = cur && cur.all.some((a) => a.gone);
    out.push(sec('데이터', [
      '일 단위 타임프레임은 TradingView 일봉으로 만들고, 주 단위는 1W 봉으로, 월 단위는 1M 봉으로 만듭니다.',
      '마감한 봉만 세고, 일봉이 없는 날은 채우지 않습니다.',
      gone ? (mouse ? '오래되어 TradingView 차트에서 지워진 라벨은 흐린 숫자로 남기고, 마우스를 올리면 지워진 라벨이라고 나옵니다.' : '오래되어 TradingView 차트에서 지워진 라벨은 흐린 숫자로 남기고, 누르면 지워진 라벨이라고 나옵니다.') : null,
      cur && cur.late ? '봉의 마지막 날에 일봉이 없으면 숫자는 그 봉에서 일봉이 있는 마지막 날에 있습니다.' : null,
    ]));
    const wrap = el('div', 'bec-help'); wrap.style.cssText = 'display:grid;gap:10px'; wrap.append(...out);
    return [wrap];
  }

  // ---------- controls ----------
  // after a setting changed: everything is laid out again
  function reset(size) { hover = null; pinned = null; closeList(); hideTip(); syncControls(); if (cur) schedule(D_LAYOUT | D_STRIP | (size ? D_SIZE : 0)); }
  // one Tab stop for a group of buttons: the arrow keys move inside it
  function rove(group) {
    const buttons = () => [...group.querySelectorAll('button')];
    const sync = () => { const list = buttons(), at = list.includes(group.at) ? group.at : list.find((b) => b.getAttribute('aria-pressed') === 'true') || list[0]; for (const b of list) b.tabIndex = b === at ? 0 : -1; };
    group.addEventListener('keydown', (e) => {
      const list = buttons(), i = list.indexOf(document.activeElement); if (i < 0) return;
      const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : -2;
      if (to === -2) return;
      e.preventDefault(); const b = list[clamp(to, 0, list.length - 1)]; group.at = b; sync(); b.focus();
    });
    group.addEventListener('focusin', (e) => { if (e.target && e.target.tagName === 'BUTTON') { group.at = e.target; sync(); } });
    sync();
    return sync;
  }
  // a labelled group of toggle buttons: list [[key, text, title]], on(key) -> true | false | 'mixed', flip(key)
  function toggles(label, cls, list, on, flip) {
    const wrap = el('div', 'ctl'), s = el('span', null, label), g = el('div', 'seg ' + cls);
    s.id = 'bec-lb-' + cls; g.setAttribute('role', 'group'); g.setAttribute('aria-labelledby', s.id);
    const sync = () => g.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(on(b.dataset.k))));
    for (const [k, text, title] of list) { const b = el('button', null, text); b.type = 'button'; b.dataset.k = k; if (title) b.title = title; b.addEventListener('click', () => flip(k)); g.append(b); }
    sync(); wrap.append(s, g); wrap.sync = sync; wrap.seg = g;
    return wrap;
  }
  const groupState = (g) => { const [s, e] = GROUPS[g]; let n = 0; for (let j = s; j <= e; j++) if (tfOn(j)) n++; return n === e - s + 1 ? true : n ? 'mixed' : false; };
  // the timeframes in the 설정 panel: a toggle each, in the three groups of the screener's table, and 모두 켜기
  function tfControl() {
    const wrap = el('div', 'ctl bec-tfs'), lab = el('span', null, '타임프레임'), boxes = el('div', 'bec-tfbox'), btns = [];
    lab.id = 'bec-lb-tf'; wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-labelledby', lab.id);
    const all = el('button', 'btn sm', '모두 켜기'); all.type = 'button'; all.title = '모든 타임프레임을 켭니다.';
    GROUPS.forEach(([s, e]) => {
      const box = el('div', 'bec-tfg');
      for (let j = s; j <= e; j++) {
        const b = el('button', null, TFS[j]); b.type = 'button';
        b.addEventListener('click', () => { S.off = tfOn(j) ? [...S.off, TFS[j]] : S.off.filter((t) => t !== TFS[j]); BE.save(); reset(); });
        btns[j] = b; box.append(b);
      }
      boxes.append(box);
    });
    all.addEventListener('click', () => { S.off = []; BE.save(); reset(); });
    boxes.append(all); wrap.append(lab, boxes);
    wrap.sync = () => { btns.forEach((b, j) => b.setAttribute('aria-pressed', String(tfOn(j)))); all.disabled = !S.off.length; };
    wrap.sync();
    return wrap;
  }
  // what in the 설정 panel is not as it is at first (in the narrow arrangement 계열 and 9 are in the panel too)
  function changed() {
    const out = [];
    if (S.off.length) out.push(`타임프레임 ${TFS.length - S.off.length}/${TFS.length}`);
    if (S.dir !== 'both') out.push(S.dir === 'buy' ? '매수 쪽만' : '매도 쪽만');
    if (S.def === 'on') out.push('+13 켬');
    if (S.scale !== 'auto') out.push(S.scale === 'log' ? '로그 축' : '선형 축');
    if (S.cond === 'off') out.push('다음 봉 조건 끔');
    if (S.near !== 5) out.push(`임박 기준 ${S.near}%`);
    if (nar) {
      if (S.nine === 'off') out.push('9 끔');
      if (BE.solo && BE.state.fam.length < BE.FAMS.length) out.push(`계열 ${BE.state.fam.length}/${BE.FAMS.length}`);
    }
    return out;
  }
  function syncControls() {
    if (!ui) return;
    for (const c of ui.syncs) c.sync();
    // the 설정 button says what differs from the defaults
    const ch = changed();
    ui.more.textContent = !ch.length ? '설정' : nar ? `바꾼 설정 ${ch.length}개` : ch.length === 1 ? `설정 · ${ch[0]}` : `설정 · ${ch[0]} 외 ${ch.length - 1}개`;
  }
  function setPanel(open) {
    ui.set.hidden = !open; ui.more.setAttribute('aria-expanded', String(open));
    ui.set.style.left = '';
    // under its button, held inside the row of controls
    if (open && !nar) ui.set.style.left = clamp(ui.more.offsetLeft, 8, Math.max(8, ui.ctl.clientWidth - ui.set.offsetWidth - 8)) + 'px';
  }
  // The arrangement follows the room. Wide: 계열, 9 and the timeframe groups stand in the row of controls, the
  // window's dates at its right end with the place of 최근 날짜로 before them. Narrow: the row is 기간 and 설정; the
  // others are in the 설정 panel, and the window's dates stand with the chart's caption, the button's place beside them.
  function arrange(force) {
    const now = chartW() < NARROW;
    if (now === nar && !force) return;
    nar = now;
    ui.ctl.classList.toggle('bec-nar', nar); ui.body.classList.toggle('bec-nar', nar);
    const mine = [ui.famCtl, ui.nineCtl, ui.grpCtl].filter(Boolean);
    if (nar) { ui.set.prepend(...mine); ui.caprow.append(ui.winText, ui.nowBtn); }
    else { for (const c of mine) ui.row.insertBefore(c, ui.more); ui.row.append(ui.nowBtn, ui.winText); }
    setPanel(false); syncControls();
    if (cur) captions();
  }

  // ---------- the probe: what is on the screen now (for checks) ----------
  // labels: every label the toggles and the window select (day: the day it is written at; s, e: the first and the last
  // calendar day of its timeframe bar), with how it is shown:
  //   'text'    a number: x, y, w, h its box; nx, nw the left edge and the width of its digits (the superscript follows);
  //             al 'c' digits centered on the day | 'l' / 'r' the box before / after its day | 'e' held by the plot's
  //             end; far: px from its candle's end; lead: a line is painted from its candle to it
  //   'mark'    a small mark at its candle (x, y, w, h)
  //   'folded'  in a chip: x, y, w, h are the chip's box and group its id
  //   'strip'   not drawn on the chart at this zoom: the strip has its tick ('none': a +13, which the strip does not show)
  // folds: the chips (n numbers: n13 13s of the families fams, or n9 9s; text as painted); list: the chip list that is
  // pinned, or null; strip: every tick as it is painted (y and h snapped to device pixels; gone: of a label deleted on
  // TradingView); conds: every condition ('in' the
  // zone at its price with style 'far' | 'near' | 'now'; 'above' / 'below' counted in the line of that edge, whose box
  // it has; 'list' in a narrow room: the box is its row's or, while the list is closed, the summary line's, measured
  // from the chart's corner). Coordinates are CSS px of the chart canvas (strip: of the strip's).
  // Besides: the scales (plot.x0 = the left edge of day d0, ys: y = a - b * price, or of ln(price) on a log scale;
  // stripScale: x = x0 + (day - first) * ppd, the lane of the close between laneT and buyT), the sizes in force, and
  // lod.modes: per timeframe how a 13 (C), a 9 (S) and a +13 (I) are shown at this zoom. handles: always empty (the
  // chart no longer unfolds in place).
  function probe() {
    flushNow();
    if (!cur || !M || !SM) return null;
    const m = M, cv = ui.cBase.getBoundingClientRect(), rows = m.list ? ui.conds.querySelectorAll('.bec-crow') : null, sum = m.list ? ui.conds.querySelector('.bec-csum') : null;
    const rel = (e) => { const r = e ? e.getBoundingClientRect() : null; return r ? { x: r.left - cv.left, y: r.top - cv.top, w: r.width, h: r.height } : { x: 0, y: 0, w: 0, h: 0 }; };
    const listChip = listOf ? m.chips.find((c) => c.id === listOf) : null;
    // (a strip tick as it is painted: snapped to device pixels, which matters where the rows are 1.5 px apart)
    const dpr = window.devicePixelRatio || 1, snap = (v) => Math.round(v * dpr) / dpr;
    return {
      coin: cur.c.slug, sym: cur.c.s, d0: m.d0, d1: m.d1, end: m.atEnd, ppd: m.ppd, scale: m.log ? 'log' : 'lin', late: cur.late, ms: m.ms, paintMs: m.paintMs || 0, passes: m.passes, restarts: m.restarts,
      lod: { candle: m.lod.candle, nineText: m.lod.nineText, all13: m.lod.all13, modes: m.lod.modes.map((x) => ({ ...x })) },
      size: { key: Z.key, num: Z.num, sup: Z.sup, def: Z.def, supDef: Z.supDef, row: Z.lh + 1, chip: Z.chip },
      plot: { l: m.plotL, r: m.plotR, t: m.plotT, b: m.plotB, w: m.W, h: m.H, x0: m.plotL + m.padL }, ys: { ...m.ys }, last: cur.det.last, narrow: m.nar, empty: m.empty,
      stripScale: { x0: SM.x0, x1: SM.x1, ppd: SM.ppd, first: cur.first, sellT: SM.sellT, buyT: SM.buyT, bandH: SM.bandH, pitch: SM.pitch, laneT: SM.laneT, lineT: SM.yA, lineB: SM.yZ },
      labels: m.items.map((it) => ({ j: it.a.j, tf: it.a.tf, bar: it.a.bar, day: it.a.day, s: it.a.s, e: it.a.e, dir: it.a.dir, kind: it.a.kind, f: it.a.f, text: it.a.text,
        shown: it.shown, x: it.x, y: it.y, w: it.w, h: it.h, group: it.group, lead: it.shown === 'text' && it.lead, late: it.a.late, gone: it.a.gone,
        ...(it.shown === 'text' ? { nx: it.x + 1, nw: it.nw, al: it.al, far: it.far } : {}) })),
      folds: m.chips.map((c) => ({ group: c.id, x: c.x, y: c.y, w: c.w, h: c.h, n: c.members.length, n13: c.n13, n9: c.n9, fams: c.fams.slice(), text: c.text, lead: c.lead })),
      handles: [],
      list: listChip && ui.list ? { group: listOf, n: listChip.members.length, ...rel(ui.list), rows: [...ui.list.querySelectorAll('.bec-rows a')].map((a) => a.textContent.replace(/\s+/g, ' ').trim()) } : null,
      pinned: pinned ? pinned.type : null,
      strip: SM.ticks.map((t) => { const y = snap(t.y); return { j: t.a.j, dir: t.a.dir, kind: t.a.kind, f: t.a.f, bar: t.a.bar, x0: t.x0, x1: t.x1, y, h: Math.max(1 / dpr, snap(t.y + t.h) - y), gone: t.a.gone }; }),
      stripBox: { ...stripBox(), w: SM.W, h: SM.H },
      zone: m.zone ? { x0: m.zx.x0, x1: m.zx.x1, edges: m.edges.map((e) => ({ above: e.above, n: e.list.length, text: e.text, x: e.x, y: e.y, w: e.w, h: e.h })) } : null,
      conds: m.conds.map((q, i) => {
        let b = { x: q.bx, y: q.by, w: q.bw, h: q.bh };
        if (m.list) b = rel(rows && rows[i] ? rows[i] : sum);
        return { j: q.j, tf: q.tf, k: q.k, d: q.d, f: q.f, o: q.o, p: q.fire.p, q: q.fire.q, pct: q.fire.pct, now: q.fire.now, near: q.near, style: q.style, shown: q.shown,
          level: q.fire.pc ? { ...q.fire.pc } : null, closeLevel: q.fire.qc && q.fire.q !== q.fire.p ? { ...q.fire.qc } : null, ...b };
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
    cur = null; win = null; M = null; SM = null; hover = null; shover = null; cursor = null; pinned = null; condRow = null; closeList(); hideTip(); setPanel(false);
    showWait([el('span', null, '불러오는 중입니다…')], true);
    BE.detail(c).then((det) => {
      if (my !== seq || !root) return;   // another coin was chosen meanwhile, or the view was left
      prepare(c, det);
      ui.wait.hidden = true; ui.wait.style.minHeight = ''; ui.body.hidden = false;
      arrange(true); applyPreset();
      sized = { c: '', s: '' }; ui.conds.dataset.key = '?'; ui.foot.dataset.key = '?';
      schedule(D_SIZE); flushNow();
    }, (err) => {
      if (my !== seq || !root) return;
      // a coin without data has nothing to try again; a newer build asks for a reload; anything else can be tried again
      const noData = !c || !c.usd || !c.t, stale = !!(err && err.stale);
      const nodes = [el('p', null, noData ? `${err && err.message ? String(err.message) : '데이터가 없습니다'}.` : stale ? '이 화면을 연 뒤에 새 데이터가 배포되었습니다. 새로고침하면 최신 데이터로 다시 엽니다.' : '일봉 데이터를 불러오지 못했습니다. 다시 시도해 주세요.')];
      if (!noData) { const b = el('button', 'btn', stale ? '새로고침' : '다시 시도'); b.type = 'button'; b.addEventListener('click', () => (stale ? location.reload() : load())); nodes.push(b); }
      showWait(nodes, false);
    });
  }
  // the chart follows the window's height: lay it out again when only that has changed (not in the narrow arrangement,
  // where the height changes while the page scrolls)
  const onResize = () => { clearTimeout(tallTimer); tallTimer = setTimeout(() => { if (root && cur && !nar && window.innerHeight !== seenH) schedule(D_SIZE); }, 160); };

  BE.register({
    view: 'chart', key: 'a', name: 'Bird Eye 차트', solo: true, lateFonts: true,
    blurb: `한 종목의 일봉 차트 한 장에 ${TFS.length}개 타임프레임의 9와 13을 적었습니다. 숫자는 그 타임프레임의 봉이 마감한 날에 있고, 위 첨자는 타임프레임이고 색은 계열입니다. `
      + '위의 전체 기간 띠는 9와 13이 나온 자리를 타임프레임마다 한 줄로 보여 주고, 차트 오른쪽 끝에는 진행 중인 봉에 9나 13이 나오는 조건가가 있습니다.',
    help,
    mount(node) {
      root = node;
      if (!document.getElementById(CSS_ID)) { const st = document.createElement('style'); st.id = CSS_ID; st.textContent = CSS; document.head.append(st); }
      S = BE.vstate(ID, { range: 'auto', scale: 'auto', off: [], nine: 'on', def: 'off', dir: 'both', cond: 'on', near: 5 });
      const oneOf = (k, allowed, def) => { if (!allowed.includes(S[k])) S[k] = def; };
      oneOf('range', ['auto', ...RANGES.map((r) => r[0])], 'auto'); oneOf('scale', ['auto', 'lin', 'log'], 'auto'); oneOf('nine', ['on', 'off'], 'on');
      oneOf('def', ['on', 'off'], 'off'); oneOf('dir', ['both', 'buy', 'sell'], 'both'); oneOf('cond', ['on', 'off'], 'on'); oneOf('near', NEARS, 5);
      S.off = Array.isArray(S.off) ? S.off.filter((t) => TFS.includes(t)) : [];
      ui = {}; cur = null; win = null; M = null; SM = null; hover = null; shover = null; cursor = null; pinned = null; listOf = null; nar = false; condsOpen = false; condRow = null; sized = { c: '', s: '' }; dirty = 0;
      readInks();

      // ---- the row of controls: 기간, 계열 (on a solo page), 9, the timeframe groups, 설정; the window's dates at its end ----
      const ctl = ui.ctl = el('div', 'panel controls bec-ctl'); ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', 'Bird Eye 차트 보기 설정');
      const set = (k, size) => (v) => { S[k] = v; BE.save(); reset(size); };
      ui.row = el('div', 'bec-row');
      ui.rangeCtl = BE.seg('기간', RANGES.map((r) => [r[0], r[1]]), () => (win && win.custom ? '' : rangeKey()), (v) => { S.range = v; BE.save(); if (cur) { applyPreset(); cursor = null; moved(); } });
      ui.rangeCtl.rove = rove(ui.rangeCtl.querySelector('.seg'));
      ui.famCtl = BE.solo ? BE.famCtl : null;
      if (ui.famCtl) rove(ui.famCtl.querySelector('.seg'));
      ui.nineCtl = toggles('9 표시', 'bec-nine', [['9', '9', '9를 켜거나 끕니다.']], () => S.nine === 'on', () => { S.nine = S.nine === 'on' ? 'off' : 'on'; BE.save(); reset(); });
      ui.grpCtl = toggles('타임프레임 묶음', 'bec-grp', GROUPS.map(([s, e], g) => [String(g), `${TFS[s]}~${TFS[e]}`, `${TFS[s]}부터 ${TFS[e]}까지 한꺼번에 켜거나 끕니다.`]), (k) => groupState(Number(k)),
        (k) => { const [s, e] = GROUPS[Number(k)], names = TFS.slice(s, e + 1), on = names.every((t) => !S.off.includes(t)); S.off = on ? [...S.off, ...names] : S.off.filter((t) => !names.includes(t)); BE.save(); reset(); });
      rove(ui.grpCtl.seg);
      ui.more = el('button', 'btn sm bec-more', '설정'); ui.more.type = 'button'; ui.more.setAttribute('aria-expanded', 'false'); ui.more.setAttribute('aria-controls', 'bec-set');
      ui.more.addEventListener('click', () => setPanel(ui.set.hidden));
      ui.winText = el('span', 'bec-win');
      ui.nowBtn = el('button', 'btn sm bec-now', '최근 날짜로'); ui.nowBtn.type = 'button'; ui.nowBtn.hidden = true; ui.nowBtn.title = '마지막으로 마감한 날까지 보이도록 창을 옮깁니다.';
      ui.nowBtn.addEventListener('click', () => { if (cur && toNewest()) moved(); });
      ui.row.append(...[ui.rangeCtl, ui.famCtl, ui.nineCtl, ui.grpCtl, ui.more, ui.nowBtn, ui.winText].filter(Boolean));
      // ---- the 설정 panel: opens under its button; closes with Esc, a press outside, or the button ----
      ui.set = el('div', 'bec-set'); ui.set.id = 'bec-set'; ui.set.hidden = true; ui.set.setAttribute('role', 'group'); ui.set.setAttribute('aria-label', '설정');
      const scaleCtl = BE.seg('가격 축', [['auto', '자동'], ['lin', '선형'], ['log', '로그']], () => S.scale, set('scale'));
      const dirCtl = BE.seg('방향', [['both', '양쪽'], ['buy', '매수 쪽'], ['sell', '매도 쪽']], () => S.dir, set('dir'));
      const defCtl = BE.seg('+13 표시', [['on', '켬'], ['off', '끔']], () => S.def, set('def'));
      const condCtl = BE.seg('다음 봉 조건', [['on', '켬'], ['off', '끔']], () => S.cond, set('cond', true));
      const nearCtl = BE.seg('임박 기준', NEARS.map((x) => [x, `${x}%`]), () => S.near, set('near'));
      const tfCtl = tfControl();
      ui.set.append(scaleCtl, dirCtl, defCtl, condCtl, nearCtl, tfCtl);
      ui.syncs = [ui.nineCtl, ui.grpCtl, scaleCtl, dirCtl, defCtl, condCtl, nearCtl, tfCtl];
      ctl.append(ui.row, ui.set);

      ui.wait = el('div', 'panel loading bec-wait'); ui.wait.setAttribute('role', 'status');
      ui.body = el('div'); ui.body.style.cssText = 'display:grid;gap:inherit;min-width:0;grid-template-columns:minmax(0,1fr)'; ui.body.hidden = true;
      const pic = el('section', 'panel bec-pic'); pic.setAttribute('aria-label', 'Bird Eye 차트');
      const canvas = (cls) => { const cv = el('canvas', cls); if (!cls) cv.setAttribute('aria-hidden', 'true'); return cv; };
      ui.capStrip = el('p', 'bec-cap');
      ui.strip = el('div', 'bec-box bec-strip'); ui.sBase = canvas(''); ui.sOver = canvas('bec-over');
      ui.sOver.tabIndex = 0; ui.sOver.setAttribute('role', 'slider'); ui.sOver.setAttribute('aria-orientation', 'horizontal');
      ui.sOver.setAttribute('aria-label', '전체 기간 띠의 현재 창. 좌우 화살표 키로 창을 옮기고, + 키로 창을 좁히고 - 키로 창을 넓힙니다.');
      ui.strip.append(ui.sBase, ui.sOver);
      ui.caprow = el('div', 'bec-caprow'); ui.capChart = el('p', 'bec-cap'); ui.caprow.append(ui.capChart);
      ui.chart = el('div', 'bec-box bec-chart'); ui.cBase = canvas(''); ui.cOver = canvas('bec-over');
      ui.cOver.tabIndex = 0; ui.cOver.setAttribute('role', 'img');
      ui.chart.append(ui.cBase, ui.cOver);
      ui.live = el('div', 'sr-only'); ui.live.setAttribute('aria-live', 'polite');
      ui.conds = el('div', 'bec-conds'); ui.conds.hidden = true;
      pic.append(ui.capStrip, ui.strip, ui.caprow, ui.chart, ui.live, ui.conds);
      ui.foot = el('div', 'panel bec-foot'); ui.foot.hidden = true;
      ui.body.append(pic, ui.foot);
      root.append(ctl, ui.wait, ui.body);
      syncControls();
      wireStrip(); wireChart();
      // the picture follows its room: the chart's width, and where the chart begins (the rows over it can become
      // taller: a longer 설정 label that wraps the row of controls, a caption on two lines)
      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(() => {
          if (!ui || !cur || !M || !(ui.chart.clientWidth > 0)) return;
          if (Math.max(240, ui.chart.clientWidth) !== M.W || Math.round(ui.chart.getBoundingClientRect().top + window.scrollY) !== seenTop) schedule(D_SIZE);
        });
        for (const e of [ui.chart, ui.ctl, ui.capStrip, ui.caprow]) ro.observe(e);
      }
      addEventListener('resize', onResize);
      document.addEventListener('pointerdown', onAway, true);
      document.addEventListener('keydown', onKey);
      root.__probe = probe;
    },
    render(why) {
      if (!ui) return;
      if (why === 'mount' || why === 'coin') { load(); return; }
      if (!cur) return;   // still loading, or the message of a failed load is up
      if (why === 'fam') { reset(); return; }
      // new colors, or fonts have arrived: the text widths are measured again and everything is laid out with them
      if (why === 'theme') { TW.clear(); readInks(); ui.conds.dataset.key = '?'; ui.foot.dataset.key = '?'; schedule(D_SIZE | D_STRIP); return; }
      // resize: the default window, the strip's height and the arrangement follow the room
      hideTip(); hover = null; pinned = null;
      schedule(D_SIZE | D_STRIP);
    },
    unmount() {
      seq++; if (raf) cancelAnimationFrame(raf); raf = 0; dirty = 0; clearTimeout(tallTimer);
      if (ro) ro.disconnect(); ro = null;
      removeEventListener('resize', onResize); document.removeEventListener('pointerdown', onAway, true); document.removeEventListener('keydown', onKey);
      hideTip(); closeList();
      if (root) delete root.__probe;
      root = null; ui = null; cur = null; win = null; M = null; SM = null; hover = null; shover = null; cursor = null; pinned = null; drag = null; sdrag = null; pinch = null; pointers = new Map();
    },
  });
})();
